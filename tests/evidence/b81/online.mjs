// Lead's probe: online throughout, a save on the wire, a reload. Does the page wrongly report a conflict? Args: base store engine.
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (process.argv.length < 5) { console.error('Usage: node tests/evidence/b81/online.mjs <base-url> <store-path> <chromium|webkit>'); process.exit(2) }
const [base, storePath, engine] = process.argv.slice(2)
const seed = () => execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const doc = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'books').document
const browser = await pw[engine].launch({ headless: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
let bad = 0, n = 0
for (const delay of [300, 460, 520, 600, 700, 900]) for (let run = 1; run <= 3; run++) {
  seed()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${base}/pages?page=books`); await wait(3000)
  await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight')
  const word = ` on${delay}x${run}`
  await page.keyboard.type(word)
  await wait(delay)
  await page.reload().catch(() => {}); await wait(5000)
  const line = (await page.locator('.editor-save-line').innerText().catch(() => '(none)')).replace(/\s+/g, ' ').trim()
  const saved = doc().includes(word), wrong = /another device|another tab|draft kept/i.test(line), shown = await page.getByText(word.trim()).count()
  const ok = saved && !wrong && shown === 1; n++; if (!ok) bad++
  console.log(ok ? 'ok  ' : 'FAIL', engine, `reloadAfter=${delay}`, `run=${run}`, JSON.stringify({ line, saved, shown }))
  await context.close()
}
await browser.close()
console.log(`${bad} of ${n} failed`)
if (bad) process.exit(1)
