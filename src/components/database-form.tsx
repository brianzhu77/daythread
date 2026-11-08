// Building a form, on the form itself (forms.md §3, Jazz): what's seen is what's answered. A tap opens a question in place, with its
// wording, description, Required, ↑↓ and ×; adding is the only list. Its words never rename a property (G7-2).
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { titleId, type Property, type PropertyType, type View } from '../domain/database'
import { defaultForm, liveQuestions, questionable, type FormQuestion, type FormSettings } from '../domain/forms'
import { DatabaseHeader, setShownView, type ChangeView, type DatabaseViewProps } from './database-block'
import { FormField, questionProperty } from './form-page'
import { useWorkspace } from './use-day'

const newTypes: { type: PropertyType; label: string }[] = [
  { type: 'text', label: 'Text' }, { type: 'number', label: 'Number' }, { type: 'select', label: 'Select' }, { type: 'multiSelect', label: 'Multi-select' },
  { type: 'date', label: 'Date' }, { type: 'checkbox', label: 'Checkbox' }, { type: 'url', label: 'URL' }, { type: 'email', label: 'Email' }, { type: 'phone', label: 'Phone' },
]
const choiceTypes = new Set<PropertyType>(['select', 'status', 'multiSelect', 'relation'])

export function DatabaseForm({ db, view, changeView, blockId, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const { run } = useWorkspace()
  const form = view.form ?? defaultForm(db.database, titleId)
  const questions = liveQuestions(db.database, form, titleId)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | 'list' | 'new'>(null)
  const [newWording, setNewWording] = useState(''), [newType, setNewType] = useState<PropertyType>('text')
  // Each edit is made on the form as it is when it's sent, so one made while another is on its way doesn't undo it.
  const save = (edit: (form: FormSettings) => FormSettings) => changeView(current => ({ form: edit(current.form ?? defaultForm(db.database, titleId)) }))
  const put = (id: string, patch: Partial<FormQuestion>) => save(form => ({ ...form, questions: form.questions.map(q => {
    if (q.propertyId !== id) return q
    const next = { ...q, ...patch } as FormQuestion & Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === false || next[k] === '') delete next[k]
    return { ...next, wording: next.wording ?? '' } as FormQuestion
  }) }))
  const move = (id: string, by: number) => save(form => { const list = [...form.questions], at = list.findIndex(q => q.propertyId === id), to = at + by; if (at < 0 || to < 0 || to >= list.length) return form; const [q] = list.splice(at, 1); list.splice(to, 0, q!); return { ...form, questions: list } })
  const remove = (id: string) => { setOpen(null); save(form => ({ ...form, questions: form.questions.filter(q => q.propertyId !== id) })) }
  const asked = new Set(form.questions.map(q => q.propertyId))
  const unasked: Property[] = [...(asked.has(titleId) ? [] : [{ id: titleId, name: 'Name', type: 'text' } as Property]), ...db.database.properties.filter(p => questionable(p) && !asked.has(p.id))]
  const ask = (p: Property) => { setAdding(null); save(form => ({ ...form, questions: [...form.questions, { propertyId: p.id, wording: p.name }] })); setOpen(p.id) }
  // A new property is named once, from the wording as first typed, and asked here in those words (§3).
  const makeProperty = () => {
    const name = newWording.trim()
    if (!name) return
    const id = crypto.randomUUID()
    void run({ type: 'change-database', pageId: db.id, change: { kind: 'addProperty', property: { id, name, type: newType, ...(newType === 'select' || newType === 'multiSelect' ? { options: [] } : {}) }, viewId: view.id } }, r => ({ text: `Asked ${name}`, undoOperationId: r.operationId }))
    setAdding(null); setNewWording(''); setOpen(id)
  }
  const responses = db.database.views.find(v => v.name === 'Responses' && v.layout !== 'form')
  const count = form.responses ?? 0
  return <div className="database-table-wrap database-form-wrap">
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => {}} />
    <div className="form-head">
      <button type="button" className="app-link" disabled={!responses} onClick={() => responses && setShownView(blockId, responses.id)}>{count === 1 ? '1 response' : `${count} responses`}</button>
      <select className="form-state" aria-label="Who can answer" value={form.closed ? 'closed' : 'me'} onChange={e => { const close = e.target.value === 'closed'; save(form => { const { closed: _was, ...rest } = form; return close ? { ...rest, closed: true } : rest }) }}>
        <option value="me">Only me</option><option value="closed">Closed</option>
      </select>
      <Link to="/form" search={{ db: db.id, view: view.id, preview: 1 }} className="app-link">Preview</Link>
      <Link to="/form" search={{ db: db.id, view: view.id }} className="app-link">Open form</Link>
    </div>
    <div className="form-page is-building">
      {questions.map((q, i) => {
        const property = questionProperty(db.database, q)
        if (!property) return null
        if (open !== q.propertyId) return <div key={q.propertyId} className="form-question-preview" role="button" tabIndex={0} aria-label={`Edit ${q.wording || property.name}`} onClick={() => setOpen(q.propertyId)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(q.propertyId) } }}>
          <FormField q={q} property={property} value={undefined} disabled onChange={() => {}} />
          {q.required && <span className="form-required">Required</span>}
        </div>
        return <QuestionEditor key={q.propertyId} q={q} property={property} first={i === 0} last={i === questions.length - 1} onPut={patch => put(q.propertyId, patch)} onMove={by => move(q.propertyId, by)} onRemove={() => remove(q.propertyId)} onClose={() => setOpen(null)} />
      })}
      {adding === null && <button type="button" className="form-add" onClick={() => setAdding('list')}>+ Add question</button>}
      {adding === 'list' && <div className="form-add-list" role="menu" aria-label="Add question">
        {unasked.map(p => <button key={p.id} type="button" role="menuitem" onClick={() => ask(p)}>{p.name}</button>)}
        <button type="button" role="menuitem" onClick={() => setAdding('new')}>New property…</button>
        <button type="button" className="app-link" onClick={() => setAdding(null)}>Cancel</button>
      </div>}
      {adding === 'new' && <div className="form-add-list">
        <input className="form-input" aria-label="New question" placeholder="The question" autoFocus value={newWording} onChange={e => setNewWording(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) makeProperty() }} />
        <select className="form-input" aria-label="Answer type" value={newType} onChange={e => setNewType(e.target.value as PropertyType)}>{newTypes.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}</select>
        <span className="form-add-actions"><button type="button" className="app-link" onClick={() => setAdding(null)}>Cancel</button><button type="button" className="form-send" disabled={!newWording.trim()} onClick={makeProperty}>Add</button></span>
      </div>}
      <SubmitSettings form={form} onSave={submit => save(form => { const { submit: _was, ...rest } = form; return submit ? { ...rest, submit } : rest })} />
    </div>
  </div>
}

