import assert from 'node:assert/strict'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { chromium } from '@playwright/test'
const repository = new SqliteWorkspaceRepository('/tmp/ratchet234-ui.sqlite')
const before = (await repository.load()).tasks
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
assert.equal(await live.count(), 0)
assert.equal(await page.locator('.editor-plan-action').count(), 0)
assert.equal(await page.locator('.editor-row-menu').count(), 0)
for (const checkbox of await page.locator('.editor-task input').all()) await checkbox.click()
await page.waitForTimeout(600)
assert.deepEqual((await repository.load()).tasks, before)
console.log(
  'PASS actual keyboard cut: no live task controls; clicking all template checkboxes leaves all Tasks unchanged',
)
await page.waitForTimeout(500)
await page.screenshot({
  path: new URL('./results/actual-cut-final.png', import.meta.url).pathname,
  fullPage: true,
})
await browser.close()
