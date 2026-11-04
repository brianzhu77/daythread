// Formulas (docs/design/formula.md): what's stored is the text with properties by id, and nothing else. Its type is checked against the
// database before it's saved and again whenever it's read, as a property it reads can change; its value is worked out per row when read.
import { formulaFunctions, FormulaDate, FormulaRowError, FormulaTooLong, format, formatDate, isList, itemOf, notApplicable, unionType, validDateUnit, type Clock, type FormulaFunction, type RunContext, type Value, type ValueType } from './formula-functions.ts'
import { FormulaSyntaxError, parseFormula, rewriteRefs, type FormulaNames, type FormulaNode } from './formula-parse.ts'
import { cellValue, titleId, type CellValue, type Database, type DateValue, type Json, type Property } from './database.ts'
import { rollupType } from './relations.ts'
import type { Page } from './types.ts'

const titleName = 'Name'
/** A view of 100 rows has to stay usable with a formula written to be slow. */
const stepsPerRow = 100_000
/** Once it has run out this often in one go, it's that kind of formula: the rest of the rows say so without paying for it. */
const overrunsAllowed = 3
export const maxLayers = 15

export const isFormula = (p: Property) => p.type === 'formula' || p.formula !== undefined

// ---------------------------------------------------------------- names and ids
function typedNames(db: Database): FormulaNames {
  const ids = new Map<string, string>([[titleName, titleId]])
  for (const p of db.properties) ids.set(p.name, p.id)
  const lower = new Map([...ids].map(([name, id]) => [name.toLocaleLowerCase(), id]))
  return { names: [...ids.keys()], stored: false, idOf: name => ids.get(name) ?? lower.get(name.toLocaleLowerCase()) ?? null }
}
const storedNames: FormulaNames = { names: [], stored: true, idOf: () => null }
const quoted = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The text as it's kept. Throws what's wrong with it, if the syntax is. */
export function storedFormula(typed: string, db: Database): string {
  const { refs } = parseFormula(typed, typedNames(db))
  return rewriteRefs(typed, refs, id => `prop(${quoted(id)})`)
}
/** The text as he reads it: names as they are now. */
export function shownFormula(stored: string, db: Database): string {
  try {
    const { refs } = parseFormula(stored, storedNames)
    return rewriteRefs(stored, refs, id => {
      const name = id === titleId ? titleName : db.properties.find(p => p.id === id)?.name
      return `prop(${quoted(name ?? 'Deleted property')})`
    })
  } catch { return stored }
}

// ---------------------------------------------------------------- checking
export interface FormulaProgram {
  tree: FormulaNode | null
  type: ValueType
  error?: string
  /** Formulas and rollups this one goes through, itself included. */
  layers: number
  usesClock: boolean
}
const wordFor = (t: ValueType) => (t === 'number' ? 'a number' : t === 'text' ? 'text' : t === 'boolean' ? 'true or false' : t === 'date' ? 'a date' : isList(t) ? 'a list' : 'a value')
class CheckError extends Error {}

function propertyType(p: Property, read: (p: Property) => ValueType): ValueType {
  if (isFormula(p)) return read(p)
  const type = p.rollup ? rollupType(p.rollup.fn).type : p.type
  switch (type) {
    case 'number': return 'number'
    case 'checkbox': return 'boolean'
    case 'date': case 'createdTime': case 'editedTime': return 'date'
    case 'multiSelect': case 'relation': return 'list:text'
    default: return 'text'
  }
}
const parsedTakes = new Map<string, Array<{ types: string[]; optional: boolean; rest: boolean }>>()
function takesOf(fn: FormulaFunction) {
  let takes = parsedTakes.get(fn.takes)
  if (!takes) {
    takes = fn.takes.split(' ').filter(Boolean).map(word => {
      const rest = word.endsWith('...'), optional = word.endsWith('?') || rest
      return { types: word.replace(/\.\.\.$|\?$/, '').split('|'), optional, rest }
    })
    parsedTakes.set(fn.takes, takes)
  }
  return takes
}
function accepts(wanted: string, t: ValueType): boolean {
  if (wanted === 'any' || t === 'any' || t === 'empty') return true
  if (wanted === 'list') return isList(t)
  // A number or a date reads as text where text is wanted, as `"Score: " + 5` does.
  if (wanted === 'text') return !isList(t)
  return wanted === t
}
const comparisons = new Set(['gt', 'gte', 'lt', 'lte'])

