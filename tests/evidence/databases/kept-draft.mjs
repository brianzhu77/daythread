// R1-15: a Text cell's typing survives the app being killed before any hide event or commit. Fresh store (reseeded).
// 1. Type into Dune's Notes, kill the browser process (SIGKILL: no pagehide, no visibilitychange), start a new one:
//    the next start sends the kept value.
// 2. The same, but the cell is changed elsewhere before the restart: the notice names the row and quotes his text, and
//    the stored value is not overwritten.
// Usage: node tests/evidence/databases/kept-draft.mjs <base-url> <store-path> [chromium|webkit]  (KILL_AFTER_MS: wait before the kill, default 3000)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/kept-draft.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const notes = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`).toString()).pages.find(p => p.id === 'dune').values.notes
// One profile kept across the kill and the restart, as the phone's app keeps its storage.
const profile = mkdtempSync(join(tmpdir(), 'kept-draft-'))
const open = async () => {
  const context = await pw[engine].launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 900 } })
  const page = context.pages()[0] ?? await context.newPage()
  return { context, page }
}
const out = {}
const typeWithoutSaving = async (text) => {
  const { context, page } = await open()
  await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
  await page.locator('.database-block').first().locator('.database-row').first().locator('.database-td.is-text .database-cell').click(); await page.waitForTimeout(400)
  await page.keyboard.press('Meta+A'); await page.keyboard.type(text)
  // A few seconds pass before the kill, as when he leaves the app mid-sentence; the browser writes its storage to disk
  // on its own schedule (Chromium within about a second), which a kill in the same instant could beat.
  await page.waitForTimeout(Number(process.env.KILL_AFTER_MS ?? 3000))
  out.keptBeforeKill = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:cell-draft:')).length)
  return { context }
}
// The kill: every process of this profile gets SIGKILL, so no hide event or commit runs.
const kill = async ({ context }) => { try { execSync(`pkill -KILL -f ${profile}`) } catch { /* already gone */ } await context.close().catch(() => {}) }
// 1. Killed, then restarted.
let s = await typeWithoutSaving('Spice must flow, kept')
out.beforeRestart = notes()
await kill(s)
let { context, page } = await open()
await page.goto(`${base}/pages?page=books`)
out.keptAtStart = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:cell-draft:')).length)
await page.waitForTimeout(8000)
out.afterRestart = notes()
await context.close()
// 2. Changed elsewhere before the restart.
s = await typeWithoutSaving('A long note typed on the phone before the app died')
await kill(s)
execSync(`node -e "const {SqliteWorkspaceRepository}=await import('./src/server/sqlite-repository.ts');const r=new SqliteWorkspaceRepository('${storePath}',undefined,{allowMissingLegacy:true});const w=await r.load();await r.execute({operationId:'elsewhere',expectedRevision:w.revision,action:{type:'set-values',pageId:'dune',values:{notes:'Changed on the laptop'},expected:{},at:new Date().toISOString()}})" --input-type=module`, { stdio: 'ignore' })
;({ context, page } = await open())
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(8000)
out.notice = await page.locator('[role=alert], [role=status]').allInnerTexts().then(t => [...new Set(t.map(x => x.trim()).filter(Boolean))].join(' | ').replace(/\s+/g, ' ').slice(0, 300))
out.afterConflict = notes()
await context.close()
console.log(JSON.stringify(out))
const ok = out.beforeRestart === 'Spice' && out.afterRestart === 'Spice must flow, kept' && out.afterConflict === 'Changed on the laptop' && /Notes in Dune changed elsewhere · yours was “A long note typed on the phone before th…”/.test(out.notice)
console.log(ok ? 'PASS' : 'FAIL'); if (!ok) process.exit(1)
