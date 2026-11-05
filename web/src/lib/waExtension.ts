import type { ExportItem } from './exportImage'
import type { TeamConfig } from './storage'
import { captionForImage } from './waCaption'
import { messageTextForTeam } from './storage'

const CHANNEL = 'tool-excel-wa'
const PING_TIMEOUT_MS = 4500
const SEND_TIMEOUT_MS = 180_000

type ExtResponse = { ok?: boolean; error?: string; service?: string; version?: number }

function extMessage<T extends ExtResponse>(
  type: string,
  payload?: unknown,
  timeoutMs = PING_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('Extension không phản hồi — cài extension và tải lại trang'))
    }, timeoutMs)

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.channel !== CHANNEL || data.id !== id) return
      window.clearTimeout(timer)
      window.removeEventListener('message', handler)
      const res = data.response as T | undefined
      if (!res?.ok) {
        reject(new Error(res?.error ?? 'Extension từ chối yêu cầu'))
        return
      }
      resolve(res)
    }

    window.addEventListener('message', handler)
    window.postMessage({ channel: CHANNEL, id, type, payload: payload ?? null }, '*')
  })
}

let extReadyFlag = false

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.channel === CHANNEL && event.data?.type === 'EXT_READY') {
      extReadyFlag = true
    }
  })
}

export async function checkWaExtension(): Promise<boolean> {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.dataset.toolExcelWaExt === '1'
  ) {
    extReadyFlag = true
  }
  for (let i = 0; i < 5; i++) {
    if (!extReadyFlag && i > 0) await new Promise((r) => setTimeout(r, 400))
    try {
      const res = await extMessage<ExtResponse>('PING', null, 6000)
      if (res.ok) return true
    } catch {
      /* retry */
    }
  }
  return false
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function sendWhatsAppViaExtension(
  items: ExportItem[],
  teamGroup: Record<string, string>,
  teamsCfg: Record<string, TeamConfig>,
  onLine?: (line: string) => void,
): Promise<void> {
  const log = (s: string) => onLine?.(s)
  const sorted = [...items].sort((a, b) => {
    const ta = a.team.localeCompare(b.team, 'vi')
    if (ta !== 0) return ta
    const rank = (f: string) => (f.toUpperCase().includes('_XLSC') ? 0 : 1)
    return rank(a.fileName) - rank(b.fileName)
  })

  log('Gửi qua Extension — tab WhatsApp Web phải đăng nhập.')
  for (const item of sorted) {
    const groupName = teamGroup[item.team]
    if (!groupName) {
      throw new Error(`Đội "${item.team}": thiếu tên nhóm WhatsApp.`)
    }
    const msgTeam = messageTextForTeam(teamsCfg, item.team)
    const caption = captionForImage(item.fileName, msgTeam)
    log(`Extension → ${item.team} (${groupName}): ${item.fileName}`)
    const pngBase64 = await blobToBase64(item.blob)
    await extMessage<ExtResponse>(
      'SEND_IMAGE',
      { groupName, fileName: item.fileName, caption, pngBase64 },
      SEND_TIMEOUT_MS,
    )
  }
  log('Hoàn tất gửi qua Extension (WhatsApp Web).')
}
