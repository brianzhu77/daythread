// A database's rules (docs/design/automations.md §2): a list, and each rule's editor, in Buttons' shell. Popover-sized at 1280, a sheet at 390. It's on the database, so every view shares it.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { automationProblem, automationSteps, everyOf, everyProblem, stepBroken, withLiveNames, type Automation, type AutomationTrigger } from '../domain/automations'
import { readSteps, stepKinds, stepTitle, writeSteps, type ButtonStep } from '../domain/buttons'
import { isDatabase, propertyOf, titleId, type Condition, type Database, type DatabaseChange, type Property } from '../domain/database'
import type { Page } from '../domain/types'
import { newStep, problemOf, StepPage } from './button-editor'
import { opLabels, opsFor, RuleValue } from './database-menu'
import { todayIso } from './dates'
import { useKeyboardTop } from './keyboard'
import { useWide } from './property-editors'
import { newOperationId, useWorkspace } from './use-day'

let open: { id: string; at: { top: number; left: number } | null } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
/** From the database's menu, or a paused rule's notice. */
export function openAutomations(databaseId: string, anchor?: Element | null) {
  const r = anchor?.getBoundingClientRect()
  // By what opened it, kept on screen, as other sheets hang from theirs. A notice has nothing to hang from.
  open = { id: databaseId, at: r ? { top: Math.max(16, Math.min(r.bottom + 6, window.innerHeight - 500)), left: Math.max(16, Math.min(r.left, window.innerWidth - 396)) } : null }; notify()
}
const close = () => { open = null; notify() }

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
/** A rule's second line, as §2's table has it. */
export function statusLine(rule: Automation, problem: string | null): { text: string; broken: boolean } {
  if (problem) return { text: `Paused · ${problem} · Edit`, broken: true }
  if (rule.paused) return { text: `Paused · ${rule.paused.reason}`, broken: true }
  const ran = rule.lastRanAt ? `Last ran ${when(rule.lastRanAt)}` : 'Not run yet'
  return { text: rule.active ? ran : rule.lastRanAt ? `Off · ${ran}` : 'Off', broken: false }
}

export function AutomationsHost() {
  const current = useSyncExternalStore(subscribe, () => open, () => null)
  const { workspace } = useWorkspace()
  const page = current ? workspace?.pages.find(p => p.id === current.id) : undefined
  return page && isDatabase(page) && !page.trashedAt ? <Sheet key={page.id} db={page} at={current!.at} /> : null
}

function Sheet({ db, at }: { db: Page & { database: Database }; at: { top: number; left: number } | null }) {
  const { run, workspace } = useWorkspace()
  const wide = useWide(), keyboardTop = useKeyboardTop()
  const [editing, setEditing] = useState<Automation | null>(null), [isNew, setIsNew] = useState(false)
  const rules = db.database.automations ?? []
  const change = (c: DatabaseChange, notice = true) => void run({ type: 'change-database', pageId: db.id, change: c }, notice ? r => ({ text: r.message, undoOperationId: r.operationId }) : undefined, newOperationId())
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editing) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }
    const away = (e: PointerEvent) => { const t = e.target as Element; if (!box.current?.contains(t)) close() }
    document.addEventListener('keydown', esc, true); document.addEventListener('pointerdown', away, true)
    return () => { document.removeEventListener('keydown', esc, true); document.removeEventListener('pointerdown', away, true) }
  })
  return createPortal(<>
    <div className="database-menu-scrim" aria-hidden="true" />
    <div ref={box} className="app-menu database-menu button-editor automation-sheet" role="dialog" aria-label="Automations" style={{ position: 'fixed', ...(wide ? at ?? { top: 90, left: Math.max(16, window.innerWidth / 2 - 190) } : {}), ...(!wide && keyboardTop !== null ? { '--keyboard-lift': `${window.innerHeight - keyboardTop}px` } as object : {}) }} onKeyDown={e => e.stopPropagation()}>
      {editing ? <Editor rule={editing} isNew={isNew} db={db} onCancel={() => setEditing(null)} onDone={rule => { change(isNew ? { kind: 'addAutomation', automation: rule } : { kind: 'updateAutomation', automation: rule }); setEditing(null) }} onDelete={isNew ? null : () => { change({ kind: 'removeAutomation', automationId: editing.id }); setEditing(null) }} /> : <>
        <div className="database-menu-head button-editor-head"><span>Automations</span></div>
        {rules.length === 0 && <p className="database-menu-quiet">No automations</p>}
        {rules.map((rule, i) => {
          const problem = automationProblem(workspace!, db.database, rule), status = statusLine(rule, problem)
          return <div key={rule.id} className="automation-row">
            <button type="button" className="automation-open" onClick={() => { setIsNew(false); setEditing(withLiveNames(workspace!, db.database, rule)) }}><span>{rule.name}</span><small className={status.broken ? 'is-broken' : ''}>{status.text}</small></button>
            <button type="button" aria-label={`Move ${rule.name} up`} disabled={i === 0} onClick={() => change({ kind: 'moveAutomation', automationId: rule.id, beforeId: rules[i - 1]!.id }, false)}>↑</button>
            <button type="button" aria-label={`Move ${rule.name} down`} disabled={i === rules.length - 1} onClick={() => change({ kind: 'moveAutomation', automationId: rule.id, beforeId: rules[i + 2]?.id ?? null }, false)}>↓</button>
            <label className="database-property-switch automation-switch"><input type="checkbox" role="switch" aria-label={`${rule.name} on`} checked={rule.active && !rule.paused && !problem} onChange={() => { if (problem) { setIsNew(false); setEditing(withLiveNames(workspace!, db.database, rule)) } else change({ kind: 'setAutomationActive', automationId: rule.id, active: !(rule.active && !rule.paused), notBefore: wallClock(new Date()) }) }} /></label>
          </div>
        })}
        <button type="button" role="menuitem" onClick={() => { setIsNew(true); setEditing({ id: crypto.randomUUID(), name: '', active: true, triggers: [{ kind: 'row-added' }], steps: writeSteps([]) }) }}>+ New automation</button>
      </>}
    </div>
  </>, document.body)
}

