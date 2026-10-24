// Builds a disposable SQLite store from a copy of his rev-356 workspace JSON (never the original dump).
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const [json, db] = process.argv.slice(2)
if (!db?.startsWith('/tmp/rb-b47/')) throw Error('store must be under /tmp/rb-b47/')
const ws = await new SqliteWorkspaceRepository(db, json).load()
console.log('store', db, 'revision', ws.revision)
