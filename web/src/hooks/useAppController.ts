import { useCallback, useMemo, useRef, useState } from 'react'
import { APP_CONFIG } from '../config'
import {
  buildTeamTable,
  getFileMeta,
  isAcceptedExcelFile,
  parseExcelFile,
  sanitizeFilename,
  scanTeamsFromWorkbook,
  type FileMeta,
  type ParsedWorkbook,
} from '../lib/excel'
import {
  downloadBlob,
  tableToPngBlob,
  zipExportItems,
  type ExportItem,
} from '../lib/exportImage'
import { appendJob, loadJobHistory, type JobRecord } from '../lib/jobs'
import {
  loadCache,
  mergeTeamsFromExcel,
  messageTextForTeam,
  saveCache,
  teamsForWhatsapp,
  type TeamConfig,
} from '../lib/storage'
import { validateWorkbook, type ValidationResult } from '../lib/validate'
import { useToast } from '../components/ui/Toast'

function todayFolder(): string {
  return new Date().toISOString().slice(0, 10)
}

export function useAppController() {
  const toast = useToast()
  const [cache, setCache] = useState(loadCache)
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [status, setStatus] = useState('Sẵn sàng')
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [lastExports, setLastExports] = useState<ExportItem[]>([])
  const [jobs, setJobs] = useState<JobRecord[]>(() => loadJobHistory())
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const teamNames = useMemo(
    () => Object.keys(cache.teams).sort((a, b) => a.localeCompare(b, 'vi')),
    [cache.teams],
  )

  const appendLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg])
  }, [])

  const updateTeam = (team: string, patch: Partial<TeamConfig>) => {
    setCache((prev) => ({
      ...prev,
      teams: { ...prev.teams, [team]: { ...prev.teams[team], ...patch } },
    }))
  }

  const handleSave = () => {
    const next = {
      ...cache,
      last_file_name: workbook?.fileName ?? cache.last_file_name,
    }
    saveCache(next)
    setCache(next)
    setStatus('Đã lưu cài đặt (trình duyệt)')
    appendLog('Đã lưu cài đặt nhóm WhatsApp.')
    toast.push('Đã lưu cài đặt', 'success')
  }

  const syncFromWorkbook = useCallback(
    (parsed: ParsedWorkbook, meta?: FileMeta) => {
      try {
        const val = validateWorkbook(parsed.workbook)
        setValidation(val)
        const excelTeams = scanTeamsFromWorkbook(parsed.workbook)
        setCache((prev) => {
          const merged = mergeTeamsFromExcel(excelTeams, prev)
          const next = {
            ...prev,
            teams: merged,
            last_file_name: parsed.fileName,
          }
          saveCache(next)
          return next
        })
        if (meta) setFileMeta(meta)
        setStatus(`Đã đồng bộ ${excelTeams.length} đội từ Excel`)
        appendLog(`Đồng bộ: ${excelTeams.length} đội từ ${parsed.fileName}`)
        if (!val.ok) appendLog(`Cảnh báo kiểm tra: ${val.errors.join('; ')}`)
        toast.push(`Đồng bộ ${excelTeams.length} đội`, val.ok ? 'success' : 'error')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setStatus('Lỗi đọc Excel')
        appendLog(`LỖI: ${msg}`)
        toast.push(msg, 'error')
      }
    },
    [appendLog, toast],
  )

  const loadExcelFile = async (file: File) => {
    if (!isAcceptedExcelFile(file)) {
      appendLog('Chỉ chấp nhận .xlsx, .xlsm, .xls, .csv')
      toast.push('Định dạng file không hỗ trợ', 'error')
      return
    }
    setBusy(true)
    setUploadProgress(8)
    try {
      setUploadProgress(35)
      const parsed = await parseExcelFile(file)
      setUploadProgress(70)
      const meta = getFileMeta(file, parsed.workbook)
      setWorkbook(parsed)
      syncFromWorkbook(parsed, meta)
      setUploadProgress(100)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`LỖI mở file: ${msg}`)
      toast.push(msg, 'error')
      setUploadProgress(null)
    } finally {
      window.setTimeout(() => setUploadProgress(null), 400)
      setBusy(false)
    }
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await loadExcelFile(file)
  }

  const onExcelDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) await loadExcelFile(file)
  }

  const onSyncClick = () => {
    if (!workbook) {
      appendLog('Chọn file Excel trước khi đồng bộ.')
      return
    }
    syncFromWorkbook(workbook, fileMeta ?? undefined)
  }

  const allSelected =
    teamNames.length > 0 && teamNames.every((t) => cache.teams[t]?.send)

  const toggleSelectAll = (checked: boolean) => {
    setCache((prev) => {
      const teams = { ...prev.teams }
      for (const name of Object.keys(teams)) {
        teams[name] = { ...teams[name], send: checked }
      }
      return { ...prev, teams }
    })
  }

  const selectedTeams = teamNames.filter((t) => cache.teams[t]?.send)
  const waMap = teamsForWhatsapp(cache.teams)

  const runExport = async (asZip: boolean) => {
    if (!workbook) {
      appendLog('Chọn file Excel trước khi xuất ảnh.')
      return
    }
    if (selectedTeams.length === 0) {
      appendLog('Tick ít nhất 1 đội cần xuất.')
      toast.push('Chọn ít nhất 1 đội', 'error')
      return
    }

    setBusy(true)
    setStatus('Đang xuất ảnh...')
    appendLog(`Bắt đầu xuất (${selectedTeams.length} đội)...`)
    const started = performance.now()
    const items: ExportItem[] = []
    let skip = 0

    try {
      for (const team of selectedTeams) {
        const safe = sanitizeFilename(team)
        for (const sh of APP_CONFIG.sheets) {
          const table = buildTeamTable(workbook.workbook, sh, team)
          if (!table) {
            skip++
            appendLog(`  [SKIP] ${team} / ${sh.name} — không có dòng`)
            continue
          }
          const title = `${team} — ${sh.suffix}`
          const blob = await tableToPngBlob(table, title)
          items.push({ team, suffix: sh.suffix, fileName: `${safe}_${sh.suffix}.png`, blob })
          appendLog(`  [OK] ${team} / ${sh.suffix}`)
        }
      }

      if (items.length === 0) {
        appendLog('Không có ảnh nào được tạo.')
        setStatus('Không có dữ liệu xuất')
        toast.push('Không có ảnh để xuất', 'error')
        return
      }

      setLastExports(items)
      const folder = todayFolder()
      if (asZip) {
        await zipExportItems(items, `bao-cao-${folder}.zip`)
        appendLog(`Đã tải ZIP (${items.length} ảnh).`)
      } else {
        for (const item of items) {
          downloadBlob(item.blob, item.fileName)
        }
        appendLog(`Đã tải ${items.length} file PNG.`)
      }

      const durationMs = Math.round(performance.now() - started)
      const status: JobRecord['status'] =
        skip > 0 && items.length > 0 ? 'partial' : skip > 0 && items.length === 0 ? 'failed' : 'completed'
      const record: JobRecord = {
        id: `${Date.now()}`,
        fileName: workbook.fileName,
        startedAt: new Date().toISOString(),
        durationMs,
        teamsProcessed: selectedTeams.length,
        imagesOk: items.length,
        imagesSkip: skip,
        status,
        note: 'Gửi WhatsApp thủ công sau khi tải ảnh',
      }
      setJobs(appendJob(record))
      setStatus('Hoàn tất xuất ảnh')
      toast.push(asZip ? 'Đã tạo ZIP ảnh' : 'Đã tải PNG', 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`LỖI xuất: ${msg}`)
      setStatus('Có lỗi — xem nhật ký')
      toast.push(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyMessage = async (team: string) => {
    const text = messageTextForTeam(cache.teams, team)
    try {
      await navigator.clipboard.writeText(text)
      appendLog(`Đã copy tin nhắn: ${team}`)
      toast.push('Đã copy tin nhắn', 'success')
    } catch {
      appendLog('Không copy được — hãy chọn và copy thủ công.')
    }
  }

  const importSettingsJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text) as { teams?: Record<string, TeamConfig | string> }
      if (!data.teams) throw new Error('File không có mục teams')
      const teams: Record<string, TeamConfig> = {}
      for (const [name, val] of Object.entries(data.teams)) {
        if (typeof val === 'string') {
          teams[name] = {
            whatsapp_group: val.trim(),
            send: Boolean(val.trim()),
            message_text: name,
          }
        } else {
          teams[name] = {
            whatsapp_group: (val.whatsapp_group || '').trim(),
            send: val.send ?? true,
            message_text: (val.message_text || name).trim() || name,
          }
        }
      }
      const next = { ...cache, teams: { ...cache.teams, ...teams } }
      setCache(next)
      saveCache(next)
      appendLog(`Đã nhập cài đặt từ ${file.name}`)
      toast.push('Đã nhập settings', 'success')
    } catch (err) {
      appendLog(`Lỗi nhập JSON: ${err instanceof Error ? err.message : String(err)}`)
      toast.push('Lỗi nhập JSON', 'error')
    }
    e.target.value = ''
  }

  return {
    cache,
    workbook,
    fileMeta,
    validation,
    status,
    logs,
    busy,
    uploadProgress,
    lastExports,
    jobs,
    fileRef,
    importRef,
    teamNames,
    selectedTeams,
    waMap,
    allSelected,
    updateTeam,
    handleSave,
    onFileChange,
    onExcelDrop,
    onSyncClick,
    toggleSelectAll,
    runExport,
    copyMessage,
    importSettingsJson,
  }
}

export type AppController = ReturnType<typeof useAppController>