function checkCall(node: Extract<FormulaNode, { k: 'call' }>, typeOf: (n: FormulaNode, vars: ReadonlyMap<string, ValueType>) => ValueType, vars: ReadonlyMap<string, ValueType>): ValueType {
  if (notApplicable[node.fn]) throw new CheckError(notApplicable[node.fn])
  const fn = formulaFunctions.get(node.fn)
  if (!fn) throw new CheckError(`There's no function called "${node.fn}"`)
  const takes = takesOf(fn), required = takes.filter(t => !t.optional).length, rest = takes.some(t => t.rest)
  if (node.args.length < required || (!rest && node.args.length > takes.length)) {
    const count = rest ? `at least ${required}` : required === takes.length ? String(required) : `${required} to ${takes.length}`
    throw new CheckError(`${node.fn} takes ${count} value${count === '1' ? '' : 's'}, and got ${node.args.length}`)
  }
  const types: ValueType[] = []
  node.args.forEach((arg, i) => {
    const inner = fn.each && i === 1 ? new Map([...vars, ['current', itemOf(types[0]!)], ['index', 'number']]) : vars
    const t = typeOf(arg, inner)
    types.push(t)
    const wanted = (takes[i] ?? takes.at(-1)!).types
    if (!wanted.some(w => accepts(w, t))) throw new CheckError(`${node.fn} expects ${wanted.map(wordFor).join(' or ')} there, not ${wordFor(t)}`)
  })
  if (comparisons.has(node.fn)) {
    const [a, b] = types as [ValueType, ValueType]
    if (a !== b && a !== 'any' && b !== 'any' && a !== 'empty' && b !== 'empty') throw new CheckError(`Can't compare ${wordFor(a)} with ${wordFor(b)}`)
  }
  if (node.fn.startsWith('date') && (node.fn === 'dateAdd' || node.fn === 'dateSubtract' || node.fn === 'dateBetween')) {
    const unit = node.args[2]
    if (unit?.k === 'lit' && (typeof unit.v !== 'string' || !validDateUnit(unit.v))) throw new CheckError(`"${String(unit.v)}" isn't a unit of time`)
  }
  return typeof fn.gives === 'function' ? fn.gives(types) : fn.gives
}

const programs = new WeakMap<Database, Map<string, FormulaProgram>>()
/**
 * A property's formula checked against its database, stored or as read: its type follows the formulas and rollups it reads.
 * Kept per database, whichever path reached it: something that reaches a loop reaches it by any path, and the rest don't depend on one.
 */
export function programOf(db: Database, p: Property, through: readonly string[] = []): FormulaProgram {
  let known = programs.get(db)
  if (!known) { known = new Map(); programs.set(db, known) }
  let program = known.get(p.id)
  if (!program) {
    program = compile(p.formula ?? '', db, [...through, p.id])
    known.set(p.id, program)
  }
  return program
}
function compile(stored: string, db: Database, through: readonly string[]): FormulaProgram {
  const failed = (error: string): FormulaProgram => ({ tree: null, type: 'any', error, layers: 1, usesClock: false })
  let tree: FormulaNode | null
  try { tree = parseFormula(stored, storedNames).tree } catch (error) {
    if (error instanceof FormulaSyntaxError) return failed(error.message)
    throw error
  }
  if (!tree) return { tree: null, type: 'empty', layers: 1, usesClock: false }
  let layers = 1, usesClock = false
  const readProperty = (id: string): ValueType => {
    if (id === titleId) return 'text'
    const p = db.properties.find(x => x.id === id)
    if (!p) throw new CheckError('A property this formula reads was deleted')
    if (p.rollup) layers = Math.max(layers, 2)
    return propertyType(p, f => {
      if (through.includes(f.id)) throw new CheckError('Cycle detected')
      const inner = programOf(db, f, through)
      if (inner.error) throw new CheckError(inner.error === 'Cycle detected' ? inner.error : `${f.name} has an error: ${inner.error}`)
      layers = Math.max(layers, inner.layers + 1)
      usesClock ||= inner.usesClock
      return inner.type
    })
  }
  const typeOf = (node: FormulaNode, vars: ReadonlyMap<string, ValueType>): ValueType => {
    switch (node.k) {
      case 'lit': return typeof node.v === 'number' ? 'number' : typeof node.v === 'string' ? 'text' : 'boolean'
      case 'list': return `list:${node.items.map(i => typeOf(i, vars)).reduce(unionType, 'empty')}`
      case 'prop': return readProperty(node.id)
      case 'var': return vars.get(node.name) ?? 'any'
      case 'let': return typeOf(node.body, new Map([...vars, [node.name, typeOf(node.value, vars)]]))
      case 'call':
        usesClock ||= Boolean(formulaFunctions.get(node.fn)?.usesClock)
        return checkCall(node, typeOf, vars)
    }
  }
  try {
    const type = typeOf(tree, new Map())
    if (layers > maxLayers) return failed(`This goes through more than ${maxLayers} formulas and rollups`)
    return { tree, type, layers, usesClock }
  } catch (error) {
    if (error instanceof CheckError) return failed(error.message)
    throw error
  }
}

