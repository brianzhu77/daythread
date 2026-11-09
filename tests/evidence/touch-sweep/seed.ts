// A day for a touch sweep at 390: to-dos, a line with a date chip, a page reference and a link, a nested line, and a page to point at.
// Usage: node --no-warnings tests/evidence/touch-sweep/seed.ts <store-path> <today>  (a throwaway SQLite file, never his data)
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path, today] = process.argv.slice(2)
if (!path || !today) { console.error('Usage: node --no-warnings tests/evidence/touch-sweep/seed.ts <store-path> <today>'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const t = (s: string) => ({ type: 'text', text: s, styles: {} })
await run({ type: 'create-document', title: 'Notes page', body: '', pageId: 'notes' })
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.id === `day:${today}`)!
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), today, document: JSON.stringify([
  { id: 'h1', type: 'heading', props: { level: 2 }, content: [t('Plan')], children: [] },
  { id: 'td1', type: 'task', props: { taskId: 'editor-task:td1', role: 'plan', planDate: today }, content: [t('Call the bank')], children: [] },
  { id: 'td2', type: 'task', props: { taskId: 'editor-task:td2', role: 'plan', planDate: today }, content: [t('Water the plants')], children: [] },
  { id: 'chips', type: 'paragraph', props: {}, content: [t('Dentist '), { type: 'dateMention', props: { eventId: 'ev1', date: today, time: '15:00' } }, t(' see '), { type: 'pageRef', props: { pageId: 'notes', refId: 'ref1' } }, t(' and '), { type: 'link', href: 'https://example.com/', content: [t('the site')] }], children: [] },
  // Lines that are only a link, as Bookmarks pages are: one wrapping to two rows with room after it, one filling its last row.
  { id: 'url1', type: 'paragraph', props: {}, content: [{ type: 'link', href: 'https://example.com/articles/2026/11/a-long-pasted-address', content: [t('https://example.com/articles/2026/11/a-long-pasted-address')] }], children: [] },
  { id: 'url2', type: 'paragraph', props: {}, content: [{ type: 'link', href: 'https://example.com/x', content: [t('https://example.com/articles/2026/11/a-much-longer-pasted-address-that-fills-its-row-to-the-edge-xyzabcdefgh')] }], children: [] },
  { id: 'p1', type: 'paragraph', props: {}, content: [t('A plain line of words to select')], children: [{ id: 'p1a', type: 'paragraph', props: {}, content: [t('A nested line')], children: [] }] },
  ...Array.from({ length: 16 }, (_, i) => ({ id: `z${i}`, type: 'paragraph', props: {}, content: [t(`Filler line ${i}`)], children: [] })),
  { id: 'last', type: 'paragraph', props: {}, content: [t('Last line')], children: [] },
]) })
console.log('seeded', today)
