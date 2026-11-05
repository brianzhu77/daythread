// A2 plan §5 round trip against the live build 21eb45b (layout 4), on a copy of Brian's database:
// link pages of every kind → rollback script → 21eb45b opens it, edits a URL line, trashes a link page, types a Good
// Stuffs URL equal to a link page's, and Undoes → migration 5 → the new build reads everything back with the same
// identities, and pasting each URL again finds the same page.
//   node old-build-roundtrip.ts <new worktree> <old worktree> <port> <db path> <pristine copy> <shots dir> <playwright index.mjs>
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import { pasteRecords } from '../../../src/domain/workspace.ts'
import { urlKey } from '../../../src/domain/url-key.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const [wt, oldWt, port, dbPath, pristine, out, pw] = process.argv.slice(2) as string[]
const { chromium } = await import(pw!)
const today = '2026-10-20', base = `http://127.0.0.1:${port}`
const log = (ok: boolean, name: string, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
for (const f of [dbPath!, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true })
copyFileSync(pristine!, dbPath!)

// 1. Link pages of every kind, written by the new build's own commands.
let repo = new SqliteWorkspaceRepository(dbPath!)
const exec = async (action: Action, operationId: string = crypto.randomUUID()) => { const ws = await repo.load(); return (await repo.execute({ operationId, expectedRevision: ws.revision, action })).workspace }
const day = `day:${today}`, oct18 = 'day:2026-10-18'
async function paste(on: string, url: string, n: string, kind = 'notes') {
  let ws = await repo.load()
  const sectionId = ws.pages.find(p => p.id === on)!.sections.find(s => s.kind === kind)?.id
  ws = await exec({ type: 'paste-links', pageId: on, ...(sectionId ? { sectionId } : {}), today, items: [{ url, pageId: `rt-${n}`, cardBlockId: `rt-card-${n}`, lineType: 'bulletListItem' }] }, `rt-op-${n}`)
  const target = pasteRecords(ws.pages.find(p => p.id === on)!, `rt-op-${n}`)[0]!.pageId
  const p = ws.pages.find(x => x.id === on)!
  await exec({ type: 'save-editor', pageId: on, expectedContent: pageContentKey(p), document: JSON.stringify([...editorSeed(p, ws), { id: `rt-card-${n}`, type: 'pageLink', props: { pageId: target, url, line: 'bulletListItem' } }]) })
  return target
}
const notes = await paste(day, 'https://Notes.example/recipe', 'notes')
const gs = await paste(day, 'https://gs.example/article', 'gs', 'good-stuffs')
let ws = await repo.load()
await exec({ type: 'review-material', materialId: ws.materials.find(m => m.url === 'https://gs.example/article')!.id, decision: 'watching', date: today, nextReviewOn: '2026-10-27' })
const reused = await paste(oct18, 'https://notes.example/recipe', 'reused')
const restored = await paste(day, 'https://restore.example/', 'restored')
await exec({ type: 'delete-page', pageId: restored, at: '2026-10-20T12:00:00.000Z' }, 'rt-del')
const restoredAgain = await paste(day, 'https://restore.example', 'restored-again')
const trashLater = await paste(day, 'https://trash-later.example/', 'trash-later')
const undone = await paste(day, 'https://undone.example/', 'undone')
await exec({ type: 'undo-paste-links', pageId: day, operationId: 'rt-op-undone', today })
ws = await repo.load()
const before = ws.pages.filter(p => p.url).map(p => ({ id: p.id, url: p.url, trashed: Boolean(p.trashedAt) }))
log(reused === notes && restoredAgain === restored && !ws.pages.some(p => p.id === undone) && before.length === 4, 'setup: 4 link pages (Notes, Good Stuffs with a decision, a restored one, one to trash); a repeat and an undone paste', JSON.stringify(before))

// 2. Rollback 5 → 4.
const rb = spawnSync(process.execPath, ['scripts/sqlite-rollback-link-pages.ts', dbPath!, '--backup', `${dbPath}.rt-backup-${Date.now()}.sqlite`], { cwd: wt, encoding: 'utf8' })
log(rb.status === 0, 'rollback script: layout 5 → 4', (rb.stdout || rb.stderr).split('\n')[0])
const sql = <T>(q: string, ...args: string[]) => { const d = new DatabaseSync(dbPath!, { readOnly: true }); try { return d.prepare(q).all(...args) as T[] } finally { d.close() } }
log(Number((sql<{ user_version: number }>('PRAGMA user_version')[0]!).user_version) === 4, '   user_version 4')

// 3. The live build opens it and is used.
let server: ChildProcess
const serverLog: string[] = []
const start = async (cwd: string) => {
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', port!, '--strictPort'], { cwd, env: { ...process.env, DAYTHREAD_STORAGE: 'sqlite', DAYTHREAD_SQLITE_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); server.stdout!.on('data', d => serverLog.push(String(d))); server.stderr!.on('data', d => serverLog.push(String(d)))
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) return } catch {} await new Promise(r => setTimeout(r, 200)) }
  throw new Error('server did not start')
}
const stop = async () => { try { process.kill(-server.pid!) } catch { console.log('server had already exited:', serverLog.join('').slice(-1500)) } await new Promise(r => setTimeout(r, 800)) }
await start(oldWt!)
const b = await chromium.launch()
const errors: string[] = []
const open = async (path: string) => {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
  p.on('pageerror', (e: Error) => errors.push(e.message)); p.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  return p
}
let p = await open(`/pages?page=${encodeURIComponent(notes)}`)
log((await p.locator('.bn-editor').innerText()).includes('https://Notes.example/recipe'), '21eb45b: the link page opens and shows its URL as the first line')
await p.locator(`.bn-block-outer[data-id="link-url:${notes}"] .bn-inline-content`).first().click(); await p.keyboard.press('End'); await p.keyboard.type(' — read later'); await p.waitForTimeout(1500)
await p.screenshot({ path: `${out}/old-21eb45b-link-page.png` })
await p.close()
p = await open(`/pages?page=${encodeURIComponent(trashLater)}`)
await p.getByRole('button', { name: 'Page actions' }).first().click(); await p.waitForTimeout(300)
await p.getByRole('menuitem', { name: 'Delete' }).first().click(); await p.waitForTimeout(1200)
log(sql<{ trashedAt: string | null }>("SELECT trashedAt FROM pages WHERE snapshot='current' AND id=?", trashLater)[0]?.trashedAt !== null, '21eb45b: a link page is trashed there')
await p.close()
p = await open('/')
// A new line under Good Stuffs: Enter at the end of its heading.
const heading = p.locator(`.bn-block-outer[data-id="day:${today}:good-stuffs"] .bn-inline-content`).first()
await heading.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection()!; sel.removeAllRanges(); sel.addRange(r) })
await heading.click({ position: { x: (await heading.boundingBox())!.width - 2, y: 10 } }); await p.keyboard.press('End'); await p.keyboard.press('Enter')
await p.keyboard.type('https://notes.example/recipe'); await p.waitForTimeout(1500)
log(sql<{ url: string }>("SELECT url FROM materials WHERE snapshot='current'").some(m => urlKey(m.url) === urlKey('https://Notes.example/recipe')), '21eb45b: a Good Stuffs URL typed there (the Notes page\'s key) becomes a saved item')
await p.keyboard.type(' x'); await p.waitForTimeout(700); await p.keyboard.press('Meta+z'); await p.waitForTimeout(1500)
await p.screenshot({ path: `${out}/old-21eb45b-today.png` })
await p.close()
log(errors.length === 0, '21eb45b: no page or console errors', errors.slice(0, 3).join(' | '))
await stop()

