// Answering a form (forms.md §4): a page of one column, up to 560 px. Answers stay on the device until they're sent, and a send holds
// its answers and key, so a retry sends the same thing and makes one row, while new words wait for the next send (Ratchet).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { isDatabase, titleId, type Database, type Json, type Property } from '../domain/database'
import { formOf, isEmptyAnswer, liveQuestions, type FormQuestion } from '../domain/forms'
import { readingWorkspace } from '../domain/todos-source'
import { useWorkspace } from './use-day'

export type Answers = Record<string, Json>
const newId = (): string => crypto.randomUUID()
const draftKey = (databaseId: string, viewId: string) => `daythread:form:${databaseId}:${viewId}`
interface Draft { key: string; answers: Answers }
const readDraft = (k: string): Draft | null => { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null') as Draft | null; return v && typeof v.key === 'string' ? v : null } catch { return null } }
const writeDraft = (k: string, d: Draft | null) => { try { if (d && Object.keys(d.answers).length) localStorage.setItem(k, JSON.stringify(d)); else localStorage.removeItem(k) } catch { /* private mode */ } }

/** The property a question asks, Name included. */
export const questionProperty = (db: Database, q: FormQuestion): Property | null =>
  q.propertyId === titleId ? { id: titleId, name: 'Name', type: 'text' } : db.properties.find(p => p.id === q.propertyId) ?? null

/** One question as it's answered. In the builder it's drawn the same way, and can't be typed in. */
export function FormField({ q, property, value, missing, disabled, onChange, onNext }: { q: FormQuestion; property: Property; value: Json | undefined; missing?: boolean; disabled?: boolean; onChange(v: Json | undefined): void; onNext?(): void }) {
  const label = q.wording.trim() || property.name
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && onNext) { e.preventDefault(); onNext() } }
  const options = property.options ?? []
  const many = property.type === 'multiSelect' || property.type === 'relation'
  const picked = Array.isArray(value) ? value as string[] : typeof value === 'string' ? [value] : []
  const asList = q.display === 'list' || (q.display !== 'dropdown' && options.length <= 6)
  let field: React.ReactNode
  switch (property.type) {
    case 'number': field = <input className="form-input" aria-label={label} inputMode="decimal" disabled={disabled} value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''} onKeyDown={enter} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} />; break
    case 'date': {
      // The browser's own picker, as elsewhere. Empty, it reads as empty: WebKit draws today's date in one, which on an iPhone looks answered (Bumblebee).
      const day = value && typeof value === 'object' && !Array.isArray(value) ? String((value as { start?: string }).start ?? '') : ''
      field = <span className={`form-date${day ? '' : ' is-empty'}`}>
        <input className="form-input" type="date" aria-label={label} disabled={disabled} value={day} onChange={e => onChange(e.target.value ? { start: e.target.value } : undefined)} />
        {!day && <span className="form-date-empty" aria-hidden="true">Pick a date</span>}
        {day && !disabled && <button type="button" className="form-date-clear" aria-label={`Clear ${label}`} onClick={() => onChange(undefined)}>×</button>}
      </span>
      break
    }
    case 'checkbox': field = <label className="form-check"><input type="checkbox" aria-label={label} disabled={disabled} checked={value === true} onChange={e => onChange(e.target.checked || undefined)} />{label}</label>; break
    case 'select': case 'status': case 'multiSelect': case 'relation': {
      const toggle = (id: string) => onChange(many ? (picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]) : (picked[0] === id ? undefined : id))
      field = asList || many
        ? <div className="form-choices" role={many ? 'group' : 'radiogroup'} aria-label={label}>{options.map(o => <label key={o.id} className="form-choice"><input type={many ? 'checkbox' : 'radio'} name={`${q.propertyId}`} disabled={disabled} checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />{o.name}</label>)}{!options.length && <p className="form-empty">Nothing to choose yet</p>}</div>
        : <select className="form-input" aria-label={label} disabled={disabled} value={picked[0] ?? ''} onChange={e => onChange(e.target.value || undefined)}><option value="">Choose…</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      break
    }
    default: {
      const kind = property.type === 'url' ? 'url' : property.type === 'email' ? 'email' : property.type === 'phone' ? 'tel' : 'text'
      field = q.display === 'long'
        ? <textarea className="form-input" aria-label={label} rows={4} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || undefined)} />
        : <input className="form-input" aria-label={label} type={kind === 'text' ? 'text' : kind} inputMode={kind === 'tel' ? 'tel' : kind === 'url' ? 'url' : kind === 'email' ? 'email' : undefined} enterKeyHint={onNext ? 'next' : undefined} disabled={disabled} value={typeof value === 'string' ? value : ''} onKeyDown={enter} onChange={e => onChange(e.target.value || undefined)} />
    }
  }
  return <div className={`form-question${missing ? ' is-missing' : ''}`} data-question={q.propertyId}>
    {property.type !== 'checkbox' && <p className="form-wording">{label}</p>}
    {q.description && <p className="form-description">{q.description}</p>}
    {field}
    {q.max && many ? <p className="form-description">{q.max} at most</p> : null}
    {missing && <p className="form-missing" role="status">Needs an answer</p>}
  </div>
}

