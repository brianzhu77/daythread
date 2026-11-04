// CSV and TSV (docs/design/csv.md): reading and writing the text, and a database's rows as a sheet. Pure: the browser does it all, so
// an export costs the server nothing and an import's preview sends nothing until it's confirmed.
import { cellValue, databaseRows, isDatabase, isReadOnly, propertyOf, rawOf, titleId, validDateText, valueText, viewColumns, viewRows, type Database, type Json, type Property, type RowEdit, type View, type ViewContext } from './database.ts'
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

// ---------------------------------------------------------------- pasting a grid (design §3)
const two = (n: string) => n.padStart(2, '0')
function dayFrom(text: string): string | null {
  if (validDateText(text)) return text
  // MM/DD/YYYY, as R4-8 reads it: DD/MM is never guessed.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (!us) return null
  const iso = `${us[3]}-${two(us[1]!)}-${two(us[2]!)}`
  return validDateText(iso) ? iso : null
}
/** What pasted words mean in a cell: undefined when they mean nothing there. An option is found by its name; a new one isn't made by a paste. */
export function pastedValue(db: Database, property: Property, line: string): Json | undefined {
  const text = line.trim()
  if (line.length > 10_000) return undefined
  if (property.id === titleId || property.type === 'text') return line
  if (property.type === 'url' || property.type === 'email' || property.type === 'phone') return text
  if (isReadOnly(property)) return undefined
  if (property.type === 'number') { const n = Number(text.replace(/,/g, '')); return Number.isFinite(n) ? n : undefined }
  const options = propertyOf(db, property.id)?.options ?? []
  const named = (name: string) => options.find(o => o.name.toLowerCase() === name.trim().toLowerCase())?.id
  if (property.type === 'select' || property.type === 'status') return named(text)
  if (property.type === 'multiSelect' || property.type === 'relation') {
    // A whole name first: one may hold a comma.
    const whole = named(text)
    if (whole) return [whole]
    const ids = text.split(',').map(named)
    return ids.every((x): x is string => Boolean(x)) ? ids : undefined
  }
  if (property.type === 'checkbox') return /^(yes|true|1|✓)$/i.test(text) ? true : /^(no|false|0)$/i.test(text) ? null : undefined
  if (property.type === 'date') {
    const [start, end, ...more] = text.split(/\s*→\s*/)
    const from = dayFrom(start!), to = end === undefined ? null : dayFrom(end)
    if (!from || more.length || (end !== undefined && (!to || to < from))) return undefined
    return to ? { start: from, end: to } : { start: from }
  }
  return undefined
}

export const maxPastedCells = 1000
export interface PastePlan { items: RowEdit[]; newRows: Array<{ title: string; values: Record<string, Json> }>; pasted: number; unconverted: number; readOnly: number; dropped: number }
/** A grid laid over the view from one cell: its columns and rows, in the order shown, then new rows. What doesn't fit is counted, never guessed at. */
export function planPaste(db: Database, grid: readonly (readonly string[])[], rows: readonly Page[], columns: readonly Property[], startRow: number, startColumn: number): PastePlan {
  const plan: PastePlan = { items: [], newRows: [], pasted: 0, unconverted: 0, readOnly: 0, dropped: 0 }
  grid.forEach((line, i) => {
    const row = rows[startRow + i]
    const values: Record<string, Json> = {}, expected: Record<string, Json> = {}
    line.forEach((cell, j) => {
      const property = columns[startColumn + j]
      if (!property) { plan.dropped++; return }
      if (property.id !== titleId && isReadOnly(property)) { plan.readOnly++; return }
      // An empty cell in the grid empties the one it lands on, as a spreadsheet's does.
      const value = cell.trim() === '' ? null : pastedValue(db, property, cell)
      if (value === undefined) { plan.unconverted++; return }
      values[property.id] = value
      if (row) expected[property.id] = (property.id === titleId ? row.title : rawOf(row, property.id) as Json | undefined) ?? null
      plan.pasted++
    })
    if (row) { if (Object.keys(values).length) plan.items.push({ pageId: row.id, values, expected }) }
    else {
      const { [titleId]: title, ...rest } = values
      plan.newRows.push({ title: typeof title === 'string' ? title : '', values: Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null)) })
    }
  })
  return plan
}
