// Regular expressions for formulas (docs/design/formula.md §5). A Pike VM: every thread advances one character at a time, so a
// pattern's time grows with the text and its own size, never by backtracking, and the row's step budget can always stop it.
// Written here because the evaluator is synchronous and runs on the Worker too, and re2js adds 46 KB gzipped to do the same.
// A character class is handed to the browser's own engine, one character at a time, which is safe: a single character can't backtrack.

export class RegexError extends Error {}
type Test = (c: string) => boolean
type Assertion = 'start' | 'end' | 'word' | 'notWord'
type Tree =
  | { k: 'char'; test: Test }
  | { k: 'cat'; items: Tree[] }
  | { k: 'alt'; items: Tree[] }
  | { k: 'rep'; node: Tree; min: number; max: number; lazy: boolean }
  | { k: 'group'; node: Tree; index: number }
  | { k: 'assert'; kind: Assertion }
type Inst =
  | { op: 'char'; test: Test }
  | { op: 'split'; x: number; y: number }
  | { op: 'jmp'; to: number }
  | { op: 'save'; slot: number }
  | { op: 'assert'; kind: Assertion }
  | { op: 'match' }

const maxPattern = 2000, maxProgram = 5000, maxNesting = 100
const lineEnds = new Set(['\n', '\r', ' ', ' '])
const isWord = (c: string | undefined) => c !== undefined && /^[A-Za-z0-9_]$/.test(c)

