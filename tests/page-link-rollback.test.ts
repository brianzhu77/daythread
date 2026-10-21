import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { verifySqliteLayout } from '../src/server/sqlite-mapping.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { linkedFrom } from '../src/domain/page-tree.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// A9a plan §2, §5: rollback 6 → 5 keeps every link's identity and time and every card's time (Ratchet 858f33ed,
// 75bc01c4); migration 6 restores them by marker only, then stamps whatever has no time, once.
const ref = (pageId: string, refId: string) => ({ type: 'pageRef', props: { pageId, refId } })
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const line = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'paragraph', content })
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-page-links-')), path = join(dir, 'w.sqlite')
  let repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
  const exec = async (action: Action) => { const ws = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
  const save = async (pageId: string, edit: (doc: EditorNode[]) => EditorNode[]) => {
    const ws = await repo.load(), p = ws.pages.find(x => x.id === pageId)!
    return exec({ type: 'save-editor', pageId, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, ws))) })
  }
  await exec({ type: 'ensure-day', date: '2026-10-19' }); await exec({ type: 'ensure-day', date: '2026-10-20' })
  for (const [id, title] of [['R', '韩国大酱汤'], ['X', 'X'], ['D', 'D']]) await exec({ type: 'create-document', title: title!, body: '', pageId: id })
  const script = () => spawnSync(process.execPath, ['scripts/sqlite-rollback-page-links.ts', path], { encoding: 'utf8' })
  const reopen = async () => { repo = new SqliteWorkspaceRepository(path); return repo.load() }
  return { dir, path, exec, save, script, reopen, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
const sql = <T>(path: string, fn: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(path); try { return fn(db) } finally { db.close() } }
const row = (path: string, id: string) => sql(path, db => db.prepare("SELECT sections, editorJSON, editorSections FROM pages WHERE snapshot='current' AND id=?").get(id)!) as { sections: string; editorJSON: string; editorSections: string }
/** What a 32ef34b save does to a page: refs kept by its spread, times on cards dropped (its card blocks are rebuilt). */
function oldBuildSave(path: string, id: string, editDoc: (doc: EditorNode[]) => EditorNode[] = d => d) {
  sql(path, db => {
    const r = db.prepare("SELECT sections, editorJSON FROM pages WHERE snapshot='current' AND id=?").get(id)!
    const sections = JSON.parse(String(r.sections)) as { blocks: { kind: string; at?: number; refs?: { at?: number }[] }[] }[]
    for (const b of sections.flatMap(s => s.blocks)) { delete b.at; for (const x of b.refs ?? []) delete x.at }
    const doc = editDoc(JSON.parse(String(r.editorJSON)))
    db.prepare("UPDATE pages SET sections=?, editorSections=?, editorJSON=? WHERE snapshot='current' AND id=?").run(JSON.stringify(sections), JSON.stringify(sections), JSON.stringify(doc), id)
  })
}
const links = (content: unknown) => (Array.isArray(content) ? content : []).filter((c: { type?: string }) => c.type === 'link' || c.type === 'pageRef') as { type: string; href?: string; props?: { refId: string } }[]

test('6 → 5: links become marked in-app links 32ef34b reads; identity and times are held; nothing else changes', async () => {
  const s = await store()
  try {
    await s.save('day:2026-10-20', doc => [...doc, line('l1', text('参考 '), ref('R', 'r1'), text(' 和 '), ref('R', 'r2')), { id: 'card', type: 'pageLink', props: { pageId: 'X' } }])
    const before = await s.reopen()
    const r = s.script()
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Layout 6 → 5\. 2 page links now plain in-app links \(marked\), \d+ card times? held/)
    sql(s.path, db => {
      assert.equal(Number(db.prepare('PRAGMA user_version').get()!.user_version), 5)
      verifySqliteLayout(db, 5)
      for (const p of db.prepare('SELECT editorJSON FROM pages').all()) assert.equal(String(p.editorJSON ?? '').includes('"pageRef"'), false)
      assert.equal(Number(db.prepare('SELECT count(*) n FROM held_page_links_l6').get()!.n), 2)
    })
    const doc = JSON.parse(row(s.path, 'day:2026-10-20').editorJSON) as EditorNode[]
    const hrefs = links(doc.find(n => n.id === 'l1')!.content).map(l => l.href)
    assert.deepEqual(hrefs, ['/pages?page=R&ref=r1', '/pages?page=R&ref=r2'])
    // Back up with nothing touched: everything as before.
    const after = await s.reopen()
    const p = (ws: Workspace) => ws.pages.find(x => x.id === 'day:2026-10-20')!
    assert.deepEqual(p(after).sections, p(before).sections)
    assert.equal(p(after).editorJSON, p(before).editorJSON)
    sql(s.path, db => assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE 'held_%_l6'").get(), undefined))
  } finally { await s.cleanup() }
})

test('after a 32ef34b save: refIds and times come back; card order kept; a look-alike link stays plain (Ratchet 75bc01c4)', async () => {
  const s = await store()
  try {
    await s.save('day:2026-10-19', doc => [...doc, line('a', ref('R', 'ra')), { id: 'ca', type: 'pageLink', props: { pageId: 'X' } }])
    await s.save('D', doc => [...doc, line('b', ref('R', 'rb')), { id: 'cb', type: 'pageLink', props: { pageId: 'X' } }])
    await s.save('day:2026-10-20', doc => [...doc, line('c', text('see '), ref('R', 'rc'))])
    let ws = await s.reopen()
    const order = { R: linkedFrom(ws, 'R').map(e => e.page.id), X: linkedFrom(ws, 'X').map(e => e.page.id) }
    const times = Object.fromEntries(ws.pages.flatMap(p => p.sections.flatMap(x => x.blocks)).flatMap(b => [...(b.refs ?? []).map(r => [r.refId, r.at]), ...(b.at !== undefined ? [[b.id, b.at]] : [])]))
    assert.equal(s.script().status, 0)
    // 32ef34b saves every page; on Oct 20 he pastes an identical in-app link (no marker) before the converted one, and
    // a copy of the converted (marked) link into another line.
    for (const id of ['day:2026-10-19', 'D']) oldBuildSave(s.path, id)
    oldBuildSave(s.path, 'day:2026-10-20', doc => doc.flatMap(n => n.id !== 'c' ? [n] : [
      { ...n, content: [{ type: 'link', href: '/pages?page=R', content: [text('韩国大酱汤')] }, ...(n.content as unknown[])] },
      { id: 'copy', type: 'paragraph', content: (n.content as { type: string }[]).filter(c => c.type === 'link') },
    ]))
    ws = await s.reopen()
    const day20 = ws.pages.find(p => p.id === 'day:2026-10-20')!
    const c = JSON.parse(day20.editorJSON!).find((n: EditorNode) => n.id === 'c')
    assert.deepEqual(links(c.content).map(l => l.type), ['link', 'pageRef'], 'the look-alike stays a plain link; the original is the [[ link again')
    assert.equal(links(c.content)[1]!.props!.refId, 'rc')
    const copy = JSON.parse(day20.editorJSON!).find((n: EditorNode) => n.id === 'copy')
    assert.deepEqual(links(copy.content).map(l => l.type), ['link'], 'a copied marker in another line stays plain')
    const now = Object.fromEntries(ws.pages.flatMap(p => p.sections.flatMap(x => x.blocks)).flatMap(b => [...(b.refs ?? []).map(r => [r.refId, r.at]), ...(b.at !== undefined ? [[b.id, b.at]] : [])]))
    for (const k of ['ra', 'rb', 'rc', 'ca', 'cb']) assert.equal(now[k], times[k], `${k} has its time back`)
    assert.deepEqual(linkedFrom(ws, 'R').map(e => e.page.id), order.R)
    assert.deepEqual(linkedFrom(ws, 'X').map(e => e.page.id), order.X, 'cards keep their order after 32ef34b saved them')
  } finally { await s.cleanup() }
})

test('an edited converted link stays plain and is no longer a reference', async () => {
  const s = await store()
  try {
    await s.save('day:2026-10-20', doc => [...doc, line('e', ref('R', 're'))])
    assert.equal(s.script().status, 0)
    oldBuildSave(s.path, 'day:2026-10-20', doc => doc.map(n => n.id === 'e' ? { ...n, content: [{ type: 'link', href: '/pages?page=R&ref=re', content: [text('my own words')] }] } : n))
    const ws = await s.reopen()
    const b = ws.pages.find(p => p.id === 'day:2026-10-20')!.sections.flatMap(x => x.blocks).find(x => x.id === 'e')!
    assert.equal(b.refs, undefined)
    assert.deepEqual(linkedFrom(ws, 'R'), [])
  } finally { await s.cleanup() }
})

test('migration 6 stamps untimed references once, in the order shown that day; a later move never reorders them', async () => {
  const s = await store()
  try {
    await s.save('day:2026-10-19', doc => [...doc, { id: 'c19', type: 'pageLink', props: { pageId: 'R' } }])
    await s.save('D', doc => [...doc, { id: 'cD', type: 'pageLink', props: { pageId: 'R' } }])
    await s.save('day:2026-10-20', doc => [...doc, { id: 'c20', type: 'pageLink', props: { pageId: 'R' } }])
    // As a store from before B15: no times anywhere, stamped by migration 6 on the way up.
    assert.equal(s.script().status, 0)
    for (const id of ['day:2026-10-19', 'D', 'day:2026-10-20']) oldBuildSave(s.path, id)
    sql(s.path, db => db.exec('DELETE FROM held_card_times_l6'))
    let ws = await s.reopen()
    const legacy = ['day:2026-10-20', 'day:2026-10-19', 'D'] // days newest first, then documents
    assert.deepEqual(linkedFrom(ws, 'R').map(e => e.page.id), legacy)
    assert.ok(ws.pages.flatMap(p => p.sections.flatMap(x => x.blocks)).filter(b => b.kind === 'reference').every(b => b.at !== undefined && b.at < 0))
    await s.exec({ type: 'move-page', pageId: 'D', parentId: 'X' })
    ws = await s.exec({ type: 'move-page', pageId: 'R', parentId: 'X' })
    assert.deepEqual(linkedFrom(ws, 'R').map(e => e.page.id), legacy)
    // A new reference is above every stamped one.
    ws = await s.save('X', doc => [...doc, line('n', ref('R', 'rn'))])
    assert.equal(linkedFrom(ws, 'R')[0]!.page.id, 'X')
  } finally { await s.cleanup() }
})

test('the 6 → 5 script refuses a store that isn\'t layout 6, and changes nothing when the backup can\'t be written', async () => {
  const s = await store()
  try {
    await s.save('day:2026-10-20', doc => [...doc, line('l', ref('R', 'r'))])
    const snap = () => sql(s.path, db => JSON.stringify([db.prepare('PRAGMA user_version').get(), db.prepare('SELECT * FROM pages ORDER BY snapshot, id').all()]))
    const before = snap()
    const bad = spawnSync(process.execPath, ['scripts/sqlite-rollback-page-links.ts', s.path, '--backup', join(s.dir, 'missing', 'b.sqlite')], { encoding: 'utf8' })
    assert.notEqual(bad.status, 0)
    assert.equal(snap(), before)
    assert.equal(s.script().status, 0)
    const again = s.script()
    assert.match(again.stderr, /Expected layout 6, found 5/)
  } finally { await s.cleanup() }
})

test('Ratchet #84: a heading\'s link is converted, held and restored with its refId and time like any line', async () => {
  const s = await store()
  try {
    await s.save('day:2026-10-20', doc => [...doc, { id: 'hd', type: 'heading', props: { level: 2 }, content: [text('关于 '), ref('R', 'rhd')] }])
    let ws = await s.reopen()
    const at = ws.pages.find(p => p.id === 'day:2026-10-20')!.sections.find(x => x.id === 'hd')!.refs![0]!.at
    assert.equal(s.script().status, 0)
    const doc = JSON.parse(row(s.path, 'day:2026-10-20').editorJSON) as EditorNode[]
    assert.deepEqual(links(doc.find(n => n.id === 'hd')!.content).map(l => l.href), ['/pages?page=R&ref=rhd'])
    oldBuildSave(s.path, 'day:2026-10-20')
    sql(s.path, db => { const r = db.prepare("SELECT sections FROM pages WHERE snapshot='current' AND id='day:2026-10-20'").get()!; const secs = JSON.parse(String(r.sections)); for (const x of secs) delete x.refs; db.prepare("UPDATE pages SET sections=?, editorSections=? WHERE snapshot='current' AND id='day:2026-10-20'").run(JSON.stringify(secs), JSON.stringify(secs)) })
    ws = await s.reopen()
    const sec = ws.pages.find(p => p.id === 'day:2026-10-20')!.sections.find(x => x.id === 'hd')!
    assert.deepEqual(sec.refs?.map(r => [r.refId, r.at]), [['rhd', at]])
    assert.ok(linkedFrom(ws, 'R').some(e => e.page.id === 'day:2026-10-20'))
  } finally { await s.cleanup() }
})
