// Edit formula (docs/design/formula.md §4): the text on top, what's wrong or what it gives right under it, and the properties and
// functions to pick from: beside it at 1280, one tap away at 390. What doesn't work can't replace what does: Done says why, and Cancel leaves it.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { databaseRows, titleId, type Database } from '../domain/database'
import { checkTyped, clockIn, previewFormula, shownFormula } from '../domain/formula'
import { functionList } from '../domain/formula-functions'
import type { Page, Workspace } from '../domain/types'
import { displayPageTitle } from './page-title'

const groups = ['Logic and text', 'Numbers', 'Dates', 'Lists', 'Other'] as const
const quoted = (name: string) => `prop("${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`

function Reference({ db, propertyId, insert }: { db: Database; propertyId: string; insert(text: string, caretBack?: number): void }) {
  const [picked, setPicked] = useState<(typeof functionList)[number] | null>(null)
  const names = [{ id: titleId, name: 'Name' }, ...db.properties.filter(p => p.id !== propertyId)]
  return <div className="formula-reference">
    <div className="formula-list" role="list" aria-label="Properties and functions">
      <p className="formula-group">Properties</p>
      {names.map(p => <button key={p.id} type="button" className="formula-item" onClick={() => insert(quoted(p.name))}>{p.name}</button>)}
      {groups.map(group => <div key={group}>
        <p className="formula-group">{group}</p>
        {functionList.filter(f => f.group === group).map(f => <button key={f.name} type="button" className={`formula-item is-function${picked?.name === f.name ? ' is-active' : ''}`} onClick={() => { setPicked(f); insert(`${f.name}()`, 1) }}>{f.name}</button>)}
      </div>)}
    </div>
    {picked && <div className="formula-doc">
      <p className="formula-doc-name">{picked.name}</p>
      <p>{picked.doc}</p>
      {picked.example && <code>{picked.example}</code>}
    </div>}
  </div>
}

export function FormulaEditor({ workspace, db, propertyId, stored, wide, onDone, onCancel }: { workspace: Workspace | null; db: Page & { database: Database }; propertyId: string; stored: string; wide: boolean; onDone(stored: string): void; onCancel(): void }) {
  const [text, setText] = useState(() => shownFormula(stored, db.database))
  // The field doesn't react mid-composition, so what's being spelled in pinyin isn't an error yet (design §4).
  const [settled, setSettled] = useState(text)
  const [refused, setRefused] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const composing = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current === null) return
    field.current?.focus()
    field.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const check = useMemo(() => checkTyped(settled, db.database, propertyId), [settled, db.database, propertyId])
  const row = useMemo(() => (workspace ? databaseRows(workspace, db.id)[0] : undefined), [workspace, db.id])
  const preview = useMemo(() => ('stored' in check && check.stored && row ? previewFormula(check.stored, db.database, propertyId, row, clockIn(undefined)) : null), [check, row, db.database, propertyId])
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
    const now = checkTyped(text, db.database, propertyId)
    if ('error' in now) { setSettled(text); setRefused(true); return }
    onDone(now.stored)
  }
  const message = 'error' in check ? check.error : preview && 'error' in preview ? preview.error : null
  return <div className="formula-editor" data-refused={refused || undefined}>
    <div className="formula-main">
      <textarea ref={field} className="formula-field" aria-label="Formula" rows={wide ? 5 : 3} autoFocus spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder='Price * Qty' value={text}
        onChange={e => change(e.target.value)}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={e => { composing.current = false; setSettled(e.currentTarget.value) }}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); done() } }} />
      <p className={`formula-status${message ? ' is-error' : ''}`} role="status">
        {message ?? (preview && 'text' in preview && row ? <><span className="formula-preview-of">{displayPageTitle(row)}</span> {preview.text || 'Empty'}</> : null)}
      </p>
      <div className="formula-actions">
        {!wide && <button type="button" className="formula-list-toggle" aria-expanded={listOpen} onClick={() => setListOpen(o => !o)}>Properties and functions</button>}
        <span className="formula-actions-end">
          <button type="button" className="formula-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="formula-done" onClick={done}>Done</button>
        </span>
      </div>
    </div>
    {(wide || listOpen) && <Reference db={db.database} propertyId={propertyId} insert={insert} />}
  </div>
}
