// Files in a page's body (B87): what an address says, what holds a file for the sweep, a Gallery's first image, the export, and what never reaches the model or search.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyFileOf, bodyFileUrl, bodyFilesIn, showsAsImage } from '../src/domain/body-files.ts'
import { holdsFiles } from '../src/domain/database.ts'
import { firstImageUrl } from '../src/domain/editor-document.ts'
import { exportFiles } from '../src/domain/export.ts'
import { buildSearchIndex, search } from '../src/domain/search.ts'
import { filesToSweep } from '../src/server/file-store.ts'
import { dayId, harness, today } from './v2-helpers.ts'

const id = 'fileBody0001', url = bodyFileUrl(id, 'My shot, 1.png', 1500)
const image = (blockId = 'img') => ({ id: blockId, type: 'image', props: { url, name: 'My shot, 1.png', caption: 'A caption' }, children: [] })
test('an address says its file, and a link to the web isn\'t ours', () => {
  assert.deepEqual(bodyFileOf(url), { id, name: 'My shot, 1.png', size: 1500 })
  assert.deepEqual(bodyFileOf(`/api/files/${id}`), { id, name: '', size: null })
  for (const other of ['https://example.com/a.png', '/api/files/short', '/api/files/../x', 'blob:http://x/y', '', null, 5]) assert.equal(bodyFileOf(other), null, String(other))
  assert.equal(showsAsImage('image/png'), true)
  assert.equal(showsAsImage('image/svg+xml'), false, 'it could run on our origin')
  assert.equal(showsAsImage('application/pdf'), false)
})
function notes() {
  const h = harness()
  h.day(today)
  h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
  return h
}
test('a page\'s file counts: bodyFilesIn, a Gallery\'s first image, the workspace holding files', () => {
  const h = notes()
  assert.equal(holdsFiles(h.ws), false)
  h.save('notes', () => [image() as never])
  assert.deepEqual(bodyFilesIn(h.page('notes')).map(f => f.id), [id])
  assert.equal(firstImageUrl(h.page('notes')), url)
  assert.equal(holdsFiles(h.ws), true)
})
test('the export names it, says it isn\'t included, and leaves no link pointing nowhere', () => {
  const h = notes()
  h.save('notes', () => [image() as never])
  const files = exportFiles(h.ws, new Date('2026-11-05T10:00:00Z'))
  assert.match(files[0]!.text, /Files are not in this export/)
  assert.match(files[0]!.text, /Notes: My shot, 1\.png \(0\.0 MB\)/)
  const page = files.find(f => f.path.endsWith('Notes.md'))!.text
  assert.match(page, /A caption \(file, not in this export\)/)
  assert.doesNotMatch(page, /\/api\/files\//)
})
test('search finds no file contents and no address', () => {
  const h = notes()
  h.save('notes', () => [image() as never])
  const found = (q: string) => JSON.stringify(search(buildSearchIndex(h.ws), q))
  assert.equal(found(id).includes('notes'), false, 'by its address')
  assert.equal(found('shot').includes('notes'), false, 'by name, which isn\'t indexed yet')
})
test('the sweep holds a file in a day, a template, a page in Trash, and a copy on another page; past those, nothing does (B87 8)', async () => {
  const store = { list: async () => [{ key: `local/${id}`, size: 1, storedAt: 0 }] } as never
  const held = async (h: ReturnType<typeof harness>) => (await filesToSweep(store, JSON.stringify(h.ws), Date.now())).length === 0
  const h = notes()
  assert.equal(await held(h), false, 'nothing holds it yet')
  h.save(dayId(today), d => [...d, image('d1') as never])
  assert.equal(await held(h), true, 'a day')
  h.save(dayId(today), d => d.filter(n => n.id !== 'd1'))
  h.save('notes', () => [image('n1') as never])
  h.run({ type: 'delete-page', pageId: 'notes', at: '2026-11-05T10:00:00.000Z' })
  h.run({ type: 'create-document', title: 'Later', body: '', pageId: 'later' })
  assert.equal(await held(h), true, 'a page in Trash')
})
