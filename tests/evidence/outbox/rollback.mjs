// B98 items 8, 20, 22 (docs/design/outbox.md §11): a tab of this build stays open while the server rolls back to the
// floor build and forward again. A change stored before the rollback is never sent to the floor build (which has no
// runOutboxCommand and couldn't check it): it stays kept, said as "Not sent yet". A change made during the rollback goes
// through the old path, as without the outbox. Once this build serves again, the stored change is sent.
// Usage: node tests/evidence/outbox/rollback.mjs <this tree> <floor tree> <store path> [chromium|webkit]
//   Both trees built (dist/). The store is a throwaway path; it's seeded here. Port 3819.
import * as pw from '@playwright/test'
import { spawn, execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
const [self, floor, storePath, only] = process.argv.slice(2), results = []
if (!self || !floor || !storePath) { console.error('Usage: node tests/evidence/outbox/rollback.mjs <this tree> <floor tree> <store path> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const port = 3819, base = `http://127.0.0.1:${port}`
const stored = () => { const db = new DatabaseSync(storePath, { readOnly: true }); try { return JSON.parse(db.prepare('SELECT data FROM workspace WHERE id = 1').get().data) } finally { db.close() } }
const statusOf = title => stored().tasks.find(t => t.title === title)?.status
let server
const serve = async tree => {
  server = spawn('node', ['node_modules/.bin/vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: tree, env: { ...process.env, DAYTHREAD_AUTH: 'off', DAYTHREAD_STORAGE: 'sqlite', DAYTHREAD_SQLITE_PATH: storePath }, stdio: 'ignore' })
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/sign-in`)).ok) return } catch { /* starting */ } await wait(250) }
  throw new Error(`${tree} didn't start`)
}
const stop = async () => { if (!server) return; const s = server; server = undefined; s.kill(); await new Promise(r => s.once('exit', r)); await wait(300) }

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const tag = engine
  execSync(`node --no-warnings tests/evidence/outbox/seed.ts ${storePath}`, { cwd: self, stdio: 'ignore' })
  await serve(self)
  const browser = await pw[engine].launch(), context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage()
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(500) }
  const back = async () => { await page.evaluate(() => window.dispatchEvent(new Event('online'))); await wait(1500); await settle() }
  try {
    await page.goto(`${base}/tasks?view=open`); await page.getByRole('checkbox', { name: /^Mark / }).first().waitFor({ timeout: 20000 }); await settle()
    // Before the rollback: a tick that couldn't be sent stays stored.
    await page.route('**/_serverFn/cedd5fc6*', route => route.abort('internetdisconnected'))
    await page.getByRole('checkbox', { name: 'Mark Water the plants done' }).click(); await wait(800)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    // The floor build serves now.
    await stop(); await serve(floor); await back()
    const line = (await page.locator('.banner.offline').innerText().catch(() => '')).trim()
    ok(`${tag} 20 on the floor build the stored tick isn't sent, and says so ("${line}")`, statusOf('Water the plants') === 'open' && /Not sent yet · 1 change will be sent/.test(line), `status ${statusOf('Water the plants')}`)
    // A change made now goes the old way, as it would have without the outbox.
    const before = stored().revision
    await page.getByRole('checkbox', { name: 'Mark Call the bank done' }).click(); await wait(1200); await settle()
    ok(`${tag} 22 a change made on the floor build goes through the old path`, statusOf('Call the bank') === 'done' && statusOf('Water the plants') === 'open' && stored().revision === before + 1, `revision ${before} → ${stored().revision}`)
    // Forward again: the stored tick is sent once.
    await stop(); await serve(self); await back()
    // The floor build wrote while it served, unstamped, so the stored tick can't be row-checked: it's held, never applied
    // over that write (§11), and Keep mine sends it.
    const text = (await page.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    ok(`${tag} 8 forward again, the stored tick is held, not applied over the floor build's write ("${text}")`, statusOf('Water the plants') === 'open' && /ticked "Water the plants" · changed since/.test(text) && /Keep mine/.test(text), `status ${statusOf('Water the plants')}`)
    await page.locator('.banner.save-failed').getByRole('button', { name: 'Keep mine' }).click(); await wait(1200); await settle()
    ok(`${tag} 8b Keep mine sends it once; nothing is left`, statusOf('Water the plants') === 'done' && await page.locator('.banner.save-failed').count() === 0 && await page.locator('.banner.offline').count() === 0 && stored().revision === before + 2, `revision → ${stored().revision}`)
  } catch (error) {
    ok(`${tag} rollback ran to the end`, false, error instanceof Error ? error.message : String(error))
  } finally { await browser.close(); await stop() }
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
