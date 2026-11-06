// A disposable store for Forms (forms.md): Runs with a number, a select, a multi-select, a date, a checkbox and a text, and a form on it.
// Usage: node --no-warnings tests/evidence/forms/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { Action } from '../../../src/domain/types.ts'
const [path] = process.argv.slice(2)
if (!path) { console.error('Usage: node --no-warnings tests/evidence/forms/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(path, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const C = (change: unknown) => run({ type: 'change-database', pageId: 'runs', change } as never)
await run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
await C({ kind: 'addProperty', property: { id: 'km', name: 'Distance', type: 'number' } })
await C({ kind: 'addProperty', property: { id: 'feel', name: 'Felt', type: 'select', options: [{ id: 'good', name: 'Good', color: 'gray' }, { id: 'hard', name: 'Hard', color: 'gray' }] } })
await C({ kind: 'addProperty', property: { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'hills', name: 'Hills', color: 'gray' }, { id: 'rain', name: 'Rain', color: 'gray' }] } })
await C({ kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } })
await C({ kind: 'addProperty', property: { id: 'ok', name: 'Stretched', type: 'checkbox' } })
await C({ kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } })
await C({ kind: 'addView', view: { id: 'f', name: 'Log a run', layout: 'form', columns: [], sort: [], filter: [] } })
const form = ws.pages.find(p => p.id === 'runs')!.database!.views.find(v => v.id === 'f')!.form!
await C({ kind: 'updateView', viewId: 'f', form: { ...form, questions: form.questions.map(q => (q.propertyId === 'km' ? { ...q, wording: 'How far did you go?', required: true } : q)) } })
console.log('seeded', path)