// 4. Migration 5 (the new build opens it), then everything is read back.
repo = new SqliteWorkspaceRepository(dbPath!)
ws = await repo.load()
const pageOf = (id: string) => ws.pages.find(x => x.id === id)
log(pageOf(notes)?.url === 'https://Notes.example/recipe' && pageOf(gs)?.url === 'https://gs.example/article' && pageOf(restored)?.url === 'https://restore.example/' && pageOf(trashLater)?.url === 'https://trash-later.example/', 'migration 5: each page has its URL back, by page id')
log(Boolean(pageOf(trashLater)?.trashedAt) && !pageOf(restored)?.trashedAt, '   the page trashed in 21eb45b stays in the trash; the others stay live')
const firstText = (id: string) => pageOf(id)!.sections.flatMap(s => s.blocks).map(x => x.text)
log(firstText(notes).some(t => t === 'https://Notes.example/recipe — read later'), '   the URL line edited in 21eb45b stays')
log(!firstText(gs).some(t => t === 'https://gs.example/article') && !firstText(restored).some(t => t === 'https://restore.example/'), '   the untouched URL lines are gone')
const mats = ws.materials.filter(m => urlKey(m.url) === urlKey('https://notes.example/recipe'))
log(mats.length === 1, '   the URL typed in 21eb45b is the Notes page\'s one saved item (matched by key)')
const gsMat = ws.materials.find(m => m.url === 'https://gs.example/article')
log(gsMat?.reviewState === 'watching' && gsMat.nextReviewOn === '2026-10-27', '   the Good Stuffs item keeps its decision')
log(sql<{ name: string }>("SELECT name FROM sqlite_master WHERE name='held_links_l5'").length === 0 && Number((sql<{ user_version: number }>('PRAGMA user_version')[0]!).user_version) === 5, '   held table consumed; layout 5')
for (const [url, id, n] of [['https://NOTES.example/recipe', notes, 'a1'], ['https://gs.example:443/article', gs, 'a2'], ['https://restore.example', restored, 'a3'], ['https://trash-later.example', trashLater, 'a4']] as const) {
  const again = await paste(day, url, n)
  log(again === id, `   pasting ${url} again finds the same page`)
}
ws = await repo.load()
log(ws.pages.filter(p => p.url).length === 4, '   still 4 link pages, no second page for any URL')
// The new build opens the result without errors.
await start(wt!)
p = await open(`/pages?page=${encodeURIComponent(notes)}`)
log((await p.locator('.link-url-row').innerText()).includes('https://Notes.example/recipe'), 'the new build shows the URL row again')
await p.close(); p = await open('/')
log((await p.locator('.editor-page-card-row.is-link').count()) >= 4, 'today\'s link cards render as link cards (URL read from the page again)')
await p.screenshot({ path: `${out}/new-after-roundtrip.png` })
await p.close()
log(errors.length === 0, 'no page or console errors in either build', errors.slice(0, 3).join(' | '))
await b.close(); await stop()
