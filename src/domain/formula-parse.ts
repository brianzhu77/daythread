// The formula language's syntax (docs/design/formula.md §1): Notion's, both call forms, so a copied formula pastes. Text typed in the
// field names properties (`prop("Name")`, or bare); what's stored names them by id (`prop("id")`), so a rename changes nothing.

export type FormulaNode =
  | { k: 'lit'; v: number | string | boolean }
  | { k: 'list'; items: FormulaNode[] }
  | { k: 'prop'; id: string }
  | { k: 'var'; name: string }
  | { k: 'call'; fn: string; args: FormulaNode[] }
  | { k: 'let'; name: string; value: FormulaNode; body: FormulaNode }
  /**
   * `object.name`, or `.name(args)`. Which of the two, a page's property or a function, takes knowing what `object` is, so the
   * checker settles it: `reads` or `asCall`. `name` is a property's id in stored text, once `byProp`.
   */
  | { k: 'member'; object: FormulaNode; name: string; args: FormulaNode[] | null; byProp: boolean; ref: { from: number; to: number } | null; reads?: string; asCall?: FormulaNode }

export class FormulaSyntaxError extends Error {}

/** How names read in this text: as typed, by a property's name; as stored, by its id. */
export interface FormulaNames {
  /** Every property's name, for bare names. None for stored text, which only has `prop("id")`. */
  names: readonly string[]
  /** Every database's property names: after a dot, `Sub-item` reads as one, whichever database it turns out to be in. */
  memberNames: readonly string[]
  idOf(name: string): string | null
  stored: boolean
}
export interface PropRef { from: number; to: number; id: string }
export interface Parsed { tree: FormulaNode | null; refs: PropRef[] }

