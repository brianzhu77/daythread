import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const base = process.argv[2] ?? 'http://127.0.0.1:3595'
const db = process.argv[3] ?? '/tmp/rb-tpl/ws.sqlite'
const read = () => JSON.parse(new DatabaseSync(db, { readOnly: true }).prepare('select data from workspace').get().data)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail) }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(String(e)))
// A real task on today's page.
await page.goto(`${base}/`)
await page.locator('[data-content-type="task"]').first().waitFor()
await page.locator('[data-content-type="task"]').first().click()
await page.keyboard.type('Preserve real task')
await page.waitForTimeout(1500)
const task = read().tasks.find(t => t.title === 'Preserve real task')
check('real task exists', !!task && task.status === 'open')
// Cut the whole row (select its text block, then cut the block with the selection over it).
await page.locator('[data-content-type="task"]', { hasText: 'Preserve real task' }).click()
await page.keyboard.press('Meta+ArrowRight')
await page.keyboard.press('Shift+Meta+ArrowLeft')
await page.keyboard.press('Shift+ArrowUp')
await page.keyboard.press('Shift+ArrowDown')
await page.keyboard.press('Meta+X')
await page.waitForTimeout(1500)
// Paste into the template (Edit makes it).
await page.goto(`${base}/pages?view=templates`)
await page.getByRole('button', { name: 'Edit' }).click()
await page.locator('.template-target').waitFor()
await page.locator('.bn-block-content[data-content-type="bulletListItem"]').last().click()
await page.keyboard.press('Meta+V')
await page.waitForTimeout(2000)
const rows = page.locator('.template-screen .editor-task input[type="checkbox"]')
const labels = await rows.evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
check('no template checkbox is labelled as a real task', !labels.some(l => /^Complete /.test(l ?? '')), JSON.stringify(labels))
const beforeTick = read().tasks.find(t => t.id === task.id)
for (let i = 0; i < await rows.count(); i++) { const r = rows.nth(i); if (await r.isEnabled()) await r.click({ force: true }) }
await page.waitForTimeout(1500)
const after = read()
const real = after.tasks.find(t => t.id === task.id)
check('ticking every template checkbox leaves the real task as it was', JSON.stringify(real) === JSON.stringify(beforeTick) && real?.status !== 'done', JSON.stringify({ before: beforeTick && { status: beforeTick.status, version: beforeTick.version }, after: real && { status: real.status, version: real.version } }))
const tpl = after.pages.find(p => p.type === 'template')
const tplRows = JSON.stringify(tpl.document)
check('stored template rows carry no real task id', !tplRows.includes(`"taskId":"${task.id}"`) || task.id === undefined)
const pasted = (await page.locator('.template-screen .bn-editor').innerText())
console.log('template text:', JSON.stringify(pasted.slice(0, 200)))
check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(JSON.stringify(results.filter(r => !r.ok)))
