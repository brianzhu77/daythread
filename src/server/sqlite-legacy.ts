// Reads a v1 SQLite store (layouts 1–7: one table per record kind, a `current` and an `undo` snapshot) so it can be
// converted to v2 once. Only the `current` snapshot is read; the undo copy and the model ledger are left behind.
import type { DatabaseSync } from 'node:sqlite'

type Kind = 'text' | 'number' | 'boolean' | 'json'
const pages: Record<string, Kind> = { id: 'text', type: 'text', url: 'text', date: 'text', title: 'text', sections: 'json', editorJSON: 'text', templateApplied: 'boolean', editorSections: 'text', editorBlockMetadata: 'json', editorCreations: 'json', editorDeletions: 'json', reviewText: 'text', reviewSaved: 'boolean', handoffDone: 'boolean', reviewStep: 'number', reviewSource: 'text', reviewSkipped: 'boolean', draftError: 'text', draft: 'json', parentId: 'text', trashedAt: 'text', trashId: 'text' }
const tasks: Record<string, Kind> = { id: 'text', title: 'text', status: 'text', version: 'number', plannedOn: 'text', attentionOn: 'text', deadlineOn: 'text', paused: 'boolean', createdOn: 'text', lastPlannedOn: 'text', sourcePageId: 'text', doneOn: 'text' }
const placements: Record<string, Kind> = { taskId: 'text', date: 'text', state: 'text', order: 'number', section: 'text' }
const events: Record<string, Kind> = { id: 'text', title: 'text', date: 'text', time: 'text', cancelled: 'boolean' }
const materials: Record<string, Kind> = { id: 'text', url: 'text', title: 'text', body: 'text', savedOn: 'text', reviewState: 'text', nextReviewOn: 'text', resurface: 'boolean', lastDecisionOn: 'text', skippedUntil: 'text', taskId: 'text', openedOn: 'json', dismissedOn: 'json', decisions: 'json', sources: 'json' }
const captures: Record<string, Kind> = { id: 'text', pageId: 'text', text: 'text', status: 'text', contextLine: 'text', error: 'text', failure: 'text', proposals: 'json', proposalRevision: 'number', simulated: 'boolean', proposedTitle: 'text', taskId: 'text', model: 'text', mode: 'text', capturedAt: 'text' }
const receipts: Record<string, Kind> = { operationId: 'text', message: 'text', entityId: 'text', simulated: 'boolean', fingerprint: 'text' }
const specs = [['pages', pages], ['tasks', tasks], ['placements', placements], ['events', events], ['materials', materials], ['captures', captures], ['receipts', receipts]] as const
export const legacyTables = ['meta', ...specs.map(([name]) => name), 'model_attempts']
const columnType = (kind: Kind) => (kind === 'number' || kind === 'boolean' ? 'INTEGER' : 'TEXT')

/** The columns a layout before 7 may lack; added so the layout-7 reader below works on any v1 store. */
export function completeLegacyColumns(db: DatabaseSync): void {
  for (const [name, fields] of specs) {
    const have = new Set((db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name))
    for (const [column, kind] of Object.entries(fields)) if (!have.has(column)) db.exec(`ALTER TABLE ${name} ADD COLUMN "${column}" ${columnType(kind)}`)
  }
}

function decode(row: Record<string, unknown>, fields: Record<string, Kind>): Record<string, unknown> {
  const present = new Set(JSON.parse(row.present as string) as string[])
  const entity: Record<string, unknown> = {}
  for (const [key, kind] of Object.entries(fields)) if (present.has(key)) {
    const value = row[key]
    entity[key] = value === null ? null : kind === 'json' ? JSON.parse(value as string) : kind === 'boolean' ? Boolean(value) : value
  }
  return entity
}
/** The v1 workspace held by the store's `current` snapshot, as the v1 code would have loaded it (without undo). */
export function readLegacyWorkspace(db: DatabaseSync): Record<string, unknown> | undefined {
  const meta = db.prepare("SELECT * FROM meta WHERE snapshot='current'").get() as Record<string, unknown> | undefined
  if (!meta) return undefined
  const result: Record<string, unknown> = { schemaVersion: meta.schemaVersion, revision: meta.revision, timezone: meta.timezone }
  for (const [name, fields] of specs) {
    const rows = db.prepare(`SELECT * FROM ${name} WHERE snapshot='current' ORDER BY position`).all() as Record<string, unknown>[]
    const list = rows.map((row) => decode(row, fields))
    result[name] = name === 'receipts' ? Object.fromEntries(list.map((r) => [r.operationId as string, r])) : list
  }
  return result
}
