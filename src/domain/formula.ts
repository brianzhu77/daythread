// Formulas (docs/design/formula.md): what's stored is the text with properties by id, and nothing else. Its type is checked against the
// databases it reads before it's saved and again whenever it's read, as a property it reads can change; its value is worked out per row when read.
import { formulaFunctions, FormulaDate, FormulaPage, FormulaRowError, FormulaTooLong, format, formatDate, isList, itemOf, notApplicable, pageTarget, unionType, validDateUnit, type Clock, type FormulaFunction, type RunContext, type Value, type ValueType } from './formula-functions.ts'
import { FormulaSyntaxError, parseFormula, rewriteRefs, type FormulaNames, type FormulaNode, type PropRef } from './formula-parse.ts'
import { cellValue, isDatabase, readValue, titleId, type CellValue, type Database, type DateValue, type Json, type Property } from './database.ts'
import { rollupType } from './relations.ts'
import { withTodos } from './todos-source.ts'
import type { Page, Workspace } from './types.ts'

const titleName = 'Name'
/** A view of 100 rows has to stay usable with a formula written to be slow. */
const stepsPerRow = 100_000
/** Once it has run out this often in one go, it's that kind of formula: the rest of the rows say so without paying for it. */
const overrunsAllowed = 3
export const maxLayers = 15
export const tooLongError = 'Too long'

export const isFormula = (p: Property) => p.type === 'formula' || p.formula !== undefined

// ---------------------------------------------------------------- the databases a formula can read
export interface FormulaWorld { databases: ReadonlyMap<string, Database>; programs: Map<string, FormulaProgram> }
const worlds = new WeakMap<Workspace, FormulaWorld>()
/** Every database, To-dos included, as stored. One per workspace, so a change anywhere checks every formula again. */
export function worldOf(ws: Workspace): FormulaWorld {
  let world = worlds.get(ws)
  if (!world) {
    const databases = new Map<string, Database>()
    for (const p of withTodos(ws).pages) if (isDatabase(p)) databases.set(p.id, p.database)
    world = { databases, programs: new Map() }
    worlds.set(ws, world)
  }
  return world
}
/** The world as it would be with this property changed, so a loop through it shows. */
function trialWorld(world: FormulaWorld, databaseId: string, property: Property): FormulaWorld {
  const db = world.databases.get(databaseId) ?? { properties: [] } as unknown as Database
  const here = db.properties.some(p => p.id === property.id)
  const databases = new Map(world.databases)
  databases.set(databaseId, { ...db, properties: here ? db.properties.map(p => (p.id === property.id ? property : p)) : [...db.properties, property] })
  return { databases, programs: new Map() }
}
const withText = (world: FormulaWorld, databaseId: string, propertyId: string, stored: string) => {
  const old = world.databases.get(databaseId)?.properties.find(p => p.id === propertyId)
  return trialWorld(world, databaseId, { ...(old ?? { id: propertyId, name: '', type: 'formula' }), formula: stored })
}

// ---------------------------------------------------------------- names and ids
function typedNames(world: FormulaWorld, databaseId: string): FormulaNames {
  const ids = new Map<string, string>([[titleName, titleId]])
  for (const p of world.databases.get(databaseId)?.properties ?? []) ids.set(p.name, p.id)
  const lower = new Map([...ids].map(([name, id]) => [name.toLocaleLowerCase(), id]))
  const elsewhere = new Set<string>([titleName])
  for (const db of world.databases.values()) for (const p of db.properties) elsewhere.add(p.name)
  return { names: [...ids.keys()], memberNames: [...elsewhere], stored: false, idOf: name => ids.get(name) ?? lower.get(name.toLocaleLowerCase()) ?? null }
}
const storedNames: FormulaNames = { names: [], memberNames: [], stored: true, idOf: () => null }
const quoted = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const propertyIn = (db: Database | undefined, id: string) => (id === titleId ? { id: titleId, name: titleName, type: 'text' as const } : db?.properties.find(p => p.id === id))

