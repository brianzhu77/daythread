// Adds the row types Brian's data doesn't have to a scratch day page on a COPY of the database, so
// scripts/check-alignment.mjs can measure every row type (Lead a2428bb1). Refuses the live database.
//
//   cp .daythread-local/workspace.sqlite /tmp/align/w.sqlite      # a copy; stop any server using it first
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=/tmp/align/w.sqlite node scripts/align-fixtures.ts
//   ...start the build on the copy, then:
//   node scripts/check-alignment.mjs <base url> /day/2026-10-18 /day/2026-10-19 /day/<today> /day/2026-12-31
//
// Everything goes through the same commands the app sends (add-task, task-status, create-document, paste-links,
// save-editor), so a cancelled task is really cancelled. On /day/2026-12-31 it adds: an open task and a cancelled one,
// a bullet with a nested bullet and an empty nested line, two page cards without preview (one with a long title),
// and a link card.
// Run it once per copy: a second run refuses, since the scratch page already has its rows.
import { resolve } from 'node:path'
import { getRepository } from '../src/server/storage.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

const SCRATCH = '2026-12-31'
const path = process.env.DAYTHREAD_SQLITE_PATH
if (!path) { console.error('Set DAYTHREAD_SQLITE_PATH to a copy of the database.'); process.exit(2) }
const live = [resolve('.daythread-local/workspace.sqlite')]
if (live.includes(resolve(path)) || resolve(path).split('/').includes('.daythread-local')) {
  console.error(`Refusing ${resolve(path)}: that's the live database (or its folder). Run this on a copy.`)
  process.exit(2)
}

const repository = getRepository()
const run = async (action: Action) => {
  const { revision } = await repository.load()
  return (await repository.execute({ operationId: `align-fixture:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const scratch = (ws: Workspace) => ws.pages.find(p => p.type === 'daily' && p.date === SCRATCH)!

let ws = await run({ type: 'ensure-day', date: SCRATCH })
if (scratch(ws).sections.some(s => s.blocks.length)) { console.error(`${SCRATCH} already has rows; use a fresh copy.`); process.exit(1) }
const section = (kind: string) => scratch(ws).sections.find(s => s.kind === kind)!.id

// Tasks: one open, one cancelled through task-status, as the row menu and the Tasks screen do.
ws = await run({ type: 'add-task', pageId: scratch(ws).id, sectionId: section('top3'), title: 'Fixture open task', plannedOn: SCRATCH })
ws = await run({ type: 'add-task', pageId: scratch(ws).id, sectionId: section('top3'), title: 'Fixture cancelled task', plannedOn: SCRATCH })
const cancelled = ws.tasks.at(-1)!
ws = await run({ type: 'task-status', taskId: cancelled.id, status: 'cancelled' })

// Cards: pages with nothing in them (no preview), created before their cards as /page does; the link comes after.
const emptyPageId = crypto.randomUUID(), linkPageId = crypto.randomUUID(), emptyCardId = crypto.randomUUID(), linkCardId = crypto.randomUUID()
ws = await run({ type: 'create-document', title: 'Fixture empty page', body: '', pageId: emptyPageId, parentId: scratch(ws).id })
// A long title, so a card's wrapping is measured too (Ratchet ba2ad8a5: long titles were clipped at 390).
const longPageId = crypto.randomUUID(), longCardId = crypto.randomUUID()
ws = await run({ type: 'create-document', title: 'Fixture page with a very long title that has to wrap onto a second line on a phone 长标题需要换行', body: '', pageId: longPageId, parentId: scratch(ws).id })

// The editor document: what the page shows now, plus the cards and a nested list under Notes.
const page = scratch(ws)
const nodes = editorSeed(page, ws, { templateRows: needsTemplateRows(page, today) }) as EditorNode[]
const text = (t: string) => (t ? [{ type: 'text', text: t, styles: {} }] : [])
const bullet = (t: string, children: EditorNode[] = []) => ({ id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: text(t), children }) as unknown as EditorNode
const added = [
  { id: emptyCardId, type: 'pageLink', props: { pageId: emptyPageId, url: '', line: '' }, children: [] },
  { id: longCardId, type: 'pageLink', props: { pageId: longPageId, url: '', line: '' }, children: [] },
  { id: linkCardId, type: 'pageLink', props: { pageId: linkPageId, url: 'https://example.com/fixture-link', line: 'paragraph' }, children: [] },
  bullet('Fixture parent', [bullet('Fixture nested child'), bullet('')]),
] as unknown as EditorNode[]
const notes = nodes.findIndex(n => n.id === page.sections.find(s => s.kind === 'notes')!.id)
nodes.splice(notes + 1, 0, ...added)
ws = await run({ type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(nodes), today })
// The link page comes after its card is saved, as in the editor: A2 skips a paste whose card isn't on the page
// (Ratchet 786198ab), which would leave a Retry card instead of a link card.
ws = await run({ type: 'paste-links', pageId: scratch(ws).id, today, items: [{ url: 'https://example.com/fixture-link', pageId: linkPageId, cardBlockId: linkCardId, lineType: 'paragraph' }] })
for (const [id, what] of [[emptyPageId, 'empty page'], [longPageId, 'long-title page'], [linkPageId, 'link page']] as const)
  if (!ws.pages.some(p => p.id === id && !p.trashedAt)) { console.error(`Fixture ${what} wasn't created.`); process.exit(1) }
if (!ws.pages.find(p => p.id === linkPageId)!.url) { console.error('Fixture link page has no URL.'); process.exit(1) }

const done = scratch(ws)
console.log(`Fixtures on /day/${SCRATCH} (revision ${ws.revision}): ${ws.tasks.find(t => t.id === cancelled.id)!.status} task, ${done.sections.flatMap(s => s.blocks).length} rows.`)
