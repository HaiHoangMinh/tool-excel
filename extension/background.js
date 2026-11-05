const WA_URL = 'https://web.whatsapp.com/'

async function findWaTab() {
  const tabs = await chrome.tabs.query({ url: `${WA_URL}*` })
  return tabs.find((t) => t.id != null) ?? null
}

async function ensureWaTab(focus) {
  const existing = await findWaTab()
  if (existing?.id != null) {
    if (focus) await chrome.tabs.update(existing.id, { active: true })
    return existing.id
  }
  const tab = await chrome.tabs.create({ url: WA_URL, active: true })
  if (tab.id == null) throw new Error('Không mở được tab WhatsApp Web')
  return tab.id
}

async function waitForWaContent(tabId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' })
      if (pong?.ok) return
    } catch {
      /* chưa inject */
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error(
    'WhatsApp Web chưa sẵn sàng — mở web.whatsapp.com, đăng nhập QR, thử lại.',
  )
}

async function sendImageOnTab(tabId, payload) {
  const res = await chrome.tabs.sendMessage(tabId, {
    type: 'SEND_IMAGE',
    groupName: payload.groupName,
    fileName: payload.fileName,
    caption: payload.caption ?? '',
    pngBase64: payload.pngBase64,
  })
  if (!res?.ok) {
    throw new Error(res?.error ?? 'Gửi ảnh trên WhatsApp Web thất bại')
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.relay) return false

  ;(async () => {
    try {
      if (msg.type === 'PING') {
        sendResponse({ ok: true, service: 'tool-excel-wa-extension', version: 1 })
        return
      }
      if (msg.type === 'SEND_IMAGE') {
        const tabId = await ensureWaTab(true)
        await waitForWaContent(tabId)
        await sendImageOnTab(tabId, msg.payload)
        sendResponse({ ok: true })
        return
      }
      sendResponse({ ok: false, error: `Unknown type: ${msg.type}` })
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()

  return true
})
