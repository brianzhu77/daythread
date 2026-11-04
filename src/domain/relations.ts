// Relations and rollups as the layouts read them (design §6, R3-5, R3-7). Nothing here is stored. A relation's options become
// its target's rows, so it reads, sorts and filters as a multi-select does; a rollup becomes a read-only column of the type it
// works out to, with its value on each row, so its cell, sort and filter can't disagree. With neither, this is the workspace.
import { isDatabase, isEmptyValue, propertyOf, titleId, todosSourceId, valueText, type CellValue, type Database, type DateValue, type Json, type Option, type Property, type Rollup, type RollupFunction } from './database.ts'
import { clockIn, formulaShape, isFormula, noteRowErrors, usesClock, WorkedCells, worldOf } from './formula.ts'
import type { Clock } from './formula-functions.ts'
import { withTodos } from './todos-source.ts'
import type { Page, Workspace } from './types.ts'

const shows = (p: Property) => p.type === 'relation' || p.type === 'rollup' || p.type === 'formula'
const dayOf = (v: CellValue): string | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as DateValue).start : null)
const numberOf = (v: CellValue): number | null => (typeof v === 'number' ? v : null)
const median = (list: number[]) => { const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }
const percent = (part: number, all: number) => Math.round((part / all) * 1000) / 10

/** What a function gives: its column's type. */
export function rollupType(fn: RollupFunction): Pick<Property, 'type' | 'format'> {
  if (fn === 'original' || fn === 'unique' || fn === 'dateRange') return { type: 'text' }
  if (fn === 'earliest' || fn === 'latest') return { type: 'date' }
  return { type: 'number', ...(fn.startsWith('percent') ? { format: 'percent' as const } : {}) }
}

/** The functions that mean something for what's read: count and original for any, the rest where our types apply (research §7). */
export function rollupFunctionsFor(type: Property['type'] | 'title'): RollupFunction[] {
  const counts: RollupFunction[] = ['original', 'unique', 'countAll', 'countValues', 'countUnique', 'countEmpty', 'countNotEmpty', 'percentEmpty', 'percentNotEmpty']
  if (type === 'number' || type === 'id') return [...counts, 'sum', 'average', 'median', 'min', 'max', 'range']
  if (type === 'date' || type === 'createdTime' || type === 'editedTime') return [...counts, 'earliest', 'latest', 'dateRange']
  if (type === 'checkbox') return ['original', 'unique', 'countAll', 'checked', 'unchecked', 'percentChecked', 'percentUnchecked']
  return counts
}

function compute(fn: RollupFunction, values: CellValue[], text: (v: CellValue) => string): Json | undefined {
  // "—" when nothing is linked, whatever the function.
  if (!values.length) return undefined
  const filled = values.filter(v => !isEmptyValue(v)), numbers = values.map(numberOf).filter((n): n is number => n !== null)
  const days = values.map(dayOf).filter((d): d is string => d !== null).sort()
  const checked = values.filter(v => v === true).length
  switch (fn) {
    case 'original': { const list = filled.map(text).filter(Boolean); return list.length ? list.join(', ') : undefined }
    case 'unique': { const list = [...new Set(filled.map(text).filter(Boolean))]; return list.length ? list.join(', ') : undefined }
    case 'countAll': return values.length
    case 'countValues': return filled.length
    case 'countUnique': return new Set(filled.map(text)).size
    case 'countEmpty': return values.length - filled.length
    case 'countNotEmpty': return filled.length
    case 'percentEmpty': return percent(values.length - filled.length, values.length)
    case 'percentNotEmpty': return percent(filled.length, values.length)
    case 'sum': return numbers.length ? numbers.reduce((a, b) => a + b, 0) : undefined
    case 'average': return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : undefined
    case 'median': return numbers.length ? median(numbers) : undefined
    case 'min': return numbers.length ? Math.min(...numbers) : undefined
    case 'max': return numbers.length ? Math.max(...numbers) : undefined
    case 'range': return numbers.length ? Math.max(...numbers) - Math.min(...numbers) : undefined
    case 'earliest': return days.length ? { start: days[0]! } : undefined
    case 'latest': return days.length ? { start: days.at(-1)! } : undefined
    case 'dateRange': {
      if (!days.length) return undefined
      const n = Math.round((Date.parse(days.at(-1)!.slice(0, 10)) - Date.parse(days[0]!.slice(0, 10))) / 86_400_000)
      return `${n} day${n === 1 ? '' : 's'}`
    }
    case 'checked': return checked
    case 'unchecked': return values.length - checked
    case 'percentChecked': return percent(checked, values.length)
    case 'percentUnchecked': return percent(values.length - checked, values.length)
  }
}

