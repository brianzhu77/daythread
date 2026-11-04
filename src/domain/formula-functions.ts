// Every function a formula can call (docs/design/formula.md §2), one line each, with what it takes and gives: the checker reads the
// same line the evaluator runs, so the field's "expected a number" and the cell can't disagree. Examples are Notion's own.
import { regexOf, RegexError, type Spend } from './formula-regex.ts'
import type { Page } from './types.ts'

/** Dates are wall clock, in UTC fields, so arithmetic has no daylight saving in it and a stored date reads as written (design §6). */
export class FormulaDate {
  readonly start: number
  readonly timed: boolean
  readonly end?: number
  constructor(start: number, timed: boolean, end?: number) {
    this.start = start
    this.timed = timed
    this.end = end
  }
}
/** A row reached through a relation. */
export class FormulaPage {
  readonly row: Page
  constructor(row: Page) { this.row = row }
}
export type Value = number | string | boolean | null | FormulaDate | FormulaPage | Value[]
/** `number`, `text`, `boolean`, `date`, `empty`, `any`, `page:<database>`, or `list:<item>`. */
export type ValueType = string

export class FormulaRowError extends Error {}
export class FormulaTooLong extends Error {}

export interface Clock {
  /** Now, as wall clock. */
  now: number
  wall(instant: number): number
  instant(wall: number): number
}
export interface RunContext { spend: Spend; clock: Clock; rowId: string }
type Thunk = () => Value
type PerItem = (item: Value, index: number) => Value

export interface FormulaFunction {
  name: string
  group: 'Logic and text' | 'Numbers' | 'Dates' | 'Lists' | 'Other'
  /** Space-separated; `a|b` either, `x?` optional, `x...` any number more. */
  takes: string
  gives: ValueType | ((args: ValueType[]) => ValueType)
  /** Given values; a required number or date that's empty makes the result empty, unless `seesEmpty`. */
  run?: (args: Value[], ctx: RunContext) => Value
  /** Given thunks, for what mustn't work out an argument it doesn't use. */
  lazy?: (args: Thunk[], ctx: RunContext) => Value
  /** The argument at 1 is worked out per item. */
  each?: (list: Value[], item: PerItem, ctx: RunContext) => Value
  doc: string
  example?: string
  usesClock?: true
  hidden?: true
}

export const isList = (t: ValueType) => t.startsWith('list')
export const itemOf = (t: ValueType): ValueType => (t.startsWith('list:') ? t.slice(5) : 'any')
const listOf = (t: ValueType): ValueType => `list:${t}`
/** The database a page, or a list of pages, is from. */
export const pageTarget = (t: ValueType): string | null => (t.startsWith('page:') ? t.slice(5) : t.startsWith('list:page:') ? t.slice(10) : null)
export function unionType(a: ValueType, b: ValueType): ValueType {
  if (a === b || b === 'empty') return a
  if (a === 'empty') return b
  return isList(a) && isList(b) ? 'list:any' : 'any'
}

export const isEmpty = (v: Value) => v === null || v === 0 || v === '' || v === false || (Array.isArray(v) && v.length === 0)
const truthy = (v: Value) => !isEmpty(v)
const clean = (n: number) => (n === 0 ? 0 : n)

