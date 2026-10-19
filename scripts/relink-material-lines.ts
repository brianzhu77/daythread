// One-off repair after fix/goodstuffs-material: saves Good Stuffs links written through the editor before the fix.
// Run against the same database as the server (safe while it runs; each command is its own transaction):
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<path> node scripts/relink-material-lines.ts
import { getRepository } from '../src/server/storage.ts'

const repository = getRepository()
const { revision } = await repository.load()
const result = await repository.execute({ operationId: `relink-material-lines:${crypto.randomUUID()}`, expectedRevision: revision, action: { type: 'relink-material-lines' } })
console.log(result.receipt.message, `(revision ${revision} → ${result.workspace.revision})`)
