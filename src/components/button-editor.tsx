// A button's editor (docs/design/buttons.md §3): a popover at 1280, a sheet at 390, with its steps as a list and each on its own page. It writes nothing until Done.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { en } from '@blocknote/core/locales'
import { filterSuggestionItems, SuggestionMenu } from '@blocknote/core/extensions'
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { isTodosTarget, pageKinds, propertyKinds, readSteps, safeUrl, stepKinds, stepProblem, stepTitle, tapValueName, tapValues, writeSteps, type ButtonSet, type ButtonStep, type ButtonValue, type StepKind } from '../domain/buttons'
import { isDatabase, isReadOnly, propertyOf, titleId, todosSourceId, type Condition, type Database, type Json, type Property } from '../domain/database'
import { readDate } from '../domain/date-reading'
import type { EditorNode } from '../domain/editor-document'
import { todoBarColumns, todosDatabase } from '../domain/todos-source'
import type { Page, Workspace } from '../domain/types'
import { currentQuestion, subscribeRunning } from './button-run'
import { opLabels, opsFor, RuleValue } from './database-menu'
import { todayIso } from './dates'
import { useKeyboardTop } from './keyboard'
import { displayPageTitle } from './page-title'
import { useWide } from './property-editors'
import { useWorkspace } from './use-day'

export interface ButtonDraft { label: string; steps: string }
/** `pageId` null: a Button property's, drawn by the app's own host, with the database whose row it acts on. */
type Open = { pageId: string | null; initial: ButtonDraft; anchor: Element | null; onDone: (draft: ButtonDraft) => void; rowsOf?: Database }
let open: Open | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function openButtonEditor(next: Open) { open = next; notify() }
const closeEditor = () => { open = null; notify() }

export const newStep = (kind: StepKind): ButtonStep => {
  const id = crypto.randomUUID()
  switch (kind) {
    case 'insert': return { id, kind, place: 'below', blocks: [] }
    case 'add-row': return { id, kind, databaseId: '', databaseName: '', title: '', set: [] }
    case 'edit-rows': return { id, kind, databaseId: '', databaseName: '', filter: [], set: [] }
    case 'edit-property': return { id, kind, set: [] }
    case 'open': return { id, kind, target: { kind: 'page', pageId: '', name: '' } }
    case 'confirm': return { id, kind, text: '' }
  }
}
export const problemOf = (steps: readonly ButtonStep[], i: number) => stepProblem(steps[i]!, steps.slice(0, i))

/** The open editor and any confirmation. One per page editor, drawing only what's for its page. */
export function ButtonEditorHost({ pageId, schema }: { pageId: string | null; schema: never }) {
  const current = useSyncExternalStore(subscribe, () => open, () => null)
  const question = useSyncExternalStore(subscribeRunning, currentQuestion, () => null)
  return <>
    {current?.pageId === pageId && <Editor key={current.initial.steps + current.initial.label} open={current} schema={schema} />}
    {pageId === null && question && createPortal(<div className="button-ask-scrim"><div className="button-ask" role="alertdialog" aria-label="Confirm">
      <p>{question.text}</p>
      <div className="button-ask-actions"><button type="button" onClick={() => question.answer(false)}>Cancel</button><button type="button" className="is-primary" autoFocus onClick={() => question.answer(true)}>Continue</button></div>
    </div></div>, document.body)}
  </>
}