// ---------------------------------------------------------------- dates
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const two = (n: number) => String(n).padStart(2, '0')
const fixedUnits: Record<string, number> = { millisecond: 1, second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }
const monthUnits: Record<string, number> = { month: 1, quarter: 3, year: 12 }
const unitOf = (text: string) => text.replace(/s$/, '')
export const validDateUnit = (text: string) => { const u = unitOf(text); return u in fixedUnits || u in monthUnits }
function addMonths(wall: number, n: number): number {
  const d = new Date(wall), day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.getTime()
}
function shifted(date: FormulaDate, n: number, unitText: string): FormulaDate {
  const unit = unitOf(unitText)
  const move = (wall: number) => {
    if (unit in monthUnits) return addMonths(wall, Math.trunc(n) * monthUnits[unit]!)
    if (unit in fixedUnits) return wall + n * fixedUnits[unit]!
    throw new FormulaRowError(`"${unitText}" isn't a unit of time`)
  }
  return new FormulaDate(move(date.start), date.timed, date.end === undefined ? undefined : move(date.end))
}
function monthsBetween(a: number, b: number): number {
  if (a < b) return -monthsBetween(b, a)
  const x = new Date(a), y = new Date(b)
  const whole = (x.getUTCFullYear() - y.getUTCFullYear()) * 12 + x.getUTCMonth() - y.getUTCMonth()
  return addMonths(b, whole) > a ? whole - 1 : whole
}
function between(a: FormulaDate, b: FormulaDate, unitText: string): number {
  const unit = unitOf(unitText)
  if (unit in monthUnits) return clean(Math.trunc(monthsBetween(a.start, b.start) / monthUnits[unit]!))
  if (unit in fixedUnits) return clean(Math.trunc((a.start - b.start) / fixedUnits[unit]!))
  throw new FormulaRowError(`"${unitText}" isn't a unit of time`)
}
function isoWeek(wall: number): number {
  const d = new Date(wall)
  // The week belongs to the year its Thursday falls in.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const first = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - first) / 86_400_000 + 1) / 7)
}
function parseDate(text: string, clock: Clock): Value {
  const s = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const at = Date.parse(`${s}T00:00Z`)
    return Number.isNaN(at) ? null : new FormulaDate(at, false)
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null
  const iso = s.replace(' ', 'T')
  if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(iso)) {
    const at = Date.parse(iso)
    return Number.isNaN(at) ? null : new FormulaDate(clock.wall(at), true)
  }
  const at = Date.parse(`${iso}Z`)
  return Number.isNaN(at) ? null : new FormulaDate(at, true)
}
const ordinal = (n: number) => { const r = n % 100; return `${n}${r >= 11 && r <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}` }
const dateTokens = /\[([^\]]*)\]|YYYY|YY|Y|MMMM|MMM|MM|Mo|M|dddd|ddd|dd|d|DD|Do|D|HH|H|hh|h|mm|m|ss|s|A|a/g
export function formatDate(wall: number, pattern: string): string {
  const d = new Date(wall), hour = d.getUTCHours(), twelve = hour % 12 || 12
  return pattern.replace(dateTokens, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal
    switch (token) {
      case 'YYYY': case 'Y': return String(d.getUTCFullYear())
      case 'YY': return two(d.getUTCFullYear() % 100)
      case 'MMMM': return months[d.getUTCMonth()]!
      case 'MMM': return months[d.getUTCMonth()]!.slice(0, 3)
      case 'MM': return two(d.getUTCMonth() + 1)
      case 'Mo': return ordinal(d.getUTCMonth() + 1)
      case 'M': return String(d.getUTCMonth() + 1)
      case 'dddd': return weekdays[d.getUTCDay()]!
      case 'ddd': return weekdays[d.getUTCDay()]!.slice(0, 3)
      case 'dd': return weekdays[d.getUTCDay()]!.slice(0, 2)
      case 'd': return String(d.getUTCDay())
      case 'DD': return two(d.getUTCDate())
      case 'Do': return ordinal(d.getUTCDate())
      case 'D': return String(d.getUTCDate())
      case 'HH': return two(hour)
      case 'H': return String(hour)
      case 'hh': return two(twelve)
      case 'h': return String(twelve)
      case 'mm': return two(d.getUTCMinutes())
      case 'm': return String(d.getUTCMinutes())
      case 'ss': return two(d.getUTCSeconds())
      case 's': return String(d.getUTCSeconds())
      case 'A': return hour < 12 ? 'AM' : 'PM'
      default: return hour < 12 ? 'am' : 'pm'
    }
  })
}
const dateText = (wall: number, timed: boolean) => formatDate(wall, timed ? 'MMMM D, Y HH:mm' : 'MMMM D, Y')

