// After old-build.mjs: the candidate opens what the previous build saved, and runs a command on it (roll forward).
//   node tests/evidence/a11/pg-roll-forward.ts <postgres url> <daythread_check_* schema>
import postgres from 'postgres'
import { postgresClient } from '../../../src/server/db/sql.ts'
import { PostgresWorkspaceRepository } from '../../../src/server/postgres-repository.ts'
import { resolveLine } from '../../../src/domain/page-refs.ts'
const sql = postgres(process.argv[2]!, { prepare: false, onnotice: () => {} })
const repo = new PostgresWorkspaceRepository(postgresClient(sql), process.argv[3]!)
const ws = await repo.load()
const day = ws.pages.find(p => p.type === 'daily')!
const refs = day.sections.flatMap(s => s.blocks).flatMap(b => b.refs ?? [])
console.log(JSON.stringify({ rollForward: 'candidate loads the old build\'s save', revision: ws.revision, refs: refs.map(r => [r.pageId, r.lineId ?? null]), doneOn: ws.tasks.find(t => t.title.startsWith('a task he links to'))?.doneOn ?? null }))
const r = await repo.execute({ operationId: 'fwd-1', expectedRevision: ws.revision, action: { type: 'ensure-day', date: '2026-12-30' } })
console.log(JSON.stringify({ candidateCommandAfterRollForward: r.workspace.revision }))
await sql.end()