const everyValue = '__every'
const pad = (n: number) => String(n).padStart(2, '0')
/** As schedules compare, in his own wall clock: "YYYY-MM-DDTHH:mm". */
const wallClock = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function EveryFields({ trigger, onChange }: { trigger: Extract<AutomationTrigger, { kind: 'every' }>; onChange(next: Extract<AutomationTrigger, { kind: 'every' }>): void }) {
  const { repeat } = trigger
  const put = (fields: Partial<typeof repeat>) => onChange({ ...trigger, repeat: { ...repeat, ...fields } })
  // What's typed stays as typed, so it can be cleared on the way to another number. Only a valid one is kept, and leaving goes back to it.
  const [count, setCount] = useState(String(repeat.interval)), [ending, setEnding] = useState(Boolean(trigger.until))
  // None chosen means From's weekday, which is how a week runs, so that's what shows.
  const days = repeat.weekdays?.length ? repeat.weekdays : [new Date(`${repeat.start}T12:00:00Z`).getUTCDay()]
  const stopUntil = () => { const { until: _u, ...rest } = trigger; onChange(rest); setEnding(false) }
  return <div className="automation-every">
    <label>Every <input aria-label="How many" inputMode="numeric" value={count} onChange={e => { setCount(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() && Number.isInteger(n) && n >= 1 && n <= 1000) put({ interval: n }) }} onBlur={() => setCount(String(repeat.interval))} /></label>
    <select aria-label="Period" value={repeat.every} onChange={e => put({ every: e.target.value as typeof repeat.every })}><option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option></select>
    {repeat.every === 'week' && <span className="automation-weekdays" role="group" aria-label="On">{weekdayNames.map((name, day) => { const on = days.includes(day); return <button key={name} type="button" aria-pressed={on} className={on ? 'is-on' : ''} onClick={() => { const next = on ? days.filter(d => d !== day) : [...days, day]; if (next.length) put({ weekdays: [...next].sort((x, y) => x - y) }) }}>{name}</button> })}</span>}
    <label>At <input type="time" aria-label="At" value={repeat.time ?? '00:00'} onChange={e => put({ time: e.target.value })} /></label>
    <label>From <input type="date" aria-label="From" value={repeat.start} onChange={e => { if (e.target.value) put({ start: e.target.value }) }} /></label>
    {ending
      ? <span className="automation-until"><label>Until <input type="date" aria-label="Until" value={trigger.until ?? ''} onChange={e => { const { until: _u, ...rest } = trigger; onChange(e.target.value ? { ...rest, until: e.target.value } : rest) }} /></label><button type="button" className="database-rule-remove" aria-label="No end date" onClick={stopUntil}>×</button></span>
      : <button type="button" className="app-link" onClick={() => setEnding(true)}>+ End date</button>}
  </div>
}

