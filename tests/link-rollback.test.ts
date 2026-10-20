import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'
import { verifySqliteLayout } from '../src/server/sqlite-mapping.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { pasteRecords } from '../src/domain/workspace.ts'
import type { Action } from '../src/domain/types.ts'

// A2 plan §5: rollback 5 → 4 keeps each link page's identity in held_links_l5 (Ratchet c2cc3896); migration 5 brings it back.
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'daythread-links-')), path = join(dir, 'w.sqlite')
  let repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
  const exec = async (action: Action, operationId: string = crypto.randomUUID()) => { const ws = await repo.load(); return (await repo.execute({ operationId, expectedRevision: ws.revision, action })).workspace }
  let ws = await exec({ type: 'ensure-day', date: '2026-10-20' })
  const day = ws.pages[0]!.id
  const paste = async (url: string, n: string, kind = 'notes') => {
    ws = await repo.load()
    const sectionId = ws.pages.find(p => p.id === day)!.sections.find(s => s.kind === kind)!.id
    ws = await exec({ type: 'paste-links', pageId: day, sectionId, today: '2026-10-20', items: [{ url, pageId: `page-${n}`, cardBlockId: `card-${n}`, lineType: 'bulletListItem' }] }, `op-${n}`)
    const target = pasteRecords(ws.pages.find(p => p.id === day)!, `op-${n}`)[0]!.pageId
    const p = ws.pages.find(x => x.id === day)!
    ws = await exec({ type: 'save-editor', pageId: day, expectedContent: pageContentKey(p), document: JSON.stringify([...editorSeed(p, ws), { id: `card-${n}`, type: 'pageLink', props: { pageId: target } }]) })
    return target
  }
  const script = () => spawnSync(process.execPath, ['scripts/sqlite-rollback-link-pages.ts', path], { encoding: 'utf8' })
  const reopen = async () => { repo = new SqliteWorkspaceRepository(path); return repo.load() }
  return { dir, path, day, exec, paste, script, reopen, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
const sql = <T>(path: string, fn: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(path); try { return fn(db) } finally { db.close() } }
const firstLine = (path: string, id: string) => sql(path, db => {
  const row = db.prepare("SELECT sections FROM pages WHERE snapshot='current' AND id=?").get(id)!
  return (JSON.parse(String(row.sections)) as { blocks: { id: string; text: string }[] }[])[0]!.blocks[0]
})

test('rollback 5 → 4: layout 4 exactly, each URL written as its page\'s first line; migration 5 restores identity and takes the line out', async () => {
  const s = await store()
  try {
    const notes = await s.paste('https://Notes.example/a', 'n')
    const gs = await s.paste('https://gs.example/b', 'g', 'good-stuffs')
    await s.exec({ type: 'review-material', materialId: (await s.reopen()).materials[0]!.id, decision: 'watching', date: '2026-10-20', nextReviewOn: '2026-10-27' })
    const trashed = await s.paste('https://trash.example/', 't')
    await s.exec({ type: 'delete-page', pageId: trashed, at: '2026-10-20T12:00:00.000Z' }, 'del-t')
    const r = s.script()
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /Layout 5 → 4\. 3 link pages held/)
    sql(s.path, db => {
      assert.equal(Number(db.prepare('PRAGMA user_version').get()!.user_version), 4)
      verifySqliteLayout(db, 4)
      assert.equal(db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'url'), false)
      for (const row of db.prepare('SELECT present FROM pages').all()) assert.equal(String(row.present).includes('"url"'), false)
      assert.equal(Number(db.prepare('SELECT count(*) AS n FROM held_links_l5').get()!.n), 3)
      assert.equal(db.prepare("SELECT undoOperationId FROM meta WHERE snapshot='current'").get()!.undoOperationId, null)
      assert.ok(db.prepare("SELECT 1 FROM materials WHERE snapshot='current' AND url='https://gs.example/b'").get(), 'the saved item keeps its url')
    })
    assert.deepEqual(firstLine(s.path, notes), { id: `link-url:${notes}`, kind: 'paragraph', text: 'https://Notes.example/a' })
    // The old build edits one URL line: that one stays after the re-upgrade.
    sql(s.path, db => {
      const row = db.prepare("SELECT sections FROM pages WHERE snapshot='current' AND id=?").get(gs)!
      const sections = JSON.parse(String(row.sections)); sections[0].blocks[0].text = 'https://gs.example/b — read this first'
      db.prepare("UPDATE pages SET sections=?, editorSections=NULL WHERE snapshot='current' AND id=?").run(JSON.stringify(sections), gs)
    })
    const ws = await s.reopen()
    assert.equal(ws.pages.find(p => p.id === notes)!.url, 'https://Notes.example/a')
    assert.equal(ws.pages.find(p => p.id === gs)!.url, 'https://gs.example/b')
    assert.equal(ws.pages.find(p => p.id === trashed)!.url, 'https://trash.example/')
    assert.ok(ws.pages.find(p => p.id === trashed)!.trashedAt, 'still in the trash')
    assert.equal(firstLine(s.path, notes)?.id === `link-url:${notes}`, false, 'the untouched URL line is gone')
    assert.equal(firstLine(s.path, gs)!.text, 'https://gs.example/b — read this first', 'the edited one stays')
    sql(s.path, db => assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='held_links_l5'").get(), undefined))
    // Pasting each URL again finds the same page, no second one.
    for (const [url, id] of [['https://notes.example/a', notes], ['https://GS.example/b', gs], ['https://trash.example', trashed]] as const) {
      const again = await s.paste(url, `again-${id}`)
      assert.equal(again, id)
    }
    const after = await s.reopen()
    assert.equal(after.pages.filter(p => p.url).length, 3)
  } finally { await s.cleanup() }
})

