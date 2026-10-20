import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// A4 rollback direction A (docs/design/a4-trash-data.md §4): the real script and migration 4. Writes by today's build
// during the rollback are stood in for with SQL here; tests/evidence/a4-trash/roundtrip.ts runs the real old build.
const at = '2026-10-20T17:30:00.000Z'
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-trash-')), path = join(dir, 'workspace.sqlite')
  const repo = new SqliteWorkspaceRepository(path, '/nonexistent.json', { allowMissingLegacy: true })
  let n = 0
  const exec = async (action: Action, operationId = `op${++n}`) => { const ws = await repo.load(); return (await repo.execute({ operationId, expectedRevision: ws.revision, action })).workspace }
  let ws = await exec({ type: 'ensure-day', date: '2026-10-18' })
  const day = ws.pages[0]!.id
  await exec({ type: 'create-document', title: 'Parent', body: '', pageId: 'P', parentId: day })
  await exec({ type: 'create-document', title: 'Child', body: '', pageId: 'C', parentId: 'P' })
  ws = await repo.load()
  const p = ws.pages.find(x => x.id === 'P')!
  const doc = [...editorSeed(p, ws), { id: 'card-c', type: 'pageLink', props: { pageId: 'C' } }, { id: 'p-task', type: 'task', props: { taskId: 'editor-task:p-task', role: 'reference' }, content: 'buy flour' }]
  await exec({ type: 'save-editor', pageId: 'P', expectedContent: pageContentKey(p), document: JSON.stringify(doc) })
  ws = await repo.load()
  await exec({ type: 'save-material', pageId: 'P', sectionId: ws.pages.find(x => x.id === 'P')!.sections[0]!.id, url: 'https://example.com/a', title: 'A', body: '', note: '' })
  await exec({ type: 'delete-page', pageId: 'C', at }, 'op-c')
  await exec({ type: 'delete-page', pageId: 'P', at }, 'op-p')
  const script = (...args: string[]) => spawnSync(process.execPath, ['scripts/sqlite-rollback-trash.ts', path, ...args], { encoding: 'utf8' })
  return { dir, path, repo, day, exec, script, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
const sql = (path: string, fn: (db: DatabaseSync) => void) => { const db = new DatabaseSync(path); try { fn(db) } finally { db.close() } }
/** Today's build's Retry on a card to P: a live page with the held id, as `create-document` makes it. */
function recreate(path: string, id: string, parentId: string, text: string) {
  sql(path, db => {
    const blocks = [{ id: `${id}-retry-line`, kind: 'paragraph', text }]
    db.prepare(`INSERT INTO pages (snapshot, position, present, id, type, date, title, sections, reviewText, reviewSaved, handoffDone, draft, parentId)
      VALUES ('current', 99, ?, ?, 'document', NULL, '', ?, '', 0, 0, NULL, ?)`)
      .run(JSON.stringify(['id', 'type', 'date', 'title', 'parentId', 'sections', 'reviewText', 'reviewSaved', 'handoffDone', 'draft']), id, JSON.stringify([{ id: `intro:${id}`, kind: 'custom', title: '', blocks }]), parentId)
  })
}

test('script + migration 4, no clash: held pages come back in the trash with their batches; Undo cleared; running again does nothing', async () => {
  const s = await store()
  try {
    const before = await s.repo.load()
    const r = s.script()
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Layout 4 → 3\. 2 pages held from the trash, 2 sources recorded; Undo cleared\./)
    sql(s.path, db => {
      assert.equal(Number(db.prepare('PRAGMA user_version').get()!.user_version), 3)
      assert.equal(db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'trashedAt' || c.name === 'trashId'), false)
      assert.equal(Number(db.prepare("SELECT count(*) n FROM pages WHERE snapshot='undo'").get()!.n), 0)
    })
    assert.notEqual(s.script().status, 0, 'a second run refuses: layout 3')
    const ws = await s.repo.load()
    assert.equal(ws.undo, undefined)
    const { undo: _undo, ...rest } = before
    assert.deepEqual({ ...ws, receipts: {} }, { ...rest, receipts: {} }, 'same pages, tasks and materials')
    assert.equal(JSON.stringify(await s.repo.load()), JSON.stringify(ws))
  } finally { await s.cleanup() }
})

