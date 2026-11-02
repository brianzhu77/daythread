// Builds a throwaway SQLite store from a Postgres table backup (a copy of his data). Reads the backup, writes nothing to it.
// Usage: node make-store.ts <repo> <backup-dir> <store-path>
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
const [repo, dir, store] = process.argv.slice(2)
if (!repo || !dir || !store) { console.error('Usage: node make-store.ts <repo> <backup-dir> <store-path>'); process.exit(2) }
if (existsSync(store)) { console.error('Store exists; use a fresh path'); process.exit(2) }
const { SqliteWorkspaceRepository } = await import(resolve(repo, 'src/server/sqlite-repository.ts'))
const { workspaceOf } = await import(resolve(repo, 'src/server/workspace-rows.ts'))
const read = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))
const [scope] = read('workspaces')
const text = (v: unknown) => v == null || typeof v === 'string' ? v : JSON.stringify(v)
const pages = read('pages').sort((a: any, b: any) => a.position - b.position).map((r: any) => ({ ...r, document: text(r.document), database_json: text(r.database_json), row_values: text(r.row_values) }))
const tasks = read('tasks').sort((a: any, b: any) => a.position - b.position)
const deleted = read('deleted_tasks').map((r: any) => ({ ...r, data: text(r.data) }))
const ws = workspaceOf({ revision: scope.revision, timezone: scope.timezone, pages, tasks, deleted })
await new SqliteWorkspaceRepository(store, undefined, { allowMissingLegacy: true }).load()
const db = new DatabaseSync(store)
db.prepare('UPDATE workspace SET revision = ?, data = ? WHERE id = 1').run(ws.revision, JSON.stringify(ws))
db.close()
const again = await new SqliteWorkspaceRepository(store).load()
const kinds: Record<string, number> = {}
for (const p of again.pages) kinds[p.type] = (kinds[p.type] ?? 0) + 1
console.log(JSON.stringify({ revision: again.revision, pages: again.pages.length, tasks: again.tasks.length, kinds, schemaVersion: again.schemaVersion }))
