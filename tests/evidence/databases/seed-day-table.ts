// Seeds a disposable SQLite store (path as the argument, never his data) for the render budget (R1-18): today's day page
// with 40 lines and, unless the second argument is `plain`, an inline database of 25 rows with all 8 R1 types. `linked`: the
// database's home is on another page and today shows a linked view of it, as a view from the Day template does (R2-7). `todos`: a To-dos view of 25 open tasks. `relation`: the table, with a relation and a rollup.
// Usage: node tests/evidence/databases/seed-day-table.ts <store-path> [plain|linked|todos|relation|formula]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import { storedFormula, worldOf } from '../../../src/domain/formula.ts'
import { todosSourceId } from '../../../src/domain/todos-source.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/databases/seed-day-table.ts <store-path> [plain|linked|todos|relation|formula]'); process.exit(2) }
const plain = process.argv[3] === 'plain', linked = process.argv[3] === 'linked', todos = process.argv[3] === 'todos', relation = process.argv[3] === 'relation', formula = process.argv[3] === 'formula'
const repo = new SqliteWorkspaceRepository(process.argv[2], undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const today = new Date().toLocaleDateString('en-CA', { timeZone: ws.timezone })
const at = new Date().toISOString()
await run({ type: 'ensure-day', date: today })
const day = ws.pages.find(p => p.date === today)!
const line = (i: number) => ({ id: `l${i}`, type: 'bulletListItem', props: {}, content: [{ type: 'text', text: `Line ${i} of the day, with a few words in it`, styles: {} }], children: [] })
const doc = [...JSON.parse(day.document), ...Array.from({ length: 20 }, (_, i) => line(i)), ...(plain ? [] : [{ id: linked ? 'view' : 'home', type: 'database', props: { pageId: todos ? todosSourceId : 'list', view: '' }, children: [] }]), ...Array.from({ length: 20 }, (_, i) => line(i + 20))]
await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify(doc), today })
if (todos) {
  // To-dos: 25 open tasks written on a page of their own.
  await run({ type: 'create-document', title: 'Tasks here', body: '', pageId: 'holder' })
  for (let i = 0; i < 25; i++) await run({ type: 'add-task', pageId: 'holder', title: `Task ${i}`, deadlineOn: today })
} else if (!plain) {
  // Linked: its home is on a page of its own.
  if (linked) await run({ type: 'create-document', title: 'Books', body: '', pageId: 'books' })
  await run({ type: 'create-database', pageId: 'list', parentId: linked ? 'books' : day.id, homeBlockId: 'home', title: 'Reading list' })
  const prop = (id: string, name: string, type: string, extra: object = {}) => run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id, name, type, ...extra } as never } })
  await prop('status', 'Status', 'status'); await prop('pages', 'Pages', 'number')
  await prop('genre', 'Genre', 'select', { options: [{ id: 'novel', name: 'Novel' }, { id: 'essay', name: 'Essay' }] })
  await prop('tags', 'Tags', 'multiSelect', { options: [{ id: 'sf', name: 'SF' }, { id: 'hist', name: 'History' }] })
  await prop('due', 'Due', 'date'); await prop('owned', 'Owned', 'checkbox'); await prop('link', 'Link', 'url'); await prop('notes', 'Notes', 'text')
  // A relation and a rollup on the table (R2-7, R3-5, R3-7): every row linked to a row of another database.
  if (relation) {
    await run({ type: 'create-database', pageId: 'authors', homeBlockId: null, title: 'Authors' })
    await run({ type: 'change-database', pageId: 'authors', change: { kind: 'addProperty', property: { id: 'age', name: 'Age', type: 'number' } } })
    await run({ type: 'add-row', databaseId: 'authors', pageId: 'author', title: 'An author', values: { age: 40 }, at })
    await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'by', name: 'By', type: 'relation', target: 'authors' } } })
    await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: 'ages', name: 'Ages', type: 'rollup', rollup: { relation: 'by', property: 'age', fn: 'sum' } } } })
  }
  // Formulas on a table of 100 rows (R4-3): arithmetic, a date against today, a chain, text and a regular expression.
  if (formula) for (const [id, name, typed] of [['twice', 'Twice', 'Pages * 2'], ['late', 'Late', 'if(and(now() > Due, Status != "Done"), "Overdue", "")'], ['days', 'Days', 'dateBetween(Due, today(), "days")'], ['more', 'More', 'Twice + 1'], ['label', 'Label', 'Name + " · " + format(More)'], ['tidy', 'Tidy', 'replaceAll(Name, "[0-9]+", "#")']]) {
    await run({ type: 'change-database', pageId: 'list', change: { kind: 'addProperty', property: { id: id!, name: name!, type: 'formula', formula: storedFormula(typed!, worldOf(ws), 'list') } } })
  }
  for (let i = 0; i < (formula ? 100 : 25); i++) await run({ type: 'add-row', databaseId: 'list', pageId: `row${i}`, title: `Book ${i}`, values: { ...(relation ? { by: ['author'] } : {}), pages: 100 + i, genre: i % 2 ? 'novel' : 'essay', tags: ['sf'], due: { start: today }, owned: i % 3 === 0, link: `https://example.com/${i}`, notes: `Note ${i}` }, at })
}
console.log('seeded', process.argv[3] ?? 'table', today)
