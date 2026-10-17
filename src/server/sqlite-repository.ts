import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { applyCommand, createEmptyWorkspace } from '../domain/workspace.ts'
import type { Command, CommandResult, Workspace } from '../domain/types.ts'
import type { WorkspaceRepository } from './repository.ts'
import { readWorkspace, sqliteMigrations, writeWorkspace, verifySqliteLayout } from './sqlite-mapping.ts'
import { commandLogFields, debugLog, logOperationId } from './debug-log.ts'

const applicationId = 0x44544852
export class SqliteWorkspaceRepository implements WorkspaceRepository {
  private readonly path: string
  private readonly legacyPath?: string
  constructor(path: string, legacyPath?: string) { this.path=resolve(path); this.legacyPath=legacyPath ? resolve(legacyPath):undefined }
  private open(operationId: string): DatabaseSync {
    mkdirSync(dirname(this.path),{recursive:true,mode:0o700})
    try { closeSync(openSync(this.path,'wx',0o600)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const db = new DatabaseSync(this.path)
    try {
      db.exec('PRAGMA busy_timeout=5000')
      db.exec('BEGIN IMMEDIATE')
      const id = db.prepare('PRAGMA application_id').get()!.application_id
      let version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
      if (id !== applicationId && (id !== 0 || version !== 0 || tables.length)) throw new Error('Unrecognized database layout; existing file kept')
      if (id === applicationId && version < 1 || version > sqliteMigrations.length) throw new Error('Unsupported database layout')
      if (id === applicationId) {
        // Never repair a damaged initialized store by re-importing an old JSON source.
        for (const table of ['meta','pages','tasks','placements','events','materials','captures','receipts']) db.prepare(`SELECT * FROM ${table} LIMIT 0`).all()
        if (!db.prepare("SELECT 1 FROM meta WHERE snapshot='current'").get()) throw new Error('Initialized database has no workspace')
      }
      while (version < sqliteMigrations.length) { sqliteMigrations[version]!(db); version++; db.exec(`PRAGMA user_version=${version}`) }
      verifySqliteLayout(db)
      if (id !== applicationId) {
        let source: Workspace = createEmptyWorkspace(), imported=false
        if (this.legacyPath) {
          try { source=JSON.parse(readFileSync(this.legacyPath,'utf8')) as Workspace; imported=true }
          catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        }
        writeWorkspace(db,undefined,source)
        if (!isDeepStrictEqual(readWorkspace(db),source)) throw new Error('Workspace import round-trip mismatch; source kept')
        db.exec(`PRAGMA application_id=${applicationId}`)
        db.exec('COMMIT')
        debugLog('storage.initialize',{operationId,afterRevision:source.revision,result:imported?'imported':'empty'})
      } else db.exec('COMMIT')
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
      return db
    } catch(error) { try {db.exec('ROLLBACK')} catch {} db.close(); throw error }
  }
  async load(): Promise<Workspace> {
    const started=performance.now(),operationId=logOperationId() ?? crypto.randomUUID(); let db:DatabaseSync|undefined
    try {
      db=this.open(operationId); db.exec('BEGIN')
      const current=readWorkspace(db)
      if (!current) throw new Error('Workspace missing')
      db.exec('COMMIT')
      debugLog('storage.load',{operationId,afterRevision:current.revision,elapsedMs:performance.now()-started,result:'ok'})
      return current
    } catch(error) { try {db?.exec('ROLLBACK')} catch {} debugLog('storage.load',{operationId,elapsedMs:performance.now()-started,result:'error',error:error instanceof Error?error.name:'UnknownError'}); throw error }
    finally { db?.close() }
  }
  async execute(command: Command): Promise<CommandResult> {
    const started=performance.now(),fields=commandLogFields(command); let db:DatabaseSync|undefined
    debugLog('command.start',fields)
    try {
      db=this.open(command.operationId); db.exec('BEGIN IMMEDIATE')
      const current=readWorkspace(db)
      if (!current) throw new Error('Workspace missing')
      const result=applyCommand(current,command)
      const replay=result.workspace.revision===current.revision
      if (!replay) writeWorkspace(db,current,result.workspace)
      db.exec('COMMIT')
      debugLog('command.finish',{...fields,beforeRevision:current.revision,afterRevision:result.workspace.revision,elapsedMs:performance.now()-started,result:replay?'replay':'committed'})
      return result
    } catch(error) {
      try {db?.exec('ROLLBACK')} catch {}
      debugLog('command.finish',{...fields,elapsedMs:performance.now()-started,result:'error',error:error instanceof Error?error.name:'UnknownError'})
      throw error
    } finally { db?.close() }
  }
}