// ---------------------------------------------------------------- reading values
export function format(v: Value): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(format).join(', ')
  if (v instanceof FormulaPage) return v.row.title || 'Untitled'
  return v.end === undefined ? dateText(v.start, v.timed) : `${dateText(v.start, v.timed)} → ${dateText(v.end, v.timed)}`
}
function deepEqual(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b || isEmpty(a) && isEmpty(b)
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]!))
  if (a instanceof FormulaDate && b instanceof FormulaDate) return a.start === b.start && a.end === b.end
  if (a instanceof FormulaPage && b instanceof FormulaPage) return a.row.id === b.row.id
  return a === b
}
function compare(a: Value, b: Value): number | null {
  if (a === null || b === null) return null
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (a instanceof FormulaDate && b instanceof FormulaDate) return a.start - b.start
  if (a instanceof FormulaPage && b instanceof FormulaPage) return format(a).localeCompare(format(b))
  throw new FormulaRowError("Those two can't be compared")
}
const order = (test: (n: number) => boolean) => ([a, b]: Value[]) => { const c = compare(a!, b!); return c === null ? false : test(c) }
function numbersIn(args: Value[], spend: Spend): number[] {
  const out: number[] = []
  const take = (v: Value) => {
    spend(1)
    if (Array.isArray(v)) v.forEach(take)
    else if (typeof v === 'number') out.push(v)
    else if (v !== null) throw new FormulaRowError('Expected numbers')
  }
  args.forEach(take)
  return out
}
const textOf = (v: Value) => v as string
const numberOf = (v: Value) => v as number
const dateOf = (v: Value) => v as FormulaDate
const listOfValues = (v: Value) => v as Value[]
const spendOn = (ctx: RunContext, text: string) => ctx.spend(1 + (text.length >> 4))
const maxText = 100_000
function regexCall<T>(pattern: string, call: (re: ReturnType<typeof regexOf>) => T): T {
  try { return call(regexOf(pattern)) } catch (error) { if (error instanceof RegexError) throw new FormulaRowError(error.message); throw error }
}
function median(list: number[]): number | null {
  if (!list.length) return null
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
function formatNumber(n: number, style: string, decimals: number | undefined): string {
  const digits = decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  const s = style.toLowerCase()
  if (s === 'percent') return new Intl.NumberFormat('en-US', { style: 'percent', ...digits }).format(n / 100)
  if (/^[a-z]{3}$/.test(s)) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: s, ...digits }).format(n) } catch { throw new FormulaRowError(`"${style}" isn't a number format`) }
  }
  if (s === 'commas' || s === 'number_with_commas') return new Intl.NumberFormat('en-US', digits).format(n)
  if (s === 'number' || s === '') return decimals === undefined ? String(n) : n.toFixed(decimals)
  throw new FormulaRowError(`"${style}" isn't a number format`)
}

const addType = ([a, b]: ValueType[]): ValueType => (a === 'number' && b === 'number' ? 'number' : a === 'text' || b === 'text' ? 'text' : 'any')
function add([a, b]: Value[]): Value {
  if (a === null) return b!
  if (b === null) return a
  return typeof a === 'number' && typeof b === 'number' ? a + b : format(a!) + format(b!)
}

const logic = 'Logic and text' as const, numbers = 'Numbers' as const, dates = 'Dates' as const, lists = 'Lists' as const, other = 'Other' as const

