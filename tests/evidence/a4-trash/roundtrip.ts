// A4 §5 round trip with the real rollback script, the real migration 4 and TODAY'S BUILD's own repository and domain
// (a checkout of 5193991), on a fresh database. Prints one line per check and exits non-zero on the first failure.
//   node tests/evidence/a4-trash/roundtrip.ts <checkout of 5193991> <empty work dir>
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { SqliteWorkspaceRepository as NewRepo } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
import { trashBatches, visiblePages } from '../../../src/domain/page-tree.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'

const [oldTree, work] = process.argv.slice(2).map(p => resolve(p!))
if (!oldTree || !work) throw new Error('usage: roundtrip.ts <old checkout> <work dir>')
const Old = await import(join(oldTree, 'src/server/sqlite-repository.ts'))
const oldDoc = await import(join(oldTree, 'src/domain/editor-document.ts'))
const db = join(work, 'workspace.sqlite')
const check = (name: string, fn: () => void) => { fn(); console.log(`ok   ${name}`) }
type Repo = { load(): Promise<Workspace>; execute(c: unknown): Promise<{ workspace: Workspace }> }
let n = 0
async function exec(repo: Repo, action: Action | Record<string, unknown>, operationId = `op${++n}`) {
  const ws = await repo.load()
  return (await repo.execute({ operationId, expectedRevision: ws.revision, action })).workspace
}
type Node = Record<string, unknown>
async function edit(repo: Repo, docs: { editorSeed: typeof editorSeed; pageContentKey: typeof pageContentKey }, pageId: string, add: Node[]) {
  const ws = await repo.load(), p = ws.pages.find(x => x.id === pageId)!
  return exec(repo, { type: 'save-editor', pageId, expectedContent: docs.pageContentKey(p), document: JSON.stringify([...docs.editorSeed(p, ws), ...add]) })
}
const card = (id: string, pageId: string): Node => ({ id, type: 'pageLink', props: { pageId } })
const line = (id: string, text: string): Node => ({ id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] })
const task = (id: string, text: string): Node => ({ id, type: 'task', props: { taskId: `editor-task:${id}`, role: 'reference' }, content: text })
const script = (...args: string[]) => spawnSync(process.execPath, ['scripts/sqlite-rollback-trash.ts', db, ...args], { encoding: 'utf8' })
const at = '2026-10-20T17:30:00.000Z'
const url = 'https://example.com/focaccia'
const newDocs = { editorSeed, pageContentKey }

// 1. New build: Sun Oct 18 > P (task, link, capture) > C; Q > Q1 deleted together; E (empty card target).
const repo = new NewRepo(db, '/nonexistent.json', { allowMissingLegacy: true })
let ws = await exec(repo, { type: 'ensure-day', date: '2026-10-18' })
const D = ws.pages[0]!.id
for (const [id, parent] of [['P', D], ['C', 'P'], ['E', D], ['Q', D], ['Q1', 'Q']] as const) {
  await exec(repo, { type: 'create-document', title: id === 'E' ? 'Empty target' : `Page ${id}`, body: '', pageId: id, parentId: parent })
  await edit(repo, newDocs, parent, [card(`card:${id}`, id)])
}
await edit(repo, newDocs, 'P', [line('p-line', 'dough notes #recipe'), task('p-task', 'buy flour')])
// E's own task: a recorded source, so it doesn't make E's empty recreation count as used.
await edit(repo, newDocs, 'E', [task('e-task', 'E task')])
ws = await repo.load()
await exec(repo, { type: 'save-material', pageId: 'P', sectionId: ws.pages.find(p => p.id === 'P')!.sections[0]!.id, url, title: 'Focaccia', body: '', note: '' })
await exec(repo, { type: 'capture', pageId: 'P', text: 'try 80% hydration' })
ws = await repo.load()
const oldTaskId = ws.tasks.find(t => t.title === 'buy flour')!.id
const captureId = ws.captures.find(c => c.pageId === 'P')!.id
await repo.reserveModelAttempt({ id: 'a1', captureId, revision: 1, day: '2026-10-18', upperBoundUsd: 0.004, model: 'm', requestHash: 'h', now: at })
await exec(repo, { type: 'delete-page', pageId: 'C', at }, 'op-c')
await exec(repo, { type: 'delete-page', pageId: 'P', at }, 'op-p')
await exec(repo, { type: 'delete-page', pageId: 'E', at }, 'op-e')
await exec(repo, { type: 'delete-page', pageId: 'Q', at }, 'op-q')
await exec(repo, { type: 'restore-page', pageId: 'Q1' })
await exec(repo, { type: 'rename-page', pageId: 'Q1', title: 'Q1 restored and edited' })
const beforeRollback = await repo.load()
check('new build: two batches for C then P, Q1 restored alone and edited, Undo present', () => {
  assert.deepEqual(trashBatches(beforeRollback).map(b => b.trashId).sort(), ['op-c', 'op-e', 'op-p', 'op-q'])
  assert.equal(beforeRollback.pages.find(p => p.id === 'Q1')!.parentId, undefined)
  assert.ok(beforeRollback.undo)
})

