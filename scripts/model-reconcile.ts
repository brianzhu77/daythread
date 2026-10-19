// Settles a model attempt whose cost is unknown (a generation id without a cost: calls are paused) or estimated (no id
// and no cost: counted at the upper bound, calls go on). Never an implicit zero:
// pass the amount shown on OpenRouter's activity page, or --worst-case to settle at the reserved upper bound.
// Until an unknown one is settled, paid calls stay paused (03 E3).
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<db> node scripts/model-reconcile.ts            (lists unknown and estimated attempts)
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=<db> node scripts/model-reconcile.ts <attemptId> <usd | --worst-case>
import { SqliteWorkspaceRepository } from '../src/server/sqlite-repository.ts'

const repository = new SqliteWorkspaceRepository(process.env.DAYTHREAD_SQLITE_PATH ?? '.daythread-local/workspace.sqlite')
const [attemptId, amount] = process.argv.slice(2)
if (!attemptId) {
  const open = (await repository.modelAttempts()).filter(a => a.state === 'unknown' || a.state === 'estimated')
  if (!open.length) console.log('No unknown or estimated model charges.')
  for (const a of open) console.log(`${a.id}\t${a.state}\tday ${a.day}\treserved $${a.reservedUsd.toFixed(6)}\tgeneration ${a.generationId ?? '(none)'}\t${a.note ?? ''}`)
} else {
  if (!amount) throw new Error('Give the amount in USD from OpenRouter, or --worst-case')
  const value = amount === '--worst-case' ? 'worst-case' as const : Number(amount)
  const settled = await repository.reconcileModelAttempt(attemptId, value, new Date().toISOString())
  console.log(`Settled ${settled.id} at $${settled.actualUsd!.toFixed(6)} (${settled.note}).`)
}
