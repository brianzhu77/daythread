// Formulas (docs/design/formula.md): Notion's own examples as the expected results, then the language's edges and its limits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { functionList, format, type Value } from '../src/domain/formula-functions.ts'
import { clockIn, formulaProblem, runRow, shownFormula, storedFormula } from '../src/domain/formula.ts'
import { LinearRegex, RegexError } from '../src/domain/formula-regex.ts'
import type { Database, Property } from '../src/domain/database.ts'
import type { Page } from '../src/domain/types.ts'

const clock = clockIn('UTC', Date.parse('2023-08-30T17:55:00Z'))
const properties: Property[] = [
  { id: 'n', name: 'Number', type: 'number' },
  { id: 't', name: 'Text', type: 'text' },
  { id: 'c', name: 'Checked', type: 'checkbox' },
  { id: 's', name: 'Start Date', type: 'date' },
  { id: 'e', name: 'End Date', type: 'date' },
  { id: 'r', name: 'Date Range', type: 'date' },
  { id: 'o', name: 'Status', type: 'status', options: [{ id: 'o1', name: 'Open', group: 'todo' }, { id: 'o2', name: 'Done', group: 'done' }] },
  { id: 'm', name: 'Tags', type: 'multiSelect', options: [{ id: 'm1', name: 'a' }, { id: 'm2', name: 'b' }] },
  { id: 'd', name: 'Sub-item', type: 'number' },
  { id: 'z', name: '进度', type: 'number' },
  { id: 'w', name: 'Due date', type: 'date' },
]
const db = { properties, views: [] } as unknown as Database
const row = { id: 'row-1', title: 'A row', type: 'document', values: { n: 7, t: 'hello', c: true, s: '2022-09-07', e: '2023-09-07', r: { start: '2022-09-07', end: '2023-09-07' }, o: 'o2', m: ['m1', 'm2'], d: 3, z: 40, w: '2023-09-01' } } as unknown as Page

function run(typed: string): Value | Error {
  const stored = storedFormula(typed, db)
  const problem = formulaProblem(stored, db, 'f')
  if (problem) return new Error(problem)
  const p: Property = { id: 'f', name: 'F', type: 'formula', formula: stored }
  const { worked, errors } = runRow({ ...db, properties: [...properties, p] }, [p], row, clock)
  return errors.f ? new Error(errors.f) : worked.get('f') ?? null
}
const shown = (v: Value | Error) => (v instanceof Error ? `Error: ${v.message}` : typeof v === 'object' && !Array.isArray(v) && v !== null ? format(v) : v)

