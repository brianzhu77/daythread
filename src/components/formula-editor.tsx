// Edit formula (docs/design/formula.md §4): the text on top, what's wrong or what it gives right under it, and the properties and
// functions to pick from: beside it at 1280, one tap away at 390. What doesn't work can't replace what does: Done says why, and Cancel leaves it.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { databaseRows, titleId, type Database } from '../domain/database'
import { checkTyped, clockIn, previewFormula, propertyTokens, shownFormula, worldOf, writtenName } from '../domain/formula'
import { functionList } from '../domain/formula-functions'
import type { Page, Workspace } from '../domain/types'
import { displayPageTitle } from './page-title'

const shortened = (text: string) => (text.length > 300 ? `${text.slice(0, 300)}…` : text)
const groups = ['Logic and text', 'Numbers', 'Dates', 'Lists', 'Other'] as const

/**
 * The same text behind the field, with each property as a token (G2-7). The field stays a plain textarea on top, so typing, Pinyin, paste and a phone's delete key are
 * what they always were, and a token is only drawn: stored text and what's typed don't know about it. So it has to wrap and scroll exactly as the field does.
 */
export function TokenBacking({ text, tokens, field }: { text: string; tokens: readonly { from: number; to: number }[]; field: RefObject<HTMLTextAreaElement | null> }) {
  const backing = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = field.current, behind = backing.current
    if (!el || !behind) return
    // A scrollbar takes width from the field's text, so the same goes from this one's.
    const fit = () => { behind.style.right = `${el.offsetWidth - el.clientWidth - el.clientLeft * 2}px`; behind.scrollTop = el.scrollTop }
    fit()
    const seen = new ResizeObserver(fit)
    seen.observe(el)
    el.addEventListener('scroll', fit, { passive: true })
    return () => { seen.disconnect(); el.removeEventListener('scroll', fit) }
  }, [field])
  useLayoutEffect(() => {
    if (backing.current && field.current) backing.current.scrollTop = field.current.scrollTop
  })
  const parts: ReactNode[] = []
  let last = 0
  for (const { from, to } of tokens) {
    if (from < last) continue
    parts.push(text.slice(last, from), <span key={from} className="formula-token">{text.slice(from, to)}</span>)
    last = to
  }
  // A last empty line takes height only with something on it, as it does in the field.
  parts.push(text.slice(last), '\u200b')
  return <div ref={backing} className="formula-backing" aria-hidden="true">{parts}</div>
}

export type FunctionDoc = (typeof functionList)[number]
export const Doc = ({ of }: { of: FunctionDoc }) => <div className="formula-doc">
  <p className="formula-doc-name">{of.name}</p>
  <p>{of.doc}</p>
  {of.example && <code>{of.example}</code>}
</div>

export function Reference({ db, propertyId, picked, setPicked, insert, wide, variables = [] }: { db: Database; propertyId: string; picked: FunctionDoc | null; setPicked(f: FunctionDoc): void; insert(text: string, caretBack?: number): void; wide: boolean; variables?: readonly string[] }) {
  const names = [{ id: titleId, name: 'Name' }, ...db.properties.filter(p => p.id !== propertyId)]
  return <div className="formula-reference">
    <div className="formula-list" role="list" aria-label="Properties and functions">
      {variables.length > 0 && <p className="formula-group">Variables</p>}
      {variables.map(name => <button key={name} type="button" className="formula-item" onClick={() => insert(name)}>{name}</button>)}
      <p className="formula-group">Properties</p>
      {names.map(p => <button key={p.id} type="button" className="formula-item" onClick={() => insert(writtenName(p.name))}>{p.name}</button>)}
      {groups.map(group => <div key={group}>
        <p className="formula-group">{group}</p>
        {functionList.filter(f => f.group === group).map(f => <button key={f.name} type="button" className={`formula-item is-function${picked?.name === f.name ? ' is-active' : ''}`} onClick={() => { setPicked(f); insert(`${f.name}()`, 1) }}>{f.name}</button>)}
      </div>)}
    </div>
    {wide && picked && <Doc of={picked} />}
  </div>
}