function Editor({ rule, isNew, db, onCancel, onDone, onDelete }: { rule: Automation; isNew: boolean; db: Page & { database: Database }; onCancel(): void; onDone(rule: Automation): void; onDelete: (() => void) | null }) {
  const { workspace } = useWorkspace()
  const [name, setName] = useState(rule.name), [triggers, setTriggers] = useState(rule.triggers), [any, setAny] = useState(Boolean(rule.any)), [viewId, setViewId] = useState(rule.viewId ?? '')
  const [steps, setSteps] = useState<ButtonStep[]>(() => readSteps(rule.steps)), [at, setAt] = useState<number | 'kinds' | null>(null), [asking, setAsking] = useState(false)
  const draft = (): Automation => { const { any: _any, viewId: _view, ...rest } = rule; return { ...rest, name: name.trim() || (steps[0] ? stepTitle(steps[0]) : 'Automation'), triggers, ...(any ? { any: true as const } : {}), ...(viewId ? { viewId } : {}), steps: writeSteps(steps) } }
  const start = useRef(JSON.stringify({ ...rule, any: Boolean(rule.any), viewId: rule.viewId ?? '' })), changedYet = JSON.stringify({ ...rule, name, triggers, any, viewId, steps: writeSteps(steps) }) !== start.current
  const stepIssue = (i: number) => problemOf(steps, i) ?? (everyOf({ triggers }) ? everyProblem(steps[i]!) : null) ?? (workspace ? stepBroken(workspace, db.database, steps[i]!) : null)
  const firstProblem = steps.findIndex((_, i) => stepIssue(i))
  // A step or trigger whose target is gone is what a paused rule needs fixed, so saving it as it is wouldn't turn it back on.
  const broken = workspace ? automationProblem(workspace, db.database, draft()) : null
  const every = everyOf({ triggers }), endsEarly = every?.until && every.until < every.repeat.start ? 'It ends before it starts, so it would never run' : null
  const ready = steps.length > 0 && firstProblem < 0 && triggers.length > 0 && !broken && !endsEarly
  const done = () => { if (!steps.length) { setAt('kinds'); return } if (firstProblem >= 0) { setAt(firstProblem); return } if (!broken && !endsEarly) onDone(draft()) }
  const leave = () => { if (changedYet && !isNew) setAsking(true); else if (changedYet && (name || steps.length)) setAsking(true); else onCancel() }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); if (at !== null) setAt(null); else leave() }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  })
  const properties: Property[] = [{ id: titleId, name: 'Name', type: 'text' }, ...db.database.properties.filter(p => p.type !== 'button')]
  const putTrigger = (i: number, next: AutomationTrigger) => setTriggers(list => list.map((t, j) => (j === i ? next : t)))
  return <>
    <div className="database-menu-head button-editor-head">
      <button type="button" className="database-menu-back" aria-label="Back" onClick={() => { if (at !== null) setAt(null); else leave() }}>‹</button>
      <span>{at === 'kinds' ? 'Add step' : typeof at === 'number' ? stepKinds.find(k => k.kind === steps[at]!.kind)!.name : 'Automation'}</span>
      <button type="button" className={`button-editor-done${ready ? '' : ' is-off'}`} onClick={done}>Done</button>
    </div>
    {asking && <div className="button-editor-discard" role="alert"><span>Discard changes?</span><button type="button" className="app-link" onClick={() => setAsking(false)}>Keep editing</button><button type="button" className="app-link" onClick={onCancel}>Discard</button></div>}
    {at === null && <>
      {(broken ?? endsEarly) && <p className="button-step-problem" role="status">{broken ?? endsEarly}</p>}
      <input className="button-editor-name" aria-label="Name" placeholder={steps[0] ? stepTitle(steps[0]) : 'Automation'} maxLength={200} value={name} onChange={e => setName(e.target.value)} />
      <p className="button-editor-label">When</p>
      {triggers.length > 1 && <select aria-label="Match" value={any ? 'any' : 'all'} onChange={e => setAny(e.target.value === 'any')}><option value="all">All of these</option><option value="any">Any of these</option></select>}
      {triggers.map((t, i) => {
        const property = t.kind === 'property-edited' ? (t.propertyId === titleId ? properties[0] : propertyOf(db.database, t.propertyId)) : undefined
        const condition = t.kind === 'property-edited' ? t.condition : undefined
        return <div key={i} className="database-rule automation-trigger">
          <select aria-label="When" value={t.kind === 'row-added' ? '' : t.kind === 'every' ? everyValue : t.propertyId} onChange={e => {
            if (e.target.value === everyValue) { const now = new Date(); setAny(false); setTriggers([{ kind: 'every', repeat: { every: 'week', interval: 1, start: todayIso(), time: '09:00', notBefore: wallClock(now) } }]); return }
            const p = properties.find(x => x.id === e.target.value); putTrigger(i, p ? { kind: 'property-edited', propertyId: p.id, name: p.name } : { kind: 'row-added' })
          }}>
            <option value="">A row is added</option>
            <option value={everyValue}>Every…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name} is edited</option>)}
          </select>
          {t.kind === 'property-edited' && property && <select aria-label="Condition" value={condition?.op ?? ''} onChange={e => { const { condition: _c, ...rest } = t; putTrigger(i, e.target.value ? { ...rest, condition: { by: property.id, op: e.target.value as Condition['op'] } } : rest) }}>
            <option value="">to anything</option>
            {opsFor(property.type).map(op => <option key={op} value={op}>{opLabels[op]}</option>)}
          </select>}
          {t.kind === 'property-edited' && property && condition && <RuleValue property={property} condition={condition} onChange={value => putTrigger(i, { ...t, condition: value === undefined ? { by: condition.by, op: condition.op } : { ...condition, value } })} />}
          {t.kind === 'property-edited' && !property && <span className="database-rule-deleted">{t.name} was deleted</span>}
          {t.kind === 'every' && <EveryFields trigger={t} onChange={next => putTrigger(i, next)} />}
          {triggers.length > 1 && <button type="button" className="database-rule-remove" aria-label="Remove trigger" onClick={() => setTriggers(list => list.filter((_, j) => j !== i))}>×</button>}
        </div>
      })}
      {!everyOf({ triggers }) && <button type="button" role="menuitem" onClick={() => setTriggers(list => [...list, { kind: 'row-added' }])}>+ Add trigger</button>}
      <p className="button-editor-label">In</p>
      <select className="button-editor-field" aria-label="In" value={viewId} onChange={e => setViewId(e.target.value)}><option value="">The whole database</option>{db.database.views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <p className="button-editor-label">Do</p>
      {steps.map((step, i) => {
        const problem = stepIssue(i)
        return <div key={step.id} className={`button-step-row${problem ? ' is-incomplete' : ''}`}>
          <button type="button" className="button-step-open" onClick={() => setAt(i)}><span>{stepTitle(step)}</span>{problem && <small>{problem}</small>}</button>
          <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setSteps(list => { const out = [...list]; const [s] = out.splice(i, 1); out.splice(i - 1, 0, s!); return out })}>↑</button>
          <button type="button" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => setSteps(list => { const out = [...list]; const [s] = out.splice(i, 1); out.splice(i + 1, 0, s!); return out })}>↓</button>
          <button type="button" aria-label={`Remove ${stepTitle(step)}`} onClick={() => setSteps(list => list.filter((_, j) => j !== i))}>×</button>
        </div>
      })}
      <button type="button" role="menuitem" onClick={() => setAt('kinds')}>+ Add step</button>
      {onDelete && <button type="button" role="menuitem" className="is-danger" onClick={onDelete}>Delete</button>}
    </>}
    {at === 'kinds' && stepKinds.filter(k => automationSteps.includes(k.kind) && !(everyOf({ triggers }) && k.kind === 'edit-property')).map(({ kind, name: label }) => <button key={kind} type="button" role="menuitem" onClick={() => { setSteps(list => [...list, newStep(kind)]); setAt(steps.length) }}>{label}</button>)}
    {typeof at === 'number' && steps[at] && workspace && <StepPage key={steps[at]!.id} step={steps[at]!} problem={problemOf(steps, at)} canOpenMade={false} workspace={workspace} schema={null as never} rowsOf={db.database} onChange={next => setSteps(list => list.map((s, j) => (j === at ? next : s)))} />}
  </>
}
