/** Automation WhatsApp Web — logic tương tự send_whatsapp.py (rút gọn). */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let currentGroup = ''

function clickFirst(selectors, root = document) {
  for (const sel of selectors) {
    const el = root.querySelector(sel)
    if (el && el.offsetParent !== null) {
      el.click()
      return true
    }
  }
  return false
}

function clickByText(text, exact) {
  const all = document.querySelectorAll('span[title], #pane-side span, [data-testid="cell-frame-container"]')
  for (const el of all) {
    const t = (el.getAttribute('title') || el.textContent || '').trim()
    if (exact ? t === text : t.includes(text)) {
      el.click()
      return true
    }
  }
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  let node
  while ((node = walk.nextNode())) {
    const t = (node.textContent || '').trim()
    if (t === text && node.children.length === 0) {
      node.click()
      return true
    }
  }
  return false
}

async function focusSearchBox() {
  clickFirst([
    '[data-testid="chat-list-search"]',
    '#side div[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
  ])
  await sleep(300)
  const boxes = [
    ...document.querySelectorAll('[data-testid="chat-list-search"]'),
    ...document.querySelectorAll('#side div[contenteditable="true"]'),
  ]
  for (const box of boxes) {
    if (box.offsetParent === null) continue
    box.click()
    return box
  }
  throw new Error('Không tìm thấy ô tìm kiếm WhatsApp Web')
}

async function typeInSearch(el, text) {
  el.focus()
  el.click()
  await sleep(150)
  document.execCommand('selectAll', false, null)
  document.execCommand('delete', false, null)
  await sleep(100)
  for (const ch of text) {
    document.execCommand('insertText', false, ch)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }))
    await sleep(35)
  }
}

async function openGroupChat(groupName) {
  if (currentGroup === groupName) {
    await sleep(400)
    return
  }
  const search = await focusSearchBox()
  await typeInSearch(search, groupName)
  await sleep(1800)

  const strategies = [
    () => document.querySelector(`span[title="${CSS.escape(groupName)}"]`)?.click(),
    () => clickByText(groupName, true),
    () => {
      const cells = document.querySelectorAll('[data-testid="cell-frame-container"]')
      for (const c of cells) {
        if (c.textContent?.includes(groupName)) {
          c.click()
          return true
        }
      }
      return false
    },
  ]
  for (const fn of strategies) {
    try {
      if (fn()) {
        currentGroup = groupName
        await sleep(800)
        return
      }
    } catch {
      /* thử cách khác */
    }
  }
  throw new Error(
    `Không tìm thấy nhóm '${groupName}' — kiểm tra tên trên WhatsApp Web (100% trung).`,
  )
}

function isSearchCompose(el) {
  const aria = (el.getAttribute('aria-label') || '').toLowerCase()
  const tab = el.getAttribute('data-tab') || ''
  if (tab === '3') return true
  return aria.includes('tìm kiếm') || aria.includes('tim kiem') || aria.includes('search')
}

function locateComposeBox() {
  const selectors = [
    '[data-testid="conversation-compose-box-input"] div[contenteditable="true"]',
    '[data-testid="media-caption-input-container"] div[contenteditable="true"]',
    '#main footer div[contenteditable="true"]',
    'footer div[contenteditable="true"]',
  ]
  for (const sel of selectors) {
    for (const box of document.querySelectorAll(sel)) {
      if (box.offsetParent === null) continue
      if (isSearchCompose(box)) continue
      const aria = (box.getAttribute('aria-label') || '').toLowerCase()
      if (
        aria.includes('soạn') ||
        aria.includes('soan') ||
        aria.includes('type a message') ||
        aria.includes('message') ||
        sel.includes('compose') ||
        sel.includes('caption')
      ) {
        return box
      }
    }
  }
  for (const box of document.querySelectorAll('div[contenteditable="true"]')) {
    if (box.offsetParent === null || isSearchCompose(box)) continue
    const inMain = box.closest('#main')
    if (inMain) return box
  }
  return null
}

async function waitForCompose(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (locateComposeBox()) return true
    await sleep(300)
  }
  return false
}

function mediaPreviewOpen() {
  for (const sel of [
    '[data-testid="media-editor"]',
    '[data-testid="media-viewer"]',
    '[data-testid="media-viewer-root"]',
  ]) {
    const el = document.querySelector(sel)
    if (el && el.offsetParent !== null) return true
  }
  return false
}

async function waitUntilMediaSent(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!mediaPreviewOpen()) {
      await sleep(800)
      return true
    }
    await sleep(400)
  }
  return !mediaPreviewOpen()
}

function typeInCompose(text) {
  const box = locateComposeBox()
  if (!box) throw new Error("Không tìm thấy ô 'Soạn tin nhắn'")
  box.focus()
  box.click()
  box.textContent = text
  box.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

function pressEnter() {
  const target = locateComposeBox() || document.activeElement || document.body
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
  target.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }),
  )
}

function base64ToFile(base64, fileName) {
  const bin = atob(base64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new File([arr], fileName, { type: 'image/png' })
}

async function attachPhotoFile(file) {
  if (
    !clickFirst([
      '[data-testid="attach-menu-plus"]',
      'button[aria-label*="Attach"]',
      'button[aria-label*="Đính kèm"]',
      'span[data-icon="plus"]',
    ])
  ) {
    throw new Error('Không tìm thấy nút đính kèm (+)')
  }
  await sleep(550)

  const menuClicked = clickFirst([
    '[data-testid="mi-attach-media"]',
    '[data-icon="attach-image"]',
    '[data-icon="image"]',
  ])
  if (!menuClicked) {
    const items = document.querySelectorAll('li, [role="menuitem"], [role="button"]')
    for (const el of items) {
      const t = (el.textContent || '').toLowerCase()
      if (t.includes('photo') || t.includes('ảnh') || t.includes('anh')) {
        el.click()
        break
      }
    }
  }
  await sleep(400)

  let input =
    document.querySelector('input[type="file"][accept*="image"]') ||
    document.querySelector('input[type="file"]')
  if (!input) {
    await sleep(800)
    input = document.querySelector('input[type="file"]')
  }
  if (!input) throw new Error('Không tìm thấy input file ảnh')

  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(1500)
}

async function sendCombinedImage(groupName, fileName, caption, pngBase64) {
  await openGroupChat(groupName)
  const file = base64ToFile(pngBase64, fileName)
  await attachPhotoFile(file)
  if (!(await waitForCompose())) {
    pressEnter()
    await waitUntilMediaSent()
    return
  }
  if (caption.trim()) typeInCompose(caption.trim())
  await sleep(250)
  pressEnter()
  if (!(await waitUntilMediaSent())) {
    pressEnter()
    await waitUntilMediaSent(45000)
  }
  await sleep(1000)
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    try {
      if (msg.type === 'PING') {
        sendResponse({ ok: true })
        return
      }
      if (msg.type === 'SEND_IMAGE') {
        await sendCombinedImage(
          msg.groupName,
          msg.fileName,
          msg.caption || '',
          msg.pngBase64,
        )
        sendResponse({ ok: true })
        return
      }
      sendResponse({ ok: false, error: 'Unknown message' })
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()
  return true
})
