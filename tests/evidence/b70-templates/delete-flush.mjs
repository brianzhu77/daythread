import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const base = process.argv[2] ?? 'http://127.0.0.1:3595'
const db = process.argv[3] ?? '/tmp/rb-tpl/ws.sqlite'
const read = () => JSON.parse(new DatabaseSync(db, { readOnly: true }).prepare('select data from workspace').get().data)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(`${base}/pages?view=templates`)
await page.getByRole('button', { name: 'New template' }).click()
await page.locator('.template-target').waitFor()
await page.keyboard.type('Doomed')
await page.waitForTimeout(1200)
// From now on every save of the editor fails with 503.
let failing = 0
await page.route('**/_serverFn/**', async route => {
  const body = route.request().postData() ?? ''
  if (route.request().method() === 'POST' && body.includes('save-editor')) { failing++; return route.fulfill({ status: 503, body: 'down' }) }
  return route.continue()
})
await page.locator('.bn-block-content').first().click()
await page.keyboard.type('Latest words')
await page.getByRole('button', { name: 'Template actions' }).click()
await page.getByRole('menuitem', { name: 'Delete' }).click()
await page.waitForTimeout(2500)
const still = read().pages.some(p => p.type === 'template' && p.title === 'Doomed')
console.log(still && failing > 0 ? 'PASS' : 'FAIL', 'a failed save stops the delete; template still there:', still, 'failed saves:', failing, page.url())
await browser.close()
