// A disposable store for buttons (buttons.md): Runs with a row, Notes holding a line and buttons of each kind, and a day template.
// Usage: node --no-warnings tests/evidence/buttons/seed.ts <store-path>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { writeSteps, type ButtonStep } from '../../../src/domain/buttons.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node --no-warnings tests/evidence/buttons/seed.ts <store-path> (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'runs', homeBlockId: null, title: 'Runs' })
await run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'when', name: 'When', type: 'date' } } } as never)
await run({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'n', name: 'N', type: 'number' } } } as never)
await run({ type: 'add-row', databaseId: 'runs', pageId: 'r1', title: 'One', values: { n: 1 }, at } as never)
await run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' })
await run({ type: 'create-document', title: 'Other', body: '', pageId: 'other' })
const line = (id: string, text: string, type = 'paragraph') => ({ id, type, props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const button = (id: string, label: string, steps: ButtonStep[]) => ({ id, type: 'button', props: { label, steps: writeSteps(steps) }, children: [] })
const add: ButtonStep = { id: 's-add', kind: 'add-row', databaseId: 'runs', databaseName: 'Runs', title: 'A run', set: [{ id: 'when', name: 'When', value: { kind: 'today' } }] }
const nodes = [
  line('l1', 'First line'),
  button('b-add', 'Log a run', [add]),
  button('b-confirm', 'Sure?', [{ id: 's-c', kind: 'confirm', text: 'Add a run?' }, add]),
  button('b-insert', 'Add lines', [{ id: 's-i', kind: 'insert', place: 'below', blocks: [line('i1', 'Inserted line'), line('i2', 'Inserted to-do', 'checkListItem')] }]),
  button('b-edit', 'Set all', [{ id: 's-e', kind: 'edit-rows', databaseId: 'runs', databaseName: 'Runs', filter: [], set: [{ id: 'n', name: 'N', value: { kind: 'fixed', raw: 7 } }] }]),
  button('b-none', 'None match', [{ id: 's-n', kind: 'edit-rows', databaseId: 'runs', databaseName: 'Runs', filter: [{ by: 'n', op: 'eq', value: 999 }], set: [{ id: 'n', name: 'N', value: { kind: 'fixed', raw: 7 } }] }]),
  button('b-open', 'Go to Other', [add, { id: 's-o', kind: 'open', target: { kind: 'page', pageId: 'other', name: 'Other' } }]),
  button('b-url', 'To a link', [add, { id: 's-u', kind: 'open', target: { kind: 'url', url: 'https://buttons.test/x' } }]),
  button('b-gone', 'Gone prop', [{ ...add, set: [{ id: 'nope', name: 'Status', value: { kind: 'fixed', raw: 1 } }] }]),
  button('b-todo', 'New to-do', [{ id: 's-t', kind: 'add-row', databaseId: 'source:tasks', databaseName: 'To-dos', title: 'From a button', set: [] }]),
  button('', 'x', []),
].filter(n => n.id)
nodes.push({ id: 'b-long', type: 'button', props: { label: 'A very long label that goes on and on and on, far past what any line can hold at either width of this app', steps: writeSteps([add]) }, children: [] } as never)
nodes.push(line('l2', 'Last line') as never)
await run({ type: 'save-editor', pageId: 'notes', expectedContent: pageContentKey(ws.pages.find(p => p.id === 'notes')!), document: JSON.stringify(nodes) } as never)
console.log('seeded', process.argv[2])
