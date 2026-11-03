// Adds every row type scripts/check-alignment.mjs measures to a scratch day page on a COPY of a SQLite store, so the
// check has full coverage on test data (Jazz c2c65193: 20 row types were missing after #12). Refuses Postgres and the
// dev service's own store.
//
//   cp tests/fixtures/v1/workspace.sqlite /tmp/align/w.sqlite       # any v1 or v2 store; it is converted on open
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=/tmp/align/w.sqlite TZ=America/Vancouver node scripts/align-fixtures.ts
//   ...start a build on the copy, then:
//   node scripts/check-alignment.mjs <base url> /day/<today> /day/2026-12-31
//
// Everything goes through the commands the app sends (ensure-day, create-document, make-link-pages, save-editor,
// task-status), so a done task is really done. On /day/2026-12-31, under the template headings: open, done and
// cancelled to-dos; a to-do with a nested one and a level-3 one under it; a bullet with a nested bullet, a level-3
// one and an empty nested line; a to-do under a bullet; page cards with and without a preview (one with a long
// title), a link card, and a line linking to another line (A11), with plain text before it so its baseline is
// measured. Today's page gets one written line if it has none. Run it once per copy: a second run refuses.
import { resolve } from 'node:path'
import { getRepository } from '../src/server/storage.ts'
import { flatNodes, headingNode, pageContentKey, pageNodes, textRun, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

const SCRATCH = '2026-12-31'
const path = process.env.DAYTHREAD_SQLITE_PATH
if (process.env.DAYTHREAD_STORAGE !== 'sqlite' || !path) {
  console.error('Run on a SQLite copy: DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<copy>. Never Postgres.')
  process.exit(2)
}
if (resolve(path).split('/').includes('.daythread-local')) {
  console.error(`Refusing ${resolve(path)}: that's the dev service's store. Run this on a copy.`)
  process.exit(2)
}

const repository = getRepository()
const run = async (action: Action): Promise<Workspace> => {
  const { revision } = await repository.load()
  return (await repository.execute({ operationId: `align-fixture:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const dayPage = (ws: Workspace, date: string) => ws.pages.find(p => p.type === 'daily' && p.date === date && !p.trashedAt)!
const written = (ws: Workspace, date: string) => flatNodes(pageNodes(dayPage(ws, date))).some(n => n.type !== 'heading' && JSON.stringify(n.content ?? []).includes('"text":"') && !JSON.stringify(n.content).includes('"text":""'))

let ws = await run({ type: 'ensure-day', date: SCRATCH })
if (written(ws, SCRATCH)) { console.error(`${SCRATCH} already has rows; use a fresh copy.`); process.exit(1) }
const scratchId = dayPage(ws, SCRATCH).id

// Card targets, made before their cards as /page and a paste do.
const previewId = crypto.randomUUID(), emptyId = crypto.randomUUID(), longId = crypto.randomUUID(), linkId = crypto.randomUUID()
ws = await run({ type: 'create-document', title: 'Fixture page with words', body: 'A first line, so the card shows a preview', pageId: previewId, parentId: scratchId })
ws = await run({ type: 'create-document', title: 'Fixture empty page', body: '', pageId: emptyId, parentId: scratchId })
// A long title, so a card's wrapping is measured too (Ratchet ba2ad8a5: long titles were clipped at 390).
ws = await run({ type: 'create-document', title: 'Fixture page with a very long title that has to wrap onto a second line on a phone 长标题需要换行', body: '', pageId: longId, parentId: scratchId })
ws = await run({ type: 'make-link-pages', parentPageId: scratchId, items: [{ url: 'https://example.com/fixture-link', pageId: linkId }] })

const words = (t: string) => (t ? [textRun(t)] : [])
const bullet = (t: string, children: EditorNode[] = [], id = crypto.randomUUID()): EditorNode => ({ id, type: 'bulletListItem', props: {}, content: words(t), children })
const todo = (t: string, role: 'plan' | 'reference', children: EditorNode[] = []): EditorNode => {
  const id = crypto.randomUUID()
  return { id, type: 'task', props: { taskId: `editor-task:${id}`, role, planDate: role === 'plan' ? SCRATCH : '' }, content: words(t), children }
}
const card = (pageId: string): EditorNode => ({ id: crypto.randomUUID(), type: 'pageLink', props: { pageId }, children: [] })
const lineTarget = crypto.randomUUID()
// Databases R1 (design §15): an inline table, so its title, `+ New` and view chevron are measured too.
const databaseId = crypto.randomUUID(), databaseBlock = crypto.randomUUID()
// R2: a board and a grouped table, each with a column or group past the row cap and a hidden one.
const boardId = crypto.randomUUID(), boardBlock = crypto.randomUUID(), groupedId = crypto.randomUUID(), groupedBlock = crypto.randomUUID(), listId = crypto.randomUUID(), listBlock = crypto.randomUUID(), galleryId = crypto.randomUUID(), galleryBlock = crypto.randomUUID(), calendarId = crypto.randomUUID(), calendarBlock = crypto.randomUUID()
const document: EditorNode[] = [
  headingNode('TODO'),
  todo('Fixture open to-do', 'plan'),
  todo('Fixture done to-do', 'plan'),
  todo('Fixture cancelled to-do', 'plan'),
  // B39: a nested to-do's checkbox starts at its parent's text; two levels deep.
  todo('Fixture parent to-do', 'plan', [todo('Fixture child to-do', 'plan', [todo('Fixture grandchild to-do', 'plan')]), bullet('Fixture note under a to-do')]),
  headingNode('Events'),
  bullet(''),
  headingNode('Good Stuffs'),
  card(linkId),
  headingNode('Notes'),
  bullet('Fixture parent', [bullet('Fixture nested child', [bullet('Fixture level 3')]), bullet('')], lineTarget),
  bullet('Fixture list with a to-do', [todo('Fixture to-do under a bullet', 'reference')]),
  card(previewId),
  card(emptyId),
  card(longId),
  { id: databaseBlock, type: 'database', props: { pageId: databaseId, view: '' }, children: [] },
  { id: boardBlock, type: 'database', props: { pageId: boardId, view: '' }, children: [] },
  { id: groupedBlock, type: 'database', props: { pageId: groupedId, view: '' }, children: [] },
  { id: listBlock, type: 'database', props: { pageId: listId, view: '' }, children: [] },
  { id: galleryBlock, type: 'database', props: { pageId: galleryId, view: '' }, children: [] },
  { id: calendarBlock, type: 'database', props: { pageId: calendarId, view: '' }, children: [] },
  { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [textRun('See '), { type: 'pageRef', props: { pageId: scratchId, refId: crypto.randomUUID(), newTitle: '', lineId: lineTarget, taskId: '' } }, textRun(' for the list')], children: [] },
]
ws = await run({ type: 'save-editor', pageId: scratchId, expectedContent: pageContentKey(dayPage(ws, SCRATCH)), document: JSON.stringify(document), today })

ws = await run({ type: 'create-database', pageId: databaseId, parentId: scratchId, homeBlockId: databaseBlock, title: 'Fixture reading list' })
ws = await run({ type: 'change-database', pageId: databaseId, change: { kind: 'addProperty', property: { id: 'status', name: 'Status', type: 'status' } } })
// One property of each type, with a value, so the gate measures what every cell draws (a table's and a row page's).
for (const property of [
  { id: 'text', name: 'Notes', type: 'text' },
  { id: 'number', name: 'Pages', type: 'number' },
  { id: 'select', name: 'Genre', type: 'select', options: [{ id: 'novel', name: 'Novel' }] },
  { id: 'multi', name: 'Tags', type: 'multiSelect', options: [{ id: 'sf', name: 'SF' }] },
  { id: 'date', name: 'Due', type: 'date' },
  { id: 'done', name: 'Owned', type: 'checkbox' },
  { id: 'url', name: 'Link', type: 'url' },
  { id: 'email', name: 'Email', type: 'email' },
  { id: 'phone', name: 'Phone', type: 'phone' },
  { id: 'made', name: 'Made', type: 'createdTime' },
  { id: 'seen', name: 'Changed', type: 'editedTime' },
  { id: 'number-id', name: 'No.', type: 'id' },
  { id: 'related', name: 'Related', type: 'relation', target: databaseId },
  { id: 'rolled', name: 'Rolled', type: 'rollup', rollup: { relation: 'related', property: 'number', fn: 'sum' } },
] as const) ws = await run({ type: 'change-database', pageId: databaseId, change: { kind: 'addProperty', property: property as never } })
ws = await run({ type: 'add-row', databaseId, pageId: crypto.randomUUID(), title: 'Fixture row', values: { text: 'A note', number: 412, select: 'novel', multi: ['sf'], date: { start: SCRATCH }, done: true, url: 'https://example.com/fixture', email: 'fixture@example.com', phone: '+1 415 555 0100' }, at: new Date().toISOString() })
const untickedRow = crypto.randomUUID()
ws = await run({ type: 'add-row', databaseId, pageId: untickedRow, title: 'Fixture row, unticked', values: {}, at: new Date().toISOString() })
// A link to the row above, so both a relation's title and a rollup's number are drawn.
ws = await run({ type: 'set-values', pageId: untickedRow, values: { related: [ws.pages.find(p => p.parentId === databaseId && p.title === 'Fixture row')!.id] }, expected: {}, at: new Date().toISOString() })
// Every kind of foot cell the gate measures: a count on Name, a number, a checkbox.
ws = await run({ type: 'change-database', pageId: databaseId, change: { kind: 'updateView', viewId: ws.pages.find(p => p.id === databaseId)!.database!.views[0]!.id, calculations: { title: 'countAll', number: 'sum', done: 'percentChecked' } } })
for (const [id, block, title, layout] of [[boardId, boardBlock, 'Fixture board', 'board'], [groupedId, groupedBlock, 'Fixture grouped table', 'table'], [listId, listBlock, 'Fixture list', 'list'], [galleryId, galleryBlock, 'Fixture gallery', 'gallery'], [calendarId, calendarBlock, 'Fixture calendar', 'calendar']] as const) {
  ws = await run({ type: 'create-database', pageId: id, parentId: scratchId, homeBlockId: block, title })
  const change = async (c: unknown) => { ws = await run({ type: 'change-database', pageId: id, change: c as never }) }
  await change({ kind: 'addProperty', property: { id: 'state', name: 'State', type: 'status', options: [{ id: 'next', name: 'Next', group: 'todo' }, { id: 'now', name: 'Now', group: 'active' }, { id: 'old', name: 'Old', group: 'done' }] } })
  await change({ kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
  await change({ kind: 'addProperty', property: { id: 'done', name: 'Done', type: 'checkbox' } })
  await change({ kind: 'addProperty', property: { id: 'on', name: 'On', type: 'date' } })
  const view = ws.pages.find(p => p.id === id)!.database!.views[0]!
  await change({ kind: 'updateView', viewId: view.id, layout, ...(layout === 'calendar' ? {} : { groupBy: 'state', hiddenGroups: ['old'] }), name: { board: 'Board', table: 'Table', list: 'List', gallery: 'Gallery', calendar: 'Calendar' }[layout], ...(layout === 'calendar' ? { dateBy: 'on', columns: [] } : layout === 'table' ? {} : { columns: [{ id: 'note' }, { id: 'done' }] }) })
  for (let i = 0; i < 26; i++) ws = await run({ type: 'add-row', databaseId: id, pageId: crypto.randomUUID(), title: `Fixture row ${i + 1}`, values: { state: 'next', note: 'A note', on: { start: SCRATCH } }, at: new Date().toISOString() })
  ws = await run({ type: 'add-row', databaseId: id, pageId: crypto.randomUUID(), title: 'Fixture hidden row', values: { state: 'old' }, at: new Date().toISOString() })
}

const task = (title: string) => {
  const found = ws.tasks.find(t => t.title === title)
  if (!found) { console.error(`Fixture task "${title}" wasn't created.`); process.exit(1) }
  return found
}
ws = await run({ type: 'task-status', taskId: task('Fixture done to-do').id, status: 'done', today })
ws = await run({ type: 'task-status', taskId: task('Fixture cancelled to-do').id, status: 'cancelled', today })

// Today's page gets one written line if it has none, so the picker's dot on today is measured (Jazz 27200c3).
ws = await run({ type: 'ensure-day', date: today })
if (!written(ws, today)) {
  const page = dayPage(ws, today), nodes = [...pageNodes(page)]
  const notes = nodes.findIndex(n => n.type === 'heading' && JSON.stringify(n.content).includes('"Notes"'))
  nodes.splice(notes < 0 ? nodes.length : notes + 1, 0, bullet('Fixture line today'))
  ws = await run({ type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(nodes), today })
}

for (const [id, what] of [[previewId, 'page with words'], [emptyId, 'empty page'], [longId, 'long-title page'], [linkId, 'link page'], [databaseId, 'database'], [boardId, 'board'], [groupedId, 'grouped table'], [listId, 'list'], [galleryId, 'gallery'], [calendarId, 'calendar']] as const)
  if (!ws.pages.some(p => p.id === id && !p.trashedAt)) { console.error(`Fixture ${what} wasn't created.`); process.exit(1) }
const statuses = ['Fixture done to-do', 'Fixture cancelled to-do'].map(t => task(t).status).join(', ')
console.log(`Fixtures on /day/${SCRATCH} (revision ${ws.revision}): ${statuses}; ${flatNodes(pageNodes(dayPage(ws, SCRATCH))).length} rows. Today ${today}.`)
