import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const EXCEL = path.join(REPO_ROOT, 'Book1.xlsm')
const SETTINGS = path.join(REPO_ROOT, 'settings_cache.json')

test.beforeAll(() => {
  if (!fs.existsSync(EXCEL)) {
    throw new Error(`Thiếu file test: ${EXCEL}`)
  }
})

test('đầy đủ luồng: upload, đồng bộ, lưu, nhập JSON, xuất ZIP, copy tin', async ({
  page,
}) => {
  await page.goto('/')

  await page.getByTestId('excel-file-input').setInputFiles(EXCEL)
  await expect(page.getByTestId('tool-status')).toContainText('đội', { timeout: 60_000 })
  await expect(page.locator('.team-name').first()).toBeVisible({ timeout: 60_000 })
  const teamCount = await page.locator('.team-name').count()
  expect(teamCount).toBeGreaterThan(0)

  const firstTeam = (await page.locator('.team-name').first().textContent())?.trim()
  expect(firstTeam).toBeTruthy()

  await page.getByRole('button', { name: 'Lưu cài đặt' }).click()

  const stored = await page.evaluate(() => localStorage.getItem('tool-excel-web-settings'))
  expect(stored).toContain('"teams"')

  if (fs.existsSync(SETTINGS)) {
    await page.getByTestId('import-json-input').setInputFiles(SETTINGS)
    await expect(page.getByTestId('tool-log')).toContainText('Đã nhập cài đặt', {
      timeout: 15_000,
    })
  }

  const firstRow = page.locator('.data-table tbody tr').first()
  await firstRow.locator('input[type="text"]').nth(0).fill('Nhóm test E2E')
  await firstRow.locator('input[type="text"]').nth(1).fill('Tin test E2E')

  const checks = page.locator('.data-table tbody input[type="checkbox"]')
  const n = await checks.count()
  for (let i = 1; i < n; i++) await checks.nth(i).uncheck()

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: 'Tải ZIP ảnh' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^bao-cao-\d{4}-\d{2}-\d{2}\.zip$/)

  const buf = fs.readFileSync(await download.path())
  const zip = await JSZip.loadAsync(buf)
  const pngs = Object.keys(zip.files).filter((k) => k.endsWith('.png'))
  expect(pngs.length).toBeGreaterThanOrEqual(1)

  await expect(page.getByTestId('tool-log')).toContainText('[OK]', { timeout: 120_000 })
  await expect(page.locator('.wa-send-list')).toContainText('Nhóm test E2E')

  await page.getByRole('button', { name: 'Copy tin' }).first().click()
  await expect(page.getByTestId('tool-log')).toContainText('Đã copy tin nhắn')

  await page.getByLabel('Chọn tất cả (xuất / gửi)').check()
  const allChecked = await checks.evaluateAll((els) =>
    els.every((el) => (el as HTMLInputElement).checked),
  )
  expect(allChecked).toBe(true)
})

test('kéo thả file Excel', async ({ page }) => {
  await page.goto('/')
  const buffer = fs.readFileSync(EXCEL)
  const b64 = buffer.toString('base64')
  await page.getByTestId('excel-drop-zone').evaluate(
    (el, payload) => {
      const bin = atob(payload.b64)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      const file = new File([arr], payload.name, {
        type: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      })
      const dt = new DataTransfer()
      dt.items.add(file)
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
    },
    { name: 'Book1.xlsm', b64 },
  )
  await expect(page.locator('.team-name').first()).toBeVisible({ timeout: 60_000 })
})
