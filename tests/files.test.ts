// Files (R3-11): the value, the file store, and the sweep, which is the one thing that can lose a file for good and so errs towards keeping.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cellValue, fileLimits, holdsFiles, readValue, storedValue, valueText, type Database, type DatabaseChange, type FileValue, type Property } from '../src/domain/database.ts'
import { commandSchema } from '../src/domain/command-schema.ts'
import { exportFiles } from '../src/domain/export.ts'
import { accountIsFull, fileKey, fileStore, idsHeldIn, ownerPrefix, sweepFiles } from '../src/server/file-store.ts'
import { asOwner } from '../src/server/auth/request-owner.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-04T10:00:00.000Z'
const file = (id: string, name = `${id}.jpg`): FileValue => ({ id, name, size: 1000, type: 'image/jpeg' })
const a = 'fileAAAA01', b = 'fileBBBB02'
const prop: Property = { id: 'f', name: 'Files', type: 'files' }
test('a value reads and stores what it should, and refuses what it shouldn\'t', () => {
  assert.equal(readValue(prop, undefined), null)
  assert.deepEqual(readValue(prop, [file(a), { id: '../x', name: 'bad', size: 1, type: '' }]), [file(a)], 'a bad entry isn\'t read')
  assert.deepEqual(storedValue(prop, [file(a), file(a), file(b)]), [file(a), file(b)], 'one of each')
  assert.equal(storedValue(prop, []), undefined)
  assert.throws(() => storedValue(prop, [{ ...file(a), id: 'x/y/zzzzzzz' }]))
  assert.throws(() => storedValue(prop, [{ ...file(a), size: fileLimits.size + 1 }]))
  assert.throws(() => storedValue(prop, Array.from({ length: fileLimits.perCell + 1 }, (_, n) => file(`file${String(n).padStart(6, '0')}`))))
  assert.deepEqual(storedValue(prop, [{ ...file(a), extra: 'dropped' }]), [file(a)], 'only the fields it knows')
})
function shelf() {
  const h = harness()
  h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'Shelf' })
  const change = (c: DatabaseChange) => h.run({ type: 'change-database', pageId: 'db', change: c })
  change({ kind: 'addProperty', property: { id: 'f', name: 'Files', type: 'files' } })
  h.run({ type: 'add-row', databaseId: 'db', pageId: 'row', title: 'Row', at })
  const set = (pageId: string, value: unknown, property = 'f') => h.run({ type: 'set-values', pageId, values: { [property]: value }, expected: {}, at } as never)
  set('row', [file(a)])
  const db = () => h.ws.pages.find(p => p.id === 'db')!.database as Database
  const row = (id = 'row') => h.ws.pages.find(p => p.id === id)!
  const held = () => idsHeldIn(JSON.stringify(h.ws))
  return { h, change, set, db, row, held }
}
test('it stays in the row through Trash and Undo, names itself in text, and the workspace knows it holds a file', () => {
  const s = shelf()
  assert.deepEqual(cellValue(s.db(), s.row(), 'f'), [file(a)])
  assert.equal(valueText(s.db(), 'f', [file(a), file(b)]), `${a}.jpg, ${b}.jpg`)
  assert.equal(holdsFiles(s.h.ws), true)
  const trashed = s.h.run({ type: 'delete-page', pageId: 'row', at })
  assert.deepEqual(s.row().values?.f, [file(a)], 'in Trash it keeps its value')
  assert.equal(holdsFiles(s.h.ws), true, 'Trash counts')
  s.h.run({ type: 'undo', targetOperationId: trashed.receipt.operationId })
  assert.equal(s.row().trashedAt, undefined)
  assert.deepEqual(cellValue(s.db(), s.row(), 'f'), [file(a)])
  s.h.run({ type: 'delete-page', pageId: 'row', at })
  s.h.run({ type: 'add-row', databaseId: 'db', pageId: 'later', title: 'Later', at })
  s.h.run({ type: 'restore-page', pageId: 'row' })
  assert.deepEqual(cellValue(s.db(), s.row(), 'f'), [file(a)], 'Restore has it back, long after Undo')
})
test('the export names files and says they aren\'t in it, only when there are some', () => {
  const s = shelf()
  const readme = (ws = s.h.ws) => exportFiles(ws, new Date(at))[0]!.text
  assert.match(readme(), /Files are not in this export/)
  assert.match(readme(), new RegExp(`Row: ${a}\\.jpg \\(0\\.0 MB\\)`))
  s.set('row', null)
  assert.doesNotMatch(readme(), /Files are not in this export/)
})
test('what holds a file for the sweep: a value, a type change and back, a row template, a duplicate, and a moved row inside Undo', () => {
  const s = shelf()
  assert.ok(s.held().has(a))
  s.change({ kind: 'updateProperty', propertyId: 'f', type: 'text' })
  assert.ok(s.held().has(a), 'a property changed to another type keeps its old value')
  s.change({ kind: 'updateProperty', propertyId: 'f', type: 'files' })
  assert.deepEqual(cellValue(s.db(), s.row(), 'f'), [file(a)], 'and reads it again')
  s.h.run({ type: 'create-template', pageId: 'tpl', title: 'Tpl', databaseId: 'db' } as never)
  s.set('tpl', [file(b)])
  assert.ok(s.held().has(b), 'a row template holds its file')
  s.h.run({ type: 'add-row', databaseId: 'db', pageId: 'copy', title: 'Copy', copyOf: 'row', at })
  assert.deepEqual(cellValue(s.db(), s.row('copy'), 'f'), [file(a)], 'a duplicate shares the file')
  s.set('row', null)
  s.h.run({ type: 'add-row', databaseId: 'db', pageId: 'later', title: 'Later', at }) // Moves the Undo slot on.
  assert.ok(s.held().has(a), 'its duplicate still holds it')
  s.set('copy', null)
  assert.ok(s.held().has(a), 'inside Undo, removing the last one still holds it')
  s.h.run({ type: 'add-row', databaseId: 'db', pageId: 'later2', title: 'Later', at })
  assert.equal(s.held().has(a), false, 'past Undo, nothing does')
})
function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'daythread-files-')); process.env.DAYTHREAD_FILES_PATH = dir
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const stream = (text: string) => new Blob([text]).stream()
test('the store keeps each account\'s files under its own key, and another account\'s id finds nothing; the sweep keeps what\'s held or recent', async () => {
  const f = folder()
  try {
    const store = await fileStore()
    await store.put(fileKey(a, 'alice'), stream('hello'), 5, 'text/plain')
    assert.equal((await store.get(fileKey(a, 'bob'))), null, 'another account')
    const got = await store.get(fileKey(a, 'alice'))
    assert.equal(got?.type, 'text/plain')
    assert.equal(got?.size, 5)
    assert.equal(await new Response(got!.body).text(), 'hello')
    await assert.rejects(store.put(fileKey('fileWrong1', 'alice'), stream('hello'), 99, 'text/plain'), /different size/)
    assert.equal(await store.get(fileKey('fileWrong1', 'alice')), null, 'a short upload leaves nothing')
    await store.put(fileKey(b, 'alice'), stream('bye'), 3, 'text/plain')
    await store.put(fileKey('fileKeep03', 'bob'), stream('bob'), 3, 'text/plain')
    const now = Date.now(), old = new Date(now - 8 * 24 * 60 * 60_000)
    assert.equal(await sweepFiles(store, new Set(), now, 'alice'), 0, 'nothing under 7 days old goes')
    utimesSync(join(f.dir, 'alice', a), old, old); utimesSync(join(f.dir, 'alice', b), old, old); utimesSync(join(f.dir, 'bob', 'fileKeep03'), old, old)
    assert.equal(await sweepFiles(store, idsHeldIn(`{"id":"${b}"}`), now, 'alice'), 1, 'old and held by nothing')
    assert.equal(await store.get(fileKey(a, 'alice')), null)
    assert.ok(await store.get(fileKey(b, 'alice')), 'held stays')
    assert.ok(await store.get(fileKey('fileKeep03', 'bob')), 'another account\'s isn\'t touched')
    assert.equal(ownerPrefix('alice'), 'alice/')
    assert.equal(await accountIsFull(store, 10, 'alice'), false)
    assert.equal(await accountIsFull(store, fileLimits.account, 'alice'), true)
  } finally { f.done() }
})
test('without a named account the key is the signed-in one, so the id in a request can\'t reach another account', () => {
  assert.equal(asOwner('alice', () => fileKey(a)), `alice/${a}`)
  assert.equal(asOwner('bob', () => fileKey(a)), `bob/${a}`)
  assert.equal(fileKey(a), `local/${a}`, 'sign-in off: the Mac\'s own')
})
test('the schema takes a card image and its clearing', () => {
  const change = (cardImage: string | null) => commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'db', change: { kind: 'updateView', viewId: 'v', cardImage } } })
  assert.ok(change('f').success)
  assert.ok(change(null).success)
})
test('a row moved to another database keeps its file, and Undo of the move holds it too', () => {
  const s = shelf()
  s.h.run({ type: 'create-database', pageId: 'other', homeBlockId: null, title: 'Other' })
  s.h.run({ type: 'change-database', pageId: 'other', change: { kind: 'addProperty', property: { id: 'g', name: 'Files', type: 'files' } } })
  const moved = s.h.run({ type: 'move-row', pageId: 'row', databaseId: 'other', at })
  assert.deepEqual(s.row().values?.g, [file(a)])
  assert.ok(s.held().has(a))
  s.h.run({ type: 'undo', targetOperationId: moved.receipt.operationId })
  assert.deepEqual(s.row().values?.f, [file(a)])
})

