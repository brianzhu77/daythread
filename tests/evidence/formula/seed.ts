// A disposable store for formulas (R4-3): Shop with rows and plain columns; `written` adds formulas to it.
// Usage: node tests/evidence/formula/seed.ts <store-path> [written]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import type { DatabaseChange } from '../../../src/domain/database.ts'
import { storedFormula } from '../../../src/domain/formula.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/formula/seed.ts <store-path> [written|hundred] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const change = (c: DatabaseChange) => run({ type: 'change-database', pageId: 'shop', change: c })
const at = new Date().toISOString()
await run({ type: 'create-database', pageId: 'shop', homeBlockId: null, title: 'Shop' })
await change({ kind: 'addProperty', property: { id: 'price', name: 'Price', type: 'number' } })
await change({ kind: 'addProperty', property: { id: 'qty', name: 'Qty', type: 'number' } })
const rows = process.argv[3] === 'hundred' ? 100 : 0
await run({ type: 'add-row', databaseId: 'shop', pageId: 'pear', title: 'Pear', values: { price: 2, qty: 3 }, at })
await run({ type: 'add-row', databaseId: 'shop', pageId: 'plum', title: 'Plum', values: { price: 5, qty: 1 }, at })
for (let i = 0; i < rows - 2; i++) await run({ type: 'add-row', databaseId: 'shop', pageId: `row${i}`, title: `Row ${i}`, values: { price: i, qty: 2 }, at })
const db = () => ws.pages.find(p => p.id === 'shop')!.database!
const formula = (id: string, name: string, typed: string) => change({ kind: 'addProperty', property: { id, name, type: 'formula', formula: storedFormula(typed, db()) } })
if (process.argv[3] === 'written' || process.argv[3] === 'hundred') {
  await formula('total', 'Total', 'Price * Qty')
  await formula('dear', 'Dear', 'Total > 5')
  await formula('late', 'Late', 'if(today() > parseDate("2020-01-01"), "Overdue", "")')
  if (process.argv[3] === 'hundred') {
    await formula('twice', 'Twice', 'Total * 2')
    await formula('label', 'Label', 'Name + " · " + format(Twice)')
    await formula('tidy', 'Tidy', 'replaceAll(Name, "[0-9]+", "#")')
  }
  await formula('slow', 'Slow', 'map(split(repeat("x", 90000), ""), current + current).length()')
}
console.log('seeded', process.argv[2])