// From Notion's page. Where it shows a date, ours shows the same date in `format`'s words.
const examples: Array<[string, unknown]> = [
  ['2 * pi()', 2 * Math.PI], ['"hello" + "world"', 'helloworld'], ['123 == 123', true], ['"Notion" == "Motion"', false],
  ['true and false', false], ['true && false', false], ['and(true, false)', false], ['true or false', true], ['true || false', true], ['or(true, false)', true], ['not true', false], ['!true', false],
  ['if(true, 1, 2)', 1], ['if(false, 1, 2)', 2], ['prop("Checked") == true ? "Complete" : "Incomplete"', 'Complete'],
  ['ifs(true, 1, true, 2, 3)', 1], ['ifs(false, 1, false, 2, 3)', 3],
  ['empty(0)', true], ['empty([])', true], ['length("hello")', 5], ['length([1, 2, 3])', 3],
  ['substring("Notion", 0, 3)', 'Not'], ['substring("Notion", 3)', 'ion'], ['contains("Notion", "ot")', true],
  ['test("Notion", "Not")', true], ['test("Notion", "\\\\d")', false], ['match("Notion Notion", "Not")', ['Not', 'Not']], ['match("Notion 123 Notion 456", "\\\\d+")', ['123', '456']],
  ['replace("Notion Notion", "N", "M")', 'Motion Notion'], ['replaceAll("Notion Notion", "N", "M")', 'Motion Motion'], ['replaceAll("Notion 123", "\\\\d", "")', 'Notion '],
  ['lower("NOTION")', 'notion'], ['upper("notion")', 'NOTION'], ['repeat("0", 4)', '0000'], ['repeat("~=", 10)', '~=~=~=~=~=~=~=~=~=~='],
  ['format(1234)', '1234'], ['format(now())', 'August 30, 2023 17:55'],
  ['add(5, 10)', 15], ['5 + 10', 15], ['subtract(5, 10)', -5], ['5 - 10', -5], ['multiply(5, 10)', 50], ['5 * 10', 50], ['mod(5, 10)', 5], ['5 % 10', 5], ['pow(5, 10)', 9765625], ['5 ^ 10', 9765625], ['divide(5, 10)', 0.5], ['5 / 10', 0.5],
  ['min(1, 2, 3)', 1], ['min([1, 2, 3])', 1], ['max(1, 2, 3)', 3], ['max([1, 2, 3])', 3], ['sum(1, 2, 3)', 6], ['sum([1, 2, 3], 4, 5)', 15], ['median(1, 2, 4)', 2], ['median([1, 2, 3], 4)', 2.5], ['mean(1, 2, 3)', 2], ['mean([1, 2, 3], 4, 5)', 3],
  ['abs(10)', 10], ['abs(-10)', 10], ['round(0.4)', 0], ['round(-0.6)', -1], ['round(1.234, 0)', 1], ['round(1.234, 2)', 1.23], ['round(1234, -2)', 1200], ['ceil(0.4)', 1], ['ceil(-0.6)', 0], ['floor(0.4)', 0], ['floor(-0.6)', -1],
  ['sqrt(4)', 2], ['sqrt(7)', 2.6457513110645907], ['cbrt(9)', 2.080083823051904], ['cbrt(64)', 4], ['exp(1)', 2.718281828459045], ['exp(-1)', 0.36787944117144233], ['ln(2.718281828459045)', 1], ['ln(10)', 2.302585092994046], ['log10(10)', 1], ['log10(100000)', 5], ['log2(4)', 2], ['log2(1024)', 10], ['sign(-10)', -1], ['sign(10)', 1], ['pi()', 3.141592653589793], ['e()', 2.718281828459045],
  ['toNumber("2")', 2], ['toNumber(now())', 1693418100000], ['toNumber(true)', 1],
  ['format(today())', 'August 30, 2023'],
  ['minute(parseDate("2023-07-10T17:35Z"))', 35], ['hour(parseDate("2023-07-10T17:35Z"))', 17], ['day(parseDate("2023-07-10T17:35Z"))', 1], ['date(parseDate("2023-07-10T17:35Z"))', 10], ['week(parseDate("2023-01-02"))', 1], ['month(parseDate("2023-07-10T17:35Z"))', 7], ['year(now())', 2023],
  ['dateAdd(now(), 1, "days")', 'August 31, 2023 17:55'], ['dateAdd(now(), 2, "months")', 'October 30, 2023 17:55'], ['dateAdd(now(), 3, "years")', 'August 30, 2026 17:55'],
  ['dateSubtract(now(), 1, "days")', 'August 29, 2023 17:55'], ['dateSubtract(now(), 2, "months")', 'June 30, 2023 17:55'], ['dateSubtract(now(), 3, "years")', 'August 30, 2020 17:55'],
  ['dateBetween(now(), parseDate("2022-09-07"), "days")', 357], ['dateBetween(parseDate("2030-01-01"), now(), "years")', 6],
  ['dateRange(prop("Start Date"), prop("End Date"))', 'September 7, 2022 → September 7, 2023'], ['dateStart(prop("Date Range"))', 'September 7, 2022'], ['dateBetween(dateStart(prop("Date Range")), dateEnd(prop("Date Range")), "days")', -365], ['dateEnd(prop("Date Range"))', 'September 7, 2023'], ['dateBetween(dateEnd(prop("Date Range")), dateStart(prop("Date Range")), "days")', 365],
  ['timestamp(now())', 1693418100000], ['fromTimestamp(1689024900000)', 'July 10, 2023 21:35'],
  ['formatDate(now(), "MMMM D, Y")', 'August 30, 2023'], ['formatDate(now(), "MM/DD/YYYY")', '08/30/2023'],
  // Notion's page prints "17:55 PM" for this, which is its own slip: `h` is the 12-hour clock.
  ['formatDate(now(), "h:mm A")', '5:55 PM'],
  ['"Revenue: " + formatNumber(prop("Number"), "usd", 0).style("green")', 'Revenue: $7'],
  ['parseDate("2022-01-01")', 'January 1, 2022'], ['parseDate("2022-01-01T00:00Z")', 'January 1, 2022 00:00'],
  ['at([1, 2, 3], 1)', 2], ['first([1, 2, 3])', 1], ['last([1, 2, 3])', 3], ['slice([1, 2, 3], 1, 2)', [2]], ['slice(["a", "b", "c"], 1)', ['b', 'c']],
  ['concat([1, 2], [3, 4])', [1, 2, 3, 4]], ['concat(["a", "b"], ["c", "d"])', ['a', 'b', 'c', 'd']], ['sort([3, 1, 2])', [1, 2, 3]], ['reverse(["green", "eggs", "ham"])', ['ham', 'eggs', 'green']],
  ['join(["a", "b", "c"], ", ")', 'a, b, c'], ['join(["dog", "go"], "")', 'doggo'], ['split("apple,pear,orange", ",")', ['apple', 'pear', 'orange']], ['unique([1, 1, 2])', [1, 2]],
  ['includes(["a", "b", "c"], "b")', true], ['includes([1, 2, 3], 4)', false],
  ['find(["a", "b", "c"], current == "b")', 'b'], ['find([1, 2, 3], current > 100)', null], ['findIndex(["a", "b", "c"], current == "b")', 1], ['findIndex([1, 2, 3], current > 100)', -1],
  ['filter([1, 2, 3], current > 1)', [2, 3]], ['filter(["a", "b", "c"], current == "a")', ['a']], ['some([1, 2, 3], current == 2)', true], ['some(["a", "b", "c"], current.length > 2)', false], ['every([1, 2, 3], current > 0)', true], ['every(["a", "b", "c"], current == "b")', false],
  ['map([1, 2, 3], current + 1)', [2, 3, 4]], ['map([1, 2, 3], current + index)', [1, 3, 5]], ['flat([1, 2, 3])', [1, 2, 3]], ['flat([[1, 2], [3, 4]])', [1, 2, 3, 4]],
  ['id()', 'row-1'], ['equal(1, 1)', true], ['"a" == "b"', false], ['unequal(1, 2)', true], ['"a" != "a"', false],
  ['let(person, "Alan", "Hello, " + person + "!")', 'Hello, Alan!'], ['let(radius, 4, round(pi() * radius ^ 2))', 50], ['lets(a, "Hello", b, "world", a + " " + b)', 'Hello world'], ['lets(base, 3, height, 8, base * height / 2)', 12],
  ['" notion ".trim()', 'notion'],
]
for (const [typed, expected] of examples) test(`Notion's example: ${typed}`, () => assert.deepEqual(shown(run(typed)), expected))

