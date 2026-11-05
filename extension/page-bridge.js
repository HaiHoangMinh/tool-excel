/** Relay giữa trang Tool Excel và background (không cần biết Extension ID). */
const CHANNEL = 'tool-excel-wa'

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.channel !== CHANNEL || !data.id || !data.type) return

  if (data.type === 'PING') {
    window.postMessage(
      {
        channel: CHANNEL,
        id: data.id,
        response: { ok: true, service: 'tool-excel-wa-extension', version: 1 },
      },
      '*',
    )
    return
  }

  chrome.runtime.sendMessage(
    { relay: true, type: data.type, payload: data.payload ?? null },
    (response) => {
      const err = chrome.runtime.lastError
      window.postMessage(
        {
          channel: CHANNEL,
          id: data.id,
          response: err ? { ok: false, error: err.message } : response,
        },
        '*',
      )
    },
  )
})

function signalReady() {
  document.documentElement.dataset.toolExcelWaExt = '1'
  window.postMessage({ channel: CHANNEL, type: 'EXT_READY' }, '*')
}
signalReady()
window.addEventListener('load', signalReady)
