// Lead's review probe for B81 on a built app: real network cut (context.setOffline), both engines, reload at several delays after the network returns.
// Args: base store engine. Run from the worktree so the seed script and playwright resolve.
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (process.argv.length < 5) { console.error('Usage: node tests/evidence/b81/offline.mjs <base-url> <store-path> <chromium|webkit>'); process.exit(2) }
const [base, storePath, engine] = process.argv.slice(2)
if (!base || !storePath || !engine) { console.error('usage: base store engine'); process.exit(2) }
const seed = () => execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const doc = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'books').document
const browser = await pw[engine].launch({ headless: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
let bad = 0
for (const delay of [0, 50, 150, 300, 600, 1000, 3000]) for (let run = 1; run <= 3; run++) {
  seed()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${base}/pages?page=books`); await wait(2500)
  await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight')
  await context.setOffline(true)
  const word = ` typed${delay}x${run}`
  await page.keyboard.type(word); await wait(2500)
  const before = (await page.locator('.editor-save-line').innerText().catch(() => '')).replace(/\s+/g, ' ')
  await context.setOffline(false)
  await wait(delay)
  await page.reload().catch(() => {}); await wait(4500)
  const line = (await page.locator('.editor-save-line').innerText().catch(() => '(none)')).replace(/\s+/g, ' ')
  const saved = doc().includes(word)
  const wrong = /another device|another tab|draft kept/i.test(line)
  const shown = await page.getByText(word.trim()).count()
  const ok = saved && !wrong && shown === 1
  if (!ok) bad++
  console.log(ok ? 'ok  ' : 'FAIL', engine, `delay=${delay}`, `run=${run}`, JSON.stringify({ before, line, saved, shown }))
  await context.close()
}
await browser.close()
console.log(bad ? `${bad} FAILED` : 'ALL OK'); process.exit(bad ? 1 : 0)
if (bad) process.exit(1)
