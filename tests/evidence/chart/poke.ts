// One command on a throwaway store, for chart.mjs. Usage: node --no-warnings tests/evidence/chart/poke.ts <store-path> '<action json>'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
const ws = await repo.load()
await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: JSON.parse(process.argv[3]!) })
