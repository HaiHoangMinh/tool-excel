import type { TeamConfig } from './storage'
import type { ExportItem } from './exportImage'

export type PythonSettingsCache = {
  version: number
  last_workbook: string
  updated_at: string
  teams: Record<string, TeamConfig>
}
import JSZip from 'jszip'
import { sanitizeFilename } from './excel'

const BRIDGE_URL = import.meta.env.VITE_WA_BRIDGE_URL ?? 'http://127.0.0.1:8765'

export type BridgeHealth = {
  ok: boolean
  service?: string
  platform?: string
}

export async function checkBridge(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) return false
    const data = (await res.json()) as BridgeHealth
    return Boolean(data.ok)
  } catch {
    return false
  }
}

export async function pushSettingsToBridge(cache: PythonSettingsCache): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cache),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Lưu settings bridge thất bại')
}

async function zipBlobFromItems(items: ExportItem[], folderName: string): Promise<Blob> {
  const zip = new JSZip()
  const root = zip.folder(folderName)
  for (const item of items) {
    const safe = sanitizeFilename(item.team)
    root?.folder(safe)?.file(item.fileName, item.blob)
  }
  return zip.generateAsync({ type: 'blob' })
}

export async function uploadExportItems(
  items: ExportItem[],
  runDay: string,
): Promise<number> {
  const zip = await zipBlobFromItems(items, `bao-cao-${runDay}`)
  const res = await fetch(`${BRIDGE_URL}/api/images?date=${encodeURIComponent(runDay)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zip,
  })
  const data = (await res.json()) as { ok?: boolean; images?: number; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Upload ảnh bridge thất bại')
  return data.images ?? 0
}

export async function sendWhatsAppViaBridge(
  teams: string[],
  runDay: string,
): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teams, date: runDay }),
  })
  const data = (await res.json()) as {
    ok?: boolean
    log?: string
    error?: string
  }
  if (!data.log && data.error) throw new Error(data.error)
  if (!data.ok) throw new Error(data.error ?? 'Gửi WhatsApp thất bại')
  return data.log ?? ''
}
