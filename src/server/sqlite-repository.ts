import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, openSync, closeSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { applyCommand, createEmptyWorkspace } from '../domain/workspace.ts'
import { upgradeWorkspace } from '../domain/convert-v1.ts'
import type { Command, CommandResult, Workspace } from '../domain/types.ts'
import { todayIn, type ServerRepository } from './repository.ts'
import { completeLegacyColumns, legacyTables, readLegacyWorkspace } from './sqlite-legacy.ts'
import { commandLogFields, debugLog, logOperationId } from './debug-log.ts'

const applicationId = 0x44544852
/** Layout 8: the v2 workspace as one JSON document in one row. Layouts 1–7 are the v1 entity tables, converted on first open. */
export const sqliteLayout = 8

/**
 * The workspace on SQLite: one row holding the document, its revision, and the Undo copy inside it, written under
 * BEGIN IMMEDIATE so a command is one transaction. A v1 store (layouts 1–7) is converted in place on first open.
 */
export class SqliteWorkspaceRepository implements ServerRepository {
  private readonly path: string
  private readonly legacyPath?: string
  private readonly allowMissingLegacy: boolean
  private readonly today: string
  constructor(path: string, legacyPath?: string, options: { allowMissingLegacy?: boolean; today?: string } = {}) {
    this.path = resolve(path); this.legacyPath = legacyPath ? resolve(legacyPath) : undefined
    this.allowMissingLegacy = options.allowMissingLegacy ?? false
    this.today = options.today ?? todayIn()
  }
  private open(operationId: string): DatabaseSync {
    // A typo in an explicitly configured import source must fail before creating even an empty DB file.
    if (this.legacyPath && !this.allowMissingLegacy && !existsSync(this.path)) readFileSync(this.legacyPath)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    try { closeSync(openSync(this.path, 'wx', 0o600)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const db = new DatabaseSync(this.path)
    try {
      db.exec('PRAGMA busy_timeout=5000')
      db.exec('BEGIN IMMEDIATE')
      const id = db.prepare('PRAGMA application_id').get()!.application_id
      const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name as string)
      if (id !== applicationId && (id !== 0 || version !== 0 || tables.length)) throw new Error('Unrecognized database layout; existing file kept')
      if (id === applicationId && (version < 1 || version > sqliteLayout)) throw new Error('Unsupported database layout')
      if (id !== applicationId) {
        // A new store: empty, or the legacy JSON file (a v1 workspace, converted).
        let source: Workspace = createEmptyWorkspace(), imported = false
        if (this.legacyPath) {
          try { source = upgradeWorkspace(JSON.parse(readFileSync(this.legacyPath, 'utf8')), this.today); imported = true }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !this.allowMissingLegacy) throw error }
        }
        db.exec('CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, data TEXT NOT NULL) STRICT')
        db.prepare('INSERT INTO workspace (id, revision, data) VALUES (1, ?, ?)').run(source.revision, JSON.stringify(source))
        db.exec(`PRAGMA application_id=${applicationId}`)
        db.exec(`PRAGMA user_version=${sqliteLayout}`)
        db.exec('COMMIT')
        console.info(JSON.stringify({ level: 'info', event: 'storage.initialize', result: imported ? 'imported' : 'empty', pages: source.pages.length }))
        debugLog('storage.initialize', { operationId, afterRevision: source.revision, result: imported ? 'imported' : 'empty' })
      } else if (version < sqliteLayout) {
        // A v1 store: read its current snapshot, convert, keep it as the one document, drop the old tables.
        for (const table of ['meta', 'pages', 'tasks', 'placements', 'events', 'materials', 'captures', 'receipts']) if (!tables.includes(table)) throw new Error('Initialized database has no workspace')
        completeLegacyColumns(db)
        const legacy = readLegacyWorkspace(db)
        if (!legacy) throw new Error('Initialized database has no workspace')
        const converted = upgradeWorkspace(legacy, this.today)
        db.exec('CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, data TEXT NOT NULL) STRICT')
        db.prepare('INSERT INTO workspace (id, revision, data) VALUES (1, ?, ?)').run(converted.revision, JSON.stringify(converted))
        for (const table of legacyTables) db.exec(`DROP TABLE IF EXISTS ${table}`)
        db.exec(`PRAGMA user_version=${sqliteLayout}`)
        db.exec('COMMIT')
        console.info(JSON.stringify({ level: 'info', event: 'storage.upgrade', from: version, to: sqliteLayout, revision: converted.revision, pages: converted.pages.length }))
      } else {
        if (!tables.includes('workspace')) throw new Error('Initialized database has no workspace')
        db.exec('COMMIT')
      }
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
      return db
    } catch (error) { try { db.exec('ROLLBACK') } catch {} db.close(); throw error }
  }
  private read(db: DatabaseSync): Workspace {
    const row = db.prepare('SELECT data FROM workspace WHERE id = 1').get() as { data: string } | undefined
    if (!row) throw new Error('Workspace missing')
    return upgradeWorkspace(JSON.parse(row.data), this.today)
  }
  private write(db: DatabaseSync, workspace: Workspace): void {
    db.prepare('UPDATE workspace SET revision = ?, data = ? WHERE id = 1').run(workspace.revision, JSON.stringify(workspace))
  }
  async load(): Promise<Workspace> {
    const started = performance.now(), operationId = logOperationId() ?? crypto.randomUUID(); let db: DatabaseSync | undefined
    try {
      db = this.open(operationId); db.exec('BEGIN')
      const current = this.read(db)
      db.exec('COMMIT')
      debugLog('storage.load', { operationId, afterRevision: current.revision, elapsedMs: performance.now() - started, result: 'ok' })
      return current
    } catch (error) { try { db?.exec('ROLLBACK') } catch {} debugLog('storage.load', { operationId, elapsedMs: performance.now() - started, result: 'error', error: error instanceof Error ? error.name : 'UnknownError' }); throw error }
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
  async executeOnLatest(operationId: string, action: Command['action']): Promise<CommandResult> {
    return this.transact(operationId, db => {
      const current = this.read(db)
      const result = applyCommand(current, { operationId, expectedRevision: current.revision, action })
      if (result.workspace.revision !== current.revision) this.write(db, result.workspace)
      return result
    })
  }
  async execute(command: Command): Promise<CommandResult> {
    const started = performance.now(), fields = commandLogFields(command)
    debugLog('command.start', fields)
    try {
      const { result, before } = this.transact(command.operationId, db => {
        const current = this.read(db)
        const result = applyCommand(current, command)
        if (result.workspace.revision !== current.revision) this.write(db, result.workspace)
        return { result, before: current.revision }
      })
      debugLog('command.finish', { ...fields, beforeRevision: before, afterRevision: result.workspace.revision, elapsedMs: performance.now() - started, result: result.workspace.revision === before ? 'replay' : 'committed' })
      return result
    } catch (error) {
      debugLog('command.finish', { ...fields, elapsedMs: performance.now() - started, result: 'error', error: error instanceof Error ? error.name : 'UnknownError' })
      throw error
    }
  }
}
