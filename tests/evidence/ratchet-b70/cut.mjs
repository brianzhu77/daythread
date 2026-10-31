import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const base = 'http://127.0.0.1:3668'
await page.goto(base + '/pages?page=review234-source')
const row = page.locator('[data-content-type="task"]').first()
await row.hover()
await page.waitForTimeout(500)
await page.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click()
await page.keyboard.press('Meta+x')
await page.waitForTimeout(1000)
console.log('source remaining tasks', await page.locator('[data-content-type="task"]').count())
await page.goto(base + '/pages?page=8f5f0f4e-70df-4370-97d0-5006dc4518d3')
await page.locator('.template-target').waitFor()
const bullet = page.locator('[data-content-type="bulletListItem"] .bn-inline-content').last()
await bullet.click()
await page.keyboard.press('Meta+ArrowRight')
await page.waitForTimeout(180)
await page.keyboard.press('Enter')
await page.waitForTimeout(180)
await page.keyboard.press('Meta+v')
await page.waitForTimeout(1200)
console.log(
  'actual keyboard cut/paste checkboxes',
  await page
    .locator('input[type="checkbox"]')
    .evaluateAll((es) => es.map((e) => e.getAttribute('aria-label'))),
)
const live = page.getByRole('checkbox', { name: 'Complete Preserve real task', exact: true })
console.log('real task control count', await live.count())
if (await live.count()) await live.last().click()
await page.waitForTimeout(500)
await page.screenshot({
  path: new URL('./results/actual-cut.png', import.meta.url).pathname,
  fullPage: true,
})
await browser.close()
