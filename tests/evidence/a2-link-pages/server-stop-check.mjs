// RETIRED (B44, Lead 590a74e3). A pasted link no longer makes a page by itself: it goes in plain, with a menu, and
// "Bookmark page" does what this checked. This check was also tied to Brian's data as of Oct 20 ("today" fixed), so it
// can't run on a fresh copy. Its saved output (*-output.txt) is the record of A2 as built. Current checks:
//   tests/evidence/b44/menu-check.mjs (the menu, Bookmark = A2's paste, both undo steps, §4a)
//   tests/evidence/b43/preview-check.mjs (the bookmarked page's title and description)
console.log('retired: see tests/evidence/b44/menu-check.mjs'); process.exit(0)

// Jazz link-pages-states §6 check 8: the server is stopped, he pastes → the card says "Not created · Retry" and keeps
// the URL; after a restart, Retry makes the page once, as a link page (never an empty page).
//   node server-stop-check.mjs <worktree> <port> <db path> <pristine copy> <shots dir> <playwright index.mjs>
import { spawn } from 'node:child_process'
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const [wt, port, dbPath, pristine, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const base = `http://127.0.0.1:${port}`, today = '2026-10-20', U = 'https://example.org/stopped'
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true }); copyFileSync(pristine, dbPath)
const linkPages = () => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare("SELECT id, url, parentId FROM pages WHERE snapshot='current' AND url IS NOT NULL").all() } finally { d.close() } }
let server
const start = async () => {
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort'], { cwd: wt, env: { ...process.env, DAYTHREAD_STORAGE: 'sqlite', DAYTHREAD_SQLITE_PATH: dbPath }, stdio: 'ignore', detached: true })
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) return } catch {} await new Promise(r => setTimeout(r, 200)) }
  throw new Error('server did not start')
}
const stop = async () => { process.kill(-server.pid); await new Promise(r => setTimeout(r, 800)) }
await start()
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 900 } })
await p.goto(base, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
await stop()
await p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`).click()
await p.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, U)
await p.waitForTimeout(4000)
const card = p.locator('.editor-page-card-row').first()
log(/Not created · Retry/.test(await card.innerText()), '8. server stopped: the card says "Not created · Retry"', await card.innerText())
log((await card.innerText()).includes('example.org/stopped'), '   the URL is never lost: it is the card\'s title')
log(linkPages().length === 0, '   nothing was written')
await p.screenshot({ path: `${out}/1280-not-created.png` })
await start()
await card.locator('.editor-page-card').click(); await p.waitForTimeout(1500)
const lp = linkPages()
log(lp.length === 1 && lp[0].url === U && lp[0].parentId === `day:${today}`, '   Retry after the restart makes the page once, a link page under today', JSON.stringify(lp))
await p.waitForTimeout(1000)
const saved = (() => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare("SELECT editorJSON FROM pages WHERE snapshot='current' AND id=?").get(`day:${today}`).editorJSON } finally { d.close() } })()
log(saved.includes('"type":"pageLink"') && saved.includes(lp[0]?.id), '   the card is saved right after, pointing at that page')
await card.locator('.editor-page-card').click().catch(() => {}); await p.waitForTimeout(1000)
log(linkPages().length === 1, '   a second tap opens it; still one page')
await b.close(); await stop()
