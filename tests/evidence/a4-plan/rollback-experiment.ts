// Can today's build (main) open a layout-4 database, and again after the down-script?
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { DatabaseSync } from 'node:sqlite'
const path = process.argv[2]!
const open = async (label: string) => { try { const ws = await new SqliteWorkspaceRepository(path).load(); console.log(label, 'opens:', ws.pages.length, 'pages, revision', ws.revision) } catch (e) { console.log(label, 'refused:', (e as Error).message) } }
await open('layout 3')
let db = new DatabaseSync(path)
db.exec('BEGIN IMMEDIATE; ALTER TABLE pages ADD COLUMN "trashedAt" TEXT; ALTER TABLE pages ADD COLUMN "trashId" TEXT; PRAGMA user_version=4; COMMIT')
db.prepare(`UPDATE pages SET trashedAt='2026-10-20T00:00:00Z', trashId='op1' WHERE title='佛卡夏披萨'`).run()
db.close()
await open('layout 4 (trash columns)')
db = new DatabaseSync(path)
console.log('trashed before down-script:', db.prepare('SELECT snapshot, title FROM pages WHERE trashedAt IS NOT NULL').all().map(r => `${r.snapshot}:${r.title}`))
db.exec('BEGIN IMMEDIATE; ALTER TABLE pages DROP COLUMN "trashId"; ALTER TABLE pages DROP COLUMN "trashedAt"; PRAGMA user_version=3; COMMIT')
db.close()
await open('after down-script')
const ws = await new SqliteWorkspaceRepository(path).load()
console.log('focaccia live again:', ws.pages.some(p => p.title === '佛卡夏披萨'))