/** What the field says while typing: what's wrong, or what it'll be saved as and what kind of value it gives. */
export function checkTyped(typed: string, db: Database, propertyId: string): { stored: string; type: ValueType } | { error: string } {
  let stored: string
  try { stored = storedFormula(typed, db) } catch (error) {
    if (error instanceof FormulaSyntaxError) return { error: error.message }
    throw error
  }
  const trial = withFormula(db, propertyId, stored)
  const program = programOf(trial, trial.properties.find(p => p.id === propertyId)!)
  return program.error ? { error: program.error } : { stored, type: program.type }
}
/** The database as it would be with this formula in place, so a loop through this property shows. */
function withFormula(db: Database, propertyId: string, stored: string): Database {
  const here = db.properties.some(p => p.id === propertyId)
  return { ...db, properties: here ? db.properties.map(p => (p.id === propertyId ? { ...p, formula: stored } : p)) : [...db.properties, { id: propertyId, name: '', type: 'formula', formula: stored }] }
}
/** Refused at Done, on the server as in the field: no text that doesn't work replaces one that does (design §4). */
export function formulaProblem(stored: string, db: Database, propertyId: string): string | null {
  const trial = withFormula(db, propertyId, stored)
  return programOf(trial, trial.properties.find(p => p.id === propertyId)!).error ?? null
}

// ---------------------------------------------------------------- the clock
const wallFormats = new Map<string, Intl.DateTimeFormat>()
function wallFormat(zone: string | undefined): Intl.DateTimeFormat {
  const key = zone ?? ''
  let found = wallFormats.get(key)
  if (!found) {
    const fields = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' } as const
    try { found = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: zone }) } catch { found = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: 'UTC' }) }
    wallFormats.set(key, found)
  }
  return found
}
/** Reading in a zone; with none, this device's, which is the clock the day pages use (design §6). */
export function clockIn(zone: string | undefined, nowMs = Date.now()): Clock {
  const format = wallFormat(zone)
  const wall = (instant: number) => {
    const part: Record<string, number> = {}
    for (const { type, value } of format.formatToParts(instant)) part[type] = Number(value)
    return Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!) + (((instant % 1000) + 1000) % 1000)
  }
  // The offset depends on the instant being looked for, so a second look settles it around a change of clocks.
  const instant = (at: number) => { const guess = at - (wall(at) - at); return at - (wall(guess) - guess) }
  return { now: wall(nowMs), wall, instant }
}

// ---------------------------------------------------------------- running
type Vars = { name: string; value: Value; next: Vars } | null
interface Run extends RunContext { read(id: string): Value }

