// Export from a view's `⋯` (docs/design/csv.md §2): worked out here from what's on screen, so a filter reads as it does in the view.
import { csvFile, databaseSheet, exportedRows, type ExportScope } from '../domain/csv'
import { fileNames, pageMarkdown, safeName } from '../domain/export'
import type { Database } from '../domain/database'
import type { Page, Workspace } from '../domain/types'

export function saveFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** A CSV, or with the rows' bodies a zip of it and a Markdown file per row, as Notion's export gives (R4-7). */
export async function exportDatabase(read: Workspace, db: Page & { database: Database }, scope: ExportScope, withBodies: boolean, label: string) {
  const { rows, columns } = exportedRows(read, db.id, scope)
  const name = safeName(label) || 'Untitled'
  const csv = csvFile(databaseSheet(db.database, rows, columns))
  if (!withBodies) { saveFile(`${name}.csv`, csv, 'text/csv;charset=utf-8'); return }
  const { zipSync, strToU8 } = await import('fflate')
  const names = fileNames(read), now = new Date()
  const files = Object.fromEntries([[`${name}.csv`, csv] as const, ...rows.map(row => [`${name}/${names.get(row.id) ?? safeName(row.title)}.md`, pageMarkdown(row, read, names)] as const)].map(([path, text]) => [path, [strToU8(text), { mtime: now }] as [Uint8Array, { mtime: Date }]]))
  saveFile(`${name}.zip`, zipSync(files, { level: 6 }).slice(), 'application/zip')
}
