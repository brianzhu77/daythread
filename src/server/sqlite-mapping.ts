import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { restoreHeldTrash } from './trash-rollback.ts'
import { restoreHeldLinks } from './link-rollback.ts'
import { restoreHeldPageLinks, stampUntimedReferences } from './page-link-rollback.ts'
import type { Capture, Event, Material, Page, Placement, Receipt, Task, Workspace } from '../domain/types.ts'

type Kind = 'text' | 'number' | 'boolean' | 'json'
type Fields<T> = Record<keyof T, Kind>
// Exhaustive maps intentionally fail typecheck whenever a domain field is added without a storage mapping.
const pages = { id:'text',type:'text',url:'text',date:'text',title:'text',sections:'json',editorJSON:'text',templateApplied:'boolean',editorSections:'text',editorBlockMetadata:'json',editorCreations:'json',editorDeletions:'json',reviewText:'text',reviewSaved:'boolean',handoffDone:'boolean',reviewStep:'number',reviewSource:'text',reviewSkipped:'boolean',draftError:'text',draft:'json',parentId:'text',trashedAt:'text',trashId:'text' } satisfies Fields<Page>
const tasks = { id:'text',title:'text',status:'text',version:'number',plannedOn:'text',attentionOn:'text',deadlineOn:'text',paused:'boolean',createdOn:'text',lastPlannedOn:'text',sourcePageId:'text',doneOn:'text' } satisfies Fields<Task>
const placements = { taskId:'text',date:'text',state:'text',order:'number',section:'text' } satisfies Fields<Placement>
const events = { id:'text',title:'text',date:'text',time:'text',cancelled:'boolean' } satisfies Fields<Event>
const materials = { id:'text',url:'text',title:'text',body:'text',savedOn:'text',reviewState:'text',nextReviewOn:'text',resurface:'boolean',lastDecisionOn:'text',skippedUntil:'text',taskId:'text',openedOn:'json',dismissedOn:'json',decisions:'json',sources:'json' } satisfies Fields<Material>
const captures = { id:'text',pageId:'text',text:'text',status:'text',contextLine:'text',error:'text',failure:'text',proposals:'json',proposalRevision:'number',simulated:'boolean',proposedTitle:'text',taskId:'text',model:'text',mode:'text',capturedAt:'text' } satisfies Fields<Capture>
const receipts = { operationId:'text',message:'text',entityId:'text',simulated:'boolean',fingerprint:'text' } satisfies Fields<Receipt>
const specs = [
  { name:'pages',fields:pages,keys:['id'] },{ name:'tasks',fields:tasks,keys:['id'] },
  { name:'placements',fields:placements,keys:['taskId','date'] },{ name:'events',fields:events,keys:['id'] },
  { name:'materials',fields:materials,keys:['id'] },{ name:'captures',fields:captures,keys:['id'] },
  { name:'receipts',fields:receipts,keys:['operationId'] },
] as const
const quote = (s: string) => `"${s}"`
type Snapshot = Omit<Workspace, 'undo'>
type Entity = Record<string, unknown>

const columnType = (kind: Kind) => kind === 'number' || kind === 'boolean' ? 'INTEGER' : 'TEXT'
// Columns added after the first layout. Migration 0 must keep creating exactly the original tables, so that a
// fresh database and an upgraded one end up identical after the later migrations run.
// `layout`: the layout (user_version) that first has the column.
const addedColumns: readonly { table: typeof specs[number]['name']; column: string; kind: Kind; layout: number }[] = [
  { table: 'pages', column: 'parentId', kind: 'text', layout: 2 },
  { table: 'captures', column: 'model', kind: 'text', layout: 3 },
  { table: 'captures', column: 'mode', kind: 'text', layout: 3 },
  { table: 'captures', column: 'capturedAt', kind: 'text', layout: 3 },
  { table: 'pages', column: 'trashedAt', kind: 'text', layout: 4 },
  { table: 'pages', column: 'trashId', kind: 'text', layout: 4 },
  { table: 'pages', column: 'url', kind: 'text', layout: 5 },
  { table: 'tasks', column: 'doneOn', kind: 'text', layout: 7 },
]
/**
 * The model budget ledger (03 E3). Deliberately outside the current/undo snapshot scheme: Undo restores a whole
 * workspace copy, and must never bring back yesterday's spend. Amounts are integer micro-USD.
 */