function evaluate(node: FormulaNode, vars: Vars, run: Run): Value {
  run.spend(1)
  switch (node.k) {
    case 'lit': return node.v
    case 'list': return node.items.map(i => evaluate(i, vars, run))
    case 'prop': return run.read(node.id)
    case 'var': { for (let v = vars; v; v = v.next) if (v.name === node.name) return v.value; return null }
    case 'let': return evaluate(node.body, { name: node.name, value: evaluate(node.value, vars, run), next: vars }, run)
    case 'call': {
      const result = call(formulaFunctions.get(node.fn)!, node.args, vars, run)
      return result === 0 ? 0 : result
    }
  }
}
function call(fn: FormulaFunction, args: FormulaNode[], vars: Vars, run: Run): Value {
  if (fn.lazy) return fn.lazy(args.map(a => () => evaluate(a, vars, run)), run)
  if (fn.each) {
    const list = coerce(evaluate(args[0]!, vars, run), ['list'])
    const body = args[1]!
    return fn.each(list as Value[], (item, index) => {
      run.spend(1)
      return evaluate(body, { name: 'current', value: item, next: { name: 'index', value: index, next: vars } }, run)
    }, run)
  }
  const takes = takesOf(fn), values: Value[] = []
  for (let i = 0; i < args.length; i++) {
    const wanted = (takes[i] ?? takes.at(-1)!).types
    const value = coerce(evaluate(args[i]!, vars, run), wanted)
    // An empty date in `dateAdd`: that cell reads empty (design §5).
    if (value === undefined) return null
    values.push(value)
  }
  return fn.run!(values, run)
}
/** The value as this argument wants it; undefined if it's empty where nothing can stand in for it. */
function coerce(value: Value, wanted: string[]): Value | undefined {
  if (wanted.includes('any')) return value
  if (value === null) {
    if (wanted.includes('text')) return ''
    if (wanted.includes('list')) return wanted.includes('number') ? null : []
    if (wanted.includes('boolean')) return false
    return undefined
  }
  if (Array.isArray(value)) { if (wanted.includes('list')) return value }
  else if (typeof value === 'number') { if (wanted.includes('number') || wanted.includes('text')) return wanted.includes('number') ? value : format(value) }
  else if (typeof value === 'boolean') { if (wanted.includes('boolean')) return value; if (wanted.includes('text')) return format(value) }
  else if (typeof value === 'string') { if (wanted.includes('text')) return value }
  else { if (wanted.includes('date')) return value; if (wanted.includes('text')) return format(value) }
  throw new FormulaRowError(`Expected ${wanted.map(wordFor).join(' or ')} here`)
}

