import * as XLSX from 'xlsx'
import { APP_CONFIG, type SheetConfig } from '../config'

export type ParsedWorkbook = {
  fileName: string
  workbook: XLSX.WorkBook
}

const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'text/csv',
]

export function isAcceptedExcelFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    return true
  }
  return EXCEL_TYPES.includes(file.type)
}

export async function parseExcelFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  return { fileName: file.name, workbook }
}

export type FileMeta = {
  name: string
  sizeBytes: number
  sizeLabel: string
  sheetNames: string[]
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function getFileMeta(file: File, workbook: XLSX.WorkBook): FileMeta {
  const configured = APP_CONFIG.sheets.map((s) => s.name)
  const sheetNames = configured.filter((n) => workbook.SheetNames.includes(n))
  return {
    name: file.name,
    sizeBytes: file.size,
    sizeLabel: formatBytes(file.size),
    sheetNames,
  }
}

function sheetMatrix(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]
}

function findColumnIndex(headerRow: unknown[], columnName: string): number {
  for (let j = 0; j < headerRow.length; j++) {
    const h = headerRow[j]
    if (h != null && String(h).trim() === columnName) return j
  }
  return -1
}

export function formatCellValue(val: unknown): string {
  if (val == null) return ''
  if (val instanceof Date) {
    return val.toLocaleDateString('vi-VN')
  }
  return String(val).trim()
}

export function scanTeamsFromWorkbook(workbook: XLSX.WorkBook): string[] {
  const { header_row, filter_column, skip_teams, sheets } = APP_CONFIG
  const skip = new Set<string>(skip_teams)
  const headerIdx = header_row - 1
  const found = new Set<string>()

  for (const sh of sheets) {
    const ws = workbook.Sheets[sh.name]
    if (!ws) throw new Error(`Thiếu sheet: ${sh.name}`)
    const matrix = sheetMatrix(ws)
    const header = matrix[headerIdx]
    if (!header) throw new Error(`Không đọc được hàng tiêu đề (${header_row}) ở sheet ${sh.name}`)
    const doiIdx = findColumnIndex(header, filter_column)
    if (doiIdx < 0) {
      throw new Error(`Không tìm thấy cột '${filter_column}' ở sheet ${sh.name}`)
    }
    for (let r = headerIdx + 1; r < matrix.length; r++) {
      const row = matrix[r]
      if (!row) continue
      const name = formatCellValue(row[doiIdx])
      if (name && !skip.has(name)) found.add(name)
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b, 'vi'))
}

export type TableData = {
  headers: string[]
  rows: string[][]
}

export function buildTeamTable(
  workbook: XLSX.WorkBook,
  sheetCfg: SheetConfig,
  team: string,
): TableData | null {
  const { header_row, filter_column } = APP_CONFIG
  const ws = workbook.Sheets[sheetCfg.name]
  if (!ws) return null

  const matrix = sheetMatrix(ws)
  const headerIdx = header_row - 1
  const header = matrix[headerIdx]
  if (!header) return null

  const doiIdx = findColumnIndex(header, filter_column)
  if (doiIdx < 0) return null

  const colIndices: number[] = []
  const headers: string[] = []
  for (const colName of sheetCfg.export_columns) {
    const idx = findColumnIndex(header, colName)
    if (idx >= 0) {
      colIndices.push(idx)
      headers.push(colName)
    }
  }
  if (headers.length === 0) return null

  const rows: string[][] = []
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row) continue
    const teamVal = formatCellValue(row[doiIdx])
    if (teamVal !== team) continue
    rows.push(colIndices.map((ci) => formatCellValue(row[ci])))
  }

  if (rows.length === 0) return null
  return { headers, rows }
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'unknown'
}

export type PreviewTable = TableData & {
  totalRows: number
  truncated: boolean
}

export function buildSheetPreview(
  workbook: XLSX.WorkBook,
  sheetName: string,
  options?: { team?: string; search?: string; limit?: number },
): PreviewTable | null {
  const sheetCfg = APP_CONFIG.sheets.find((s) => s.name === sheetName)
  if (!sheetCfg) return null
  const team = options?.team?.trim()
  if (team) {
    const t = buildTeamTable(workbook, sheetCfg, team)
    if (!t) return { headers: sheetCfg.export_columns, rows: [], totalRows: 0, truncated: false }
    return filterPreview(t, options?.search, options?.limit ?? 200)
  }

  const { header_row } = APP_CONFIG
  const ws = workbook.Sheets[sheetName]
  if (!ws) return null
  const matrix = sheetMatrix(ws)
  const headerIdx = header_row - 1
  const header = matrix[headerIdx]
  if (!header) return null

  const headers: string[] = []
  const colIndices: number[] = []
  for (const colName of sheetCfg.export_columns) {
    const idx = findColumnIndex(header, colName)
    if (idx >= 0) {
      headers.push(colName)
      colIndices.push(idx)
    }
  }
  if (!headers.length) return null

  const rows: string[][] = []
  let totalRows = 0
  const limit = options?.limit ?? 200
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row) continue
    const cells = colIndices.map((ci) => formatCellValue(row[ci]))
    if (cells.every((c) => !c)) continue
    totalRows++
    if (rows.length < limit) rows.push(cells)
  }
  const filtered = filterPreview({ headers, rows }, options?.search, limit)
  return { ...filtered, totalRows, truncated: totalRows > rows.length }
}

function filterPreview(
  table: TableData,
  search?: string,
  limit = 200,
): PreviewTable {
  const q = search?.trim().toLowerCase()
  let rows = table.rows
  if (q) {
    rows = rows.filter((row) => row.some((c) => c.toLowerCase().includes(q)))
  }
  const totalRows = rows.length
  const truncated = rows.length > limit
  if (truncated) rows = rows.slice(0, limit)
  return { headers: table.headers, rows, totalRows, truncated }
}
