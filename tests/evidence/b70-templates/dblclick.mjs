import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const base = process.argv[2] ?? 'http://127.0.0.1:3595'
const db = process.argv[3] ?? '/tmp/rb-tpl/ws.sqlite'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.route('**/_serverFn/**', async route => { if (route.request().method() === 'POST') await new Promise(r => setTimeout(r, 600)); await route.continue() })
await page.goto(`${base}/pages?view=templates`)
await page.getByRole('button', { name: 'Edit' }).dblclick()
await page.waitForTimeout(3000)
const ws = JSON.parse(new DatabaseSync(db, { readOnly: true }).prepare('select data from workspace').get().data)
const n = ws.pages.filter(p => p.type === 'template').length
console.log(n === 1 ? 'PASS' : 'FAIL', 'double-click Edit with 600 ms POST latency makes one template:', n, page.url())
await browser.close()