test('re-upgrade: a page deleted for good or a key taken meanwhile is reported, never overwritten', async () => {
  const s = await store()
  try {
    const a = await s.paste('https://a.example/', 'a')
    const b = await s.paste('https://b.example/', 'b')
    assert.equal(s.script().status, 0)
    sql(s.path, db => {
      db.prepare("DELETE FROM pages WHERE id=?").run(a)
      // Not something the old build can do; checked anyway: a second held row for another page with b's key.
      db.prepare("INSERT INTO held_links_l5 (pageId, url, lineBlockId, lineText) VALUES (?, 'https://B.example', 'none', 'none')").run(s.day)
    })
    const logs: string[] = [], info = console.info
    console.info = (m: string) => { logs.push(m) }
    try { await s.reopen() } finally { console.info = info }
    const log = JSON.parse(logs.find(l => l.includes('storage.links-reupgrade'))!)
    assert.deepEqual(log.gone, [a])
    assert.deepEqual(log.keyTaken, [s.day])
    assert.equal(log.restored, 1)
    const ws = await s.reopen()
    assert.equal(ws.pages.find(p => p.id === b)!.url, 'https://b.example/')
    assert.equal(ws.pages.find(p => p.id === s.day)!.url, undefined)
  } finally { await s.cleanup() }
})

test('the rollback refuses a store that isn\'t layout 5, and changes nothing when the backup can\'t be written', async () => {
  const s = await store()
  try {
    await s.paste('https://x.example/', 'x')
    const snapshot = () => sql(s.path, db => JSON.stringify([db.prepare('PRAGMA user_version').get(), db.prepare('SELECT * FROM pages ORDER BY snapshot, id').all()]))
    const before = snapshot()
    const bad = spawnSync(process.execPath, ['scripts/sqlite-rollback-link-pages.ts', s.path, '--backup', join(s.dir, 'missing', 'b.sqlite')], { encoding: 'utf8' })
    assert.notEqual(bad.status, 0)
    assert.equal(snapshot(), before)
    assert.equal(s.script().status, 0)
    const again = s.script()
    assert.notEqual(again.status, 0)
    assert.match(again.stderr, /Expected layout 5, found 4/)
  } finally { await s.cleanup() }
})

test('a URL line inside the editor document comes out too, and the page reads as before', async () => {
  const s = await store()
  try {
    const id = await s.paste('https://doc.example/', 'd')
    let ws = await s.reopen()
    const p = ws.pages.find(x => x.id === id)!
    ws = await s.exec({ type: 'save-editor', pageId: id, expectedContent: pageContentKey(p), document: JSON.stringify([...editorSeed(p, ws), { id: 'mine', type: 'paragraph', content: 'my note' }]) })
    const before = ws.pages.find(x => x.id === id)!
    assert.equal(s.script().status, 0)
    const held = sql(s.path, db => JSON.parse(String(db.prepare("SELECT editorJSON FROM pages WHERE snapshot='current' AND id=?").get(id)!.editorJSON)) as EditorNode[])
    assert.equal(inlineText(held[0]!.content), 'https://doc.example/')
    ws = await s.reopen()
    const after = ws.pages.find(x => x.id === id)!
    assert.deepEqual(after.sections, before.sections)
    assert.equal(after.editorJSON, before.editorJSON)
    assert.equal(after.editorSections, before.editorSections)
  } finally { await s.cleanup() }
})