/** Functions whose argument after the list is worked out per item, with `current` and `index`. */
const perItem = new Set(['find', 'findIndex', 'filter', 'some', 'every', 'map'])
const binary: Array<Record<string, string>> = [
  { '||': 'or', or: 'or' },
  { '&&': 'and', and: 'and' },
  { '==': 'equal', '!=': 'unequal' },
  { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' },
  { '+': 'add', '-': 'subtract' },
  { '*': 'multiply', '/': 'divide', '%': 'mod' },
]
const operators = ['==', '!=', '>=', '<=', '&&', '||', '+', '-', '*', '/', '%', '^', '>', '<', '!', '?', ':', '(', ')', '[', ']', ',', '.']
// A Chinese keyboard's punctuation, outside a string: the error would otherwise be invisible (design §4).
const halfWidth: Record<string, string> = { '（': '(', '）': ')', '，': ',', '：': ':', '？': '?', '！': '!' }
const identStart = /^[\p{L}_]/u
const identChar = /[\p{L}\p{N}_]/u
const maxDepth = 100

function longestAt(text: string, from: number, namesByLength: readonly string[]): string | null {
  for (const name of namesByLength) {
    if (!name || !text.startsWith(name, from)) continue
    const next = text.codePointAt(from + name.length)
    if (next === undefined || !identChar.test(String.fromCodePoint(next))) return name
  }
  return null
}

type Token = { kind: 'num' | 'str' | 'ident' | 'op' | 'end'; text: string; value?: number | string; from: number; to: number }

class Parser {
  private at = 0
  private token!: Token
  private depth = 0
  private scope: string[] = []
  refs: PropRef[] = []
  private readonly byLength: string[]
  private readonly membersByLength: string[]
  private readonly text: string
  private readonly names: FormulaNames
  constructor(text: string, names: FormulaNames) {
    this.text = text
    this.names = names
    this.byLength = [...names.names].sort((a, b) => b.length - a.length)
    this.membersByLength = [...names.memberNames].sort((a, b) => b.length - a.length)
  }
  parse(): FormulaNode | null {
    this.advance()
    if (this.atEnd()) return null
    const tree = this.expression()
    if (!this.atEnd()) throw new FormulaSyntaxError(`Unexpected ${this.shown()}`)
    return tree
  }
  private atEnd() {
    return this.token.kind === 'end'
  }
  private shown(): string {
    return this.token.kind === 'end' ? 'end of formula' : `"${this.token.text}"`
  }
  private skipSpace() {
    for (;;) {
      while (this.at < this.text.length && /\s/.test(this.text[this.at]!)) this.at++
      if (!this.text.startsWith('/*', this.at)) return
      const close = this.text.indexOf('*/', this.at + 2)
      if (close < 0) throw new FormulaSyntaxError('A comment is missing its */')
      this.at = close + 2
    }
  }
  private advance() {
    this.skipSpace()
    const from = this.at, c = this.text[from]
    if (c === undefined) { this.token = { kind: 'end', text: '', from, to: from }; return }
    if (c === '"' || c === '“') { this.token = this.stringToken(from); return }
    const number = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.text.slice(from, from + 40))
    if (number) { this.at += number[0].length; this.token = { kind: 'num', text: number[0], value: Number(number[0]), from, to: this.at }; return }
    if (halfWidth[c]) { this.at++; this.token = { kind: 'op', text: halfWidth[c]!, from, to: this.at }; return }
    const first = String.fromCodePoint(this.text.codePointAt(from)!)
    if (identStart.test(first)) {
      this.at += first.length
      while (this.at < this.text.length) {
        const next = String.fromCodePoint(this.text.codePointAt(this.at)!)
        if (!identChar.test(next)) break
        this.at += next.length
      }
      this.token = { kind: 'ident', text: this.text.slice(from, this.at), from, to: this.at }
      return
    }
    const op = operators.find(o => this.text.startsWith(o, from))
    if (!op) throw new FormulaSyntaxError(`Unexpected "${first}"`)
    this.at += op.length
    this.token = { kind: 'op', text: op, from, to: this.at }
  }
  private stringToken(from: number): Token {
    let out = ''
    for (let i = from + 1; i < this.text.length; i++) {
      const c = this.text[i]!
      if (c === '"' || c === '”') { this.at = i + 1; return { kind: 'str', text: this.text.slice(from, i + 1), value: out, from, to: this.at } }
      if (c !== '\\') { out += c; continue }
      const next = this.text[++i]
      // Anything else keeps its backslash, so "\d" and "\\d" both reach a regular expression as \d.
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === '"' || next === '\\' || next === '”' ? next : `\\${next ?? ''}`
    }
    throw new FormulaSyntaxError('A string is missing its closing "')
  }
  private isOp(text: string) {
    return this.token.kind === 'op' && this.token.text === text
  }
  private expect(text: string, after: string) {
    if (!this.isOp(text)) throw new FormulaSyntaxError(`Expected ${text} ${after}, found ${this.shown()}`)
    this.advance()
  }
  private expression(): FormulaNode {
    if (++this.depth > maxDepth) throw new FormulaSyntaxError('This formula is nested too deeply')
    const cond = this.binaryLevel(0)
    let out = cond
    if (this.isOp('?')) {
      this.advance()
      const yes = this.expression()
      this.expect(':', 'in X ? Y : Z')
      out = { k: 'call', fn: 'if', args: [cond, yes, this.expression()] }
    }
    this.depth--
    return out
  }
  private binaryLevel(level: number): FormulaNode {
    if (level === binary.length) return this.unary()
    let left = this.binaryLevel(level + 1)
    for (;;) {
      const fn = this.token.kind === 'op' || this.token.kind === 'ident' ? binary[level]![this.token.text] : undefined
      if (!fn) return left
      this.advance()
      left = { k: 'call', fn, args: [left, this.binaryLevel(level + 1)] }
    }
  }
  private unary(): FormulaNode {
    if (++this.depth > maxDepth) throw new FormulaSyntaxError('This formula is nested too deeply')
    let out: FormulaNode
    if (this.isOp('-')) { this.advance(); out = { k: 'call', fn: 'negate', args: [this.unary()] } }
    else if (this.isOp('+')) { this.advance(); out = this.unary() }
    else if (this.isOp('!') || (this.token.kind === 'ident' && this.token.text === 'not' && !this.opensCall(this.token.to))) { this.advance(); out = { k: 'call', fn: 'not', args: [this.unary()] } }
    else out = this.power()
    this.depth--
    return out
  }
  private power(): FormulaNode {
    const base = this.postfix()
    if (!this.isOp('^')) return base
    this.advance()
    return { k: 'call', fn: 'pow', args: [base, this.unary()] }
  }
  private postfix(): FormulaNode {
    let node = this.primary()
    while (this.isOp('.')) {
      this.advance()
      node = this.member(node)
    }
    return node
  }
  private member(object: FormulaNode): FormulaNode {
    const t = this.token
    if (t.kind === 'ident' && t.text === 'prop' && this.opensCall(t.to)) {
      this.advance()
      this.expect('(', 'after prop')
      if (this.token.kind !== 'str') throw new FormulaSyntaxError("prop takes a property's name in quotes")
      const name = this.token.value as string
      this.advance()
      if (!this.isOp(')')) throw new FormulaSyntaxError(`Expected ) after prop, found ${this.shown()}`)
      const to = this.token.to
      this.advance()
      return { k: 'member', object, name, args: null, byProp: true, ref: { from: t.from, to } }
    }
    const named = t.kind === 'ident' || t.kind === 'num' ? longestAt(this.text, t.from, this.membersByLength) : null
    // A function's name with its parentheses is the function, even if a property goes by it too.
    if (named && !(t.kind === 'ident' && named === t.text && this.opensCall(t.to))) {
      this.at = t.from + named.length
      this.advance()
      return { k: 'member', object, name: named, args: null, byProp: false, ref: { from: t.from, to: t.from + named.length } }
    }
    if (t.kind !== 'ident') throw new FormulaSyntaxError(`Expected a function or a property after ".", found ${this.shown()}`)
    this.advance()
    // `current.length`, as Notion's page writes it, is a call with nothing further to pass.
    return { k: 'member', object, name: t.text, args: this.isOp('(') ? this.callArgs(t.text, 0) : null, byProp: false, ref: null }
  }
  private afterSpace(from: number) {
    let i = from
    while (i < this.text.length && /\s/.test(this.text[i]!)) i++
    return i
  }
  private opensCall(from: number) {
    const c = this.text[this.afterSpace(from)]
    return c === '(' || c === '（'
  }
  private isComma(from: number) {
    const c = this.text[this.afterSpace(from)]
    return c === ',' || c === '，'
  }
  private primary(): FormulaNode {
    const t = this.token
    if (t.kind === 'str') { this.advance(); return { k: 'lit', v: t.value as string } }
    if (this.isOp('(')) {
      this.advance()
      const inner = this.expression()
      this.expect(')', 'to close (')
      return inner
    }
    if (this.isOp('[')) {
      this.advance()
      const items: FormulaNode[] = []
      while (!this.isOp(']')) {
        items.push(this.expression())
        if (this.isOp(',')) this.advance()
        else if (!this.isOp(']')) throw new FormulaSyntaxError(`Expected , or ] in a list, found ${this.shown()}`)
      }
      this.advance()
      return { k: 'list', items }
    }
    if (t.kind === 'ident' && this.opensCall(t.to)) return this.callNode(t)
    if (t.kind === 'ident' && this.scope.includes(t.text)) { this.advance(); return { k: 'var', name: t.text } }
    const bare = t.kind === 'ident' || t.kind === 'num' ? this.bareName(t.from) : null
    if (bare) return this.takeBare(t.from, bare)
    if (t.kind === 'num') { this.advance(); return { k: 'lit', v: t.value as number } }
    if (t.kind === 'ident') {
      if (t.text === 'true' || t.text === 'false') { this.advance(); return { k: 'lit', v: t.text === 'true' } }
      if (t.text === 'current' || t.text === 'index') throw new FormulaSyntaxError(`${t.text} only means something inside map, filter, find, findIndex, some or every`)
      throw new FormulaSyntaxError(`There's no property or function called "${t.text}"`)
    }
    throw new FormulaSyntaxError(t.kind === 'end' ? 'This formula stops before it finishes' : `Unexpected ${this.shown()}`)
  }
  /** The longest property name starting here, so `Sub-item` and `Due date` read as one. */
  private bareName(from: number): string | null {
    return longestAt(this.text, from, this.byLength)
  }
  private takeBare(from: number, name: string): FormulaNode {
    this.at = from + name.length
    const id = this.names.idOf(name)!
    this.refs.push({ from, to: this.at, id })
    this.advance()
    return { k: 'prop', id }
  }
  private callNode(t: Token): FormulaNode {
    if (t.text === 'prop') return this.propCall(t)
    if (t.text === 'let' || t.text === 'lets') return this.letCall(t.text)
    this.advance()
    return { k: 'call', fn: t.text, args: this.callArgs(t.text, 1) }
  }
  private callArgs(fn: string, itemAt: number): FormulaNode[] {
    this.expect('(', `after ${fn}`)
    const args: FormulaNode[] = []
    while (!this.isOp(')')) {
      const item = perItem.has(fn) && args.length === itemAt
      if (item) this.scope.push('current', 'index')
      args.push(this.expression())
      if (item) this.scope.length -= 2
      if (this.isOp(',')) this.advance()
      else if (!this.isOp(')')) throw new FormulaSyntaxError(`Expected , or ) in ${fn}, found ${this.shown()}`)
    }
    this.advance()
    return args
  }
  private propCall(t: Token): FormulaNode {
    this.advance()
    this.expect('(', 'after prop')
    if (this.token.kind !== 'str') throw new FormulaSyntaxError('prop takes a property\'s name in quotes')
    const name = this.token.value as string
    const id = this.names.stored ? name : this.names.idOf(name)
    if (id === null) throw new FormulaSyntaxError(`There's no property called "${name}"`)
    this.advance()
    if (!this.isOp(')')) throw new FormulaSyntaxError(`Expected ) after prop, found ${this.shown()}`)
    this.refs.push({ from: t.from, to: this.token.to, id })
    this.advance()
    return { k: 'prop', id }
  }
  private letCall(fn: string): FormulaNode {
    this.advance()
    this.expect('(', `after ${fn}`)
    const bindings: Array<{ name: string; value: FormulaNode }> = []
    const pushed = this.scope.length
    for (;;) {
      // In `lets`, what's left after pairs is the result, so a name is only a name if `, value ,` follows it.
      if (this.token.kind !== 'ident' || !this.isComma(this.token.to)) {
        if (!bindings.length) throw new FormulaSyntaxError(`${fn} starts with a name, then its value`)
        break
      }
      const name = this.token.text
      this.advance()
      this.advance()
      bindings.push({ name, value: this.expression() })
      this.scope.push(name)
      this.expect(',', `after ${name}'s value, then the result`)
      if (fn === 'let') break
    }
    const body = this.expression()
    this.scope.length = pushed
    this.expect(')', `to close ${fn}`)
    return bindings.reduceRight<FormulaNode>((inner, b) => ({ k: 'let', name: b.name, value: b.value, body: inner }), body)
  }
}

export function parseFormula(text: string, names: FormulaNames): Parsed {
  const parser = new Parser(text, names)
  return { tree: parser.parse(), refs: parser.refs }
}

/** The references up to where the text stops making sense, as it does mid-typing, so what's already written still reads as written. */
export function partialRefs(text: string, names: FormulaNames): Parsed {
  let parser: Parser | null = null
  try {
    parser = new Parser(text, names)
    return { tree: parser.parse(), refs: parser.refs }
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return { tree: null, refs: parser?.refs ?? [] }
    throw error
  }
}

/** The same text with each reference to a property rewritten, leaving the rest as written, spacing and all. */
export function rewriteRefs(text: string, refs: readonly PropRef[], write: (id: string) => string): string {
  let out = '', last = 0
  for (const ref of [...refs].sort((a, b) => a.from - b.from)) {
    out += text.slice(last, ref.from) + write(ref.id)
    last = ref.to
  }
  return out + text.slice(last)
}
