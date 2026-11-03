// R2-4, R2-5, R2-6 on a copy of his data: a linked view in his Day template. Every new day gets its own, filtered to that day, and
// making a day stays one operation with nothing else made. Adds the views to the copy it's given, so give it a throwaway copy.
// Usage: node tests/evidence/databases/template-view.mjs <base-url> <copy-store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/template-view.mjs <base-url> <copy-store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
const ws = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
execSync(`node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
execSync(`node tests/evidence/databases/template-view-seed.ts ${storePath}`, { stdio: 'inherit' })
const days = ['2026-12-20', '2026-12-21']
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
const out = { days: [] }
const before = ws()
for (const date of days) {
  await page.goto(`${base}/day/${date}`); await page.waitForTimeout(3000)
  const s = ws(), day = s.pages.find(p => p.date === date), blocks = JSON.parse(day.document).filter(n => n.type === 'database')
  const rows = await page.locator('.database-block .database-title-cell').allInnerTexts()
  out.days.push({ date, blocks: blocks.length, sameIdAsTemplate: blocks.some(b => b.id === 'tv1'), tables: await page.locator('.database-table').count(), rows })
}
const after = ws()
out.databases = [before, after].map(s => s.pages.filter(p => p.database).length)
out.pages = after.pages.length - before.pages.length
out.tasksMade = after.tasks.length - before.tasks.length
out.errors = errors
// Dec 20 shows the row due Dec 20; Dec 21 the row due Dec 21; opening one writes neither the rows nor the source.
const ok = out.days.every(d => d.blocks === 2 && !d.sameIdAsTemplate && d.tables === 2) && out.days[0].rows.includes('Due the 20th') && !out.days[0].rows.includes('Due the 21st') && out.days[1].rows.includes('Due the 21st') && !out.days[1].rows.includes('Due the 20th') && out.databases[0] === out.databases[1] && !errors.length
// R2-4, R2-14: + New in that view starts with the page's day, stays in sight there, and isn't on the other day's page.
await page.locator('.database-block').first().locator('.database-new').click(); await page.waitForTimeout(1800)
const row = ws().pages.find(p => p.parentId === 'list' && !before.pages.some(q => q.id === p.id) && p.values?.due?.start === days[1])
out.newRow = Boolean(row); out.shownThere = await page.locator(`.database-block .database-row[data-row="${row?.id}"]`).count()
await page.goto(`${base}/day/${days[0]}`); await page.waitForTimeout(3000)
out.shownOnOtherDay = await page.locator(`.database-block .database-row[data-row="${row?.id}"]`).count()
const newOk = out.newRow && out.shownThere === 2 && out.shownOnOtherDay === 0 && !errors.length
console.log(JSON.stringify(out)); console.log(ok && newOk ? 'PASS' : 'FAIL')
await browser.close(); if (!ok || !newOk) process.exit(1)