const fromDateText = (text: string) => Date.parse(text.length > 10 ? `${text}Z` : `${text}T00:00Z`)
function dateFrom(value: DateValue): FormulaDate {
  return new FormulaDate(fromDateText(value.start), value.start.length > 10, value.end ? fromDateText(value.end) : undefined)
}
function fromCell(p: Property | null, value: CellValue): Value {
  if (value === null) return null
  const nameOf = (id: string) => p?.options?.find(o => o.id === id)?.name ?? ''
  switch (p?.type) {
    case 'select': case 'status': return nameOf(String(value))
    case 'multiSelect': case 'relation': return (value as string[]).map(nameOf)
    case 'id': return `${p.prefix ?? ''}${String(value)}`
    default: return typeof value === 'object' && !Array.isArray(value) ? dateFrom(value) : (value as Value)
  }
}
const dateText = (wall: number, timed: boolean) => formatDate(wall, timed ? 'YYYY-MM-DD[T]HH:mm' : 'YYYY-MM-DD')
/** What the cell holds, in the column's type, so a filter, a sort and a sum read what it shows. */
function toCell(value: Value, type: ValueType): Json | undefined {
  if (value === null) return undefined
  if (type === 'boolean') return value === true ? true : undefined
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  if (type === 'date' && value instanceof FormulaDate) {
    const start = dateText(value.start, value.timed)
    return value.end === undefined ? start : { start, end: dateText(value.end, value.timed) }
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  return format(value) || undefined
}
export function formulaShape(db: Database, p: Property): Pick<Property, 'type' | 'formulaError' | 'withTime'> {
  const program = programOf(db, p)
  if (program.error) return { type: 'text', formulaError: program.error }
  return { type: program.type === 'number' ? 'number' : program.type === 'boolean' ? 'checkbox' : program.type === 'date' ? 'date' : 'text' }
}

const rowErrors = new WeakMap<Page, Record<string, string>>()
/** Why this row's cell reads Error, when it does: a formula that can't be read at all says so on the column. */
export const formulaErrorOf = (row: Page | undefined, p: Property): string | null =>
  p.formulaError ?? (row ? rowErrors.get(row)?.[p.id] ?? null : null)
export const tooLongError = 'Too long'

export interface FormulaRun { worked: Map<string, Value>; errors: Record<string, string> }
/** One row's formulas. `db` is the database as read, so a rollup a formula reads is already its result. */
export function runRow(db: Database, formulas: readonly Property[], row: Page, clock: Clock): FormulaRun {
  const worked = new Map<string, Value>(), errors: Record<string, string> = {}
  let left = stepsPerRow
  const spend = (steps: number) => { left -= steps; if (left < 0) throw new FormulaTooLong() }
  const inProgress = new Set<string>()
  const runOne = (p: Property): Value => {
    if (worked.has(p.id)) return worked.get(p.id)!
    if (errors[p.id]) throw new FormulaRowError(`${p.name} has an error`)
    if (inProgress.has(p.id)) throw new FormulaRowError('Cycle detected')
    const program = programOf(db, p)
    if (program.error) throw new FormulaRowError(program.error)
    inProgress.add(p.id)
    try {
      const value = program.tree ? evaluate(program.tree, null, { rowId: row.id, spend, clock, read }) : null
      worked.set(p.id, value)
      return value
    } catch (error) {
      errors[p.id] = error instanceof FormulaTooLong ? tooLongError : error instanceof FormulaRowError ? error.message : String(error)
      throw error
    } finally { inProgress.delete(p.id) }
  }
  const read = (id: string): Value => {
    if (id === titleId) return row.title || null
    const p = db.properties.find(x => x.id === id)
    if (!p) throw new FormulaRowError('A property this formula reads was deleted')
    return isFormula(p) ? runOne(p) : fromCell(p, cellValue(db, row, id))
  }
  for (const p of formulas) {
    try { runOne(p) } catch (error) { if (!(error instanceof FormulaRowError || error instanceof FormulaTooLong)) throw error }
  }
  return { worked, errors }
}

/** Every row's formulas, written into its `values` as read. Stored values under these ids (from before a type change) are left alone in the store and not read here. */
export function workFormulas(db: Database, formulas: readonly Property[], rows: Page[], clock: Clock): Page[] {
  const usable = formulas.filter(p => !p.formulaError)
  const overran = new Map<string, number>()
  return rows.map(row => {
    const stopped = usable.filter(p => (overran.get(p.id) ?? 0) >= overrunsAllowed)
    const running = stopped.length ? usable.filter(p => !stopped.includes(p)) : usable
    const { worked, errors } = runRow(db, running, row, clock)
    const values: Record<string, Json> = { ...row.values }
    for (const p of formulas) {
      const cell = worked.has(p.id) ? toCell(worked.get(p.id)!, programOf(db, p).type) : undefined
      if (cell === undefined) delete values[p.id]; else values[p.id] = cell
    }
    for (const p of stopped) errors[p.id] = tooLongError
    for (const [id, message] of Object.entries(errors)) if (message === tooLongError) overran.set(id, (overran.get(id) ?? 0) + 1)
    const next = { ...row, values }
    if (Object.keys(errors).length) rowErrors.set(next, errors)
    return next
  })
}

/** A live preview: this row, this text, before it's saved. */
export function previewFormula(stored: string, db: Database, propertyId: string, row: Page, clock: Clock): { text: string } | { error: string } {
  const trial = withFormula(db, propertyId, stored)
  const property = trial.properties.find(p => p.id === propertyId)!
  const { worked, errors } = runRow(trial, [property], row, clock)
  if (errors[propertyId]) return { error: errors[propertyId]! }
  const value = worked.get(propertyId) ?? null
  return { text: typeof value === 'number' && !Number.isFinite(value) ? '' : format(value) }
}

export function usesClock(db: Database): boolean {
  return db.properties.some(p => isFormula(p) && programOf(db, p).usesClock)
}
