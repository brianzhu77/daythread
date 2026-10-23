import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { sqliteMigrations, verifySqliteLayout } from '../src/server/sqlite-mapping.ts'
import type { Action } from '../src/domain/types.ts'

// A11 §6 (Ratchet #143 finding 1): `Task.doneOn` is stored by the SQLite repository (layout 7), survives a reload, and
// the 7 → 6 rollback drops only that column.
const today = '2026-10-16', tomorrow = '2026-10-17'

async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-a11-')), path = join(dir, 'w.sqlite')
  let repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
  let sequence = 0
  const exec = async (action: Action) => {
    const ws = await repo.load()
    return (await repo.execute({ operationId: `a11-store-${++sequence}`, expectedRevision: ws.revision, action })).workspace
  }
  /** A fresh repository on the same file: what the next server process reads. */
  const reopen = () => { repo = new SqliteWorkspaceRepository(path); return repo.load() }
  return { dir, path, exec, reopen, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('sqlite: done, reopen, cancel and Undo keep doneOn across reloads', async () => {
  const s = await store()
  try {
    let ws = await s.exec({ type: 'ensure-day', date: today })
    const page = ws.pages[0]!
    ws = await s.exec({ type: 'add-task', pageId: page.id, sectionId: page.sections.find(x => x.kind === 'other')!.id, title: 'Stored', plannedOn: today })
    const id = ws.tasks[0]!.id
    const doneOn = async () => (await s.reopen()).tasks.find(t => t.id === id)!.doneOn ?? null
    await s.exec({ type: 'task-status', taskId: id, status: 'done', today })
    assert.equal(await doneOn(), today, 'done')
    await s.exec({ type: 'task-status', taskId: id, status: 'open', today })
    assert.equal(await doneOn(), null, 'reopened')
    await s.exec({ type: 'task-status', taskId: id, status: 'done', today: tomorrow })
    assert.equal(await doneOn(), tomorrow, 'done again, another day')
    const cancelled = await s.exec({ type: 'task-status', taskId: id, status: 'cancelled' })
    assert.equal(await doneOn(), null, 'cancelled')
    await s.exec({ type: 'undo', targetOperationId: cancelled.undo!.operationId })
    const back = (await s.reopen()).tasks.find(t => t.id === id)!
    assert.deepEqual([back.status, back.doneOn], ['done', tomorrow], 'Undo of the cancel brings back the done day')
  } finally { await s.cleanup() }
})

test('sqlite: rollback 7 → 6 drops only doneOn; migration 7 adds it back empty', async () => {
  const s = await store()
  try {
    let ws = await s.exec({ type: 'ensure-day', date: today })
    const page = ws.pages[0]!
    ws = await s.exec({ type: 'add-task', pageId: page.id, sectionId: page.sections.find(x => x.kind === 'other')!.id, title: 'Rolled', plannedOn: today })
    const id = ws.tasks[0]!.id
    await s.exec({ type: 'task-status', taskId: id, status: 'done', today })
    const before = await s.reopen()
    const out = spawnSync(process.execPath, ['scripts/sqlite-rollback-done-on.ts', s.path], { encoding: 'utf8' })
    assert.equal(out.status, 0, out.stderr)
    assert.match(out.stdout, /Layout 7 → 6\. 1 done day dropped/)
    const db = new DatabaseSync(s.path)
    try {
      assert.equal(Number(db.prepare('PRAGMA user_version').get()!.user_version), 6)
      verifySqliteLayout(db, 6)
      assert.ok(!db.prepare('PRAGMA table_info(tasks)').all().some(c => c.name === 'doneOn'))
      assert.ok(db.prepare('SELECT present FROM tasks').all().every(r => !String(r.present).includes('doneOn')))
    } finally { db.close() }
    // Opening with this build runs migration 7: the column is back, empty; everything else is as it was.
    const after = await s.reopen()
    assert.equal(sqliteMigrations.length, 7)
    const { doneOn: _dropped, ...rest } = before.tasks[0]!
    assert.deepEqual(after.tasks[0], rest)
    assert.deepEqual(after.pages, before.pages)
    const again = spawnSync(process.execPath, ['scripts/sqlite-rollback-done-on.ts', s.path], { encoding: 'utf8' })
    assert.equal(again.status, 0, again.stderr)
    const twice = spawnSync(process.execPath, ['scripts/sqlite-rollback-done-on.ts', s.path], { encoding: 'utf8' })
    assert.notEqual(twice.status, 0)
    assert.match(twice.stderr, /Expected layout 7, found 6/)
  } finally { await s.cleanup() }
})
