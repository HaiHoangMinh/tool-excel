import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { chromium, expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const EXT_DIR = path.resolve(REPO_ROOT, 'extension')
const EXCEL = path.join(REPO_ROOT, 'Book1.xlsm')
const USER_DATA = path.join(__dirname, '../.pw-ext-test')

/** Hai nhóm đầu trong settings_cache.json */
const TEST_TEAMS = ['Bảo Đài', 'Bắc Giang 1']

test.beforeAll(() => {
  if (!fs.existsSync(EXCEL)) throw new Error(`Thiếu ${EXCEL}`)
})

test('Extension Chrome: autoload Excel + gửi 2 nhóm đầu', async () => {
  test.setTimeout(600_000)

  const context = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
    ],
  })

  try {
    const waPage = await context.newPage()
    await waPage.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded' })
    await waPage
      .locator('#pane-side, [data-testid="chat-list"]')
      .first()
      .waitFor({ state: 'visible', timeout: 240_000 })

    const page = await context.newPage()
    await page.goto('http://localhost:5173/?autoload=book1&autosettings=1', {
      waitUntil: 'load',
    })
    await expect(page.getByText('WA Extension: bật')).toBeVisible({ timeout: 35_000 })
    await expect(page.getByTestId('tool-status')).toContainText('đội', { timeout: 90_000 })
    await expect(page.getByTestId('tool-log')).toContainText('settings_cache', {
      timeout: 20_000,
    })

    const rows = page.locator('.data-table tbody tr')
    const n = await rows.count()
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      const team = (await row.locator('.team-name').textContent())?.trim() ?? ''
      const cb = row.locator('input[type="checkbox"]').first()
      if (TEST_TEAMS.includes(team)) await cb.check()
      else await cb.uncheck()
    }

    await page.getByRole('button', { name: 'Xuất ảnh + Gửi WhatsApp' }).click()
    await expect(page.getByTestId('tool-log')).toContainText('Extension →', { timeout: 180_000 })
    await expect(page.getByTestId('tool-log')).toContainText('Hoàn tất gửi qua Extension', {
      timeout: 480_000,
    })
  } finally {
    await context.close()
  }
})