export function FormulaEditor({ workspace, read, db, propertyId, stored, wide, onDone, onCancel }: { workspace: Workspace; read: Workspace; db: Page & { database: Database }; propertyId: string; stored: string; wide: boolean; onDone(stored: string): void; onCancel(): void }) {
  const world = worldOf(workspace)
  const [text, setText] = useState(() => shownFormula(stored, world, db.id))
  // The field doesn't react mid-composition, so what's being spelled in pinyin isn't an error yet (design §4).
  const [settled, setSettled] = useState(text)
  const [refused, setRefused] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [picked, setPicked] = useState<FunctionDoc | null>(null)
  const composing = useRef(false)
  // Where what's being spelled in pinyin starts: it isn't a name yet, whatever its letters say (design §4).
  const composingFrom = useRef(0)
  const field = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current === null) return
    field.current?.focus()
    field.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const check = useMemo(() => checkTyped(settled, world, db.id, propertyId), [settled, world, db.id, propertyId])
  const row = useMemo(() => databaseRows(read, db.id)[0], [read, db.id])
  const preview = useMemo(() => ('stored' in check && check.stored && row ? previewFormula(check.stored, workspace, read, db.id, propertyId, row, clockIn(undefined)) : null), [check, row, workspace, read, db.id, propertyId])
  const change = (next: string) => {
    setText(next)
    setRefused(false)
    if (!composing.current) setSettled(next)
  }
  const insert = (words: string, caretBack = 0) => {
    const el = field.current, from = el?.selectionStart ?? text.length, to = el?.selectionEnd ?? text.length
    caret.current = from + words.length - caretBack
    change(text.slice(0, from) + words + text.slice(to))
    setListOpen(false)
  }
  const done = () => {
    const now = checkTyped(text, world, db.id, propertyId)
    if ('error' in now) { setSettled(text); setRefused(true); return }
    onDone(now.stored)
  }
  const tokens = useMemo(() => propertyTokens(text, world, db.id), [text, world, db.id])
  const shownTokens = composing.current ? tokens.filter(t => t.to <= composingFrom.current) : tokens
  const message = 'error' in check ? check.error : preview && 'error' in preview ? preview.error : null
  return <div className="formula-editor" data-refused={refused || undefined}>
    <div className="formula-main">
      <div className="formula-field-box">
      <textarea ref={field} className="formula-field" aria-label="Formula" rows={wide ? 5 : 3} autoFocus spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder='Price * Qty' value={text}
        onChange={e => change(e.target.value)}
        onCompositionStart={e => { composing.current = true; composingFrom.current = e.currentTarget.selectionStart }}
        onCompositionEnd={e => { composing.current = false; setSettled(e.currentTarget.value) }}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); done() } }} />
      {/* After the field, so the field's ref is there for its layout effect. It's drawn behind it by z-index. */}
      <TokenBacking text={text} tokens={shownTokens} field={field} />
      </div>
      <p className={`formula-status${message ? ' is-error' : ''}`} role="status">
        {message ?? (preview && 'text' in preview && row ? <><span className="formula-preview-of">{displayPageTitle(row)}</span> {shortened(preview.text) || 'Empty'}</> : null)}
      </p>
      {/* The list closes on a pick, on the phone, so what was picked is explained here. */}
      {!wide && picked && !listOpen && <Doc of={picked} />}
      <div className="formula-actions">
        {!wide && <button type="button" className="formula-list-toggle" aria-expanded={listOpen} onClick={() => setListOpen(o => !o)}>Properties and functions</button>}
        <span className="formula-actions-end">
          <button type="button" className="formula-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="formula-done" onClick={done}>Done</button>
        </span>
      </div>
    </div>
    {(wide || listOpen) && <Reference db={db.database} propertyId={propertyId} picked={picked} setPicked={setPicked} insert={insert} wide={wide} />}
  </div>
}
