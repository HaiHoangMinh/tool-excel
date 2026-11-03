import * as XLSX from 'xlsx'
import { APP_CONFIG } from '../config'
import { scanTeamsFromWorkbook } from './excel'

export type ValidationResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
  teamCount: number
  sheets: { name: string; present: boolean; rowEstimate: number }[]
}

function estimateRows(ws: XLSX.WorkSheet): number {
  const ref = ws['!ref']
  if (!ref) return 0
  const range = XLSX.utils.decode_range(ref)
  return Math.max(0, range.e.r - range.s.r)
}

export function validateWorkbook(workbook: XLSX.WorkBook): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const sheets = APP_CONFIG.sheets.map((sh) => {
    const ws = workbook.Sheets[sh.name]
    const present = Boolean(ws)
    if (!present) errors.push(`Thiếu sheet bắt buộc: ${sh.name}`)
    return { name: sh.name, present, rowEstimate: ws ? estimateRows(ws) : 0 }
  })

  let teamCount = 0
  try {
    teamCount = scanTeamsFromWorkbook(workbook).length
    if (teamCount === 0) warnings.push('Không tìm thấy đội nào trong file.')
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  for (const sh of sheets) {
    if (sh.present && sh.rowEstimate > 5000) {
      warnings.push(`Sheet ${sh.name} có nhiều dòng (${sh.rowEstimate}+) — preview có thể chậm.`)
    }
  }

  return { ok: errors.length === 0, errors, warnings, teamCount, sheets }
}
