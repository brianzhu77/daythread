// B21-12, B21-13 on a copy of his data: a copy of a block in his Day template is on every new day, one note edited once, counted once,
// and nothing else about the day changes. Usage: node tests/evidence/b21/template.mjs <base-url> <store-path> <his-copy-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, copy, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath || !copy) { console.error('Usage: node tests/evidence/b21/template.mjs <base-url> <store-path> <his-copy-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && cp ${copy} ${storePath} && node --no-warnings tests/evidence/b21/template-seed.ts ${storePath}`, { stdio: 'ignore' })
const before = store()
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const page = await context.newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
const r = {}
const days = ['2026-12-20', '2026-12-21']
for (const d of days) { await page.goto(`${base}/day/${d}`); await wait(1800); const make = page.getByRole('button', { name: 'Create page' }); if (await make.count()) await make.click(); await wait(2500) }
const texts = () => page.locator('.bn-inline-content').allInnerTexts()
r.onDay = (await texts()).filter(t => t.includes('standing note')).length
r.label = await page.locator('.synced-label-button').allInnerTexts()
const s1 = store()
r.tasksMade = s1.tasks.length - before.tasks.length
r.storedLines = s1.pages.filter(p => p.date && days.includes(p.date) && p.document.includes('One standing')).length
// The label sits above the first line, never over it (B21-18).
const lineBox = await page.locator('.bn-inline-content', { hasText: 'standing note' }).first().boundingBox(), labelBox = await page.locator('.synced-label-button').first().boundingBox()
r.labelClear = labelBox.y + labelBox.height <= lineBox.y + 1
// One note, edited once, from a day.
await page.locator('.bn-inline-content', { hasText: 'standing note' }).first().click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.type(' edited'); await wait(2500)
r.notice = (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ')
const s2 = store()
r.record = JSON.parse(s2.synced.find(x => x.id === 'standing').lines)[0].content[0].text
await page.goto(`${base}/day/${days[0]}`); await wait(2500)
r.otherDay = (await texts()).some(t => t.includes('standing note #standing edited') || (t.includes('standing note') && t.includes('edited')))
// Search finds it once, under the original.
await page.locator('button, a', { hasText: 'Search' }).first().click(); await wait(500); await page.keyboard.type('standing note'); await wait(900)
r.search = (await page.locator('.search-row-text').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).filter(t => /standing note/.test(t))
await page.keyboard.press('Escape'); await wait(200)
// A tag counts once.
await page.goto(`${base}/tags`); await wait(2000)
r.tag = (await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/standing[^a-z]*\d*/)?.[0] ?? null
await page.goto(`${base}/tags/standing`); await wait(2000)
r.tagLines = (await page.locator('body').innerText()).split('standing note').length - 1
r.errors = errors
const ok = r.labelClear && r.onDay === 1 && /Synced/.test(r.label[0] ?? '') && r.tasksMade === 0 && r.storedLines === 0 && !/another|elsewhere/i.test(r.notice) && /edited/.test(r.record) && r.otherDay && r.search.length === 1 && r.tagLines === 1 && !errors.length
console.log(JSON.stringify(r)); console.log(ok ? 'PASS' : 'FAIL')
await browser.close(); if (!ok) process.exit(1)