const projected = new WeakMap<Workspace, { next: Workspace; day: number | null }>()
const localDay = () => { const d = new Date(); return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate() }
/** `clock` is for a reader that isn't this device: the Worker's export, with his zone. */
export function withLinks(ws: Workspace, clock?: Clock): Workspace {
  const known = clock ? undefined : projected.get(ws)
  // today() has to turn over with the day page, with nothing else having changed.
  if (known && (known.day === null || known.day === localDay())) return known.next
  if (!ws.pages.some(p => p.database?.properties.some(shows))) { projected.set(ws, { next: ws, day: null }); return ws }
  const reading = clock ?? clockIn(undefined)
  const byId = new Map(ws.pages.map(p => [p.id, p]))
  const rowsOf = new Map<string, Page[]>()
  const optionsOf = new Map<string, Option[]>()
  const optionsFor = (target: Page): Option[] => {
    let options = optionsOf.get(target.id)
    if (!options) {
      // A target in Trash took its rows with it, and they still read, marked (design §13).
      const rows = ws.pages.filter(p => p.parentId === target.id && p.type === 'document' && (target.trashedAt ? p.trashId === target.trashId : !p.trashedAt))
      rowsOf.set(target.id, rows)
      options = rows.map(r => ({ id: r.id, name: r.title || 'Untitled' }))
      optionsOf.set(target.id, options)
    }
    return options
  }
  // First the relations of every database, as a rollup reads through them; then the rollups, from those.
  const linked = new Map<string, Database>()
  const tasks = withTodos(ws)
  let todoOptions: Option[] | undefined
  const relationShape = (id: string | undefined): Pick<Property, 'options' | 'targetTitle' | 'targetTrashed'> => {
    // To-dos: its rows are his tasks, so a deleted task drops out, and comes back with it (R3-23).
    if (id === todosSourceId) { todoOptions ??= tasks.pages.filter(p => p.parentId === todosSourceId).map(r => ({ id: r.id, name: r.title })); return { options: todoOptions, targetTitle: 'To-dos' } }
    const target = byId.get(id ?? '')
    return { options: target && isDatabase(target) ? optionsFor(target) : [], targetTitle: target?.title || 'Untitled', ...(target?.trashedAt ? { targetTrashed: true as const } : {}) }
  }
  for (const p of ws.pages) {
    if (!isDatabase(p) || !p.database.properties.some(shows)) continue
    linked.set(p.id, { ...p.database, properties: p.database.properties.map(x => {
      return x.type === 'relation' ? { ...x, ...relationShape(x.target) } : x
    }) })
  }
  const world = worldOf(ws)
  const pages = ws.pages.map(page => {
    const database = linked.get(page.id)
    if (!database) return page
    const properties = database.properties.map(x => {
      if (x.type === 'rollup') return { ...x, ...rollupType(x.rollup?.fn ?? 'original'), readOnly: true as const }
      if (x.type !== 'formula') return x
      const shape = formulaShape(world, page.id, x)
      // A formula that gives pages reads as a relation does, and draws its page refs.
      return { ...x, ...shape, ...(shape.target ? relationShape(shape.target) : {}), readOnly: true as const }
    })
    return { ...page, database: { ...database, properties } }
  })
  const next = { ...ws, pages }
  const databases = new Map<string, Database>()
  for (const p of tasks.pages) if (isDatabase(p)) databases.set(p.id, p.database)
  for (const p of pages) if (isDatabase(p)) databases.set(p.id, p.database)
  const allPages = new Map(tasks.pages.map(p => [p.id, p]))
  // Formulas and rollups read each other, across databases, so each is worked out when first asked for.
  const cells: WorkedCells = new WorkedCells({ world, pages: allPages, databases, clock: reading, rollup: (r, row, db) => (r.rollup ? rollupOf(r.rollup, row, db, allPages, databases, cells) : undefined) })
  next.pages = pages.map(row => {
    const db = row.parentId ? databases.get(row.parentId) : undefined
    const worked = db?.properties.filter(p => p.rollup || isFormula(p))
    if (!db || !worked?.length) return row
    const values: Record<string, Json> = { ...row.values }
    const errors: Record<string, string> = {}
    for (const p of worked) {
      const { cell, error } = isFormula(p) ? cells.columnCell(row, db, p) : { cell: cells.rollupColumn(row, db, p), error: undefined }
      if (cell === undefined) delete values[p.id]; else values[p.id] = cell
      if (error) errors[p.id] = error
    }
    const read = { ...row, values }
    if (Object.keys(errors).length) noteRowErrors(read, errors)
    return read
  })
  if (!clock) projected.set(ws, { next, day: usesClock(world) ? localDay() : null })
  return next
}

function rollupOf(rollup: Rollup, row: Page, database: Database, pages: ReadonlyMap<string, Page>, databases: ReadonlyMap<string, Database>, cells: WorkedCells): Json | undefined {
  const relation = propertyOf(database, rollup.relation)
  if (relation?.type !== 'relation') return undefined
  const target = databases.get(relation.target ?? '')
  if (!target) return undefined
  const known = new Set((relation.options ?? []).map(o => o.id))
  const raw = row.values?.[relation.id]
  const linked = (Array.isArray(raw) ? (raw as string[]) : []).filter(id => known.has(id)).map(id => pages.get(id)!).filter(Boolean)
  // A property deleted since reads as nothing there, rather than as a wrong number.
  const source = rollup.property === titleId ? null : propertyOf(target, rollup.property)
  if (rollup.property !== titleId && !source) return undefined
  const read = (r: Page): CellValue => (source ? cells.cell(r, target, source) : r.title || null)
  return compute(rollup.fn, linked.map(read), v => (rollup.property === titleId ? String(v) : valueText(target, rollup.property, v)))
}
