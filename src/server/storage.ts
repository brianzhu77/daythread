import { resolve } from 'node:path'
import type { WorkspaceRepository } from './repository.ts'
import { SqliteWorkspaceRepository } from './sqlite-repository.ts'
let repository: WorkspaceRepository | undefined
export function getRepository(): WorkspaceRepository {
  if (process.env.DAYTHREAD_STORAGE !== 'sqlite') throw new Error('Configure DAYTHREAD_STORAGE=sqlite. No fallback storage is enabled.')
  if (process.env.VERCEL || process.env.NETLIFY) throw new Error('Unauthenticated local SQLite storage is disabled on hosting platforms')
  repository ??= new SqliteWorkspaceRepository(resolve(process.env.DAYTHREAD_SQLITE_PATH ?? '.daythread-local/workspace.sqlite'),resolve(process.env.DAYTHREAD_LOCAL_DATA_PATH ?? '.daythread-local/workspace.json'))
  return repository
}
