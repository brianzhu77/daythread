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
// measured. Today's page gets one written line if it has none. /pages?page=fixture-smart-page holds a smart note
// block in each stored state. Run it once per copy: a second run refuses.
import { resolve } from 'node:path'
import { getRepository } from '../src/server/storage.ts'
import { flatNodes, headingNode, pageContentKey, pageNodes, textRun, type EditorNode } from '../src/domain/editor-document.ts'
import { collectInput } from '../src/domain/smart-note.ts'
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

// Icons, for the gate's P1-3 checks: a page with an emoji and one with an icon of ours, each with a card and a [[ link below, a day, and a row's page.
const iconPageId = 'fixture-icon-page', ownIconPageId = 'fixture-own-icon-page', iconTrashId = 'fixture-icon-trash', iconDay = '2026-12-30'
for (const [pageId, title, icon] of [[iconPageId, 'Fixture icon page', '🌲'], [ownIconPageId, 'Fixture own icon page', 'icon:activity'], [iconTrashId, 'Fixture icon in Trash', '🌲']] as const) {
  ws = await run({ type: 'create-document', title, body: 'A first line', pageId, parentId: scratchId })
  ws = await run({ type: 'set-page-icon', pageId, icon })
}
// The sidebar lists Pages only since bb12a273, so pages under the scratch day aren't in it: one at the top level is.
ws = await run({ type: 'create-document', title: 'Fixture icon in the sidebar', body: '', pageId: 'fixture-icon-sidebar' })
ws = await run({ type: 'set-page-icon', pageId: 'fixture-icon-sidebar', icon: '🌲' })
ws = await run({ type: 'ensure-day', date: iconDay })
ws = await run({ type: 'set-page-icon', pageId: dayPage(ws, iconDay).id, icon: '🌲' })

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
const treeId = crypto.randomUUID(), treeBlock = crypto.randomUUID()
const timelineId = crypto.randomUUID(), timelineBlock = crypto.randomUUID()
const layered = (['table', 'list', 'gallery', 'board'] as const).map(layout => ({ layout, id: crypto.randomUUID(), block: crypto.randomUUID() }))
const boardId = crypto.randomUUID(), boardBlock = crypto.randomUUID(), groupedId = crypto.randomUUID(), groupedBlock = crypto.randomUUID(), listId = crypto.randomUUID(), listBlock = crypto.randomUUID(), galleryId = crypto.randomUUID(), galleryBlock = crypto.randomUUID(), calendarId = crypto.randomUUID(), calendarBlock = crypto.randomUUID()
const document: EditorNode[] = [
  headingNode('TODO'),
  todo('Fixture open to-do', 'plan'),
  // B93: to-dos that wrap to 2 and 3 lines at 390 (and 2 at 1280), so a box, tag or ⋯ is measured against a first line that isn't the whole row.
  todo('Fixture wrapped to-do: 提交加拿大临时居民签证续签申请材料并预约生物信息采集', 'plan'),
  todo('Fixture wrapped to-do in three lines at a phone width, long enough to wrap once more on a laptop, as some of his long notes do', 'plan'),
  todo('Fixture done to-do', 'plan'),
  todo('Fixture cancelled to-do', 'plan'),
  // B39: a nested to-do's checkbox starts at its parent's text; two levels deep.
  todo('Fixture parent to-do', 'plan', [todo('Fixture child to-do', 'plan', [todo('Fixture grandchild to-do', 'plan')]), bullet('Fixture note under a to-do')]),
  // A synced block (B21-18): its lines keep the columns they have outside, at each level, and the label clears what's around it.
  { id: crypto.randomUUID(), type: 'syncedBlock', props: { syncId: crypto.randomUUID(), rev: 0, key: '', roles: '' }, children: [bullet('Fixture synced line', [bullet('Fixture synced nested', [bullet('Fixture synced level 3')])]), todo('Fixture synced to-do', 'reference', [todo('Fixture synced child to-do', 'reference')])] },
  bullet('Fixture line below a synced block'),
  headingNode('Events'),
  bullet(''),
  headingNode('Good Stuffs'),
  card(linkId),
  card(iconPageId),
  card(ownIconPageId),
  headingNode('Notes'),
  bullet('Fixture parent', [bullet('Fixture nested child', [bullet('Fixture level 3')]), bullet('')], lineTarget),
  bullet('Fixture list with a to-do', [todo('Fixture to-do under a bullet', 'reference')]),
  card(previewId),
  card(emptyId),
  card(longId),
  { id: databaseBlock, type: 'database', props: { pageId: databaseId, view: '' }, children: [] },
  { id: boardBlock, type: 'database', props: { pageId: boardId, view: '' }, children: [] },
  ...layered.map(l => ({ id: l.block, type: 'database', props: { pageId: l.id, view: '' }, children: [] })),
  { id: treeBlock, type: 'database', props: { pageId: treeId, view: '' }, children: [] },
  { id: timelineBlock, type: 'database', props: { pageId: timelineId, view: '' }, children: [] },
  { id: groupedBlock, type: 'database', props: { pageId: groupedId, view: '' }, children: [] },
  { id: listBlock, type: 'database', props: { pageId: listId, view: '' }, children: [] },
  { id: galleryBlock, type: 'database', props: { pageId: galleryId, view: '' }, children: [] },
  { id: calendarBlock, type: 'database', props: { pageId: calendarId, view: '' }, children: [] },
  { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [textRun('See '), { type: 'pageRef', props: { pageId: scratchId, refId: crypto.randomUUID(), newTitle: '', lineId: lineTarget, taskId: '' } }, textRun(' for the list')], children: [] },
  { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [textRun('See '), { type: 'pageRef', props: { pageId: iconPageId, refId: crypto.randomUUID(), newTitle: '', lineId: '', taskId: '' } }, textRun(' for the icon')], children: [] },
  { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [textRun('See '), { type: 'pageRef', props: { pageId: previewId, refId: crypto.randomUUID(), newTitle: '', lineId: '', taskId: '' } }, textRun(' with no icon')], children: [] },
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
// One wrapped column, on a value that fits a line: a wrapped table's rows and columns must still sit where they did.
{
  const first = ws.pages.find(p => p.id === databaseId)!.database!.views[0]!
  ws = await run({ type: 'change-database', pageId: databaseId, change: { kind: 'updateView', viewId: first.id, columns: first.columns.map(c => (c.id === 'text' ? { ...c, wrap: true as const } : c)) } })
}
// Sub-items (R4-4): the gate measures the toggle's column and one step of indent.
{
  ws = await run({ type: 'create-database', pageId: treeId, parentId: scratchId, homeBlockId: treeBlock, title: 'Fixture sub-items' })
  await run({ type: 'change-database', pageId: treeId, change: { kind: 'setSubItems', on: { parent: 'par', sub: 'sub' } } as never })
  const top = crypto.randomUUID()
  ws = await run({ type: 'add-row', databaseId: treeId, pageId: top, title: 'Fixture parent row', values: {}, at: new Date().toISOString() })
  const kid = crypto.randomUUID()
  ws = await run({ type: 'add-row', databaseId: treeId, pageId: kid, title: 'Fixture sub-item', values: {}, at: new Date().toISOString() })
  ws = await run({ type: 'set-values', pageId: kid, values: { par: [top] }, expected: {}, at: new Date().toISOString() })
}
// A timeline (R4-1): the gate measures a bar's title and the scale.
{
  ws = await run({ type: 'create-database', pageId: timelineId, parentId: scratchId, homeBlockId: timelineBlock, title: 'Fixture timeline' })
  const change = async (c: unknown) => { ws = await run({ type: 'change-database', pageId: timelineId, change: c as never }) }
  await change({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
  const view = ws.pages.find(p => p.id === timelineId)!.database!.views[0]!
  await change({ kind: 'updateView', viewId: view.id, layout: 'timeline', dateBy: 'when' })
  ws = await run({ type: 'add-row', databaseId: timelineId, pageId: crypto.randomUUID(), title: 'Fixture bar', values: { when: { start: today } }, at: new Date().toISOString() })
}
// A peek (R4-11, R4-16): a row with every kind of line, over a page with no editor of its own, so the gate measures only the peek's.
{
  ws = await run({ type: 'create-database', pageId: 'fixture-peek-db', parentId: null, homeBlockId: null, title: 'Fixture peek' } as never)
  ws = await run({ type: 'add-row', databaseId: 'fixture-peek-db', pageId: 'fixture-peek-row', title: 'Fixture peek row', values: {}, at: new Date().toISOString() })
  const row = ws.pages.find(p => p.id === 'fixture-peek-row')!
  ws = await run({ type: 'save-editor', pageId: row.id, expectedContent: pageContentKey(row), document: JSON.stringify([headingNode('Fixture peek heading'), bullet('Fixture peek line', [bullet('Fixture peek nested')]), bullet('Fixture peek last')]) })
}
// Two layers on each layout that has them (R3-13): the gate measures a sub-group's chevron and a board's lanes.
for (const { layout, id, block } of layered) {
  ws = await run({ type: 'create-database', pageId: id, parentId: scratchId, homeBlockId: block, title: `Fixture two layers, ${layout}` })
  const change = async (c: unknown) => { ws = await run({ type: 'change-database', pageId: id, change: c as never }) }
  await change({ kind: 'addProperty', property: { id: 'state', name: 'State', type: 'status', options: [{ id: 'next', name: 'Next', group: 'todo' }, { id: 'now', name: 'Now', group: 'active' }] } })
  await change({ kind: 'addProperty', property: { id: 'shelf', name: 'Shelf', type: 'select', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } })
  const view = ws.pages.find(p => p.id === id)!.database!.views[0]!
  await change({ kind: 'updateView', viewId: view.id, layout, groupBy: 'state', subGroupBy: 'shelf', hideEmptyGroups: layout !== 'board' })
  for (const [state, shelf] of [['next', 'a'], ['now', 'b']]) ws = await run({ type: 'add-row', databaseId: id, pageId: crypto.randomUUID(), title: `Fixture ${state} ${shelf}`, values: { state, shelf }, at: new Date().toISOString() })
}
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

// A row's icon before its name, in every layout, and a row's page with its head.
for (const id of [groupedId, boardId, listId, galleryId, calendarId, timelineId]) {
  const row = ws.pages.find(p => p.parentId === id && !p.trashedAt && !p.database)
  if (!row) { console.error(`Fixture ${id} has no row for its icon.`); process.exit(1) }
  ws = await run({ type: 'set-page-icon', pageId: row.id, icon: '🌲' })
}
ws = await run({ type: 'add-row', databaseId: listId, pageId: 'fixture-icon-row', title: 'Fixture icon row', values: { state: 'next' }, at: new Date().toISOString() })
ws = await run({ type: 'set-page-icon', pageId: 'fixture-icon-row', icon: '🌲' })
ws = await run({ type: 'delete-page', pageId: iconTrashId, at: new Date().toISOString() })
// A database's own icon on its title, a page under one for the breadcrumb, one linked from it for Linked from, and a relation's chip.
ws = await run({ type: 'set-page-icon', pageId: listId, icon: '🌲' })
ws = await run({ type: 'create-document', title: 'Fixture page under an icon', body: '', pageId: 'fixture-icon-child', parentId: iconPageId })
{
  const page = ws.pages.find(p => p.id === iconPageId)!
  ws = await run({ type: 'save-editor', pageId: iconPageId, expectedContent: pageContentKey(page), document: JSON.stringify([bullet('A first line'), { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [textRun('See '), { type: 'pageRef', props: { pageId: ownIconPageId, refId: crypto.randomUUID(), newTitle: '', lineId: '', taskId: '' } }], children: [] }]), today })
  const target = ws.pages.find(p => p.parentId === groupedId && p.icon)!
  ws = await run({ type: 'change-database', pageId: listId, change: { kind: 'addProperty', property: { id: 'rel', name: 'Linked', type: 'relation', target: groupedId } } as never })
  ws = await run({ type: 'set-values', pageId: 'fixture-icon-row', values: { rel: [target.id] }, expected: { rel: null } } as never)
  // A Timeline with its table open: the fixture day's is closed.
  ws = await run({ type: 'create-database', pageId: 'fixture-icon-timeline', parentId: null, homeBlockId: null, title: 'Fixture icon Timeline' } as never)
  ws = await run({ type: 'change-database', pageId: 'fixture-icon-timeline', change: { kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } } as never })
  ws = await run({ type: 'add-row', databaseId: 'fixture-icon-timeline', pageId: 'fixture-icon-bar', title: 'Fixture icon bar', values: { when: { start: today } }, at: new Date().toISOString() })
  ws = await run({ type: 'set-page-icon', pageId: 'fixture-icon-bar', icon: '🌲' })
  const timeline = ws.pages.find(p => p.id === 'fixture-icon-timeline')!.database!.views[0]!
  ws = await run({ type: 'change-database', pageId: 'fixture-icon-timeline', change: { kind: 'updateView', viewId: timeline.id, layout: 'timeline', dateBy: 'when', timelineTable: true } as never })
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

// Smart notes (smart-note.md §4): /pages?page=fixture-smart-page holds a block in each state a stored note can show:
// plain (heading, paragraph, bullets, sources, a Read line with older pages left out), Notes changed, its range deleted,
// and a block whose note is gone. Failed needs a failed ask, which can't be stored: the smoke covers it. Last, so no
// later fixture changes the lines the plain note's key was made from.
{
  const sourceId = 'fixture-smart-source', hostId = 'fixture-smart-page', [s1, s2, s3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  ws = await run({ type: 'create-document', title: 'Fixture smart note source', body: '', pageId: sourceId })
  ws = await run({ type: 'save-editor', pageId: sourceId, expectedContent: pageContentKey(ws.pages.find(p => p.id === sourceId)!), document: JSON.stringify([bullet('No guest checkout in v1', [], s1), bullet('Address form is one step now', [], s2), bullet('Tax rounding has no owner yet', [], s3)]), today })
  const range = { where: { kind: 'pages' as const, pageIds: [sourceId] }, days: 0 as const }
  const at = new Date(Date.now() - 2 * 3600_000).toISOString()
  const result = (inputKey: string) => ({
    blocks: [
      { kind: 'heading' as const, text: 'Decisions', sources: [] },
      { kind: 'bullet' as const, text: 'Guest checkout is out of the first release', sources: [{ pageId: sourceId, blockId: s1 }] },
      { kind: 'bullet' as const, text: 'The address form moves to one step', sources: [{ pageId: sourceId, blockId: s2 }, { pageId: sourceId, blockId: s1 }] },
      { kind: 'heading' as const, text: 'Open questions', sources: [] },
      { kind: 'paragraph' as const, text: 'Nobody owns the tax rounding change yet, so it waits for the next planning day.', sources: [{ pageId: sourceId, blockId: s3 }] },
    ],
    at, inputKey, pagesRead: 14, pagesLeftOut: 6, from: '2026-10-20', to: '2026-11-12',
  })
  const notes = [
    { id: 'fixture-smart-plain', name: 'Checkout redesign: where things stand', range, inputKey: collectInput(ws, range, today).key },
    { id: 'fixture-smart-changed', name: 'Checkout, changed since', range, inputKey: 'fixture-stale-key' },
    { id: 'fixture-smart-gone', name: 'Checkout, range deleted', range: { where: { kind: 'pages' as const, pageIds: ['fixture-smart-no-such-page'] }, days: 0 as const }, inputKey: 'fixture-stale-key' },
  ]
  for (const n of notes) ws = await run({ type: 'save-smart-note', note: { id: n.id, name: n.name, prompt: 'Where does checkout stand?', range: n.range, refresh: 'manual', result: result(n.inputKey) } })
  const block = (noteId: string): EditorNode => ({ id: crypto.randomUUID(), type: 'smartNote', props: { noteId }, children: [] })
  const paragraph = (t: string): EditorNode => ({ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: words(t), children: [] })
  ws = await run({ type: 'create-document', title: 'Fixture smart notes', body: '', pageId: hostId })
  // A bullet above, so the page has a row column; an empty line right below the first note, where IME input is checked.
  ws = await run({ type: 'save-editor', pageId: hostId, expectedContent: pageContentKey(ws.pages.find(p => p.id === hostId)!), document: JSON.stringify([bullet('Fixture line above the smart notes'), block('fixture-smart-plain'), paragraph(''), block('fixture-smart-changed'), block('fixture-smart-gone'), block('fixture-smart-no-such-note'), bullet('Fixture line below the smart notes')]), today })
  const plain = ws.smartNotes?.find(n => n.id === 'fixture-smart-plain')
  if (!plain || collectInput(ws, plain.range, today).key !== plain.result.inputKey) { console.error('Fixture smart note would show Notes changed.'); process.exit(1) }
}

for (const [id, what] of [[previewId, 'page with words'], [emptyId, 'empty page'], [longId, 'long-title page'], [linkId, 'link page'], [databaseId, 'database'], [boardId, 'board'], [groupedId, 'grouped table'], [listId, 'list'], [galleryId, 'gallery'], [calendarId, 'calendar']] as const)
  if (!ws.pages.some(p => p.id === id && !p.trashedAt)) { console.error(`Fixture ${what} wasn't created.`); process.exit(1) }
const statuses = ['Fixture done to-do', 'Fixture cancelled to-do'].map(t => task(t).status).join(', ')
console.log(`Fixtures on /day/${SCRATCH} (revision ${ws.revision}): ${statuses}; ${flatNodes(pageNodes(dayPage(ws, SCRATCH))).length} rows. Today ${today}.`)
