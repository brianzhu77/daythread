// CSV and TSV (docs/design/csv.md): reading and writing the text, and a database's rows as a sheet. Pure: the browser does it all, so
// an export costs the server nothing and an import's preview sends nothing until it's confirmed.
import { cellValue, databaseRows, isDatabase, isReadOnly, propertyOf, rawOf, titleId, validDateText, valueText, viewColumns, viewRows, type Database, type DatabaseChange, type Json, type Option, type Property, type PropertyType, type RowEdit, type View, type ViewContext } from './database.ts'
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
  return { rows: viewRows(ws, databaseId, scope.view, scope.context), columns: viewColumns(page.database, scope.view).map(c => c.property).filter(p => p.type !== 'button' && p.id !== titleId) }
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
  if (isReadOnly(property) || property.type === 'files') return undefined
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

// ---------------------------------------------------------------- import (design §4, §5)
export const maxImportRows = 10_000
/**
 * Every command reads the whole workspace, so what's stored sets what a Worker can hold. About 20,000 ordinary rows, the most that
 * worked with the heap capped at 100 MB. Checked only on imports: typing is never refused (Lead 6934c378).
 */
export const workspaceLimitBytes = 10 * 1024 * 1024
export const workspaceWarnBytes = 8 * 1024 * 1024
const rowOverhead = 150
const inputBytes = (values: unknown) => (values ? JSON.stringify(values).length : 0)
export function workspaceBytes(ws: Pick<Workspace, 'pages'>): number {
  let total = 0
  for (const p of ws.pages) total += rowOverhead + p.title.length + p.document.length + inputBytes(p.values) + inputBytes(p.database)
  return total
}
export type ImportRow = { pageId: string; title: string; values?: Record<string, Json> }
/** Why an import can't be written, or null. The preview and the server ask the same question. */
export function importRefusal(ws: Pick<Workspace, 'pages'>, rows: readonly ImportRow[]): string | null {
  if (rows.length > maxImportRows) return `This file has ${rows.length.toLocaleString('en-US')} rows, and an import takes up to ${maxImportRows.toLocaleString('en-US')}. Nothing was written.`
  const emptyDocument = 80
  const adding = rows.reduce((n, r) => n + rowOverhead + emptyDocument + r.title.length + inputBytes(r.values), 0)
  const after = workspaceBytes(ws) + adding
  if (after <= workspaceLimitBytes) return null
  const mb = (n: number) => (n / 1048576).toFixed(1)
  return `This would make the workspace ${mb(after)} MB, and it can hold about ${mb(workspaceLimitBytes)} MB. Nothing was written.`
}

/** Strict UTF-8 first; GBK is what Excel writes on a Chinese system. The preview shows the words, so a wrong guess shows before anything's written. */
export function decodeCsv(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return new TextDecoder('gb18030').decode(bytes) }
}
/** Comma, or semicolon (European Excel) or tab where one of those fits the first lines better. */
export function detectDelimiter(text: string): string {
  const sample = parseFirstLines(text)
  const score = (d: string) => { const counts = sample.map(l => parseDelimited(l, d)[0]?.length ?? 1); return counts[0]! > 1 && counts.every(c => c === counts[0]) ? counts[0]! : 0 }
  let best = ',', top = score(',')
  for (const d of [';', '\t']) { const s = score(d); if (s > top) { best = d; top = s } }
  return best
}
const parseFirstLines = (text: string) => text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).slice(0, 10)

export type ImportKind = Extract<PropertyType, 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multiSelect' | 'url' | 'email' | 'phone'>
export const importKinds: readonly ImportKind[] = ['text', 'number', 'date', 'checkbox', 'select', 'multiSelect', 'url', 'email', 'phone']
/** Where a column goes: the row's Name, a new property of a kind, an existing property, or nowhere. */
export type ImportTarget = { to: 'name' } | { to: 'new'; kind: ImportKind } | { to: 'existing'; propertyId: string } | { to: 'skip' }
export interface ImportColumn { index: number; header: string; samples: string[]; suggested: ImportKind; target: ImportTarget }
export interface ImportSheet { columns: ImportColumn[]; rows: string[][]; extraCells: number; emptyRows: number }