// 2. Backup failure stops before anything changes.
const fingerprint = () => { const d = new DatabaseSync(db); try { return JSON.stringify([d.prepare('PRAGMA user_version').get(), d.prepare('SELECT * FROM pages ORDER BY snapshot, id').all()]) } finally { d.close() } }
const untouched = fingerprint()
check('script: a failed backup stops with nothing changed', () => {
  const r = script('--backup', join(work, 'no-such-dir', 'backup.sqlite'))
  assert.notEqual(r.status, 0)
  assert.equal(fingerprint(), untouched)
})

// 3. Rollback script.
check('script: layout 4 → 3 with a readable backup', () => {
  const r = script()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Layout 4 → 3\. 4 pages held from the trash, 5 sources recorded; Undo cleared\. Backup at /)
  console.log(r.stdout.trim().split('\n').map(l => `     ${l}`).join('\n'))
})
check('script: run again on layout 3 refuses and changes nothing', () => {
  const f = fingerprint(), r = script()
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Expected layout 4, found 3; nothing changed/)
  assert.equal(fingerprint(), f)
})

// 4. Today's build (5193991) on the downgraded file.
const old: Repo = new Old.SqliteWorkspaceRepository(db, '/nonexistent.json', { allowMissingLegacy: true })
let o = await old.load()
check("today's build opens it: held pages hidden, Undo empty, the held page's task still listed", () => {
  assert.deepEqual(o.pages.map(p => p.id).sort(), [D, 'Q1'].sort())
  assert.equal(o.undo, undefined)
  assert.ok(o.tasks.some(t => t.id === oldTaskId && t.status === 'open'))
})
o = await exec(old, { type: 'task-status', taskId: oldTaskId, status: 'done' })
o = await exec(old, { type: 'task-status', taskId: oldTaskId, status: 'open' })
// Retry on the card to P and to E: today's build recreates both with the held ids.
await exec(old, { type: 'create-document', title: '', body: '', pageId: 'P', parentId: D })
await exec(old, { type: 'create-document', title: '', body: '', pageId: 'E', parentId: D })
await edit(old, oldDoc, 'P', [line('p2-line', 'rewritten during rollback'), task('p2-task', 'new task during rollback')])
o = await old.load()
await exec(old, { type: 'save-material', pageId: 'P', sectionId: o.pages.find(p => p.id === 'P')!.sections[0]!.id, url, title: 'Focaccia', body: '', note: '' })
await exec(old, { type: 'rename-page', pageId: 'Q1', title: 'Q1 v2' })
o = await exec(old, { type: 'undo', targetOperationId: `op${n}` })
await exec(old, { type: 'rename-page', pageId: 'Q1', title: 'Q1 v3' })
o = await old.load()
const newTaskId = o.tasks.find(t => t.title === 'new task during rollback')!.id
check("today's build: Retry recreated P (written in) and E (left empty); its own Undo works", () => {
  assert.equal(o.materials.length, 1)
  assert.equal(o.materials[0]!.sources.length, 2)
  assert.equal(o.pages.find(p => p.id === 'Q1')!.title, 'Q1 v3')
})