test('every function in the list has its example, and it runs', () => {
  for (const f of functionList) {
    assert.ok(f.doc, `${f.name} has a line`)
    assert.ok(f.example, `${f.name} has an example`)
    assert.ok(!(run(f.example!.replace(/prop\("Start Date"\)/g, 'Start Date')) instanceof Error) || /Date Range|End Date/.test(f.example!), f.example)
  }
})

const language: Array<[string, unknown]> = [
  // Both call forms; bare names, with spaces, hyphens and Chinese; full-width punctuation outside a string.
  ['"hello".length()', 5], ['length("hello")', 5], ['Number + 1', 8], ['Sub-item * 2', 6], ['Sub-item-1', 2], ['进度 + 1', 41], ['if（Checked，“是”，“否”）', '是'], ['prop("进度")', 40], ['prop("number")', 7],
  ['Name', 'A row'], ['Text.upper()', 'HELLO'], ['Tags.length()', 2], ['Tags.first()', 'a'], ['Status', 'Done'], ['Status != "Done"', false], ['Status == "Done" ? 1 : 0', 1],
  ['if(and(now() > Due date, Status != "Done"), "Overdue", "")', ''],
  // Precedence: ^ binds tighter than unary minus's result, and is right-associative; a comment and a line break are nothing.
  ['2 ^ 3 ^ 2', 512], ['-2 ^ 2', -4], ['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['1 /* one */ +\n 2', 3], ['true ? 1 : false ? 2 : 3', 1], ['5 > 3 && 2 > 1', true],
  // Empty.
  ['empty("")', true], ['empty(1)', false], ['empty()', null],
  // Text and numbers meet the way "Score: " + 5 reads.
  ['"Score: " + 5', 'Score: 5'], ['5 + " points"', '5 points'], ['upper(5)', '5'], ['contains(Tags, "a")', true], ['replace("a-b", "(a)-(b)", "$2-$1")', 'b-a'],
  // Dates: the end of a month holds, and a week belongs to its Thursday's year.
  ['dateAdd(parseDate("2023-01-31"), 1, "month").formatDate("YYYY-MM-DD")', '2023-02-28'], ['week(parseDate("2021-01-03"))', 53], ['day(parseDate("2023-07-16"))', 7], ['dateBetween(parseDate("2023-03-01"), parseDate("2023-01-31"), "months")', 1],
  ['Start Date < End Date', true], ['Start Date == parseDate("2022-09-07")', true], ['Number > 5 and Text == "hello"', true],
  // Scope: a let's name wins over a property's, in its own body only; `current` nests.
  ['let(Number, 1, Number + 1)', 2], ['map([1, 2], map([10], current + 1).first() + current)', [12, 13]], ['lets(a, 1, b, a + 1, a + b)', 3],
  // Older Notion text-joining.
  ['concat("a", "b")', 'ab'],
]
for (const [typed, expected] of language) test(`language: ${typed}`, () => assert.deepEqual(shown(run(typed)), expected))

const refused: Array<[string, RegExp]> = [
  ['length(', /stops before|Expected/], ['1 +', /stops before/], ['if(true, 1)', /if takes 3 values, and got 2/], ['round(1, 2, 3)', /round takes 1 to 2 values, and got 3/], ['abs("x")', /abs expects a number there, not text/],
  ['dateAdd(5, 1, "days")', /expects a date there, not a number/], ['dateAdd(now(), 1, "fortnights")', /isn't a unit of time/], ['1 > "a"', /Can't compare a number with text/], ['nosuch(1)', /no function called "nosuch"/], ['Nosuch', /no property or function/], ['prop("Nosuch")', /no property called "Nosuch"/],
  ['current + 1', /only means something inside/], ['name(1)', /person type/], ['email(1)', /person type/], ['"abc', /closing "/], ['1 2', /Unexpected "2"/], ['[1, 2', /stops before|Expected/], ['let(1, 2, 3)', /starts with a name/],
]
for (const [typed, message] of refused) test(`refused: ${typed}`, () => {
  try {
    const out = run(typed)
    assert.ok(out instanceof Error, `gave ${JSON.stringify(out)}`)
    assert.match(out.message, message)
  } catch (error) { assert.match((error as Error).message, message) }
})

test('a row that breaks a formula reads Error on that row only, and an empty date reads empty', () => {
  assert.equal(shown(run('at(Tags, 5)')), null)
  assert.equal(shown(run('dateAdd(prop("Due date"), 1, "days").format()').valueOf() as Value), 'September 2, 2023')
  const empty = { ...row, values: {} } as Page
  const p: Property = { id: 'f', name: 'F', type: 'formula', formula: storedFormula('dateAdd(prop("Due date"), 1, "days")', db) }
  const { worked, errors } = runRow({ ...db, properties: [...properties, p] }, [p], empty, clock)
  assert.equal(worked.get('f'), null)
  assert.deepEqual(errors, {})
  assert.match(String(shown(run('test("a", "(")'))), /missing a \)/)
  assert.match(String(shown(run('test("a", "(?=a)")'))), /aren't supported/)
  assert.match(String(shown(run('test("aa", "(a)\\\\1")'))), /aren't supported/)
})

test('what is stored names properties by id, spacing kept; a rename reads through, and a deleted one is named as such', () => {
  const stored = storedFormula('Number  + prop("Text")', db)
  assert.equal(stored, 'prop("n")  + prop("t")')
  const renamed = { ...db, properties: properties.map(p => (p.id === 'n' ? { ...p, name: 'Count' } : p)) }
  assert.equal(shownFormula(stored, renamed), 'prop("Count")  + prop("Text")')
  assert.equal(shownFormula(stored, { ...db, properties: properties.filter(p => p.id !== 'n') }), 'prop("Deleted property")  + prop("Text")')
  assert.match(formulaProblem(stored, { ...db, properties: properties.filter(p => p.id !== 'n') }, 'f')!, /deleted/)
})

test('a loop is refused, and so is a chain past 15 layers; many paths to one formula cost one check', () => {
  const chain = (n: number): Property[] => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `F${i}`, type: 'formula' as const, formula: i ? `prop("f${i - 1}") + 1` : '1' }))
  const looped = { ...db, properties: chain(3) }
  assert.equal(formulaProblem('prop("f2")', looped, 'f0'), 'Cycle detected')
  assert.equal(formulaProblem('prop("f0")', looped, 'f0'), 'Cycle detected')
  assert.equal(formulaProblem('prop("f13") + 1', { ...db, properties: chain(14) }, 'next'), null)
  assert.match(formulaProblem('prop("f14") + 1', { ...db, properties: chain(15) }, 'next')!, /more than 15/)
  const diamonds: Property[] = Array.from({ length: 14 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, type: 'formula' as const, formula: i ? `prop("d${i - 1}") + prop("d${i - 1}")` : '1' }))
  const started = performance.now()
  assert.equal(formulaProblem('prop("d13")', { ...db, properties: diamonds }, 'next'), null)
  assert.ok(performance.now() - started < 100)
})