function QuestionEditor({ q, property, first, last, onPut, onMove, onRemove, onClose }: { q: FormQuestion; property: Property; first: boolean; last: boolean; onPut(p: Partial<FormQuestion>): void; onMove(by: number): void; onRemove(): void; onClose(): void }) {
  const [wording, setWording] = useState(q.wording), [description, setDescription] = useState(q.description ?? '')
  const keep = () => { if (wording !== q.wording || description !== (q.description ?? '')) onPut({ wording, description: description || undefined }) }
  const text = property.type === 'text' || property.id === titleId
  const [required, setRequired] = useState(Boolean(q.required))
  return <div className="form-question-edit" data-question={q.propertyId}>
    <input className="form-input form-wording-field" aria-label="Question" value={wording} placeholder={property.name} onChange={e => setWording(e.target.value)} onBlur={keep} />
    <input className="form-input" aria-label="Description" placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} onBlur={keep} />
    <p className="form-property-name">Property: {property.name}</p>
    <div className="form-question-tools">
      <label className="form-required-switch"><input type="checkbox" role="switch" aria-label="Required" checked={required} onChange={e => { setRequired(e.target.checked); onPut({ required: e.target.checked ? true : undefined }) }} />Required</label>
      {choiceTypes.has(property.type) && property.type !== 'multiSelect' && property.type !== 'relation' && <select aria-label="Shown as" value={q.display ?? ''} onChange={e => onPut({ display: (e.target.value || undefined) as FormQuestion['display'] })}><option value="">Automatic</option><option value="list">A list</option><option value="dropdown">A dropdown</option></select>}
      {text && <select aria-label="Answer" value={q.display ?? 'short'} onChange={e => onPut({ display: e.target.value === 'long' ? 'long' : undefined })}><option value="short">Short answer</option><option value="long">Long answer</option></select>}
      {(property.type === 'multiSelect' || property.type === 'relation') && <input className="form-max" aria-label="At most" inputMode="numeric" placeholder="Any number" value={q.max ?? ''} onChange={e => { const n = Number(e.target.value); onPut({ max: e.target.value && Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined }) }} />}
      <span className="form-question-moves">
        <button type="button" aria-label="Move up" disabled={first} onClick={() => { keep(); onMove(-1) }}>↑</button>
        <button type="button" aria-label="Move down" disabled={last} onClick={() => { keep(); onMove(1) }}>↓</button>
        <button type="button" aria-label={`Remove ${q.wording || property.name}`} onClick={onRemove}>×</button>
        <button type="button" className="app-link" onClick={() => { keep(); onClose() }}>Done</button>
      </span>
    </div>
  </div>
}

function SubmitSettings({ form, onSave }: { form: FormSettings; onSave(submit: NonNullable<FormSettings['submit']> | null): void }) {
  const [button, setButton] = useState(form.submit?.button ?? ''), [title, setTitle] = useState(form.submit?.title ?? ''), [body, setBody] = useState(form.submit?.body ?? '')
  const keep = () => { const submit = { ...(button.trim() ? { button } : {}), ...(title.trim() ? { title } : {}), ...(body.trim() ? { body } : {}) }; if (JSON.stringify(submit) !== JSON.stringify(form.submit ?? {})) onSave(Object.keys(submit).length ? submit : null) }
  return <div className="form-submit-settings">
    <p className="form-wording">When it's sent</p>
    <input className="form-input" aria-label="Button" placeholder="Send" value={button} onChange={e => setButton(e.target.value)} onBlur={keep} />
    <input className="form-input" aria-label="Confirmation title" placeholder="Sent" value={title} onChange={e => setTitle(e.target.value)} onBlur={keep} />
    <textarea className="form-input" aria-label="Confirmation" placeholder="Confirmation" rows={2} value={body} onChange={e => setBody(e.target.value)} onBlur={keep} />
  </div>
}
