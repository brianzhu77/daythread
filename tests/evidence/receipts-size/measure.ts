// Basics #1: row size, save time and browser download before/after, on a COPY of his row, on a local throwaway
// Postgres (embedded PG 17, loopback). Prints sizes and timings only.
//   node tests/evidence/receipts-size/measure.ts <workspace-row.json> <postgres url>
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { forBrowser } from '../../../src/server/browser-workspace.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
const [rowPath, url] = process.argv.slice(2)
const row = JSON.parse(readFileSync(rowPath!, 'utf8')), base = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
const sql = postgres(url!, { prepare: false, onnotice: () => {} })
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const schema = 'daythread_check_receipts'
await sql.unsafe(`drop schema if exists ${schema} cascade`)
const repo = new PostgresWorkspaceRepository(postgresClient(sql), schema)
await repo.load()
await sql.unsafe(`update ${schema}.workspace set revision = $1, data = $2::text::json where id = 1`, [base.revision, JSON.stringify(base)])
const rowBytes = async () => Number((await sql.unsafe(`select octet_length(data::text) as n from ${schema}.workspace`))[0]!.n)
const browserBytes = async () => Buffer.byteLength(JSON.stringify(forBrowser(await repo.load())))
const save = async (i: number) => {
  const cur = await repo.load(), p = cur.pages[0]!, doc = editorSeed(p, cur)
  const last = doc.findLast(n => n.type === 'paragraph' || n.type === 'bulletListItem'); if (last) last.content = `probe ${i}`
  const t0 = performance.now()
  await repo.execute({ operationId: `measure-${i}`, expectedRevision: cur.revision, action: { type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(doc) } as never })
  return performance.now() - t0
}
const before = { row: await rowBytes(), browser: await browserBytes() }
const times: number[] = []
for (let i = 0; i < 25; i++) times.push(await save(i))   // the first save trims the row
const ws = await repo.load()
const after = { row: await rowBytes(), browser: await browserBytes(), receipts: Buffer.byteLength(JSON.stringify(ws.receipts)), undo: Buffer.byteLength(JSON.stringify(ws.undo ?? null)) }
const steady = times.slice(1).sort((a, b) => a - b)
console.log(JSON.stringify({ revisionBefore: base.revision, rowBefore: kb(before.row), rowAfter: kb(after.row), receiptsAfter: kb(after.receipts), undoAfter: kb(after.undo), browserBefore: kb(before.browser), browserAfter: kb(after.browser), firstSaveMs: Math.round(times[0]!), saveMsMedian: Math.round(steady[12]!), saveMsMax: Math.round(steady.at(-1)!) }))
await sql.unsafe(`drop schema ${schema} cascade`); await sql.end()
