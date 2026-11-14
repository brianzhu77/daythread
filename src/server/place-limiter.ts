// Which Place search limiter this server uses: Postgres, shared by every Worker instance, or one process's memory for
// SQLite storage, which only ever serves this machine.
import { storageKind, postgresSql } from './storage.ts'
import { MemoryPlaceLimiter, PostgresPlaceLimiter, type PlaceLimiter } from './place-limits.ts'

let limiter: PlaceLimiter | undefined
export function placeLimiter(): PlaceLimiter {
  return limiter ??= storageKind() === 'postgres' ? new PostgresPlaceLimiter(postgresSql()) : new MemoryPlaceLimiter()
}