// ---------------------------------------------------------------- checking
export interface FormulaProgram {
  tree: FormulaNode | null
  type: ValueType
  error?: string
  /** Formulas and rollups this one goes through, itself included. */
  layers: number
  usesClock: boolean
}
const wordFor = (t: ValueType) => (t === 'number' ? 'a number' : t === 'text' ? 'text' : t === 'boolean' ? 'true or false' : t === 'date' ? 'a date' : t.startsWith('page') ? 'a page' : isList(t) ? 'a list' : 'a value')
class CheckError extends Error {}

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
  if (wanted === 'page') return t.startsWith('page')
  // A number or a date reads as text where text is wanted, as `"Score: " + 5` does, and a page as its title.
  if (wanted === 'text') return !isList(t)
  return wanted === t
}
const comparisons = new Set(['gt', 'gte', 'lt', 'lte'])
const sameKind = (a: ValueType, b: ValueType) => a === b || (a.startsWith('page') && b.startsWith('page'))

/** One formula's check: types its tree, resolves `.x`, and notes what it reads. */
class Checker {
  layers = 1
  usesClock = false
  readonly memberRefs: PropRef[] = []
  private readonly typed = new Map<FormulaNode, ValueType>()
  private readonly world: FormulaWorld
  private readonly databaseId: string
  private readonly through: readonly string[]
  private readonly byName: boolean
  constructor(world: FormulaWorld, databaseId: string, through: readonly string[], byName: boolean) {
    this.world = world
    this.databaseId = databaseId
    this.through = through
    this.byName = byName
  }
  typeOf(node: FormulaNode, vars: ReadonlyMap<string, ValueType>): ValueType {
    let t = this.typed.get(node)
    if (t === undefined) { t = this.work(node, vars); this.typed.set(node, t) }
    return t
  }
  private work(node: FormulaNode, vars: ReadonlyMap<string, ValueType>): ValueType {
    switch (node.k) {
      case 'lit': return typeof node.v === 'number' ? 'number' : typeof node.v === 'string' ? 'text' : 'boolean'
      case 'list': return `list:${node.items.map(i => this.typeOf(i, vars)).reduce(unionType, 'empty')}`
      case 'prop': return this.readProperty(this.databaseId, node.id)
      case 'var': return vars.get(node.name) ?? 'any'
      case 'let': return this.typeOf(node.body, new Map([...vars, [node.name, this.typeOf(node.value, vars)]]))
      case 'call':
        this.usesClock ||= Boolean(formulaFunctions.get(node.fn)?.usesClock)
        return this.checkCall(node, vars)
      case 'member': return this.checkMember(node, vars)
    }
  }
  private checkMember(node: Extract<FormulaNode, { k: 'member' }>, vars: ReadonlyMap<string, ValueType>): ValueType {
    const object = this.typeOf(node.object, vars), target = pageTarget(object)
    if (target !== null && node.args === null) {
      const db = this.world.databases.get(target)
      const found = this.byName ? (node.name === titleName ? propertyIn(db, titleId) : db?.properties.find(p => p.name === node.name)) : propertyIn(db, node.name)
      if (found) {
        node.reads = found.id
        if (node.ref) this.memberRefs.push({ ...node.ref, id: found.id })
        const t = this.readProperty(target, found.id)
        if (!isList(object)) return t
        return isList(t) ? t : `list:${t}`
      }
      if (node.byProp) throw new CheckError(this.byName ? `There's no property called "${node.name}" there` : 'A property this formula reads was deleted')
    }
    if (node.byProp) throw new CheckError('prop after a dot reads a page')
    node.asCall = { k: 'call', fn: node.name, args: [node.object, ...(node.args ?? [])] }
    return this.typeOf(node.asCall, vars)
  }
  private checkCall(node: Extract<FormulaNode, { k: 'call' }>, vars: ReadonlyMap<string, ValueType>): ValueType {
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
      const t = this.typeOf(arg, inner)
      types.push(t)
      const wanted = (takes[i] ?? takes.at(-1)!).types
      if (!wanted.some(w => accepts(w, t))) throw new CheckError(`${node.fn} expects ${wanted.map(wordFor).join(' or ')} there, not ${wordFor(t)}`)
    })
    if (comparisons.has(node.fn)) {
      const [a, b] = types as [ValueType, ValueType]
      if (!sameKind(a, b) && a !== 'any' && b !== 'any' && a !== 'empty' && b !== 'empty') throw new CheckError(`Can't compare ${wordFor(a)} with ${wordFor(b)}`)
    }
    if (node.fn === 'dateAdd' || node.fn === 'dateSubtract' || node.fn === 'dateBetween') {
      const unit = node.args[2]
      if (unit?.k === 'lit' && (typeof unit.v !== 'string' || !validDateUnit(unit.v))) throw new CheckError(`"${String(unit.v)}" isn't a unit of time`)
    }
    return typeof fn.gives === 'function' ? fn.gives(types) : fn.gives
  }
  private readFormula(databaseId: string, f: Property): ValueType {
    const inner = programOf(this.world, databaseId, f.id, this.through)
    if (inner.error) throw new CheckError(inner.error === 'Cycle detected' ? inner.error : `${f.name} has an error: ${inner.error}`)
    this.layers = Math.max(this.layers, inner.layers + 1)
    this.usesClock ||= inner.usesClock
    return inner.type
  }
  private readRollup(databaseId: string, r: Property): ValueType {
    this.layers = Math.max(this.layers, 2)
    const { source, sourceIn } = rollupSource(this.world, databaseId, r)
    if (source && isFormula(source)) {
      this.readFormula(sourceIn!, source)
      this.layers += 1
    }
    return plainType(rollupType(r.rollup!.fn).type)
  }
  private readProperty(databaseId: string, id: string): ValueType {
    if (id === titleId) return 'text'
    const p = this.world.databases.get(databaseId)?.properties.find(x => x.id === id)
    if (!p) throw new CheckError('A property this formula reads was deleted')
    if (isFormula(p)) return this.readFormula(databaseId, p)
    if (p.rollup) return this.readRollup(databaseId, p)
    if (p.type === 'relation') return `list:page:${p.target}`
    return plainType(p.type)
  }
}
function plainType(type: Property['type']): ValueType {
  switch (type) {
    case 'number': return 'number'
    case 'checkbox': return 'boolean'
    case 'date': case 'createdTime': case 'editedTime': return 'date'
    case 'multiSelect': return 'list:text'
    default: return 'text'
  }
}
function rollupSource(world: FormulaWorld, databaseId: string, r: Property): { source?: Property; sourceIn?: string } {
  const through = world.databases.get(databaseId)?.properties.find(p => p.id === r.rollup?.relation)
  const sourceIn = through?.target
  const source = sourceIn ? world.databases.get(sourceIn)?.properties.find(p => p.id === r.rollup!.property) : undefined
  return { ...(source ? { source } : {}), ...(sourceIn ? { sourceIn } : {}) }
}