test('a formula made to be slow runs out at its row, and the rest of the view is spared', () => {
  const stored = storedFormula('map(split(repeat("x", 90000), ""), current + current).length()', db)
  const p: Property = { id: 'f', name: 'F', type: 'formula', formula: stored }
  const { errors } = runRow({ ...db, properties: [...properties, p] }, [p], row, clock)
  assert.equal(errors.f, 'Too long')
  const started = performance.now()
  const backtrack = storedFormula(`test(repeat("a", 30) + "b", "^(a+)+$")`, db)
  const r: Property = { id: 'f', name: 'F', type: 'formula', formula: backtrack }
  const done = runRow({ ...db, properties: [...properties, r] }, [r], row, clock)
  assert.equal(done.worked.get('f'), false)
  assert.ok(performance.now() - started < 200, `took ${performance.now() - started} ms`)
})

test('dates read in the zone asked for, so the Worker and the browser agree', () => {
  const vancouver = clockIn('America/Vancouver', Date.parse('2026-11-03T07:30:00Z'))
  const p: Property = { id: 'f', name: 'F', type: 'formula', formula: 'format(today())' }
  assert.equal(runRow({ ...db, properties: [p] }, [p], row, vancouver).worked.get('f'), 'November 2, 2026')
  // Across a change of clocks: an instant and its wall clock turn back into each other.
  for (const at of [Date.parse('2026-03-08T09:59:00Z'), Date.parse('2026-03-08T10:01:00Z'), Date.parse('2026-11-01T08:59:00Z'), Date.parse('2026-11-01T10:01:00Z')]) assert.equal(vancouver.instant(vancouver.wall(at)), at)
})

