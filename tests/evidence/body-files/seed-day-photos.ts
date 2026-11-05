// A disposable store for what photos cost a day (B87 14): today with 40 lines and N copies of a photo, as R1-18's day. The first is above the lines, the rest spread down them.
// Usage: node tests/evidence/body-files/seed-day-photos.ts <store-path> <files-folder> <photo.jpg> <count>
import { copyFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { bodyFileSized, bodyFileUrl } from '../../../src/domain/body-files.ts'
import type { Action } from '../../../src/domain/types.ts'
const [store, folder, photo, count] = process.argv.slice(2)
if (!store || !folder || !photo || !count) { console.error('Usage: node tests/evidence/body-files/seed-day-photos.ts <store-path> <files-folder> <photo.jpg> <count> (throwaway store and folder, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(store, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const date = new Intl.DateTimeFormat('en-CA').format(new Date())
await run({ type: 'ensure-day', date })
const day = () => ws.pages.find(p => p.date === date && p.type === 'daily')!
const size = statSync(photo).size, photos = Number(count)
mkdirSync(join(folder, 'local'), { recursive: true })
const lines: unknown[] = Array.from({ length: 40 }, (_, i) => ({ id: `line-${i}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `Line ${i} of the day`, styles: {} }], children: [] }))
for (let i = 0; i < photos; i++) {
  const id = `photo-${String(i).padStart(4, '0')}`
  copyFileSync(photo, join(folder, 'local', id))
  writeFileSync(join(folder, 'local', `${id}.type`), 'image/jpeg')
  lines.splice(i * 12, 0, { id: `img-${i}`, type: 'image', props: { url: bodyFileSized(bodyFileUrl(id, 'photo.jpg', size, 'image/jpeg'), 4032, 3024), name: 'photo.jpg' }, children: [] })
}
await run({ type: 'save-editor', pageId: day().id, expectedContent: pageContentKey(day()), document: JSON.stringify([...JSON.parse(day().document), ...lines]) })
console.log('seeded', store, photos)
