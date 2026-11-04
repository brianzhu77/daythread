// CSV and TSV (docs/design/csv.md): reading and writing the text, and a database's rows as a sheet. Pure: the browser does it all, so
// an export costs the server nothing and an import's preview sends nothing until it's confirmed.
import { cellValue, databaseRows, isDatabase, titleId, valueText, viewColumns, viewRows, type Database, type Property, type View, type ViewContext } from './database.ts'
import type { Page, Workspace } from './types.ts'

/** Excel on Windows reads UTF-8 without this as the system's encoding, and Chinese turns to garbage. Harmless elsewhere; the parser strips it. */
export const byteOrderMark = '﻿'
const quoteIfNeeded = (cell: string, delimiter: string) => (cell.includes('"') || cell.includes(delimiter) || /[\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)
export function writeDelimited(rows: readonly (readonly string[])[], delimiter = ','): string {
  return rows.map(row => row.map(cell => quoteIfNeeded(cell, delimiter)).join(delimiter)).join('\r\n')
}
/** Quoted cells may hold the delimiter, a newline or a doubled quote, as a spreadsheet writes them, so splitting on lines would be wrong. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const source = text.startsWith(byteOrderMark) ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false, started = false
  const endCell = () => { row.push(cell); cell = ''; started = false }
  const endRow = () => { endCell(); rows.push(row); row = [] }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    if (quoted) {
      if (c !== '"') cell += c
      else if (source[i + 1] === '"') { cell += '"'; i++ }
      else quoted = false
    } else if (c === '"' && !started) { quoted = true; started = true }
    else if (c === delimiter) endCell()
    else if (c === '\n') endRow()
    else if (c === '\r') { if (source[i + 1] === '\n') i++; endRow() }
    else { cell += c; started = true }
  }
  // A last line without its line ending, but not an empty one after it.
  if (started || cell || row.length) endRow()
  return rows
}

/** Text a spreadsheet would run as a formula gets a leading `'`, which our import takes off again. A Number column has nothing to run, so `-5` stays a number. */
const runnable = /^[=+\-@\t\r]/
const notRun = (text: string) => (runnable.test(text) ? `'${text}` : text)

function cellText(db: Database, row: Page, p: Property): string {
  const value = cellValue(db, row, p.id)
  if (p.type === 'checkbox') return value === true ? 'Yes' : 'No'
  const text = valueText(db, p.id, value)
  return p.type === 'number' || p.type === 'date' || p.type === 'createdTime' || p.type === 'editedTime' || p.type === 'id' ? text : notRun(text)
}
/** A sheet of these rows and columns, Name first, each value as the cell shows it. `ws` is the workspace as read: a formula or rollup writes its value. */
export function databaseSheet(db: Database, rows: readonly Page[], columns: readonly Property[]): string[][] {
  return [['Name', ...columns.map(c => notRun(c.name))], ...rows.map(row => [notRun(row.title), ...columns.map(c => cellText(db, row, c))])]
}
export const csvFile = (sheet: readonly (readonly string[])[]) => byteOrderMark + writeDelimited(sheet)

export type ExportScope = { view: View; context: ViewContext } | 'whole'
/** What Export takes: this view's rows and visible properties, or every row and property. */
export function exportedRows(ws: Workspace, databaseId: string, scope: ExportScope): { rows: Page[]; columns: Property[] } {
  const page = ws.pages.find(p => p.id === databaseId)
  if (!isDatabase(page)) return { rows: [], columns: [] }
  if (scope === 'whole') return { rows: databaseRows(ws, databaseId), columns: page.database.properties }
  return { rows: viewRows(ws, databaseId, scope.view, scope.context), columns: viewColumns(page.database, scope.view).map(c => c.property).filter(p => p.id !== titleId) }
}