// ---------------------------------------------------------------- the regular expression engine, against the browser's
const spendNothing = () => {}
test('the engine finds what the built-in engine finds, across generated patterns', () => {
  let seed = 7
  const pick = <T,>(list: readonly T[]): T => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return list[seed % list.length]! }
  const atom = (depth: number): string => {
    const a = pick(['a', 'b', 'c', '.', '[ab]', '[^a]', '\\d', '\\w', '1', ...(depth < 3 ? ['(', '(?:'] : [])])
    return a === '(' || a === '(?:' ? `${a}${alternatives(depth + 1)})` : a
  }
  // A quantifier over something that can match nothing is the one place the two differ: the built-in engine discards an empty
  // turn and goes back for a longer one, and a linear engine, like RE2, takes it. `(?:1*?)?` on "1" gives "1" there and "" here.
  const piece = (depth: number) => {
    const a = atom(depth)
    const canBeEmpty = /^\(/.test(a) && new RegExp(`^${a}$`).test('')
    return a + (canBeEmpty ? '' : pick(['', '', '', '*', '+', '?', '{2}', '{1,2}', '*?', '+?', '??']))
  }
  const sequence = (depth: number) => Array.from({ length: 1 + (seed % 3) }, () => piece(depth)).join('')
  const alternatives = (depth: number): string => (pick([0, 0, 1]) ? `${sequence(depth)}|${sequence(depth)}` : sequence(depth))
  for (let i = 0; i < 3000; i++) {
    const anchorStart = pick(['', '', '^']), anchorEnd = pick(['', '', '$', '\\b'])
    const pattern = anchorStart + alternatives(0) + anchorEnd
    const text = Array.from({ length: seed % 9 }, () => pick(['a', 'b', 'c', '1', ' '])).join('')
    const native = [...text.matchAll(new RegExp(pattern, 'g'))].map(m => m[0])
    assert.deepEqual(new LinearRegex(pattern).all(text, spendNothing), native, `/${pattern}/ on "${text}"`)
  }
})
test('the engine: classes, escapes, Chinese, case, and what it refuses', () => {
  const all = (p: string, t: string) => new LinearRegex(p).all(t, spendNothing)
  assert.deepEqual(all('\\p{Script=Han}+', 'a中文b'), ['中文'])
  assert.deepEqual(all('[一-龥]', '中a'), ['中'])
  assert.deepEqual(all('.', '😀a'), ['😀', 'a'])
  assert.deepEqual(all('(?i)notion', 'NOTION notion'), ['NOTION', 'notion'])
  assert.deepEqual(all('a{,2}', 'a{,2}'), ['a{,2}'])
  assert.equal(new LinearRegex('(a)|(b)').replace('b', '[$1|$2]', true, spendNothing), '[|b]')
  assert.equal(new LinearRegex('x*').replace('ab', '-', true, spendNothing), '-a-b-')
  for (const bad of ['(', ')', '[a', 'a{2,1}', '*', '(?=a)', '(?<!a)', '(a)\\1', 'a'.repeat(3000)]) assert.throws(() => new LinearRegex(bad), RegexError, bad)
})
test('the engine takes time in proportion to the text, and stops when told', () => {
  let steps = 0
  const count = (n: number) => { steps += n }
  new LinearRegex('^(a+)+$').test(`${'a'.repeat(1000)}b`, count)
  const per = steps; steps = 0
  new LinearRegex('^(a+)+$').test(`${'a'.repeat(2000)}b`, count)
  assert.ok(steps < per * 2.2, `${per} then ${steps}`)
  assert.throws(() => new LinearRegex('a*').test('a'.repeat(1000), () => { throw new RangeError('out') }), RangeError)
})