const table: FormulaFunction[] = [
  { name: 'if', group: logic, takes: 'any any any', gives: ([, a, b]) => unionType(a!, b!), lazy: ([c, a, b]) => (truthy(c!()) ? a!() : b!()), doc: 'The second value if the first is true, otherwise the third.', example: 'if(true, 1, 2)' },
  { name: 'ifs', group: logic, takes: 'any any any...', gives: args => args.filter((_, i) => i % 2 === 1 || i === args.length - 1).reduce(unionType), lazy: args => { for (let i = 0; i + 1 < args.length; i += 2) if (truthy(args[i]!())) return args[i + 1]!(); return args.length % 2 ? args.at(-1)!() : null }, doc: 'The value after the first true condition, or the last value.', example: 'ifs(false, 1, false, 2, 3)' },
  { name: 'and', group: logic, takes: 'any any any...', gives: 'boolean', lazy: args => args.every(a => truthy(a())), doc: 'True if all are true.', example: 'and(true, false)' },
  { name: 'or', group: logic, takes: 'any any any...', gives: 'boolean', lazy: args => args.some(a => truthy(a())), doc: 'True if any is true.', example: 'or(true, false)' },
  { name: 'not', group: logic, takes: 'any', gives: 'boolean', lazy: ([a]) => !truthy(a!()), doc: 'The opposite.', example: 'not(true)' },
  { name: 'empty', group: logic, takes: 'any?', gives: args => (args.length ? 'boolean' : 'empty'), lazy: ([a]) => (a ? isEmpty(a()) : null), doc: 'True if empty, which 0, "" and [] all are. With nothing to check, an empty value.', example: 'empty(0)' },
  { name: 'length', group: logic, takes: 'text|list', gives: 'number', run: ([v], ctx) => { if (Array.isArray(v)) return v.length; spendOn(ctx, textOf(v!)); return Array.from(textOf(v!)).length }, doc: 'How long a text or a list is.', example: 'length("hello")' },
  { name: 'substring', group: logic, takes: 'text number number?', gives: 'text', run: ([s, a, b], ctx) => { spendOn(ctx, textOf(s!)); return Array.from(textOf(s!)).slice(numberOf(a!), b === undefined ? undefined : numberOf(b)).join('') }, doc: 'Part of a text, from a position up to another.', example: 'substring("Notion", 0, 3)' },
  { name: 'contains', group: logic, takes: 'text|list any', gives: 'boolean', run: ([s, x], ctx) => { if (Array.isArray(s)) return s.some(v => { ctx.spend(1); return deepEqual(v, x!) }); spendOn(ctx, textOf(s!)); return textOf(s!).includes(format(x!)) }, doc: 'True if a text contains another.', example: 'contains("Notion", "ot")' },
  { name: 'test', group: logic, takes: 'text text', gives: 'boolean', run: ([s, p], ctx) => regexCall(textOf(p!), re => re.test(textOf(s!), ctx.spend)), doc: 'True if a text matches a regular expression.', example: 'test("Notion", "Not")' },
  { name: 'match', group: logic, takes: 'text text', gives: listOf('text'), run: ([s, p], ctx) => regexCall(textOf(p!), re => re.all(textOf(s!), ctx.spend)), doc: 'Every match of a regular expression.', example: 'match("Notion 123 Notion 456", "\\\\d+")' },
  { name: 'replace', group: logic, takes: 'text text text', gives: 'text', run: ([s, p, r], ctx) => regexCall(textOf(p!), re => re.replace(textOf(s!), textOf(r!), false, ctx.spend)), doc: 'Replaces the first match of a regular expression.', example: 'replace("Notion Notion", "N", "M")' },
  { name: 'replaceAll', group: logic, takes: 'text text text', gives: 'text', run: ([s, p, r], ctx) => regexCall(textOf(p!), re => re.replace(textOf(s!), textOf(r!), true, ctx.spend)), doc: 'Replaces every match of a regular expression.', example: 'replaceAll("Notion Notion", "N", "M")' },
  { name: 'lower', group: logic, takes: 'text', gives: 'text', run: ([s], ctx) => { spendOn(ctx, textOf(s!)); return textOf(s!).toLowerCase() }, doc: 'Lowercase.', example: 'lower("NOTION")' },
  { name: 'upper', group: logic, takes: 'text', gives: 'text', run: ([s], ctx) => { spendOn(ctx, textOf(s!)); return textOf(s!).toUpperCase() }, doc: 'Uppercase.', example: 'upper("notion")' },
  { name: 'trim', group: logic, takes: 'text', gives: 'text', run: ([s], ctx) => { spendOn(ctx, textOf(s!)); return textOf(s!).trim() }, doc: 'Without the spaces at either end.', example: '" notion ".trim()' },
  { name: 'repeat', group: logic, takes: 'text number', gives: 'text', run: ([s, n], ctx) => {
    const times = Math.max(0, Math.trunc(numberOf(n!))), size = textOf(s!).length * times
    if (size > maxText) throw new FormulaTooLong()
    ctx.spend(1 + (size >> 4))
    return textOf(s!).repeat(times)
  }, doc: 'A text, that many times over.', example: 'repeat("0", 4)' },
  { name: 'link', group: logic, takes: 'text text', gives: 'text', run: ([label]) => label!, doc: 'A link with this label. Only http and https become links.', example: 'link("Notion", "https://notion.so")' },
  { name: 'style', group: logic, takes: 'text text...', gives: 'text', run: ([s]) => s!, doc: 'A text with styles and colours: b, u, i, c, s, and a colour or colour_background.', example: 'style("Notion", "b", "u")' },
  { name: 'unstyle', group: logic, takes: 'text text?', gives: 'text', run: ([s]) => s!, doc: 'Removes styles, or just the one named.', example: 'unstyle("Text")' },
  { name: 'format', group: logic, takes: 'any', gives: 'text', run: ([v], ctx) => { ctx.spend(1); return format(v!) }, doc: 'A value as text.', example: 'format(1234)' },
  { name: 'split', group: logic, takes: 'text text', gives: listOf('text'), run: ([s, by], ctx) => { spendOn(ctx, textOf(s!)); return textOf(s!).split(textOf(by!)) }, doc: 'A text, cut into a list at each separator.', example: 'split("apple,pear,orange", ",")' },
  { name: 'join', group: logic, takes: 'list text', gives: 'text', run: ([l, by], ctx) => { ctx.spend(1 + listOfValues(l!).length); return listOfValues(l!).map(format).join(textOf(by!)) }, doc: 'A list as one text, with this between.', example: 'join(["a", "b", "c"], ", ")' },

  { name: 'add', group: numbers, takes: 'any any', gives: addType, run: add, doc: 'Adds numbers, or puts text together.', example: 'add(5, 10)' },
  { name: 'subtract', group: numbers, takes: 'number number', gives: 'number', run: ([a, b]) => numberOf(a!) - numberOf(b!), doc: 'The difference.', example: 'subtract(5, 10)' },
  { name: 'multiply', group: numbers, takes: 'number number', gives: 'number', run: ([a, b]) => numberOf(a!) * numberOf(b!), doc: 'The product.', example: 'multiply(5, 10)' },
  { name: 'divide', group: numbers, takes: 'number number', gives: 'number', run: ([a, b]) => numberOf(a!) / numberOf(b!), doc: 'The quotient.', example: 'divide(5, 10)' },
  { name: 'mod', group: numbers, takes: 'number number', gives: 'number', run: ([a, b]) => numberOf(a!) % numberOf(b!), doc: 'The remainder.', example: 'mod(5, 10)' },
  { name: 'pow', group: numbers, takes: 'number number', gives: 'number', run: ([a, b]) => numberOf(a!) ** numberOf(b!), doc: 'A number to a power.', example: 'pow(5, 10)' },
  { name: 'min', group: numbers, takes: 'number|list number|list...', gives: 'number', run: (args, ctx) => { const l = numbersIn(args, ctx.spend); return l.length ? Math.min(...l) : null }, doc: 'The smallest.', example: 'min(1, 2, 3)' },
  { name: 'max', group: numbers, takes: 'number|list number|list...', gives: 'number', run: (args, ctx) => { const l = numbersIn(args, ctx.spend); return l.length ? Math.max(...l) : null }, doc: 'The largest.', example: 'max(1, 2, 3)' },
  { name: 'sum', group: numbers, takes: 'number|list number|list...', gives: 'number', run: (args, ctx) => numbersIn(args, ctx.spend).reduce((a, b) => a + b, 0), doc: 'All added up.', example: 'sum([1, 2, 3], 4, 5)' },
  { name: 'median', group: numbers, takes: 'number|list number|list...', gives: 'number', run: (args, ctx) => median(numbersIn(args, ctx.spend)), doc: 'The middle value.', example: 'median(1, 2, 4)' },
  { name: 'mean', group: numbers, takes: 'number|list number|list...', gives: 'number', run: (args, ctx) => { const l = numbersIn(args, ctx.spend); return l.length ? l.reduce((a, b) => a + b, 0) / l.length : null }, doc: 'The average.', example: 'mean(1, 2, 3)' },
  { name: 'abs', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.abs(numberOf(n!)), doc: 'Without its sign.', example: 'abs(-10)' },
  { name: 'round', group: numbers, takes: 'number number?', gives: 'number', run: ([n, d]) => { const scale = 10 ** (d === undefined ? 0 : numberOf(d)); return Math.round(numberOf(n!) * scale) / scale }, doc: 'To the nearest whole number, or to these decimals.', example: 'round(1.234, 2)' },
  { name: 'ceil', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.ceil(numberOf(n!)), doc: 'Rounded up.', example: 'ceil(0.4)' },
  { name: 'floor', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.floor(numberOf(n!)), doc: 'Rounded down.', example: 'floor(0.4)' },
  { name: 'sqrt', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.sqrt(numberOf(n!)), doc: 'The square root.', example: 'sqrt(4)' },
  { name: 'cbrt', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.cbrt(numberOf(n!)), doc: 'The cube root.', example: 'cbrt(64)' },
  { name: 'exp', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.exp(numberOf(n!)), doc: 'e to this power.', example: 'exp(1)' },
  { name: 'ln', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.log(numberOf(n!)), doc: 'The natural logarithm.', example: 'ln(10)' },
  { name: 'log10', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.log10(numberOf(n!)), doc: 'The base 10 logarithm.', example: 'log10(100000)' },
  { name: 'log2', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.log2(numberOf(n!)), doc: 'The base 2 logarithm.', example: 'log2(1024)' },
  { name: 'sign', group: numbers, takes: 'number', gives: 'number', run: ([n]) => Math.sign(numberOf(n!)), doc: '1, -1 or 0.', example: 'sign(-10)' },
  { name: 'pi', group: numbers, takes: '', gives: 'number', run: () => Math.PI, doc: 'The ratio of a circle to its diameter.', example: 'pi()' },
  { name: 'e', group: numbers, takes: '', gives: 'number', run: () => Math.E, doc: "Euler's number.", example: 'e()' },
  { name: 'toNumber', group: numbers, takes: 'any', gives: 'number', run: ([v], ctx) => {
    if (typeof v === 'number') return v
    if (typeof v === 'boolean') return Number(v)
    if (v instanceof FormulaDate) return ctx.clock.instant(v.start)
    const n = typeof v === 'string' && v.trim() ? Number(v.trim().replace(/,/g, '')) : NaN
    return Number.isFinite(n) ? n : null
  }, doc: 'A value as a number.', example: 'toNumber("2")' },
  { name: 'formatNumber', group: numbers, takes: 'number text number?', gives: 'text', run: ([n, s, d]) => formatNumber(numberOf(n!), textOf(s!), d === undefined ? undefined : numberOf(d)), doc: 'A number as text: usd or another currency code, percent or commas, with these decimals.', example: 'formatNumber(1234, "usd", 0)' },

  { name: 'now', group: dates, takes: '', gives: 'date', usesClock: true, run: (_, ctx) => new FormulaDate(ctx.clock.now, true), doc: 'The date and time now.', example: 'now()' },
  { name: 'today', group: dates, takes: '', gives: 'date', usesClock: true, run: (_, ctx) => new FormulaDate(Math.floor(ctx.clock.now / 86_400_000) * 86_400_000, false), doc: "Today's date, the one on today's page.", example: 'today()' },
  { name: 'minute', group: dates, takes: 'date', gives: 'number', run: ([d]) => new Date(dateOf(d!).start).getUTCMinutes(), doc: 'The minute, 0 to 59.', example: 'minute(parseDate("2023-07-10T17:35Z"))' },
  { name: 'hour', group: dates, takes: 'date', gives: 'number', run: ([d]) => new Date(dateOf(d!).start).getUTCHours(), doc: 'The hour, 0 to 23.', example: 'hour(parseDate("2023-07-10T17:35Z"))' },
  { name: 'day', group: dates, takes: 'date', gives: 'number', run: ([d]) => new Date(dateOf(d!).start).getUTCDay() || 7, doc: 'The day of the week, Monday 1 to Sunday 7.', example: 'day(parseDate("2023-07-10T17:35Z"))' },
  { name: 'date', group: dates, takes: 'date', gives: 'number', run: ([d]) => new Date(dateOf(d!).start).getUTCDate(), doc: 'The day of the month.', example: 'date(parseDate("2023-07-10T17:35Z"))' },
  { name: 'week', group: dates, takes: 'date', gives: 'number', run: ([d]) => isoWeek(dateOf(d!).start), doc: 'The ISO week, 1 to 53.', example: 'week(parseDate("2023-01-02"))' },
  { name: 'month', group: dates, takes: 'date', gives: 'number', run: ([d]) => new Date(dateOf(d!).start).getUTCMonth() + 1, doc: 'The month, 1 to 12.', example: 'month(parseDate("2023-07-10T17:35Z"))' },
  { name: 'year', group: dates, takes: 'date', gives: 'number', run: ([d]) => new Date(dateOf(d!).start).getUTCFullYear(), doc: 'The year.', example: 'year(now())' },
  { name: 'dateAdd', group: dates, takes: 'date number text', gives: 'date', run: ([d, n, u]) => shifted(dateOf(d!), numberOf(n!), textOf(u!)), doc: 'A date plus this much: years, quarters, months, weeks, days, hours, minutes, seconds.', example: 'dateAdd(now(), 1, "days")' },
  { name: 'dateSubtract', group: dates, takes: 'date number text', gives: 'date', run: ([d, n, u]) => shifted(dateOf(d!), -numberOf(n!), textOf(u!)), doc: 'A date minus this much.', example: 'dateSubtract(now(), 1, "days")' },
  { name: 'dateBetween', group: dates, takes: 'date date text', gives: 'number', run: ([a, b, u]) => between(dateOf(a!), dateOf(b!), textOf(u!)), doc: 'How far the first date is after the second, in this unit.', example: 'dateBetween(now(), parseDate("2022-09-07"), "days")' },
  { name: 'dateRange', group: dates, takes: 'date date', gives: 'date', run: ([a, b]) => { const x = dateOf(a!), y = dateOf(b!); return new FormulaDate(Math.min(x.start, y.start), x.timed || y.timed, Math.max(x.start, y.start)) }, doc: 'A date range from two dates.', example: 'dateRange(prop("Start Date"), prop("End Date"))' },
  { name: 'dateStart', group: dates, takes: 'date', gives: 'date', run: ([d]) => new FormulaDate(dateOf(d!).start, dateOf(d!).timed), doc: "A range's start.", example: 'dateStart(prop("Date Range"))' },
  { name: 'dateEnd', group: dates, takes: 'date', gives: 'date', run: ([d]) => new FormulaDate(dateOf(d!).end ?? dateOf(d!).start, dateOf(d!).timed), doc: "A range's end.", example: 'dateEnd(prop("Date Range"))' },
  { name: 'timestamp', group: dates, takes: 'date', gives: 'number', run: ([d], ctx) => ctx.clock.instant(dateOf(d!).start), doc: 'A date as milliseconds since 1970.', example: 'timestamp(now())' },
  { name: 'fromTimestamp', group: dates, takes: 'number', gives: 'date', run: ([n], ctx) => new FormulaDate(ctx.clock.wall(numberOf(n!)), true), doc: 'Milliseconds since 1970 as a date.', example: 'fromTimestamp(1689024900000)' },
  { name: 'formatDate', group: dates, takes: 'date text', gives: 'text', run: ([d, f]) => formatDate(dateOf(d!).start, textOf(f!)), doc: 'A date as text, in a pattern like "MMMM D, Y" or "MM/DD/YYYY".', example: 'formatDate(now(), "MMMM D, Y")' },
  { name: 'parseDate', group: dates, takes: 'text', gives: 'date', run: ([s], ctx) => parseDate(textOf(s!), ctx.clock), doc: 'An ISO 8601 text as a date.', example: 'parseDate("2022-01-01")' },

  { name: 'at', group: lists, takes: 'list number', gives: ([l]) => itemOf(l!), run: ([l, i]) => listOfValues(l!).at(numberOf(i!)) ?? null, doc: 'The item at this position, counting from 0.', example: 'at([1, 2, 3], 1)' },
  { name: 'first', group: lists, takes: 'list', gives: ([l]) => itemOf(l!), run: ([l]) => listOfValues(l!)[0] ?? null, doc: 'The first item.', example: 'first([1, 2, 3])' },
  { name: 'last', group: lists, takes: 'list', gives: ([l]) => itemOf(l!), run: ([l]) => listOfValues(l!).at(-1) ?? null, doc: 'The last item.', example: 'last([1, 2, 3])' },
  { name: 'slice', group: lists, takes: 'list number number?', gives: ([l]) => l!, run: ([l, a, b]) => listOfValues(l!).slice(numberOf(a!), b === undefined ? undefined : numberOf(b)), doc: 'Part of a list, from a position up to another.', example: 'slice([1, 2, 3], 1, 2)' },
  { name: 'concat', group: lists, takes: 'any any...', gives: args => (args.every(t => t === 'text') ? 'text' : args.every(isList) ? args.reduce(unionType) : 'list:any'), run: (args, ctx) => {
    ctx.spend(1 + args.length)
    // Older Notion formulas join text with this.
    if (args.every(a => !Array.isArray(a) && (typeof a === 'string' || a === null))) return args.map(format).join('')
    return args.flatMap(a => (Array.isArray(a) ? a : a === null ? [] : [a]))
  }, doc: 'Lists put together.', example: 'concat([1, 2], [3, 4])' },
  { name: 'sort', group: lists, takes: 'list', gives: ([l]) => l!, run: ([l], ctx) => { ctx.spend(1 + listOfValues(l!).length); return [...listOfValues(l!)].sort((a, b) => compare(a, b) ?? (a === null ? 1 : -1)) }, doc: 'A list in order.', example: 'sort([3, 1, 2])' },
  { name: 'reverse', group: lists, takes: 'list', gives: ([l]) => l!, run: ([l], ctx) => { ctx.spend(1 + listOfValues(l!).length); return [...listOfValues(l!)].reverse() }, doc: 'A list backwards.', example: 'reverse(["green", "eggs", "ham"])' },
  { name: 'unique', group: lists, takes: 'list', gives: ([l]) => l!, run: ([l], ctx) => { const out: Value[] = []; for (const v of listOfValues(l!)) { ctx.spend(1 + out.length); if (!out.some(x => deepEqual(x, v))) out.push(v) } return out }, doc: 'A list without repeats.', example: 'unique([1, 1, 2])' },
  { name: 'includes', group: lists, takes: 'list any', gives: 'boolean', run: ([l, x], ctx) => listOfValues(l!).some(v => { ctx.spend(1); return deepEqual(v, x!) }), doc: 'True if a list has this item.', example: 'includes(["a", "b", "c"], "b")' },
  { name: 'find', group: lists, takes: 'list any', gives: ([l]) => itemOf(l!), each: (list, item) => { for (let i = 0; i < list.length; i++) if (truthy(item(list[i]!, i))) return list[i]!; return null }, doc: 'The first item where the condition holds, using current.', example: 'find(["a", "b", "c"], current == "b")' },
  { name: 'findIndex', group: lists, takes: 'list any', gives: 'number', each: (list, item) => { for (let i = 0; i < list.length; i++) if (truthy(item(list[i]!, i))) return i; return -1 }, doc: 'Where that first item is, or -1.', example: 'findIndex(["a", "b", "c"], current == "b")' },
  { name: 'filter', group: lists, takes: 'list any', gives: ([l]) => l!, each: (list, item) => list.filter((v, i) => truthy(item(v, i))), doc: 'The items where the condition holds, using current.', example: 'filter([1, 2, 3], current > 1)' },
  { name: 'some', group: lists, takes: 'list any', gives: 'boolean', each: (list, item) => list.some((v, i) => truthy(item(v, i))), doc: 'True if the condition holds for any item.', example: 'some([1, 2, 3], current == 2)' },
  { name: 'every', group: lists, takes: 'list any', gives: 'boolean', each: (list, item) => list.every((v, i) => truthy(item(v, i))), doc: 'True if the condition holds for every item.', example: 'every([1, 2, 3], current > 0)' },
  { name: 'map', group: lists, takes: 'list any', gives: ([, t]) => listOf(t!), each: (list, item) => list.map((v, i) => item(v, i)), doc: 'Each item worked out anew, using current and index.', example: 'map([1, 2, 3], current + index)' },
  { name: 'flat', group: lists, takes: 'list', gives: ([l]) => (isList(itemOf(l!)) ? itemOf(l!) : l!), run: ([l], ctx) => { ctx.spend(1 + listOfValues(l!).length); return listOfValues(l!).flat(1) as Value[] }, doc: 'Lists inside a list, as one list.', example: 'flat([[1, 2], [3, 4]])' },

  { name: 'id', group: other, takes: 'page?', gives: 'text', run: ([page], ctx) => (page instanceof FormulaPage ? page.row.id : ctx.rowId), doc: "This row's ID, or a page's.", example: 'id()' },
  { name: 'equal', group: other, takes: 'any any', gives: 'boolean', run: ([a, b]) => deepEqual(a!, b!), doc: 'True if the two are equal.', example: 'equal(1, 1)' },
  { name: 'unequal', group: other, takes: 'any any', gives: 'boolean', run: ([a, b]) => !deepEqual(a!, b!), doc: 'True if the two differ.', example: 'unequal(1, 2)' },

  // What the operators call. A list of functions has no use for them.
  { name: 'negate', group: numbers, takes: 'number', gives: 'number', run: ([n]) => -numberOf(n!), doc: '', hidden: true },
  { name: 'gt', group: other, takes: 'any any', gives: 'boolean', run: order(c => c > 0), doc: '', hidden: true },
  { name: 'gte', group: other, takes: 'any any', gives: 'boolean', run: order(c => c >= 0), doc: '', hidden: true },
  { name: 'lt', group: other, takes: 'any any', gives: 'boolean', run: order(c => c < 0), doc: '', hidden: true },
  { name: 'lte', group: other, takes: 'any any', gives: 'boolean', run: order(c => c <= 0), doc: '', hidden: true },
]

export const formulaFunctions: ReadonlyMap<string, FormulaFunction> = new Map(table.map(f => [f.name, f]))
/** The field's reference list, including what the parser handles itself. */
export const functionList: readonly Pick<FormulaFunction, 'name' | 'group' | 'doc' | 'example'>[] = [
  ...table.filter(f => !f.hidden),
  { name: 'let', group: other, doc: 'A name for a value, used in what follows.', example: 'let(person, "Alan", "Hello, " + person + "!")' },
  { name: 'lets', group: other, doc: 'Several names for values, used in what follows.', example: 'lets(a, "Hello", b, "world", a + " " + b)' },
]
/** Notion's, with nothing here to answer them (design §2). */
export const notApplicable: Readonly<Record<string, string>> = {
  name: "name reads a person, and Daythread doesn't have a person type",
  email: "email reads a person, and Daythread doesn't have a person type",
}