const failedProgram = (error: string): FormulaProgram => ({ tree: null, type: 'any', error, layers: 1, usesClock: false })
/**
 * A property's formula, checked, its type following the formulas and rollups it reads. Kept with the world, whichever path reached
 * it: something that reaches a loop reaches it by any path, and the rest don't depend on one.
 */
export function programOf(world: FormulaWorld, databaseId: string, propertyId: string, through: readonly string[] = []): FormulaProgram {
  const key = `${databaseId}\0${propertyId}`
  let program = world.programs.get(key)
  if (program) return program
  if (through.includes(key)) return failedProgram('Cycle detected')
  const p = world.databases.get(databaseId)?.properties.find(x => x.id === propertyId)
  program = compile(p?.formula ?? '', world, databaseId, [...through, key])
  world.programs.set(key, program)
  return program
}
function compile(stored: string, world: FormulaWorld, databaseId: string, through: readonly string[]): FormulaProgram {
  let tree: FormulaNode | null
  try { tree = parseFormula(stored, storedNames).tree } catch (error) {
    if (error instanceof FormulaSyntaxError) return failedProgram(error.message)
    throw error
  }
  if (!tree) return { tree: null, type: 'empty', layers: 1, usesClock: false }
  const checker = new Checker(world, databaseId, through, false)
  try {
    const type = checker.typeOf(tree, new Map())
    if (checker.layers > maxLayers) return failedProgram(`This goes through more than ${maxLayers} formulas and rollups`)
    return { tree, type, layers: checker.layers, usesClock: checker.usesClock }
  } catch (error) {
    if (error instanceof CheckError) return failedProgram(error.message)
    throw error
  }
}

