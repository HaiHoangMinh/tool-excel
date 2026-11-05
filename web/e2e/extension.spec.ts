import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXT_DIR = path.resolve(__dirname, '../../extension')
const USER_DATA = path.join(__dirname, '../.pw-ext-test')

test('Extension: web local nhận WA Extension bật (PING)', async () => {
  const context = await chromium.launchPersistentContext(USER_DATA, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
    ],
  })

  try {
    const page = await context.newPage()
    await page.goto('http://localhost:5173/', { waitUntil: 'load' })
    await expect(page.getByRole('heading', { name: /Báo cáo theo đội/i })).toBeVisible()
    await expect(page.locator('html[data-tool-excel-wa-ext="1"]')).toHaveAttribute(
      'data-tool-excel-wa-ext',
      '1',
      { timeout: 15_000 },
    )
    await expect(page.getByText('WA Extension: bật')).toBeVisible({ timeout: 30_000 })
  } finally {
    await context.close()
  }
})