/** Our export's `'=`, back to `=`. */
const fromSheet = (cell: string) => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell)
const plainNumber = /^-?\d[\d,]*(\.\d+)?$|^-?\.\d+$/
const fold = (s: string) => s.trim().toLocaleLowerCase()
/** What a column's values suggest. `$` and `%` aren't read as numbers, so nothing about them is lost: it stays text, as it was written. */
export function suggestKind(values: readonly string[]): ImportKind {
  const filled = values.map(v => v.trim()).filter(Boolean)
  if (!filled.length) return 'text'
  if (filled.every(v => plainNumber.test(v))) return 'number'
  // A range is what our own export writes, and pastedValue reads it.
  if (filled.every(v => v.split(/\s*→\s*/).every(part => dayFrom(part) !== null))) return 'date'
  if (filled.every(v => /^(yes|no|true|false)$/i.test(v))) return 'checkbox'
  const distinct = new Set(filled.map(fold)).size
  if (filled.length >= 2 && distinct <= 30 && distinct * 2 <= filled.length && filled.every(v => v.length <= 100)) return 'select'
  return 'text'
}
/** The first row is headers. In a merge, a header matching a property's name goes there first. */
export function readSheet(text: string, db: Database | null): ImportSheet {
  const all = parseDelimited(text, detectDelimiter(text))
  const header = all[0] ?? []
  const lines = all.slice(1)
  const rows = lines.filter(l => l.some(c => c.trim()))
  const extraCells = rows.reduce((n, l) => n + l.slice(header.length).filter(c => c.trim()).length, 0)
  let named = header.findIndex(h => /^(name|title|名称|标题|姓名)$/i.test(h.trim()))
  if (named < 0) named = 0
  const taken = new Set<string>()
  const columns = header.map((raw, index): ImportColumn => {
    const name = fromSheet(raw).trim() || `Column ${index + 1}`
    const values = rows.map(l => fromSheet(l[index] ?? ''))
    const suggested = suggestKind(values)
    const samples = values.filter(v => v.trim()).slice(0, 3)
    const match = db?.properties.find(p => fold(p.name) === fold(name) && !isReadOnly(p) && p.type !== 'rollup' && !taken.has(p.id))
    if (match) taken.add(match.id)
    const target: ImportTarget = index === named ? { to: 'name' } : match ? { to: 'existing', propertyId: match.id } : { to: 'new', kind: suggested }
    return { index, header: name, samples, suggested, target }
  })
  return { columns, rows, extraCells, emptyRows: lines.length - rows.length }
}

export interface BadCell { row: number; column: string; value: string }
export interface ImportPlan { changes: DatabaseChange[]; rows: ImportRow[]; bad: BadCell[]; badByColumn: Record<number, number>; skipped: string[] }
/** Options a column needs that its property doesn't have yet. */
function namesIn(kind: PropertyType, cell: string, known: (name: string) => boolean): string[] {
  const whole = cell.trim()
  if (!whole) return []
  if (kind === 'select' || known(whole)) return [whole]
  return whole.split(',').map(x => x.trim()).filter(Boolean)
}
/**
 * What's written, from a sheet and where each column goes. A cell that can't be read leaves its cell empty and is counted and named; a
 * row is never dropped for it. `newId` is passed in so a plan is the same in a test.
 */
export function planImport(sheet: ImportSheet, db: Database | null, newId: () => string): ImportPlan {
  const plan: ImportPlan = { changes: [], rows: [], bad: [], badByColumn: {}, skipped: [] }
  const used = new Set((db?.properties ?? []).map(p => fold(p.name)))
  used.add('name')
  type Reader = { column: ImportColumn; property: Property }
  const readers: Reader[] = []
  let nameColumn: ImportColumn | undefined
  for (const column of sheet.columns) {
    const target = column.target
    if (target.to === 'skip') { plan.skipped.push(column.header); continue }
    if (target.to === 'name') { nameColumn = column; continue }
    if (target.to === 'existing') {
      const property = db?.properties.find(p => p.id === target.propertyId)
      if (property) readers.push({ column, property }); else plan.skipped.push(column.header)
      continue
    }
    let name = column.header
    for (let n = 2; used.has(fold(name)); n++) name = `${column.header} ${n}`
    used.add(fold(name))
    const property: Property = { id: newId(), name, type: target.kind, ...(target.kind === 'select' || target.kind === 'multiSelect' ? { options: [] } : {}) }
    readers.push({ column, property })
    plan.changes.push({ kind: 'addProperty', property: { id: property.id, name, type: target.kind } })
  }
  // Select and Multi-select take the names they meet, kept in order; a Status and a relation only have what's there.
  const grown = new Map<string, Option[]>()
  const fresh = new Set(plan.changes.flatMap(c => (c.kind === 'addProperty' ? [c.property.id] : [])))
  for (const { column, property } of readers) {
    if (property.type !== 'select' && property.type !== 'multiSelect') continue
    const options = [...(property.options ?? [])]
    const has = (name: string) => options.some(o => fold(o.name) === fold(name))
    for (const line of sheet.rows) for (const name of namesIn(property.type, fromSheet(line[column.index] ?? ''), has)) if (!has(name) && options.length < 200) options.push({ id: newId(), name })
    if (options.length !== (property.options ?? []).length) { property.options = options; grown.set(property.id, options) }
  }
  for (const [propertyId, options] of grown) {
    if (fresh.has(propertyId)) { const add = plan.changes.find(c => c.kind === 'addProperty' && c.property.id === propertyId); if (add?.kind === 'addProperty') add.property.options = options }
    else plan.changes.push({ kind: 'updateProperty', propertyId, options })
  }
  const shape: Database = { ...(db ?? ({ views: [] } as unknown as Database)), properties: readers.map(r => r.property) }
  sheet.rows.forEach((line, i) => {
    const values: Record<string, Json> = {}
    for (const { column, property } of readers) {
      const cell = fromSheet(line[column.index] ?? '')
      if (!cell.trim()) continue
      const value = pastedValue(shape, property, cell)
      if (value === undefined) {
        plan.bad.push({ row: i + 2, column: column.header, value: cell.length > 40 ? `${cell.slice(0, 40)}…` : cell })
        plan.badByColumn[column.index] = (plan.badByColumn[column.index] ?? 0) + 1
      } else if (value !== null) values[property.id] = value
    }
    const title = nameColumn ? fromSheet(line[nameColumn.index] ?? '').trim().slice(0, 1000) : ''
    plan.rows.push({ pageId: newId(), title, ...(Object.keys(values).length ? { values } : {}) })
  })
  return plan
}