/** The text as it's kept. Throws what's wrong with it, if the syntax or a type is. */
export function storedFormula(typed: string, world: FormulaWorld, databaseId: string): string {
  const { tree, refs } = parseFormula(typed, typedNames(world, databaseId))
  if (!tree) return typed
  const checker = new Checker(world, databaseId, [], true)
  try { checker.typeOf(tree, new Map()) } catch (error) {
    if (error instanceof CheckError) throw new FormulaSyntaxError(error.message)
    throw error
  }
  return rewriteRefs(typed, [...refs, ...checker.memberRefs], id => `prop(${quoted(id)})`)
}
/** The text as he reads it: names as they are now. */
export function shownFormula(stored: string, world: FormulaWorld, databaseId: string): string {
  try {
    const { tree, refs } = parseFormula(stored, storedNames)
    const here = world.databases.get(databaseId)
    const members: PropRef[] = []
    const walk = (node: FormulaNode | null | undefined): void => {
      if (!node) return
      if (node.k === 'list') node.items.forEach(walk)
      else if (node.k === 'call') node.args.forEach(walk)
      else if (node.k === 'let') { walk(node.value); walk(node.body) }
      else if (node.k === 'member') { if (node.ref) members.push({ ...node.ref, id: node.name }); walk(node.object); node.args?.forEach(walk) }
    }
    walk(tree)
    const memberIds = new Set(members.map(m => m.from))
    const nameOf = (id: string, db: Database | undefined) => propertyIn(db, id)?.name
    const anywhere = (id: string) => { for (const db of world.databases.values()) { const name = nameOf(id, db); if (name) return name } return undefined }
    const all = [...refs.map(r => ({ ...r, member: false })), ...members.map(m => ({ ...m, member: true }))]
    let out = '', last = 0
    for (const ref of all.sort((a, b) => a.from - b.from)) {
      const name = (ref.member && memberIds.has(ref.from) ? anywhere(ref.id) : nameOf(ref.id, here)) ?? 'Deleted property'
      out += stored.slice(last, ref.from) + `prop(${quoted(name)})`
      last = ref.to
    }
    return out + stored.slice(last)
  } catch { return stored }
}