// 5. Re-upgrade (migration 4) by opening with the new build.
const logs: string[] = [], info = console.info
console.info = (s: string) => { logs.push(s) }
ws = await new NewRepo(db).load()
console.info = info
const log = JSON.parse(logs.find(l => l.includes('storage.trash-reupgrade'))!)
const P2 = log.idMap.P as string
const page = (id: string) => ws.pages.find(p => p.id === id)!
check('re-upgrade log: 4 restored, E dropped as an untouched recreation, P → new id, 4 sources moved (2 tasks, 1 material edge, 1 capture)', () => {
  assert.equal(log.restored, 4)
  assert.deepEqual(log.recreatedDropped, ['E'])
  assert.deepEqual(Object.keys(log.idMap), ['P'])
  assert.equal(log.sourcesMoved, 4)
  console.log(`     ${JSON.stringify(log)}`)
})
check('both P pages kept: the live one has the id and the new line; the held one is in the trash under the new id', () => {
  assert.equal(page('P').trashedAt ?? null, null)
  assert.ok(JSON.stringify(page('P').sections).includes('rewritten during rollback'))
  assert.equal(page(P2).trashId, 'op-p')
  assert.equal(page(P2).parentId, D)
  assert.ok(JSON.stringify(page(P2).sections).includes('dough notes #recipe'))
})
check('cross-batch child C (op-c) now points at the held parent\'s new id', () => {
  assert.equal(page('C').trashId, 'op-c')
  assert.equal(page('C').parentId, P2)
})
check('sources: old task, old material edge and capture → new id; new task and new edge stay on the live page', () => {
  assert.equal(ws.tasks.find(t => t.id === oldTaskId)!.sourcePageId, P2)
  assert.equal(ws.tasks.find(t => t.id === newTaskId)!.sourcePageId, 'P')
  assert.equal(ws.captures.find(c => c.id === captureId)!.pageId, P2)
  const sources = ws.materials[0]!.sources.map(s => s.pageId)
  assert.deepEqual(sources, [P2, 'P'])
})
check('E: the empty recreation is gone and the held E is back in the trash under its original id, with its task', () => {
  assert.equal(ws.tasks.find(t => t.id === 'editor-task:e-task')!.sourcePageId, 'E')
  assert.equal(ws.pages.filter(p => p.id === 'E').length, 1)
  assert.equal(page('E').trashId, 'op-e')
})
check('Q: back in the trash (op-q); Q1 stays live at top level with the rollback edit', () => {
  assert.equal(page('Q').trashId, 'op-q')
  assert.equal(page('Q1').trashedAt ?? null, null)
  assert.equal(page('Q1').parentId, undefined)
  assert.equal(page('Q1').title, 'Q1 v3')
})
check('Undo cleared at re-upgrade; nothing held is visible; the ledger is unchanged', () => {
  assert.equal(ws.undo, undefined)
  assert.deepEqual(visiblePages(ws).map(p => p.id).sort(), [D, 'P', 'Q1'].sort())
  const d = new DatabaseSync(db)
  assert.equal(Number(d.prepare('SELECT count(*) n FROM model_attempts').get()!.n), 1)
  assert.equal(d.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'held_%'").all().length, 0)
  d.close()
})
const repo2 = new NewRepo(db)
await exec(repo2, { type: 'rename-page', pageId: 'Q1', title: 'Q1 v4' }, 'after-1')
ws = await exec(repo2, { type: 'undo', targetOperationId: 'after-1' })
check('a new Undo after the cleared one works and keeps every trashed page', () => {
  assert.equal(page('Q1').title, 'Q1 v3')
  assert.deepEqual(trashBatches(ws).map(b => b.trashId).sort(), ['op-c', 'op-e', 'op-p', 'op-q'])
})
const settled = JSON.stringify(await repo2.load())
const reopened = JSON.stringify(await new NewRepo(db).load())
check('opening again (migration already run) changes nothing', () => assert.equal(reopened, settled))
ws = await exec(repo2, { type: 'restore-batch', trashId: 'op-p' })
ws = await exec(repo2, { type: 'restore-batch', trashId: 'op-c' })
check('restore the held P, then C: P under Sun Oct 18 next to the live P, C under the restored P', () => {
  assert.equal(page(P2).parentId, D)
  assert.equal(page('C').parentId, P2)
})
console.log('all checks passed')
