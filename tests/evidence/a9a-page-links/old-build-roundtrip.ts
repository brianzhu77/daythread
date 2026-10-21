// A9a plan §5 round trip against the live build 32ef34b (layout 5), on a copy of Brian's database (Ratchet #83 items):
// `[[` links of each kind and card times → rollback 6 → 5 → 32ef34b opens every page (no "Something went wrong!"),
// its converted links open their pages, it saves a page with cards, he pastes a look-alike in-app link before a
// converted one and edits another converted link → migration 6 → refIds and times back, card order kept, the
// look-alike and the edited link plain, Linked from as before.
//   node old-build-roundtrip.ts <new worktree> <old worktree> <port> <db path> <pristine copy> <shots dir> <playwright index.mjs>
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import { linkedFrom } from '../../../src/domain/page-tree.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const [wt, oldWt, port, dbPath, pristine, out, pw] = process.argv.slice(2) as string[]
const { chromium } = await import(pw!)
const base = `http://127.0.0.1:${port}`, today = 'day:2026-10-20', oct18 = 'day:2026-10-18'
const R = 'fa95e8a3-dd0a-4b3c-8fcc-c1129c8c4820', F = 'ee5bd493-980f-4041-ad34-89efa85ed78a' // 韩国大酱汤, 佛卡夏披萨
const log = (ok: boolean, name: string, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
for (const f of [dbPath!, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true })
copyFileSync(pristine!, dbPath!)

// 1. Links of each kind, written by the new build's own commands.
let repo = new SqliteWorkspaceRepository(dbPath!)
const exec = async (action: Action) => { const ws = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const save = async (pageId: string, edit: (doc: EditorNode[]) => EditorNode[]) => { const ws = await repo.load(), p = ws.pages.find(x => x.id === pageId)!; return exec({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) }) }
const ref = (pageId: string, refId: string) => ({ type: 'pageRef', props: { pageId, refId } })
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
await exec({ type: 'create-document', title: 'Reading list', body: '', pageId: 'rt-doc' })
await save(today, doc => [...doc, { id: 'rt-two', type: 'paragraph', content: [text('参考 '), ref(R, 'rt-r1'), text(' 和 '), ref(R, 'rt-r2')] }, { id: 'rt-edit', type: 'paragraph', content: [ref(F, 'rt-f1'), text(' 发面')] }])
await save('rt-doc', doc => [...doc, { id: 'rt-doc-line', type: 'paragraph', content: [text('see '), ref(F, 'rt-f2')] }, { id: 'rt-doc-card', type: 'pageLink', props: { pageId: R } }])
let ws: Workspace = await repo.load()
const orders = (w: Workspace) => ({ R: linkedFrom(w, R).map(e => e.page.id), F: linkedFrom(w, F).map(e => e.page.id) })
const times = (w: Workspace) => Object.fromEntries(w.pages.flatMap(p => p.sections.flatMap(s => s.blocks)).flatMap(b => [...(b.refs ?? []).map(r => [r.refId, r.at] as const), ...(b.kind === 'reference' && b.at !== undefined ? [[b.id, b.at] as const] : [])]))
const before = { orders: orders(ws), times: times(ws) }
log(before.orders.R.length >= 2 && Object.keys(before.times).length >= 6, 'setup: 4 links (two to one page in one line), Brian\'s 2 Oct 18 cards and a new card, all timed', JSON.stringify(before.orders))

// 2. Rollback 6 → 5.
const rb = spawnSync(process.execPath, ['scripts/sqlite-rollback-page-links.ts', dbPath!, '--backup', `${dbPath}.rt-${Date.now()}.sqlite`], { cwd: wt, encoding: 'utf8' })
log(rb.status === 0, 'rollback script: layout 6 → 5', (rb.stdout || rb.stderr).split('\n')[0]!.replace(/ Backup at .*/, ''))

// 3. The live build opens it and is used.
let server: ChildProcess
const serverLog: string[] = []
const start = async (cwd: string) => {
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', port!, '--strictPort'], { cwd, env: { ...process.env, DAYTHREAD_STORAGE: 'sqlite', DAYTHREAD_SQLITE_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  server.stdout!.on('data', d => serverLog.push(String(d))); server.stderr!.on('data', d => serverLog.push(String(d)))
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) return } catch {} await new Promise(r => setTimeout(r, 200)) }
  throw new Error('server did not start: ' + serverLog.join(''))
}
const stop = async () => { try { process.kill(-server.pid!) } catch {} await new Promise(r => setTimeout(r, 800)) }
await start(oldWt!)
const b = await chromium.launch()
const errors: string[] = []
const open = async (path: string) => {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
  p.on('pageerror', (e: Error) => errors.push(e.message)); p.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  return p
}
const broken = async (p: { locator(s: string): { innerText(): Promise<string> } }) => /Something went wrong/.test(await p.locator('body').innerText())
let p = await open('/')
log(!(await broken(p)) && (await p.locator('.bn-block-outer').count()) > 0, '32ef34b: today opens (no "Something went wrong!")')
const two = p.locator('.bn-block-outer[data-id="rt-two"]')
log((await two.locator('a').count()) === 2 && (await two.innerText()).includes('韩国大酱汤'), '32ef34b: the two links are plain in-app links with the title')
await p.screenshot({ path: `${out}/old-32ef34b-today.png` })
const href = await two.locator('a').first().getAttribute('href')
await p.goto(`${base}${href}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
log(new URL(p.url()).searchParams.get('page') === R && !(await broken(p)), '32ef34b: a converted link opens its page', href ?? '')
await p.close()
p = await open('/pages?page=rt-doc')
log(!(await broken(p)) && (await p.locator('.bn-block-outer').count()) > 0, '32ef34b: the document page with a link and a card opens')
await p.close()
// He edits one converted link's text, pastes a look-alike in-app link before another, and 32ef34b saves Oct 18 (cards).
const sql = <T>(q: string, ...a: string[]) => { const d = new DatabaseSync(dbPath!, { readOnly: true }); try { return d.prepare(q).all(...a) as T[] } finally { d.close() } }
p = await open('/')
const editLink = p.locator('.bn-block-outer[data-id="rt-edit"] a').first()
await editLink.click({ position: { x: 3, y: 5 } }).catch(() => {})
if (new URL(p.url()).pathname !== '/') { await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600) }
await p.evaluate(() => { const a = document.querySelector('.bn-block-outer[data-id="rt-edit"] a'); const t = a?.firstChild; if (t) { const r = document.createRange(); r.setStart(t, 2); r.collapse(true); const s = getSelection()!; s.removeAllRanges(); s.addRange(r) } })
await p.keyboard.type('X'); await p.waitForTimeout(1500)
await p.evaluate(() => { const el = document.querySelector('.bn-block-outer[data-id="rt-two"] .bn-inline-content'); const r = document.createRange(); r.setStart(el!, 0); r.collapse(true); const s = getSelection()!; s.removeAllRanges(); s.addRange(r) })
await p.evaluate(rid => { const dt = new DataTransfer(); dt.setData('text/html', `<a href="/pages?page=${rid}">韩国大酱汤</a>`); dt.setData('text/plain', '韩国大酱汤'); document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, R)
await p.waitForTimeout(1500)
await p.close()
p = await open('/day/2026-10-18')
const notes18 = p.locator('.bn-block-outer').filter({ hasText: '奥德赛' }).first()
await notes18.locator('.bn-inline-content').first().click(); await p.keyboard.press('End'); await p.keyboard.type(' (old build)'); await p.waitForTimeout(1500)
await p.close()
const oct18Row = sql<{ sections: string }>("SELECT sections FROM pages WHERE snapshot='current' AND id=?", oct18)[0]!
log(JSON.parse(oct18Row.sections).flatMap((s: { blocks: { kind: string; at?: number }[] }) => s.blocks).filter((x: { kind: string; at?: number }) => x.kind === 'reference').every((x: { at?: number }) => x.at === undefined), '32ef34b: its save of Oct 18 dropped the cards\' times (as expected)')
const todayDoc = JSON.parse(sql<{ editorJSON: string }>("SELECT editorJSON FROM pages WHERE snapshot='current' AND id=?", today)[0]!.editorJSON)
const twoLinks = todayDoc.find((n: EditorNode) => n.id === 'rt-two').content.filter((c: { type: string }) => c.type === 'link')
log(twoLinks.length === 3 && twoLinks[0].href === `/pages?page=${R}`, '32ef34b: the look-alike link is in the line before the converted ones', JSON.stringify(twoLinks.map((l: { href: string }) => l.href)))
log(errors.length === 0, '32ef34b: no page or console errors', errors.slice(0, 2).join(' | '))
await stop()

// 4. Migration 6 (the new build opens it); everything read back.
repo = new SqliteWorkspaceRepository(dbPath!)
ws = await repo.load()
const after = { orders: orders(ws), times: times(ws) }
const day = ws.pages.find(x => x.id === today)!, doc = JSON.parse(day.editorJSON!) as EditorNode[]
const kinds = (id: string) => ((doc.find(n => n.id === id)!.content as { type: string; props?: { refId: string } }[]).filter(c => c.type === 'link' || c.type === 'pageRef')).map(c => c.type === 'pageRef' ? `ref:${c.props!.refId}` : 'link')
log(JSON.stringify(kinds('rt-two')) === JSON.stringify(['link', 'ref:rt-r1', 'ref:rt-r2']), 'migration 6: the two links are [[ links again with their refIds; the look-alike stays a plain link', JSON.stringify(kinds('rt-two')))
log(JSON.stringify(kinds('rt-edit')) === JSON.stringify(['link']), '   the link edited in 32ef34b stays a plain link')
for (const k of ['rt-r1', 'rt-r2', 'rt-f2', 'rt-doc-card']) log(after.times[k] === before.times[k], `   ${k} has its time back`, `${before.times[k]} → ${after.times[k]}`)
const cards18 = ws.pages.find(x => x.id === oct18)!.sections.flatMap(s => s.blocks).filter(x => x.kind === 'reference')
log(cards18.every(c => after.times[c.id] === before.times[c.id]), '   Brian\'s Oct 18 cards have their times back after 32ef34b saved that page')
log(JSON.stringify(after.orders.R) === JSON.stringify(before.orders.R), '   Linked from of 韩国大酱汤 is as before', JSON.stringify(after.orders.R))
log(JSON.stringify(after.orders.F) === JSON.stringify(before.orders.F.filter(id => id !== today || ws.pages.find(x => x.id === today)!.sections.some(s => s.blocks.some(b => (b.refs ?? []).some(r => r.pageId === F))))), '   Linked from of 佛卡夏披萨 is as before, minus the line whose link he edited', JSON.stringify(after.orders.F))
log(Number(new DatabaseSync(dbPath!, { readOnly: true }).prepare('PRAGMA user_version').get()!.user_version) === 6, '   layout 6, held tables consumed')
await start(wt!)
p = await open('/')
log(!(await broken(p)) && (await p.locator('.bn-block-outer[data-id="rt-two"] .page-ref').count()) === 2, 'the new build shows the two [[ links as chips again')
await p.screenshot({ path: `${out}/new-after-roundtrip.png` })
await p.close()
log(errors.length === 0, 'no page or console errors in either build', errors.slice(0, 2).join(' | '))
await b.close(); await stop()