/** What the field says while typing: what's wrong, or what it'll be saved as and what kind of value it gives. */
export function checkTyped(typed: string, world: FormulaWorld, databaseId: string, propertyId: string): { stored: string; type: ValueType } | { error: string } {
  let stored: string
  try { stored = storedFormula(typed, world, databaseId) } catch (error) {
    if (error instanceof FormulaSyntaxError) return { error: error.message }
    throw error
  }
  const program = programOf(withText(world, databaseId, propertyId, stored), databaseId, propertyId)
  return program.error ? { error: program.error } : { stored, type: program.type }
}
/** Refused at Done, on the server as in the field: no text that doesn't work replaces one that does (design §4). */
export function formulaProblem(stored: string, world: FormulaWorld, databaseId: string, propertyId: string): string | null {
  return programOf(withText(world, databaseId, propertyId, stored), databaseId, propertyId).error ?? null
}
/** A rollup that reads a formula counts as a layer on its way, and a formula that reads it back is a loop (design §3, §5). */
export function rollupProblem(world: FormulaWorld, databaseId: string, rollup: Property): string | null {
  const trial = trialWorld(world, databaseId, rollup)
  const { source, sourceIn } = rollupSource(trial, databaseId, rollup)
  if (!source || !isFormula(source)) return null
  const key = `${databaseId}\0${rollup.id}`
  const program = programOf(trial, sourceIn!, source.id, [key])
  if (program.error) return program.error
  // The source is reached from the rollup: anything reading the rollup back would have found the loop above.
  const readers = [...trial.databases].flatMap(([id, db]) => db.properties.filter(isFormula).map(p => programOf(trial, id, p.id)))
  return readers.find(r => r.error === 'Cycle detected')?.error ?? (program.layers + 1 > maxLayers ? `This goes through more than ${maxLayers} formulas and rollups` : null)
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
interface Run extends RunContext { read(page: Page, id: string): Value; row: Page }

function evaluate(node: FormulaNode, vars: Vars, run: Run): Value {
  run.spend(1)
  switch (node.k) {
    case 'lit': return node.v
    case 'list': return node.items.map(i => evaluate(i, vars, run))
    case 'prop': return run.read(run.row, node.id)
    case 'var': { for (let v = vars; v; v = v.next) if (v.name === node.name) return v.value; return null }
    case 'let': return evaluate(node.body, { name: node.name, value: evaluate(node.value, vars, run), next: vars }, run)
    case 'member': {
      if (node.asCall) return evaluate(node.asCall, vars, run)
      return readMember(evaluate(node.object, vars, run), node.reads!, run)
    }
    case 'call': {
      const result = call(formulaFunctions.get(node.fn)!, node.args, vars, run)
      return result === 0 ? 0 : result
    }
  }
}
function readMember(object: Value, id: string, run: Run): Value {
  if (object === null) return null
  if (object instanceof FormulaPage) return run.read(object.row, id)
  // `Parent.Sub-item`: what each page holds, as one list.
  if (Array.isArray(object)) return object.flatMap(page => { run.spend(1); const v = readMember(page, id, run); return v === null ? [] : Array.isArray(v) ? v : [v] })
  throw new FormulaRowError('Expected a page here')
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
  else if (value instanceof FormulaPage) { if (wanted.includes('page')) return value; if (wanted.includes('text')) return format(value) }
  else { if (wanted.includes('date')) return value; if (wanted.includes('text')) return format(value) }
  throw new FormulaRowError(`Expected ${wanted.map(wordFor).join(' or ')} here`)
}

const fromDateText = (text: string) => Date.parse(text.length > 10 ? `${text}Z` : `${text}T00:00Z`)
function dateFrom(value: DateValue): FormulaDate {
  return new FormulaDate(fromDateText(value.start), value.start.length > 10, value.end ? fromDateText(value.end) : undefined)
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
  // Pages draw as page refs, reading as a relation does.
  if (pageTarget(type) !== null) {
    const pages = (Array.isArray(value) ? value : [value]).filter((v): v is FormulaPage => v instanceof FormulaPage)
    return pages.length ? pages.map(p => p.row.id) : undefined
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  return format(value) || undefined
}
export function formulaShape(world: FormulaWorld, databaseId: string, p: Property): Pick<Property, 'type' | 'formulaError' | 'target'> {
  const program = programOf(world, databaseId, p.id)
  if (program.error) return { type: 'text', formulaError: program.error }
  const target = pageTarget(program.type)
  if (target !== null) return { type: 'relation', target }
  return { type: program.type === 'number' ? 'number' : program.type === 'boolean' ? 'checkbox' : program.type === 'date' ? 'date' : 'text' }
}

const rowErrors = new WeakMap<Page, Record<string, string>>()
/** Why this row's cell reads Error, when it does: a formula that can't be read at all says so on the column. */
export const formulaErrorOf = (row: Page | undefined, p: Property): string | null =>
  p.formulaError ?? (row ? rowErrors.get(row)?.[p.id] ?? null : null)
export const noteRowErrors = (row: Page, errors: Record<string, string>) => { rowErrors.set(row, errors) }

export interface CellSources {
  world: FormulaWorld
  /** Every row, To-dos' included. */
  pages: ReadonlyMap<string, Page>
  /** The databases as read: relations with their options, formulas and rollups with their column types. */
  databases: ReadonlyMap<string, Database>
  clock: Clock
  /** A rollup's cell on a row. It reads its source through `cell`. */
  rollup(rollup: Property, row: Page, db: Database): Json | undefined
  /** Formulas and rollups other than these read what the row already holds: a preview needs only the one being written worked out. */
  only?: string
}

/** Every worked-out cell of one reading: each one once, however many ways it's reached. */
export class WorkedCells {
  private readonly sources: CellSources
  private readonly worked = new Map<string, Value>()
  private readonly failed = new Map<string, string>()
  private readonly running = new Set<string>()
  private readonly overran = new Map<string, number>()
  private left = stepsPerRow
  private readonly spend = (steps: number) => { this.left -= steps; if (this.left < 0) throw new FormulaTooLong() }
  constructor(sources: CellSources) { this.sources = sources }

  private read = (row: Page, id: string): Value => {
    if (id === titleId) return row.title || null
    const db = this.sources.databases.get(row.parentId ?? '')
    const p = db?.properties.find(x => x.id === id)
    if (!db || !p) throw new FormulaRowError('A property this formula reads was deleted')
    return this.valueOf(row, db, p)
  }
  private valueOf(row: Page, db: Database, p: Property): Value {
    const held = this.sources.only !== undefined && p.id !== this.sources.only
    if (!held && isFormula(p)) return this.runFormula(row, db, p)
    if (!held && p.rollup) {
      const key = `${row.id}\0${p.id}`
      if (this.worked.has(key)) return this.worked.get(key)!
      const value = this.fromCell(p, readValue(p, this.sources.rollup(p, row, db)))
      this.worked.set(key, value)
      return value
    }
    return this.fromCell(p, cellValue(db, row, p.id))
  }
  private fromCell(p: Property, value: CellValue): Value {
    if (value === null) return null
    const nameOf = (id: string) => p.options?.find(o => o.id === id)?.name ?? ''
    switch (p.type) {
      case 'select': case 'status': return nameOf(String(value))
      case 'multiSelect': return (value as string[]).map(nameOf)
      case 'relation': return (value as string[]).flatMap(id => { const row = this.sources.pages.get(id); return row ? [new FormulaPage(row)] : [] })
      case 'id': return `${p.prefix ?? ''}${String(value)}`
      default: return typeof value === 'object' && !Array.isArray(value) ? dateFrom(value) : (value as Value)
    }
  }
  private runFormula(row: Page, db: Database, p: Property): Value {
    const key = `${row.id}\0${p.id}`
    if (this.worked.has(key)) return this.worked.get(key)!
    if (this.failed.has(key)) throw new FormulaRowError(`${p.name} has an error`)
    if (this.running.has(key)) throw new FormulaRowError('Cycle detected')
    const program = programOf(this.sources.world, row.parentId!, p.id)
    if (program.error) throw new FormulaRowError(program.error)
    this.running.add(key)
    try {
      const value = program.tree ? evaluate(program.tree, null, { row, rowId: row.id, spend: this.spend, clock: this.sources.clock, read: this.read }) : null
      this.worked.set(key, value)
      return value
    } catch (error) {
      if (error instanceof FormulaRowError) this.failed.set(key, error.message)
      throw error
    } finally { this.running.delete(key) }
  }
  /** A cell as a rollup or a column reads it, in its projected type. An Error there reads as nothing. */
  cell(row: Page, db: Database, p: Property): CellValue {
    if (!isFormula(p)) return cellValue(db, row, p.id)
    try { return readValue(p, toCell(this.runFormula(row, db, p), programOf(this.sources.world, row.parentId!, p.id).type)) } catch (error) {
      if (error instanceof FormulaRowError) return null
      throw error
    }
  }
  /** A formula's value on a row, with a row's budget of its own. */
  column(row: Page, db: Database, p: Property): { value: Value; error?: string } {
    if ((this.overran.get(p.id) ?? 0) >= overrunsAllowed) return { value: null, error: tooLongError }
    this.left = stepsPerRow
    try { return { value: this.runFormula(row, db, p) } } catch (error) {
      if (error instanceof FormulaTooLong) { this.overran.set(p.id, (this.overran.get(p.id) ?? 0) + 1); return { value: null, error: tooLongError } }
      if (error instanceof FormulaRowError) return { value: null, error: this.failed.get(`${row.id}\0${p.id}`) ?? error.message }
      throw error
    }
  }
  /** A rollup's cell, with a row's budget of its own. */
  rollupColumn(row: Page, db: Database, p: Property): Json | undefined {
    this.left = stepsPerRow
    try { return this.sources.rollup(p, row, db) } catch (error) {
      if (error instanceof FormulaTooLong || error instanceof FormulaRowError) return undefined
      throw error
    }
  }
  columnCell(row: Page, db: Database, p: Property): { cell: Json | undefined; error?: string } {
    const { value, error } = this.column(row, db, p)
    if (error) return { cell: undefined, error }
    return { cell: toCell(value, programOf(this.sources.world, row.parentId!, p.id).type) }
  }
}

/** A live preview: this row, this text, before it's saved. `read` is the workspace as read, whose cells it can trust. */
export function previewFormula(stored: string, ws: Workspace, read: Workspace, databaseId: string, propertyId: string, row: Page, clock: Clock): { text: string } | { error: string } {
  const world = withText(worldOf(ws), databaseId, propertyId, stored)
  const pages = new Map(withTodos(read).pages.map(p => [p.id, p]))
  const databases = new Map<string, Database>()
  for (const p of pages.values()) if (isDatabase(p)) databases.set(p.id, p.database)
  const db = databases.get(databaseId)
  if (!db) return { text: '' }
  const here = db.properties.some(p => p.id === propertyId)
  const property = { ...(db.properties.find(p => p.id === propertyId) ?? { id: propertyId, name: '', type: 'formula' as const }), formula: stored }
  const trial = { ...db, properties: here ? db.properties.map(p => (p.id === propertyId ? property : p)) : [...db.properties, property] }
  databases.set(databaseId, trial)
  const cells = new WorkedCells({ world, pages, databases, clock, only: propertyId, rollup: () => undefined })
  const { value, error } = cells.column(row, trial, property)
  if (error) return { error }
  return { text: typeof value === 'number' && !Number.isFinite(value) ? '' : format(value) }
}

export function usesClock(world: FormulaWorld): boolean {
  for (const [id, db] of world.databases) if (db.properties.some(p => isFormula(p) && programOf(world, id, p.id).usesClock)) return true
  return false
}