function Editor({ open: { initial, anchor, onDone, rowsOf }, schema }: { open: Open; schema: never }) {
  const { workspace } = useWorkspace()
  const wide = useWide(), keyboardTop = useKeyboardTop()
  const [label, setLabel] = useState(initial.label)
  const [steps, setSteps] = useState(() => readSteps(initial.steps))
  const [at, setAt] = useState<number | 'kinds' | null>(null)
  const [asking, setAsking] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const changedYet = label !== initial.label || writeSteps(steps) !== (initial.steps || writeSteps([]))
  const firstProblem = steps.findIndex((_, i) => problemOf(steps, i))
  const ready = steps.length > 0 && firstProblem < 0
  const leave = () => { if (changedYet) setAsking(true); else closeEditor() }
  const done = () => {
    if (!steps.length) { setAt('kinds'); return }
    if (firstProblem >= 0) { setAt(firstProblem); return }
    closeEditor(); onDone({ label: label.trim(), steps: writeSteps(steps) })
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      // One Esc per layer: a menu open in the blocks' editor goes first.
      if (closeBlocksMenu?.()) return
      if (at !== null) setAt(null); else leave()
    }
    const away = (e: PointerEvent) => { const t = e.target as Element; if (!changedYet && !box.current?.contains(t) && !t.closest?.('.button-ask, .bn-suggestion-menu, [data-floating-ui-portal]')) closeEditor() }
    document.addEventListener('keydown', esc, true); document.addEventListener('pointerdown', away, true)
    return () => { document.removeEventListener('keydown', esc, true); document.removeEventListener('pointerdown', away, true) }
  })
  // At 1280 it hangs from the button, kept on screen.
  const place = useMemo(() => { const r = anchor?.getBoundingClientRect(); return r ? { top: Math.min(r.bottom + 6, window.innerHeight - 480), left: Math.min(r.left, window.innerWidth - 380) } : { top: 120, left: Math.max(16, window.innerWidth / 2 - 180) } }, [anchor])
  const put = (i: number, next: ButtonStep) => setSteps(list => list.map((s, j) => (j === i ? next : s)))
  const shift = (i: number, by: number) => setSteps(list => { const out = [...list]; const [s] = out.splice(i, 1); out.splice(i + by, 0, s!); return out })
  if (!workspace) return null
  return createPortal(<>
    <div className="database-menu-scrim" aria-hidden="true" />
    <div ref={box} className="app-menu database-menu button-editor" role="dialog" aria-label="Edit button" style={{ position: 'fixed', ...(wide ? place : {}), ...(!wide && keyboardTop !== null ? { '--keyboard-lift': `${window.innerHeight - keyboardTop}px` } as object : {}) }} onKeyDown={e => e.stopPropagation()}>
      <div className="database-menu-head button-editor-head">
        {at !== null && <button type="button" className="database-menu-back" aria-label="Back" onClick={() => setAt(null)}>‹</button>}
        <span>{at === 'kinds' ? 'Add step' : typeof at === 'number' ? stepKinds.find(k => k.kind === steps[at]!.kind)!.name : 'Button'}</span>
        <button type="button" className={`button-editor-done${ready ? '' : ' is-off'}`} onClick={done}>Done</button>
      </div>
      {asking && <div className="button-editor-discard" role="alert"><span>Discard changes?</span><button type="button" className="app-link" onClick={() => setAsking(false)}>Keep editing</button><button type="button" className="app-link" onClick={closeEditor}>Discard</button></div>}
      {at === null && <>
        <input className="button-editor-name" aria-label="Name" placeholder="Button" maxLength={200} value={label} autoFocus={wide} onChange={e => setLabel(e.target.value)} />
        {steps.map((step, i) => {
          const problem = problemOf(steps, i)
          return <div key={step.id} className={`button-step-row${problem ? ' is-incomplete' : ''}`}>
            <button type="button" className="button-step-open" onClick={() => setAt(i)}><span>{stepTitle(step)}</span>{problem && <small>{problem}</small>}</button>
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => shift(i, -1)}>↑</button>
            <button type="button" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => shift(i, 1)}>↓</button>
            <button type="button" aria-label={`Remove ${stepTitle(step)}`} onClick={() => setSteps(list => list.filter((_, j) => j !== i))}>×</button>
          </div>
        })}
        <button type="button" role="menuitem" onClick={() => setAt('kinds')}>+ Add step</button>
      </>}
      {at === 'kinds' && stepKinds.filter(k => (rowsOf ? propertyKinds : pageKinds).includes(k.kind)).map(({ kind, name }) => <button key={kind} type="button" role="menuitem" onClick={() => { setSteps(list => [...list, newStep(kind)]); setAt(steps.length) }}>{name}</button>)}
      {typeof at === 'number' && steps[at] && <StepPage key={steps[at]!.id} step={steps[at]!} problem={problemOf(steps, at)} canOpenMade={steps.slice(0, at).some(s => s.kind === 'add-row')} workspace={workspace} schema={schema} {...(rowsOf ? { rowsOf } : {})} onChange={next => put(at, next)} />}
    </div>
  </>, document.body)
}