class PatternParser {
  private at = 0
  private depth = 0
  groups = 0
  private ignoreCase = false
  private chars: string[]
  constructor(pattern: string) {
    if (pattern.startsWith('(?i)')) { this.ignoreCase = true; pattern = pattern.slice(4) }
    this.chars = Array.from(pattern)
  }
  parse(): Tree {
    const tree = this.alternatives()
    if (this.at < this.chars.length) throw new RegexError('That pattern has an extra )')
    return tree
  }
  private alternatives(): Tree {
    if (++this.depth > maxNesting) throw new RegexError('That pattern is nested too deeply')
    const items = [this.sequence()]
    while (this.chars[this.at] === '|') { this.at++; items.push(this.sequence()) }
    this.depth--
    return items.length === 1 ? items[0]! : { k: 'alt', items }
  }
  private sequence(): Tree {
    const items: Tree[] = []
    while (this.at < this.chars.length && this.chars[this.at] !== '|' && this.chars[this.at] !== ')') items.push(this.repeated())
    return items.length === 1 ? items[0]! : { k: 'cat', items }
  }
  private repeated(): Tree {
    let node = this.atom()
    for (;;) {
      const range = this.quantifier()
      if (!range) return node
      if (node.k === 'assert') throw new RegexError('Nothing to repeat there')
      const lazy = this.chars[this.at] === '?'
      if (lazy) this.at++
      node = { k: 'rep', node, min: range[0], max: range[1], lazy }
    }
  }
  private quantifier(): [number, number] | null {
    const c = this.chars[this.at]
    if (c === '*') { this.at++; return [0, Infinity] }
    if (c === '+') { this.at++; return [1, Infinity] }
    if (c === '?') { this.at++; return [0, 1] }
    if (c !== '{') return null
    // As in JavaScript, a brace that isn't a count is just a brace.
    const found = /^\{(\d+)(,(\d*))?\}/.exec(this.chars.slice(this.at, this.at + 16).join(''))
    if (!found) return null
    this.at += found[0].length
    const min = Number(found[1]), max = found[2] === undefined ? min : found[3] ? Number(found[3]) : Infinity
    if (max < min) throw new RegexError('That pattern has a count out of order')
    return [min, max]
  }
  private atom(): Tree {
    const c = this.chars[this.at++]!
    switch (c) {
      case '(': return this.group()
      case '[': return this.charClass()
      case '.': return { k: 'char', test: x => !lineEnds.has(x) }
      case '^': return { k: 'assert', kind: 'start' }
      case '$': return { k: 'assert', kind: 'end' }
      case '\\': return this.escape()
      case '*': case '+': case '?': throw new RegexError('Nothing to repeat there')
      default: return this.literal(c)
    }
  }
  private group(): Tree {
    let capture = true
    if (this.chars[this.at] === '?') {
      const next = this.chars[this.at + 1], after = this.chars[this.at + 2]
      if (next === '=' || next === '!' || (next === '<' && (after === '=' || after === '!'))) throw new RegexError("Lookahead and lookbehind aren't supported here")
      if (next === ':') { capture = false; this.at += 2 }
      else if (next === '<') { const close = this.chars.indexOf('>', this.at); if (close < 0) throw new RegexError('That pattern has an unfinished group name'); this.at = close + 1 }
      else throw new RegexError("That kind of group isn't supported here")
    }
    const index = capture ? ++this.groups : 0
    const inner = this.alternatives()
    if (this.chars[this.at] !== ')') throw new RegexError('That pattern is missing a )')
    this.at++
    return capture ? { k: 'group', node: inner, index } : inner
  }
  private charClass(): Tree {
    const start = this.at - 1
    let i = this.at
    if (this.chars[i] === '^') i++
    while (i < this.chars.length && this.chars[i] !== ']') i += this.chars[i] === '\\' ? 2 : 1
    if (i >= this.chars.length) throw new RegexError('That pattern is missing a ]')
    this.at = i + 1
    return { k: 'char', test: this.native(this.chars.slice(start, i + 1).join('')) }
  }
  private escape(): Tree {
    const c = this.chars[this.at++]
    if (c === undefined) throw new RegexError('That pattern ends with a backslash')
    if ('dDwWsS'.includes(c)) return { k: 'char', test: this.native(`\\${c}`) }
    if (c === 'p' || c === 'P') {
      const close = this.chars.indexOf('}', this.at)
      if (this.chars[this.at] !== '{' || close < 0) throw new RegexError(`\\${c} needs a {name}`)
      const source = `\\${c}${this.chars.slice(this.at, close + 1).join('')}`
      this.at = close + 1
      return { k: 'char', test: this.native(source) }
    }
    if (c === 'b') return { k: 'assert', kind: 'word' }
    if (c === 'B') return { k: 'assert', kind: 'notWord' }
    if ((c >= '1' && c <= '9') || c === 'k') throw new RegexError("Backreferences aren't supported here")
    const control: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', 0: '\0' }
    if (control[c]) return this.literal(control[c]!)
    if (c === 'x' || c === 'u') return this.literal(this.codePoint(c))
    return this.literal(c)
  }
  private codePoint(c: string): string {
    const rest = this.chars.slice(this.at, this.at + 10).join('')
    const found = c === 'x' ? /^[0-9a-fA-F]{2}/.exec(rest) : /^(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/.exec(rest)
    if (!found) return c
    this.at += found[0].length
    const n = parseInt(found[0].replace(/[{}]/g, ''), 16)
    if (n > 0x10ffff) throw new RegexError('That pattern has a character out of range')
    return String.fromCodePoint(n)
  }
  private literal(c: string): Tree {
    if (!this.ignoreCase) return { k: 'char', test: x => x === c }
    const folded = c.toLowerCase()
    return { k: 'char', test: x => x.toLowerCase() === folded }
  }
  private native(source: string): Test {
    const flags = this.ignoreCase ? 'i' : ''
    let re: RegExp
    // `u` is what makes \p{...} and astral characters work, but it refuses escapes a non-Unicode pattern allows, like [\_].
    try { re = new RegExp(`^${source}$`, `su${flags}`) } catch {
      try { re = new RegExp(`^${source}$`, `s${flags}`) } catch { throw new RegexError(`That pattern's ${source} isn't valid`) }
    }
    return x => re.test(x)
  }
}

function emit(tree: Tree): Inst[] {
  const prog: Inst[] = []
  const push = (inst: Inst) => { if (prog.length >= maxProgram) throw new RegexError('That pattern is too long'); prog.push(inst); return prog.length - 1 }
  const walk = (t: Tree): void => {
    switch (t.k) {
      case 'char': push({ op: 'char', test: t.test }); return
      case 'assert': push({ op: 'assert', kind: t.kind }); return
      case 'cat': t.items.forEach(walk); return
      case 'group': push({ op: 'save', slot: t.index * 2 }); walk(t.node); push({ op: 'save', slot: t.index * 2 + 1 }); return
      case 'alt': {
        const jumps: number[] = []
        t.items.forEach((item, i) => {
          if (i === t.items.length - 1) { walk(item); return }
          const split = push({ op: 'split', x: 0, y: 0 }) as number
          ;(prog[split] as { x: number }).x = prog.length
          walk(item)
          jumps.push(push({ op: 'jmp', to: 0 }))
          ;(prog[split] as { y: number }).y = prog.length
        })
        for (const j of jumps) (prog[j] as { to: number }).to = prog.length
        return
      }
      case 'rep': {
        for (let i = 0; i < t.min; i++) walk(t.node)
        const branch = (split: number, into: number, out: number) => { const inst = prog[split] as { x: number; y: number }; inst.x = t.lazy ? out : into; inst.y = t.lazy ? into : out }
        if (t.max === Infinity) {
          const split = push({ op: 'split', x: 0, y: 0 })
          walk(t.node)
          push({ op: 'jmp', to: split })
          branch(split, split + 1, prog.length)
        } else {
          const splits: number[] = []
          for (let i = t.min; i < t.max; i++) { splits.push(push({ op: 'split', x: 0, y: 0 })); walk(t.node) }
          for (const split of splits) branch(split, split + 1, prog.length)
        }
      }
    }
  }
  push({ op: 'save', slot: 0 })
  walk(tree)
  push({ op: 'save', slot: 1 })
  push({ op: 'match' })
  return prog
}

type Slots = readonly number[]
export type Spend = (steps: number) => void

export class LinearRegex {
  private prog: Inst[]
  private slots: number
  constructor(pattern: string) {
    if (pattern.length > maxPattern) throw new RegexError('That pattern is too long')
    const parser = new PatternParser(pattern)
    this.prog = emit(parser.parse())
    this.slots = (parser.groups + 1) * 2
  }
  /** The leftmost match from `from`, with the same preference among alternatives a backtracking engine has. */
  private exec(chars: readonly string[], from: number, spend: Spend): Slots | null {
    const { prog } = this
    const seen = new Int32Array(prog.length).fill(-1)
    const add = (list: Array<{ pc: number; caps: Slots }>, pc: number, at: number, caps: Slots): void => {
      if (seen[pc] === at) return
      seen[pc] = at
      const inst = prog[pc]!
      switch (inst.op) {
        case 'jmp': add(list, inst.to, at, caps); return
        case 'split': add(list, inst.x, at, caps); add(list, inst.y, at, caps); return
        case 'save': { const next = [...caps]; next[inst.slot] = at; add(list, pc + 1, at, next); return }
        case 'assert': if (this.holds(inst.kind, chars, at)) add(list, pc + 1, at, caps); return
        default: list.push({ pc, caps })
      }
    }
    const none: Slots = new Array(this.slots).fill(-1)
    let current: Array<{ pc: number; caps: Slots }> = []
    let best: Slots | null = null
    for (let at = from; ; at++) {
      // A new start is the lowest priority, and none once there's a match: leftmost wins.
      if (!best) add(current, 0, at, none)
      if (!current.length) break
      spend(current.length)
      const next: typeof current = []
      for (const thread of current) {
        const inst = prog[thread.pc]!
        if (inst.op === 'match') { best = thread.caps; break }
        if (inst.op === 'char' && at < chars.length && inst.test(chars[at]!)) add(next, thread.pc + 1, at + 1, thread.caps)
      }
      current = next
      if (at >= chars.length) break
    }
    return best
  }
  private holds(kind: Assertion, chars: readonly string[], at: number): boolean {
    switch (kind) {
      case 'start': return at === 0
      case 'end': return at === chars.length
      default: { const edge = isWord(chars[at - 1]) !== isWord(chars[at]); return kind === 'word' ? edge : !edge }
    }
  }
  private *matches(chars: readonly string[], spend: Spend): Generator<Slots> {
    let from = 0
    while (from <= chars.length) {
      const m = this.exec(chars, from, spend)
      if (!m) return
      yield m
      from = m[1]! === m[0]! ? m[1]! + 1 : m[1]!
    }
  }
  test(text: string, spend: Spend): boolean {
    return this.exec(Array.from(text), 0, spend) !== null
  }
  all(text: string, spend: Spend): string[] {
    const chars = Array.from(text), found: string[] = []
    for (const m of this.matches(chars, spend)) found.push(chars.slice(m[0]!, m[1]!).join(''))
    return found
  }
  replace(text: string, by: string, every: boolean, spend: Spend): string {
    const chars = Array.from(text)
    let out = '', last = 0
    for (const m of this.matches(chars, spend)) {
      out += chars.slice(last, m[0]!).join('') + by.replace(/\$(\$|&|\d{1,2})/g, (all, what: string) => {
        if (what === '$') return '$'
        if (what === '&') return chars.slice(m[0]!, m[1]!).join('')
        const slot = Number(what) * 2
        if (slot === 0 || slot >= m.length) return all
        return m[slot]! < 0 || m[slot + 1]! < 0 ? '' : chars.slice(m[slot]!, m[slot + 1]!).join('')
      })
      last = m[1]!
      if (!every) break
    }
    return out + chars.slice(last).join('')
  }
}

const compiled = new Map<string, LinearRegex | RegexError>()
/** One engine per pattern: a view asks for the same few, once per row. */
export function regexOf(pattern: string): LinearRegex {
  let re = compiled.get(pattern)
  if (!re) {
    try { re = new LinearRegex(pattern) } catch (error) { if (!(error instanceof RegexError)) throw error; re = error }
    if (compiled.size >= 200) compiled.clear()
    compiled.set(pattern, re)
  }
  if (re instanceof RegexError) throw re
  return re
}
