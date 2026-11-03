import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  checkBridge,
  pushSettingsToBridge,
  sendWhatsAppViaBridge,
  uploadExportItems,
} from '../lib/bridge'

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
  const [bridgeOnline, setBridgeOnline] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const ok = await checkBridge()
      if (alive) setBridgeOnline(ok)
    }
    tick()
    const id = window.setInterval(tick, 8000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

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

  const toPythonSettings = useCallback(() => {
    return {
      version: 1,
      last_workbook: workbook?.fileName ?? cache.last_file_name ?? '',
      updated_at: new Date().toISOString(),
      teams: cache.teams,
    }
  }, [cache, workbook?.fileName])

  const handleSave = async () => {
    const next = {
      ...cache,
      last_file_name: workbook?.fileName ?? cache.last_file_name,
    }
    saveCache(next)
    setCache(next)
    try {
      if (bridgeOnline) {
        await pushSettingsToBridge({
          ...toPythonSettings(),
          last_workbook: next.last_file_name ?? '',
        })
        setStatus('Đã lưu cài đặt (trình duyệt + bridge)')
      } else {
        setStatus('Đã lưu cài đặt (trình duyệt)')
      }
    } catch {
      setStatus('Đã lưu cài đặt (trình duyệt)')
    }
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

  const buildExportItems = async (): Promise<{ items: ExportItem[]; skip: number }> => {
    if (!workbook) throw new Error('Chọn file Excel trước.')
    if (selectedTeams.length === 0) throw new Error('Tick ít nhất 1 đội cần xuất.')
    const items: ExportItem[] = []
    let skip = 0
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
    return { items, skip }
  }

  const recordExportJob = (
    items: ExportItem[],
    skip: number,
    started: number,
    note: string,
  ) => {
    if (!workbook) return
    const durationMs = Math.round(performance.now() - started)
    const status: JobRecord['status'] =
      skip > 0 && items.length > 0 ? 'partial' : skip > 0 && items.length === 0 ? 'failed' : 'completed'
    setJobs(
      appendJob({
        id: `${Date.now()}`,
        fileName: workbook.fileName,
        startedAt: new Date().toISOString(),
        durationMs,
        teamsProcessed: selectedTeams.length,
        imagesOk: items.length,
        imagesSkip: skip,
        status,
        note,
      }),
    )
  }

  const runWhatsAppSend = async (items: ExportItem[], runDay: string) => {
    const waTeams = Object.keys(waMap)
    if (waTeams.length === 0) {
      throw new Error('Bật Gửi và điền tên nhóm WhatsApp cho ít nhất 1 đội.')
    }
    if (!bridgeOnline) {
      throw new Error(
        'Chưa có WA Bridge. Chạy "Mo Web + WA Bridge.bat" trên Windows (giống tool Python).',
      )
    }
    appendLog('Đồng bộ settings sang bridge...')
    await pushSettingsToBridge(toPythonSettings())
    appendLog(`Upload ${items.length} ảnh vào output/${runDay}...`)
    const n = await uploadExportItems(items, runDay)
    appendLog(`Đã ghi ${n} ảnh. Bắt đầu gửi WhatsApp (Chrome)...`)
    setStatus('Đang gửi WhatsApp...')
    const log = await sendWhatsAppViaBridge(waTeams, runDay)
    for (const line of log.split('\n')) {
      if (line.trim()) appendLog(line.trim())
    }
  }

  type JobMode = 'export' | 'send' | 'both'

  const runJob = async (mode: JobMode, asZip = false) => {
    if (mode === 'send' && !bridgeOnline) {
      toast.push('Cần WA Bridge trên máy Windows', 'error')
      appendLog('Chạy: Mo Web + WA Bridge.bat (hoặc py wa_bridge_server.py)')
      return
    }
    if (mode !== 'send' && !workbook) {
      appendLog('Chọn file Excel trước khi xuất ảnh.')
      return
    }
    if (mode === 'send' && lastExports.length === 0) {
      appendLog('Chưa có ảnh — dùng "Xuất ảnh + Gửi WhatsApp" hoặc xuất trước.')
      toast.push('Xuất ảnh trước khi gửi', 'error')
      return
    }

    setBusy(true)
    const started = performance.now()
    const runDay = todayFolder()

    try {
      let items = lastExports
      let skip = 0

      if (mode !== 'send') {
        setStatus('Đang xuất ảnh...')
        appendLog(`Bắt đầu xuất (${selectedTeams.length} đội)...`)
        const built = await buildExportItems()
        items = built.items
        skip = built.skip
        if (items.length === 0) {
          appendLog('Không có ảnh nào được tạo.')
          setStatus('Không có dữ liệu xuất')
          toast.push('Không có ảnh để xuất', 'error')
          return
        }
        setLastExports(items)
        if (mode === 'export') {
          if (asZip) {
            await zipExportItems(items, `bao-cao-${runDay}.zip`)
            appendLog(`Đã tải ZIP (${items.length} ảnh).`)
          } else {
            for (const item of items) {
              downloadBlob(item.blob, item.fileName)
            }
            appendLog(`Đã tải ${items.length} file PNG.`)
          }
          recordExportJob(items, skip, started, 'Tải file về máy')
          setStatus('Hoàn tất xuất ảnh')
          toast.push(asZip ? 'Đã tạo ZIP ảnh' : 'Đã tải PNG', 'success')
        }
      }

      if (mode === 'send' || mode === 'both') {
        const sendItems = mode === 'send' ? lastExports : items
        await runWhatsAppSend(sendItems, runDay)
        recordExportJob(
          sendItems,
          skip,
          started,
          mode === 'both' ? 'Xuất + gửi WhatsApp (Playwright)' : 'Gửi WhatsApp (Playwright)',
        )
        setStatus('Hoàn tất gửi WhatsApp')
        toast.push('Hoàn tất gửi WhatsApp', 'success')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`LỖI: ${msg}`)
      setStatus('Có lỗi — xem nhật ký')
      toast.push(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  const runExport = async (asZip: boolean) => runJob('export', asZip)

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
    bridgeOnline,
    updateTeam,
    handleSave,
    onFileChange,
    onExcelDrop,
    onSyncClick,
    toggleSelectAll,
    runExport,
    runJob,
    copyMessage,
    importSettingsJson,
  }
}

export type AppController = ReturnType<typeof useAppController>
