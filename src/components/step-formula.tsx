// A formula in a button's or a rule's step (buttons.md §2): the field, with what's wrong or what it gives under it. It keeps nothing itself: the step holds the stored text.
import { useMemo, useRef, useState } from 'react'

import { checkStepTyped, propertyTokens, shownFormula, stepFormulaFits, type FormulaWorld } from '../domain/formula'
import type { VariableTypes } from '../domain/step-formulas'
import type { Database, Property } from '../domain/database'
import { Doc, Reference, TokenBacking, type FunctionDoc } from './formula-editor'

const givesWord = (type: string) => (type === 'number' ? 'a number' : type === 'text' ? 'text' : type === 'boolean' ? 'true or false' : type === 'date' ? 'a date' : type.includes('page') ? 'pages' : type.startsWith('list') ? 'a list' : 'a value')
const noDatabase = { properties: [] } as unknown as Database

export function StepFormula({ label, stored, world, databaseId, variables, property, autoFocus, onChange }: { label: string; stored: string; world: FormulaWorld; databaseId: string; variables: VariableTypes; property?: Property; autoFocus?: boolean; onChange(stored: string): void }) {
  const [text, setText] = useState(() => shownFormula(stored, world, databaseId, variables))
  // As in the column's field: what's being spelled in pinyin isn't an error yet.
  const [settled, setSettled] = useState(text)
  const [listOpen, setListOpen] = useState(false)
  const [picked, setPicked] = useState<FunctionDoc | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false), composingFrom = useRef(0)
  const check = useMemo(() => checkStepTyped(settled, world, databaseId, variables), [settled, world, databaseId, variables])
  const fits = 'type' in check && property ? stepFormulaFits(check.type, property) : null
  const put = (next: string) => { const now = checkStepTyped(next, world, databaseId, variables); onChange('stored' in now ? now.stored : next) }
  const change = (next: string) => {
    setText(next)
    if (!composing.current) { setSettled(next); put(next) }
  }
  const insert = (words: string, caretBack = 0) => {
    const el = field.current, from = el?.selectionStart ?? text.length, to = el?.selectionEnd ?? text.length
    change(text.slice(0, from) + words + text.slice(to))
    setListOpen(false)
    requestAnimationFrame(() => { el?.focus(); const at = from + words.length - caretBack; el?.setSelectionRange(at, at) })
  }
  const tokens = useMemo(() => propertyTokens(text, world, databaseId, variables), [text, world, databaseId, variables])
  const shownTokens = composing.current ? tokens.filter(t => t.to <= composingFrom.current) : tokens
  const message = 'error' in check ? check.error : fits
  const gives = !message && 'type' in check && settled.trim() ? `Gives ${givesWord(check.type)}` : ''
  return <div className="step-formula">
    <div className="formula-field-box">
      <textarea ref={field} className="formula-field" aria-label={label} rows={2} autoFocus={autoFocus} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={text}
        onChange={e => change(e.target.value)}
        onCompositionStart={e => { composing.current = true; composingFrom.current = e.currentTarget.selectionStart }}
        onCompositionEnd={e => { composing.current = false; setSettled(e.currentTarget.value); put(e.currentTarget.value) }} />
      <TokenBacking text={text} tokens={shownTokens} field={field} />
    </div>
    <p className={`formula-status${message ? ' is-error' : ''}`} role="status">{settled.trim() ? message ?? gives : ''}</p>
    {picked && !listOpen && <Doc of={picked} />}
    <button type="button" className="formula-list-toggle" aria-expanded={listOpen} onClick={() => setListOpen(o => !o)}>Properties and functions</button>
    {listOpen && <Reference db={world.databases.get(databaseId) ?? noDatabase} propertyId="" picked={picked} setPicked={setPicked} insert={insert} wide={false} variables={[...variables.keys()]} />}
  </div>
}
