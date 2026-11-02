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
  { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [textRun('See '), { type: 'pageRef', props: { pageId: scratchId, refId: crypto.randomUUID(), newTitle: '', lineId: lineTarget, taskId: '' } }, textRun(' for the list')], children: [] },
]
ws = await run({ type: 'save-editor', pageId: scratchId, expectedContent: pageContentKey(dayPage(ws, SCRATCH)), document: JSON.stringify(document), today })

ws = await run({ type: 'create-database', pageId: databaseId, parentId: scratchId, homeBlockId: databaseBlock, title: 'Fixture reading list' })
ws = await run({ type: 'change-database', pageId: databaseId, change: { kind: 'addProperty', property: { id: 'status', name: 'Status', type: 'status' } } })
ws = await run({ type: 'add-row', databaseId, pageId: crypto.randomUUID(), title: 'Fixture row', values: {}, at: new Date().toISOString() })

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

for (const [id, what] of [[previewId, 'page with words'], [emptyId, 'empty page'], [longId, 'long-title page'], [linkId, 'link page'], [databaseId, 'database']] as const)
  if (!ws.pages.some(p => p.id === id && !p.trashedAt)) { console.error(`Fixture ${what} wasn't created.`); process.exit(1) }
const statuses = ['Fixture done to-do', 'Fixture cancelled to-do'].map(t => task(t).status).join(', ')
console.log(`Fixtures on /day/${SCRATCH} (revision ${ws.revision}): ${statuses}; ${flatNodes(pageNodes(dayPage(ws, SCRATCH))).length} rows. Today ${today}.`)