const fromDatabase = (workspace: Workspace, id: string): { title: string; database: Database } | null => {
  if (isTodosTarget(id)) return { title: 'To-dos', database: todosDatabase }
  const page = workspace.pages.find(p => p.id === id)
  return page && isDatabase(page) && !page.trashedAt ? { title: page.title, database: page.database } : null
}
const settable = (database: Database): Property[] => database.fixed ? database.properties.filter(p => todoBarColumns.has(p.id)) : database.properties.filter(p => !isReadOnly(p) && p.id !== titleId)

export function StepPage({ step, problem, canOpenMade, workspace, schema, rowsOf, onChange }: { step: ButtonStep; problem: string | null; canOpenMade: boolean; workspace: Workspace; schema: never; rowsOf?: Database; onChange(next: ButtonStep): void }) {
  const said = problem && <p className="button-step-problem" role="status">{problem}</p>
  switch (step.kind) {
    case 'edit-property': return <>{said}{rowsOf && <SetList database={rowsOf} set={step.set} onChange={set => onChange({ ...step, set })} />}</>
    case 'confirm': return <>{said}<textarea className="button-editor-field" aria-label="Confirmation words" rows={3} autoFocus value={step.text} onChange={e => onChange({ ...step, text: e.target.value })} /></>
    case 'insert': return <>{said}
      <label className="database-menu-row">Where
        <select aria-label="Where" value={step.place} onChange={e => onChange({ ...step, place: e.target.value as typeof step.place })}>
          <option value="below">Below the button</option><option value="above">Above the button</option><option value="top">Top of the page</option><option value="bottom">Bottom of the page</option>
        </select>
      </label>
      <BlocksField schema={schema} blocks={step.blocks} onChange={blocks => onChange({ ...step, blocks })} />
    </>
    case 'open': return <>{said}
      <label className="database-menu-row">Open
        <select aria-label="Open" value={step.target.kind} onChange={e => onChange({ ...step, target: e.target.value === 'page' ? { kind: 'page', pageId: '', name: '' } : e.target.value === 'url' ? { kind: 'url', url: '' } : { kind: 'made' } })}>
          <option value="page">A page</option><option value="url">A link</option>{canOpenMade && <option value="made">The row just made</option>}
        </select>
      </label>
      {step.target.kind === 'url' && <input className="button-editor-field" aria-label="Link" inputMode="url" value={step.target.url} onChange={e => onChange({ ...step, target: { kind: 'url', url: e.target.value } })} />}
      {step.target.kind === 'url' && step.target.url && !safeUrl(step.target.url) && <p className="button-step-problem">Not a web or mail link</p>}
      {step.target.kind === 'page' && <select className="button-editor-field" aria-label="Page" value={step.target.pageId} onChange={e => { const to = workspace.pages.find(p => p.id === e.target.value); onChange({ ...step, target: { kind: 'page', pageId: e.target.value, name: to ? displayPageTitle(to) : '' } }) }}>
        <option value="">Choose a page…</option>
        {workspace.pages.filter((p: Page) => !p.trashedAt && p.type === 'document').map(p => <option key={p.id} value={p.id}>{displayPageTitle(p)}</option>)}
      </select>}
    </>
    case 'add-row': case 'edit-rows': {
      const target = step.databaseId ? fromDatabase(workspace, step.databaseId) : null
      return <>{said}
        <label className="database-menu-row">Database
          <select aria-label="Database" value={step.databaseId} onChange={e => { const db = fromDatabase(workspace, e.target.value); onChange({ ...step, databaseId: e.target.value, databaseName: db?.title ?? '', set: [], ...(step.kind === 'edit-rows' ? { filter: [] } : {}) } as ButtonStep) }}>
            <option value="">Choose…</option>
            <option value={todosSourceId}>To-dos</option>
            {workspace.pages.filter(p => isDatabase(p) && !p.trashedAt).map(p => <option key={p.id} value={p.id}>{displayPageTitle(p)}</option>)}
          </select>
        </label>
        {step.databaseId && !target && <p className="button-step-problem" role="status">{step.databaseName || 'That database'} was deleted</p>}
        {target && step.kind === 'add-row' && <input className="button-editor-field" aria-label="Row name" placeholder="Name" value={step.title} onChange={e => onChange({ ...step, title: e.target.value })} />}
        {target && step.kind === 'edit-rows' && <Rules database={target.database} filter={step.filter} any={Boolean(step.any)} onChange={(filter, any) => onChange({ ...step, filter, ...(any ? { any } : { any: false }) })} />}
        {target && <SetList database={target.database} set={step.set} onChange={set => onChange({ ...step, set } as ButtonStep)} />}
      </>
    }
  }
}