test('clash, untouched recreation: it is dropped and the held page keeps its id', async () => {
  const s = await store()
  try {
    assert.equal(s.script().status, 0)
    recreate(s.path, 'P', s.day, '')
    const ws = await s.repo.load()
    assert.deepEqual(ws.pages.filter(p => p.id === 'P').map(p => [p.title, p.trashId]), [['Parent', 'op-p']])
    assert.equal(ws.pages.find(p => p.id === 'C')!.parentId, 'P')
    assert.equal(ws.tasks.find(t => t.id === 'editor-task:p-task')!.sourcePageId, 'P')
  } finally { await s.cleanup() }
})

test('clash, written in: both kept; held rows of any batch and recorded sources move; live ones stay', async () => {
  const s = await store()
  try {
    assert.equal(s.script().status, 0)
    recreate(s.path, 'P', s.day, 'written during the rollback')
    // Written during the rollback: a task and a second source on the same material, both on the live page.
    sql(s.path, db => {
      db.prepare(`INSERT INTO tasks (snapshot, position, present, id, title, status, version, plannedOn, attentionOn, deadlineOn, paused, createdOn, lastPlannedOn, sourcePageId)
        VALUES ('current', 99, ?, 'new-task', 'new', 'open', 1, NULL, NULL, NULL, 0, '2026-10-20', NULL, 'P')`).run(JSON.stringify(['id', 'title', 'status', 'version', 'plannedOn', 'attentionOn', 'deadlineOn', 'paused', 'createdOn', 'lastPlannedOn', 'sourcePageId']))
      const m = db.prepare("SELECT id, sources FROM materials WHERE snapshot='current'").get()!
      db.prepare("UPDATE materials SET sources=? WHERE snapshot='current' AND id=?").run(JSON.stringify([...JSON.parse(String(m.sources)), { pageId: 'P', blockId: 'P-retry-line', note: '' }]), m.id as string)
    })
    const ws = await s.repo.load()
    const live = ws.pages.find(p => p.id === 'P')!, held = ws.pages.find(p => p.title === 'Parent')!
    assert.equal(live.trashedAt ?? null, null)
    assert.notEqual(held.id, 'P')
    assert.equal(held.trashId, 'op-p')
    assert.equal(ws.pages.find(p => p.id === 'C')!.parentId, held.id, 'the child from the earlier batch follows')
    assert.equal(ws.tasks.find(t => t.id === 'editor-task:p-task')!.sourcePageId, held.id)
    assert.equal(ws.tasks.find(t => t.id === 'new-task')!.sourcePageId, 'P')
    assert.deepEqual(ws.materials[0]!.sources.map(x => x.pageId), [held.id, 'P'])
    assert.ok(JSON.stringify(held.editorJSON).includes('card-c'), 'held content kept')
  } finally { await s.cleanup() }
})

test('a backup that cannot be written stops the script with nothing changed', async () => {
  const s = await store()
  try {
    const snapshot = () => { let out = ''; sql(s.path, db => { out = JSON.stringify([db.prepare('PRAGMA user_version').get(), db.prepare('SELECT * FROM pages ORDER BY snapshot, id').all()]) }); return out }
    const before = snapshot()
    const r = s.script('--backup', join(s.dir, 'missing', 'b.sqlite'))
    assert.notEqual(r.status, 0)
    assert.equal(snapshot(), before)
  } finally { await s.cleanup() }
})

test('a new Undo after the re-upgrade works and keeps trashed pages', async () => {
  const s = await store()
  try {
    assert.equal(s.script().status, 0)
    await s.repo.load()
    await s.exec({ type: 'create-document', title: 'New', body: '', pageId: 'N' }, 'after')
    const ws: Workspace = await s.exec({ type: 'undo', targetOperationId: 'after' })
    assert.equal(ws.pages.some(p => p.id === 'N'), false)
    assert.deepEqual(ws.pages.filter(p => p.trashId).map(p => p.id).sort(), ['C', 'P'])
  } finally { await s.cleanup() }
})