export const modelAttemptsTable = `CREATE TABLE IF NOT EXISTS model_attempts (
  id TEXT PRIMARY KEY, captureId TEXT, revision INTEGER, day TEXT NOT NULL,
  reservedMicros INTEGER NOT NULL, actualMicros INTEGER, state TEXT NOT NULL CHECK(state IN ('reserved','unknown','estimated','settled','not-sent')),
  generationId TEXT, model TEXT, createdAt TEXT NOT NULL, settledAt TEXT, note TEXT,
  resultFingerprint TEXT, resultOperationId TEXT, requestHash TEXT) STRICT`
const modelAttemptColumns = ['id','captureId','revision','day','reservedMicros','actualMicros','state','generationId','model','createdAt','settledAt','note','resultFingerprint','resultOperationId','requestHash']
// Each function runs once, in order, inside the adapter's initialization transaction.
export const sqliteMigrations: readonly ((db: DatabaseSync) => void)[] = [db => {
  db.exec('CREATE TABLE meta (snapshot TEXT PRIMARY KEY CHECK(snapshot IN (\'current\',\'undo\')), schemaVersion INTEGER NOT NULL, revision INTEGER NOT NULL, timezone TEXT NOT NULL, undoOperationId TEXT, undoRevision INTEGER) STRICT')
  for (const spec of specs) {
    const columns = Object.entries(spec.fields).filter(([name]) => !addedColumns.some(a => a.table === spec.name && a.column === name)).map(([name,kind]) => `${quote(name)} ${columnType(kind)}`)
    db.exec(`CREATE TABLE ${spec.name} (snapshot TEXT NOT NULL CHECK(snapshot IN ('current','undo')), position INTEGER NOT NULL, present TEXT NOT NULL, ${columns.join(',')}, PRIMARY KEY(snapshot,${spec.keys.map(quote).join(',')})) STRICT`)
  }
}, db => {
  // pages-delta N-2: the page a page was created in. Existing rows read as top level.
  const { table, column, kind } = addedColumns[0]!
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${quote(column)} ${columnType(kind)}`)
}, db => {
  // feat/model step 1: which model organized a capture, in which mode and when he wrote it, plus the budget ledger. The ledger table
  // may already exist: a rollback to layout 2 keeps it, so today's spend survives a round trip.
  for (const { table, column, kind } of addedColumns.slice(1, 4)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${quote(column)} ${columnType(kind)}`)
  db.exec(modelAttemptsTable)
}, db => {
  // A4 trash (docs/design/a4-trash-data.md): existing rows read as live. After a rollback to layout 3, what the script
  // held back goes into the trash again (§4).
  for (const { table, column, kind } of addedColumns.slice(4, 6)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${quote(column)} ${columnType(kind)}`)
  const log = restoreHeldTrash(db)
  if (log) console.info(JSON.stringify({ level: 'info', event: 'storage.trash-reupgrade', ...log }))
}, db => {
  // A2 link pages (docs/plan/a2-url-page.md §5): a page's URL. After a rollback to layout 4, the identities the script
  // held come back.
  const { table, column, kind } = addedColumns[6]!
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${quote(column)} ${columnType(kind)}`)
  const log = restoreHeldLinks(db)
  if (log) console.info(JSON.stringify({ level: 'info', event: 'storage.links-reupgrade', ...log }))
}, db => {
  // A9a layout 6 (docs/plan/a9-page-links.md §5): no table changes; inline `[[` links are a format the layout-5 build
  // can't open. After a rollback to 5 the held links come back by their marker, then every reference without a time
  // is stamped once, in the order Linked from shows now (B15).
  const restored = restoreHeldPageLinks(db)
  const stamped = stampUntimedReferences(db)
  if (restored || stamped) console.info(JSON.stringify({ level: 'info', event: 'storage.page-links-upgrade', ...(restored ?? {}), stamped }))
}, db => {
  // A11 layout 7 (docs/plan/a11-line-links.md §6): the day a task was done. Existing rows have none and use the
  // derived day; a layout-6 build reading this database ignores the column only if it's dropped (rollback step).
  const { table, column, kind } = addedColumns[7]!
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${quote(column)} ${columnType(kind)}`)
}]

const workspaceFields = {schemaVersion:true,revision:true,timezone:true,pages:true,tasks:true,placements:true,events:true,materials:true,captures:true,receipts:true,undo:true} satisfies Record<keyof Workspace,boolean>
function checkWorkspaceKeys(w: Snapshot | Workspace): void {
  const known = new Set(Object.keys(workspaceFields))
  if (Object.keys(w).some(k => !known.has(k))) throw new Error('Unmapped workspace field')
  if (w.schemaVersion !== 1 || !Number.isSafeInteger(w.revision) || w.revision < 0 || w.timezone !== 'America/Vancouver') throw new Error('Unsupported workspace metadata')
  for (const name of ['pages','tasks','placements','events','materials','captures'] as const) if (!Array.isArray(w[name])) throw new Error('Invalid workspace collection')
  if (!w.receipts || typeof w.receipts !== 'object' || Array.isArray(w.receipts)) throw new Error('Invalid receipts')
  for (const [key,receipt] of Object.entries(w.receipts)) if (key !== receipt.operationId) throw new Error('Receipt identity mismatch')
}
function encode(entity: Entity, fields: Record<string, Kind>): { present: string; values: SQLInputValue[] } {
  if (Object.keys(entity).some(k => !(k in fields))) throw new Error('Unmapped entity field')
  const present = Object.keys(fields).filter(k => entity[k] !== undefined)
  const values = Object.entries(fields).map(([key,kind]): SQLInputValue => {
    const value = entity[key]
    if (value === undefined || value === null) return null
    if (kind === 'json') return JSON.stringify(value)
    if (kind === 'boolean' && typeof value === 'boolean') return Number(value)
    if (kind === 'number' && typeof value === 'number' && Number.isSafeInteger(value)) return value
    if (kind === 'text' && typeof value === 'string') return value
    throw new Error('Invalid mapped field type')
  })
  return { present: JSON.stringify(present),values }
}
function decode(row: Record<string, unknown>,fields: Record<string, Kind>): Entity {
  const present = new Set(JSON.parse(row.present as string) as string[])
  const entity: Entity = {}
  for (const [key,kind] of Object.entries(fields)) if (present.has(key)) {
    const value = row[key]
    entity[key] = value === null ? null : kind === 'json' ? JSON.parse(value as string) : kind === 'boolean' ? Boolean(value) : value
  }
  return entity
}
function entities(snapshot: Snapshot | undefined,name: typeof specs[number]['name']): Entity[] {
  if (!snapshot) return []
  return (name === 'receipts' ? Object.values(snapshot.receipts) : snapshot[name]) as unknown as Entity[]
}
function identity(entity: Entity,keys: readonly string[]): string { return JSON.stringify(keys.map(k=>entity[k])) }
function writeSnapshot(db: DatabaseSync, snapshot: 'current' | 'undo',before: Snapshot | undefined,after: Snapshot | undefined): void {
  if (after) checkWorkspaceKeys(after)
  for (const spec of specs) {
    const columns = Object.keys(spec.fields)
    const previous = new Map(entities(before,spec.name).map((entity,position)=>[identity(entity,spec.keys),JSON.stringify([position,encode(entity,spec.fields)])]))
    const next = entities(after,spec.name)
    const seen = new Set<string>()
    const names = ['snapshot','position','present',...columns]
    const upsert = db.prepare(`INSERT INTO ${spec.name} (${names.map(quote).join(',')}) VALUES (${names.map(()=>'?').join(',')}) ON CONFLICT(snapshot,${spec.keys.map(quote).join(',')}) DO UPDATE SET ${names.slice(1).map(n=>`${quote(n)}=excluded.${quote(n)}`).join(',')}`)
    next.forEach((entity,position)=>{
      for (const key of spec.keys) if (typeof entity[key] !== 'string' || !entity[key]) throw new Error('Invalid entity identity')
      const key = identity(entity,spec.keys)
      if (seen.has(key)) throw new Error('Duplicate entity identity')
      seen.add(key)
      const encoded = encode(entity,spec.fields)
      if (previous.get(key) !== JSON.stringify([position,encoded])) upsert.run(snapshot,position,encoded.present,...encoded.values)
    })
    const remove = db.prepare(`DELETE FROM ${spec.name} WHERE snapshot=? AND ${spec.keys.map(k=>`${quote(k)}=?`).join(' AND ')}`)
    for (const entity of entities(before,spec.name)) if (!seen.has(identity(entity,spec.keys))) remove.run(snapshot,...spec.keys.map(k=>entity[k] as string))
  }
  if (!after) db.prepare('DELETE FROM meta WHERE snapshot=?').run(snapshot)
  else db.prepare('INSERT INTO meta(snapshot,schemaVersion,revision,timezone) VALUES(?,?,?,?) ON CONFLICT(snapshot) DO UPDATE SET schemaVersion=excluded.schemaVersion,revision=excluded.revision,timezone=excluded.timezone').run(snapshot,after.schemaVersion,after.revision,after.timezone)
}
function readSnapshot(db: DatabaseSync,snapshot:'current'|'undo'): Snapshot | undefined {
  const meta = db.prepare('SELECT * FROM meta WHERE snapshot=?').get(snapshot)
  if (!meta) return undefined
  const result: Record<string, unknown> = {schemaVersion:meta.schemaVersion,revision:meta.revision,timezone:meta.timezone}
  for (const spec of specs) {
    const rows = db.prepare(`SELECT * FROM ${spec.name} WHERE snapshot=? ORDER BY position`).all(snapshot)
    const list = rows.map(row=>decode(row,spec.fields))
    result[spec.name] = spec.name === 'receipts' ? Object.fromEntries(list.map(r=>[r.operationId,r])) : list
  }
  checkWorkspaceKeys(result as unknown as Snapshot)
  return result as unknown as Snapshot
}
export function readWorkspace(db: DatabaseSync): Workspace | undefined {
  const current = readSnapshot(db,'current')
  if (!current) return undefined
  const meta = db.prepare("SELECT undoOperationId,undoRevision FROM meta WHERE snapshot='current'").get()!
  if (meta.undoOperationId !== null) {
    const before = readSnapshot(db,'undo')
    if (!before) throw new Error('Undo snapshot missing')
    return {...current,undo:{operationId:meta.undoOperationId as string,revision:meta.undoRevision as number,before}}
  }
  return current
}
export function writeWorkspace(db: DatabaseSync,before: Workspace | undefined,after: Workspace): void {
  checkWorkspaceKeys(after)
  if (after.undo && Object.keys(after.undo).some(k=>!['operationId','revision','before'].includes(k))) throw new Error('Unmapped undo field')
  writeSnapshot(db,'current',before,after)
  writeSnapshot(db,'undo',before?.undo?.before,after.undo?.before)
  db.prepare("UPDATE meta SET undoOperationId=?,undoRevision=? WHERE snapshot='current'").run(after.undo?.operationId ?? null,after.undo?.revision ?? null)
}

/** The tables match `layout` exactly (default: the current one). A rollback script checks the layout it starts from. */
export function verifySqliteLayout(db: DatabaseSync, layout: number = sqliteMigrations.length): void {
  for (const spec of specs) {
    const actual=db.prepare(`PRAGMA table_info(${spec.name})`).all()
    const later=new Set(addedColumns.filter(a=>a.table===spec.name&&a.layout>layout).map(a=>a.column))
    const names=['snapshot','position','present',...Object.keys(spec.fields).filter(n=>!later.has(n))]
    if (actual.length!==names.length || names.some(n=>!actual.some(c=>c.name===n))) throw new Error('Incompatible entity table layout')
    const primary=actual.filter(c=>Number(c.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(c=>c.name)
    if (JSON.stringify(primary)!==JSON.stringify(['snapshot',...spec.keys])) throw new Error('Incompatible entity primary key')
  }
  const ledger=db.prepare('PRAGMA table_info(model_attempts)').all().map(c=>c.name)
  if (JSON.stringify(ledger)!==JSON.stringify(modelAttemptColumns)) throw new Error('Incompatible model ledger layout')
  const meta=db.prepare('PRAGMA table_info(meta)').all().map(c=>c.name)
  if (JSON.stringify(meta)!==JSON.stringify(['snapshot','schemaVersion','revision','timezone','undoOperationId','undoRevision'])) throw new Error('Incompatible workspace metadata layout')
}
