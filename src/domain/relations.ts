// Relations and rollups as the layouts read them (design §6, R3-5, R3-7). Nothing here is stored. A relation's options become
// its target's rows, so it reads, sorts and filters as a multi-select does; a rollup becomes a read-only column of the type it
// works out to, with its value on each row, so its cell, sort and filter can't disagree. With neither, this is the workspace.
import { cellValue, isDatabase, isEmptyValue, propertyOf, titleId, valueText, type CellValue, type Database, type DateValue, type Json, type Option, type Property, type Rollup, type RollupFunction } from './database.ts'
import type { Page, Workspace } from './types.ts'

const shows = (p: Property) => p.type === 'relation' || p.type === 'rollup'
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

const projected = new WeakMap<Workspace, Workspace>()
export function withLinks(ws: Workspace): Workspace {
  const known = projected.get(ws)
  if (known) return known
  if (!ws.pages.some(p => p.database?.properties.some(shows))) { projected.set(ws, ws); return ws }
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
  for (const p of ws.pages) {
    if (!isDatabase(p) || !p.database.properties.some(shows)) continue
    linked.set(p.id, { ...p.database, properties: p.database.properties.map(x => {
      if (x.type !== 'relation') return x
      const target = byId.get(x.target ?? '')
      return { ...x, options: target && isDatabase(target) ? optionsFor(target) : [], targetTitle: target?.title || 'Untitled', ...(target?.trashedAt ? { targetTrashed: true as const } : {}) }
    }) })
  }
  const pages = ws.pages.map(page => {
    const database = linked.get(page.id)
    if (database) {
      const rollups = database.properties.filter(x => x.type === 'rollup')
      return { ...page, database: { ...database, properties: database.properties.map(x => (x.type === 'rollup' ? { ...x, ...rollupType(x.rollup?.fn ?? 'original'), readOnly: true as const } : x)) }, _rollups: rollups }
    }
    return page
  })
  const next = { ...ws, pages: pages.map(({ _rollups, ...page }: Page & { _rollups?: Property[] }) => page as Page) }
  const finalById = new Map(next.pages.map(p => [p.id, p]))
  const rollupsByDb = new Map(pages.flatMap(p => { const r = (p as Page & { _rollups?: Property[] })._rollups; return r?.length ? [[p.id, r] as const] : [] }))
  if (rollupsByDb.size) {
    next.pages = next.pages.map(row => {
      const rollups = row.parentId ? rollupsByDb.get(row.parentId) : undefined
      if (!rollups) return row
      const values: Record<string, Json> = { ...row.values }
      const database = finalById.get(row.parentId!)!.database!
      for (const r of rollups) {
        const worked = r.rollup ? rollupOf(r.rollup, row, database, finalById) : undefined
        if (worked === undefined) delete values[r.id]; else values[r.id] = worked
      }
      return { ...row, values }
    })
  }
  projected.set(ws, next)
  return next
}

function rollupOf(rollup: Rollup, row: Page, database: Database, pages: ReadonlyMap<string, Page>): Json | undefined {
  const relation = propertyOf(database, rollup.relation)
  if (relation?.type !== 'relation') return undefined
  const target = pages.get(relation.target ?? '')
  if (!isDatabase(target)) return undefined
  const known = new Set((relation.options ?? []).map(o => o.id))
  const raw = row.values?.[relation.id]
  const linked = (Array.isArray(raw) ? (raw as string[]) : []).filter(id => known.has(id)).map(id => pages.get(id)!).filter(Boolean)
  // A property deleted since reads as nothing there, rather than as a wrong number.
  if (rollup.property !== titleId && !propertyOf(target.database, rollup.property)) return undefined
  const read = (r: Page): CellValue => (rollup.property === titleId ? r.title || null : cellValue(target.database, r, rollup.property))
  return compute(rollup.fn, linked.map(read), v => (rollup.property === titleId ? String(v) : valueText(target.database, rollup.property, v)))
}