/** A value as the row stores it: a number from what was typed; the rest as they are. */
function stored(property: Property, value: Json | undefined): Json | undefined {
  if (value === undefined) return undefined
  if (property.type === 'number' && typeof value === 'string') { const n = Number(value.replace(/,/g, '')); return Number.isFinite(n) ? n : undefined }
  return value
}

export function FormPage({ databaseId, viewId, preview }: { databaseId: string; viewId: string; preview: boolean }) {
  const { workspace, run } = useWorkspace()
  const reading = useMemo(() => (workspace ? readingWorkspace(workspace, databaseId) : null), [workspace, databaseId])
  const page = reading?.pages.find(p => p.id === databaseId)
  const view = page && isDatabase(page) && !page.trashedAt ? page.database.views.find(v => v.id === viewId) : undefined
  const form = view ? formOf(view) : null
  const draftAt = draftKey(databaseId, viewId)
  const [draft, setDraft] = useState<Draft>(() => (typeof window === 'undefined' ? null : readDraft(draftAt)) ?? { key: newId(), answers: {} })
  const latest = useRef(draft); latest.current = draft
  const [held, setHeld] = useState<{ key: string; answers: Answers; at: string } | null>(null)
  const [state, setState] = useState<'open' | 'sending' | 'failed' | 'sent'>('open')
  const [missing, setMissing] = useState<string[]>([])
  const [refused, setRefused] = useState<string | null>(null)
  useEffect(() => { if (!preview) writeDraft(draftAt, draft) }, [draft, draftAt, preview])
  if (!workspace) return null
  if (!page?.database || !view || !form || form.closed) return <div className="form-page"><h1 className="form-title">This form is closed</h1></div>
  const db = page.database
  const questions = liveQuestions(db, form, titleId).flatMap(q => { const property = questionProperty(db, q); return property ? [{ q, property }] : [] })
  const put = (id: string, v: Json | undefined) => { setDraft(d => { const answers = { ...d.answers }; if (v === undefined) delete answers[id]; else answers[id] = v; return { ...d, answers } }); setMissing(m => m.filter(x => x !== id)) }
  const focusNext = (i: number) => { const next = document.querySelectorAll<HTMLElement>('.form-page .form-question')[i + 1]?.querySelector<HTMLElement>('input, textarea, select'); next?.focus() }

  const send = async (payload = { key: draft.key, answers: draft.answers, at: new Date().toISOString() }) => {
    const empty = questions.filter(({ q, property }) => q.required && isEmptyAnswer(stored(property, payload.answers[q.propertyId])))
    if (empty.length) {
      setMissing(empty.map(({ q }) => q.propertyId))
      document.querySelector(`[data-question="${CSS.escape(empty[0]!.q.propertyId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setRefused(null)
    if (preview) { setState('sent'); return }
    setHeld(payload); setState('sending')
    const values = Object.fromEntries(questions.flatMap(({ q, property }) => { const v = stored(property, payload.answers[q.propertyId]); return q.propertyId === titleId || v === undefined ? [] : [[q.propertyId, v]] }))
    const action = { type: 'answer-form' as const, databaseId, viewId, pageId: payload.key, title: typeof payload.answers[titleId] === 'string' ? payload.answers[titleId] as string : '', values, at: payload.at }
    let refusal: string | null = null
    const receipt = await run(action, undefined, payload.key, { quiet: true, inlineRefusal: /^Needs an answer|^This form is closed$| at most$/, onRefused: m => { refusal = m } })
    if (receipt) {
      // A late success: what was typed since stays, for the next one, with its own key.
      const now = latest.current, same = JSON.stringify(now.answers) === JSON.stringify(payload.answers)
      setDraft({ key: newId(), answers: same ? {} : now.answers })
      setHeld(null); setState('sent')
      return
    }
    if (refusal) { setHeld(null); setState('open'); setRefused(refusal); return }
    setState('failed')
  }

  if (state === 'sent') return <div className="form-page">
    {preview && <p className="form-preview-mark">Preview · nothing was sent</p>}
    <h1 className="form-title">{form.submit?.title || 'Sent'}</h1>
    {form.submit?.body && <p className="form-sent-body">{form.submit.body}</p>}
    <button type="button" className="form-send" onClick={() => setState('open')}>Send another</button>
  </div>
  return <div className="form-page">
    {preview && <p className="form-preview-mark">Preview · nothing is sent</p>}
    <h1 className="form-title">{view.name}</h1>
    {questions.map(({ q, property }, i) => <FormField key={q.propertyId} q={q} property={property} value={draft.answers[q.propertyId]} missing={missing.includes(q.propertyId)} onChange={v => put(q.propertyId, v)} onNext={i < questions.length - 1 ? () => focusNext(i) : undefined} />)}
    <div className="form-actions">
      <button type="button" className="form-send" disabled={state === 'sending'} onClick={() => void send()}>{state === 'sending' ? 'Sending…' : form.submit?.button || 'Send'}</button>
      {/* Beside Send, in its bar, so it can't be under it (Jazz). */}
      {refused && <p className="form-failed" role="alert">{refused}</p>}
      {state === 'failed' && held && <p className="form-failed" role="alert">Not sent · <button type="button" className="app-link" onClick={() => void send(held)}>Try again</button></p>}
      <Link to="/pages" search={{ page: databaseId }} className="form-back">Back to {page.title.trim() || 'the database'}</Link>
    </div>
  </div>
}
