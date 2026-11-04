// A disposable store for Bookmarks (B83): link pages under two days and one page, one with a quote, one still at its default title.
// Usage: node tests/evidence/bookmarks/seed.ts <store-path> [empty]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/bookmarks/seed.ts <store-path> [empty] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'create-document', title: 'Reading', body: '', pageId: 'reading' })
if (process.argv[3] !== 'empty') {
  for (const date of ['2026-10-20', '2026-10-25']) await run({ type: 'ensure-day', date })
  const link = (pageId: string, parentPageId: string, url: string, title?: string) => run({ type: 'make-link-pages', parentPageId, items: [{ url, pageId, ...(title ? { title } : {}) }] })
  await link('kept', 'day:2026-10-20', 'https://www.example.com/old', 'An older article')
  await link('dan', 'day:2026-10-25', 'https://x.com/thedankoe/status/1', 'DAN KOE (@thedankoe) on X')
  await link('bare', 'reading', 'https://example.org/plain')
  const dan = ws.pages.find(p => p.id === 'dan')!
  await run({ type: 'save-editor', pageId: 'dan', expectedContent: pageContentKey(dan), document: JSON.stringify([{ id: 'q1', type: 'quote', props: {}, content: [{ type: 'text', text: 'How to fix your entire life in 1 day', styles: {} }], children: [] }]), today: new Date().toISOString().slice(0, 10) })
}
console.log('seeded', process.argv[2])
