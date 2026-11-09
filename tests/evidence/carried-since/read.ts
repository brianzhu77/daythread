// What B92 shows on a store's day page, for checking a copy against a hand-worked read (Bumblebee e30337c4):
// each open to-do planned for <today>, with the date it reads "Since" from, or "-" for none. It loads a temporary copy of the
// store, as loading can bring an older store up to date, so the file it's given is never written.
// Usage: node --no-warnings tests/evidence/carried-since/read.ts <store-path> <today>  (a local copy, never production)
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteWorkspaceRepository as R } from '../../../src/server/sqlite-repository.ts'
import { carriedSince } from '../../../src/domain/carried.ts'
import { plannedOn } from '../../../src/domain/workspace.ts'
const [S, today] = process.argv.slice(2)
if (!S || !today) { console.error('Usage: node --no-warnings tests/evidence/carried-since/read.ts <store-path> <today>'); process.exit(2) }
const dir = mkdtempSync(join(tmpdir(), 'b92-read-')), copy = join(dir, 'store.sqlite')
copyFileSync(S, copy)
const ws = await new R(copy, undefined, { allowMissingLegacy: true }).load()
for (const t of ws.tasks.filter(t => t.status === 'open' && plannedOn(ws, t.id) === today)) {
  console.log(`${carriedSince(ws, t, today) ?? '-'}\t${t.createdOn}\t${t.paused ? 'paused\t' : ''}${t.title.slice(0, 40) || '(blank)'}`)
}
rmSync(dir, { recursive: true, force: true })
