import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, openSync, closeSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { applyCommand, createEmptyWorkspace, DomainError } from '../domain/workspace.ts'
import type { Command, CommandResult, Workspace } from '../domain/types.ts'
import type { WorkspaceRepository } from './repository.ts'
import { readWorkspace, sqliteMigrations, writeWorkspace, verifySqliteLayout } from './sqlite-mapping.ts'
import { commandLogFields, debugLog, logOperationId } from './debug-log.ts'
import { bindResult, sha256, markInterrupted, readAttempts, reconcileAttempt, reserveAttempt, settleAttempt, type ModelAttempt, type ReserveInput, type SettleInput } from './model-ledger.ts'

const applicationId = 0x44544852
export class SqliteWorkspaceRepository implements WorkspaceRepository {
  private readonly path: string
  private readonly legacyPath?: string
  private readonly allowMissingLegacy: boolean
  constructor(path: string, legacyPath?: string, options: {allowMissingLegacy?: boolean} = {}) {
    this.path=resolve(path); this.legacyPath=legacyPath ? resolve(legacyPath):undefined
    this.allowMissingLegacy=options.allowMissingLegacy ?? false
  }
  private open(operationId: string): DatabaseSync {
    // A typo in an explicitly configured import source must fail before creating even an empty DB file.
    // Initialization is still rechecked under BEGIN IMMEDIATE; an existing initialized DB needs no source.
    if (this.legacyPath && !this.allowMissingLegacy && !existsSync(this.path)) readFileSync(this.legacyPath)
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
          catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !this.allowMissingLegacy) throw error }
        }
        writeWorkspace(db,undefined,source)
        if (!isDeepStrictEqual(readWorkspace(db),source)) throw new Error('Workspace import round-trip mismatch; source kept')
        db.exec(`PRAGMA application_id=${applicationId}`)
        db.exec('COMMIT')
        console.info(JSON.stringify({level:'info',event:'storage.initialize',result:imported?'imported':'empty',pages:source.pages.length}))
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
  /** Runs `fn` in one BEGIN IMMEDIATE transaction; nothing it wrote survives an error. */
  private transact<T>(operationId: string, fn: (db: DatabaseSync) => T): T {
    let db: DatabaseSync | undefined
    try {
      db = this.open(operationId); db.exec('BEGIN IMMEDIATE')
      const value = fn(db)
      db.exec('COMMIT')
      return value
    } catch (error) { try { db?.exec('ROLLBACK') } catch {} throw error }
    finally { db?.close() }
  }
  /** The ledger is server-only; the browser gets `modelStatus` instead. */
  async modelAttempts(): Promise<ModelAttempt[]> { return this.transact(crypto.randomUUID(), readAttempts) }
  async reserveModelAttempt(input: ReserveInput): Promise<ModelAttempt> { return this.transact(input.id, db => reserveAttempt(db, input)) }
  /**
   * Settles an attempt and, in the same transaction, applies the workspace command its result implies. A command the
   * domain refuses (the capture moved on) leaves the settlement in place and applies nothing; any other failure rolls
   * back both, so a charge and its applied items never come apart.
   */
  async recordModelResult(input: SettleInput, command?: Command, options: { failAfterWrite?: boolean } = {}): Promise<{ attempt: ModelAttempt; result?: CommandResult; refused?: string }> {
    return this.transact(input.attemptId, db => {
      const attempt = settleAttempt(db, input)
      let result: CommandResult | undefined, refused: string | undefined
      // No cost and no result = "outcome not known yet" (timeout, lost reply). That binds nothing, so the real result
      // arriving later is recorded normally (Ratchet #68 fixed-identity).
      if (input.actualUsd === null && !command) return { attempt }
      // A real result without a cost: applied once, counted at the worst case (the reservation), and left "unknown"
      // so calls stay paused until it's reconciled. Never settled as null or zero (Lead c8706da8).
      if (input.actualUsd === null) db.prepare("UPDATE model_attempts SET note=? WHERE id=?").run('result recorded without a cost; counted at worst case until reconciled', input.attemptId)
      // One attempt, one result: the same result again replays the first receipt; a different one is refused.
      // Fingerprint = the business result only: what it applies + which generation (Lead, after d25b6c28). Cost is a
      // ledger field checked separately by settleAttempt, and may be filled in later without touching the result.
      const fingerprint = sha256(JSON.stringify([command ? command.action : null, input.generationId]))
      const earlier = bindResult(db, input.attemptId, fingerprint, command?.operationId ?? null)
      if (earlier !== null) {
        const current = readWorkspace(db)
        const receipt = earlier === 'none' ? undefined : current?.receipts[earlier]
        return { attempt, ...(receipt && current ? { result: { workspace: current, receipt } } : {}), ...(command && !receipt ? { refused: 'Result already recorded for this attempt' } : {}) }
      }
      if (command) {
        const current = readWorkspace(db)
        if (!current) throw new Error('Workspace missing')
        try { result = applyCommand(current, command) } catch (error) {
          if (!(error instanceof DomainError)) throw error
          refused = error.message
        }
        if (result && result.workspace.revision !== current.revision) writeWorkspace(db, current, result.workspace)
      }
      if (options.failAfterWrite) throw new Error('injected failure after write') // test hook for the atomicity check
      return { attempt, result, refused }
    })
  }
  async markInterruptedModelAttempts(now: string): Promise<number> { return this.transact(crypto.randomUUID(), db => markInterrupted(db, now)) }
  async reconcileModelAttempt(attemptId: string, amount: number | 'worst-case', now: string): Promise<ModelAttempt> { return this.transact(attemptId, db => reconcileAttempt(db, attemptId, amount, now)) }
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
