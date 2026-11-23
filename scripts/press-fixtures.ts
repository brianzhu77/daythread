// Gives today's page a ready day draft on a COPY of a SQLite store, so scripts/check-press.mjs can press the draft's
// own buttons (✓, ✕, Apply all, Dismiss). Run it after scripts/align-fixtures.ts on the same copy. Refuses Postgres
// and the dev service's own store.
//
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=/tmp/press/w.sqlite TZ=America/Vancouver node scripts/press-fixtures.ts
//
// The draft goes in through the command the app sends (set-draft), built by the same code that reads a model answer:
// up to two open to-dos and two new lines, so each kind of suggestion row is on the page.
import { resolve } from 'node:path'
import { getRepository } from '../src/server/storage.ts'
import { buildDayDraftRequest, itemsFromModel } from '../src/server/model/day-draft.ts'
import { DRAFT_RECIPE } from '../src/domain/day-draft.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

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
  return (await repository.execute({ operationId: `press-fixture:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const ws = await run({ type: 'ensure-day', date: today })
const page = ws.pages.find(p => p.type === 'daily' && p.date === today && !p.trashedAt)!
const request = buildDayDraftRequest(ws, page, ws.timezone)
const anchor = [...request.blocks.keys()][0]
if (!anchor) { console.error(`${today} has no line to place suggestions after; run scripts/align-fixtures.ts first.`); process.exit(1) }
const suggestion = (fields: object) => ({ anchor, place: 'after', kind: 'new_line', taskId: '', lineId: '', text: '', why: '', ...fields })
const suggestions = [
  ...[...request.tasks.keys()].slice(0, 2).map(taskId => suggestion({ kind: 'existing_todo', taskId })),
  suggestion({ text: 'Fixture suggestion one' }),
  suggestion({ text: 'Fixture suggestion two' }),
]
const items = itemsFromModel(request, suggestions as Parameters<typeof itemsFromModel>[1], () => crypto.randomUUID())
if (items.length < 2) { console.error(`Only ${items.length} suggestions were kept; the check needs at least 2.`); process.exit(1) }
await run({ type: 'set-draft', pageId: page.id, status: 'ready', moreOpen: [], allowedTaskIds: items.flatMap(i => (i.taskId ? [i.taskId] : [])), items, recipe: DRAFT_RECIPE })
console.log(`press fixtures: ${today} has a ready draft with ${items.length} suggestions`)