function Rules({ database, filter, any, onChange }: { database: Database; filter: Condition[]; any: boolean; onChange(filter: Condition[], any: boolean): void }) {
  const columns = [{ id: titleId, name: 'Name', type: 'text' as const }, ...database.properties] as Property[]
  return <>
    <p className="button-editor-label">Rows where{filter.length ? '' : ' · every row'}</p>
    {filter.length > 1 && <select aria-label="Match" value={any ? 'any' : 'all'} onChange={e => onChange(filter, e.target.value === 'any')}><option value="all">all rules match</option><option value="any">any rule matches</option></select>}
    {filter.map((c, i) => {
      const property = propertyOf(database, c.by)
      const set = (next: Condition) => onChange(filter.map((x, j) => (j === i ? next : x)), any)
      return <div key={i} className="database-rule">
        {property ? <>
          <select aria-label="Property" value={c.by} onChange={e => { const p = propertyOf(database, e.target.value)!; set({ by: p.id, op: opsFor(p.type)[0]!, ...(p.type === 'checkbox' ? { value: true } : {}) }) }}>{columns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select aria-label="Condition" value={c.op} onChange={e => set({ by: c.by, op: e.target.value as Condition['op'], ...(c.value !== undefined && !e.target.value.includes('Empty') ? { value: c.value } : {}) })}>{opsFor(property.type).map(op => <option key={op} value={op}>{opLabels[op]}</option>)}</select>
          <RuleValue property={property} condition={c} onChange={value => set(value === undefined ? { by: c.by, op: c.op } : { ...c, value })} />
        </> : <span className="database-rule-deleted">(deleted)</span>}
        <button type="button" className="database-rule-remove" aria-label="Remove rule" onClick={() => onChange(filter.filter((_, j) => j !== i), any)}>×</button>
      </div>
    })}
    <button type="button" role="menuitem" onClick={() => onChange([...filter, { by: titleId, op: 'contains' }], any)}>+ Add rule</button>
  </>
}

function SetList({ database, set, onChange }: { database: Database; set: ButtonSet[]; onChange(set: ButtonSet[]): void }) {
  const can = settable(database), free = can.filter(p => !set.some(s => s.id === p.id))
  const firstValue = (p: Property): ButtonValue => { const tap = tapValues(p)[0]; return p.type === 'date' || p.type === 'relation' ? { kind: tap! } as ButtonValue : { kind: 'fixed', raw: null } }
  return <>
    <p className="button-editor-label">Set</p>
    {set.map((s, i) => {
      const property = can.find(p => p.id === s.id)
      const put = (value: ButtonValue) => onChange(set.map((x, j) => (j === i ? { ...x, value } : x)))
      return <div key={s.id} className="database-rule">
        <span className="button-set-name">{s.name}</span>
        {property ? <>
          {tapValues(property).length > 0 && <select aria-label={`${s.name} from`} value={s.value.kind} onChange={e => put(e.target.value === 'fixed' ? { kind: 'fixed', raw: null } : { kind: e.target.value } as ButtonValue)}>
            {tapValues(property).map(k => <option key={k} value={k}>{tapValueName[k as keyof typeof tapValueName]}</option>)}
            {property.type !== 'relation' && <option value="fixed">A value</option>}
          </select>}
          {s.value.kind === 'fixed' && <FixedValue property={property} raw={s.value.raw} onChange={raw => put({ kind: 'fixed', raw })} />}
          {(property.type === 'multiSelect' || property.type === 'relation') && <select aria-label={`${s.name} how`} value={s.mode ?? 'set'} onChange={e => onChange(set.map((x, j) => { if (j !== i) return x; const { mode: _mode, ...rest } = x; return e.target.value === 'set' ? rest : { ...rest, mode: e.target.value as 'add' | 'remove' } }))}><option value="set">Replace</option><option value="add">Add</option><option value="remove">Remove</option></select>}
        </> : <span className="database-rule-deleted">(deleted)</span>}
        <button type="button" className="database-rule-remove" aria-label={`Stop setting ${s.name}`} onClick={() => onChange(set.filter((_, j) => j !== i))}>×</button>
      </div>
    })}
    {free.length > 0 && <select aria-label="Set a property" value="" onChange={e => { const p = free.find(x => x.id === e.target.value); if (p) onChange([...set, { id: p.id, name: p.name, type: p.type, value: firstValue(p) }]) }}><option value="">+ Set a property…</option>{free.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
  </>
}

function FixedValue({ property, raw, onChange }: { property: Property; raw: Json; onChange(raw: Json): void }) {
  switch (property.type) {
    case 'checkbox': return <select aria-label={property.name} value={raw === false ? 'no' : 'yes'} onChange={e => onChange(e.target.value === 'yes')}><option value="yes">checked</option><option value="no">unchecked</option></select>
    case 'select': case 'status': case 'multiSelect': {
      const value = Array.isArray(raw) ? String(raw[0] ?? '') : typeof raw === 'string' ? raw : ''
      return <select aria-label={property.name} value={value} onChange={e => onChange(e.target.value ? (property.type === 'multiSelect' ? [e.target.value] : e.target.value) : null)}><option value="">Empty</option>{(property.options ?? []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    }
    case 'date': return <input type="date" aria-label={property.name} value={raw && typeof raw === 'object' && 'start' in raw ? String(raw.start) : ''} onChange={e => onChange(e.target.value ? { start: e.target.value } : null)} />
    case 'number': return <input aria-label={property.name} inputMode="decimal" value={typeof raw === 'number' ? String(raw) : ''} onChange={e => { const n = Number(e.target.value); onChange(e.target.value.trim() && Number.isFinite(n) ? n : null) }} />
    default: return <input aria-label={property.name} value={typeof raw === 'string' ? raw : ''} onChange={e => onChange(e.target.value)} />
  }
}

// Over the sheet, which clips what's inside it. Fixed takes it out of the sheet's scrolling box.
const overSheet = { useFloatingOptions: { strategy: 'fixed' as const } }
let closeBlocksMenu: (() => boolean) | null = null
// No explanatory line (Brian's rule): the step says what's wanted.
const noPlaceholders = { ...en, placeholders: { ...en.placeholders, default: '', emptyDocument: '' } }
const slashKinds = new Set(['paragraph', 'heading', 'heading_2', 'heading_3', 'bullet_list', 'numbered_list', 'check_list', 'quote'])
/** What Insert blocks puts in, written as on a page: to-dos and `@date` chips come out new each tap (§2). It saves nowhere but the step. */
function BlocksField({ schema, blocks, onChange }: { schema: never; blocks: EditorNode[]; onChange(blocks: EditorNode[]): void }) {
  const editor = useCreateBlockNote({ schema, dictionary: noPlaceholders, ...(blocks.length ? { initialContent: blocks as never } : {}) })
  useEffect(() => {
    closeBlocksMenu = () => { const menu = editor.getExtension(SuggestionMenu); if (!menu?.shown()) return false; menu.closeMenu(); return true }
    return () => { closeBlocksMenu = null }
  }, [editor])
  return <div className="button-blocks" aria-label="Blocks to insert">
    <BlockNoteView editor={editor} theme="light" formattingToolbar={false} sideMenu={false} slashMenu={false} linkToolbar={false} onChange={() => onChange(editor.document as never)}>
      <SuggestionMenuController triggerCharacter="/" floatingUIOptions={overSheet} getItems={async query => filterSuggestionItems(getDefaultReactSlashMenuItems(editor).filter(item => slashKinds.has((item as { key?: string }).key ?? '')), query)} />
      <SuggestionMenuController triggerCharacter="@" floatingUIOptions={overSheet} getItems={async query => {
        const reading = readDate(query || 'today', todayIso())
        return reading ? [{ title: reading.date, onItemClick: () => { editor.insertInlineContent([{ type: 'dateMention', props: { date: reading.date, time: reading.time ?? '' } } as never, ' ']) } }] : []
      }} />
    </BlockNoteView>
  </div>
}
