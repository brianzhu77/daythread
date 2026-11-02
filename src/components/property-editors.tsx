// The database's value editors and cell contents (design §6.3). One editor per type, all in the same shell: a popover
// under the cell at ≥ 900 px, our bottom sheet below that. Each commit hands over what `storedValue` accepts; the
// per-cell check, Undo and the save states stay with the caller (Roadbuster 03d86c21).
import {
  FloatingFocusManager, FloatingPortal, autoUpdate, flip, offset, shift, size, useDismiss, useFloating, useInteractions,
  useRole, type Placement,
} from '@floating-ui/react'
import { Calendar, Modal } from '@heroui/react'
import { parseDate } from '@internationalized/date'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  sameRaw, storedValue, type CellValue, type DateValue, type Json, type Option, type Property,
} from '../domain/database.ts'
import { mayRead, readDate } from '../domain/date-reading.ts'
import type { LocalDate } from '../domain/types'
import { addDays, todayIso } from './dates'
import { pickerLabel, relativeDay } from './event-rows'
import {
  changedNotice, dateLabel, enterChoice, flipSign, hasTime, joinDate, matchOptions, numberDraft, numberLabel,
  orderedDate, popoverMinWidth, readNumberInput, readingLabel, splitDate, statusDot, statusGroups, tooLong,
  tooLongMessage, urlHref, urlLabel, withoutTime,
} from './property-values.ts'

export interface CommitInfo {
  /** Show this as the usual Undo notice ("Notes changed · Undo"): phone Text/URL commits only (Lead f1e56ab4). */
  notice?: string
}
export interface EditorProps {
  property: Property
  /** What `readValue` returns for the cell. */
  value: CellValue
  /** The row's title, shown under the property name on the phone, where the sheet covers the table. */
  rowTitle: string
  /** The cell: the popover opens under it, and focus goes back to it on close. */
  anchor: HTMLElement | null
  /** `undefined` clears the value. Never called when nothing changed: `onCancel` is, instead. */
  onCommit(raw: Json | undefined, info?: CommitInfo): void
  onCancel(): void
  /** Select, Multi-select, Status: makes the option (Status: at the end of To do) and returns its id. */
  onCreateOption?(name: string): string
  /** Text and URL: what's typed so far, on every change, so the caller can keep it on the device (R1-15). */
  onDraft?(text: string): void
  /** Tab / Shift-Tab in an in-cell field (≥ 900): called after the commit, to move the cell cursor along the row. */
  onMove?(direction: 'next' | 'previous'): void
}
type Dismiss = 'done' | 'escape' | 'outside'

/** The width rule (§6.3.1): popovers at ≥ 900 px, sheets below. */
export function useWide(): boolean {
  const query = `(min-width: ${popoverMinWidth}px)`
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setWide(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return wide
}

/** One editor for the property's type. Checkbox has none: it ticks in its cell (`PropertyCheckbox`). */
export function PropertyEditor(props: EditorProps) {
  switch (props.property.type) {
    case 'text': return <TextEditor {...props} kind="text" />
    case 'url': return <TextEditor {...props} kind="url" />
    case 'number': return <NumberEditor {...props} />
    case 'select':
    case 'status':
    case 'multiSelect': return <OptionsEditor {...props} />
    case 'date': return <DateEditor {...props} />
    case 'checkbox': return null
  }
}

// ---------- Commit ----------

/** The stored form of what the cell shows now, to compare a commit against. */
function storedNow(property: Property, value: CellValue): Json | undefined {
  try { return storedValue(property, value) } catch { return undefined }
}
/**
 * Commits `input` when the model accepts it and it differs from the cell; cancels when it's the same. Returns false
 * when the model refuses it, so the editor stays open. `property` may carry options created while it was open.
 */
function finish(p: EditorProps, input: unknown, property: Property = p.property, info?: CommitInfo): boolean {
  let raw: Json | undefined
  try { raw = storedValue(property, input) } catch { return false }
  if (sameRaw(raw, storedNow(p.property, p.value))) p.onCancel()
  else p.onCommit(raw, info)
  return true
}
/** Enter while an IME is composing only commits the composition (§6.3.1). */
const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

// ---------- Shell (§6.3.1) ----------

interface ShellProps {
  wide: boolean
  anchor: HTMLElement | null
  property: Property
  rowTitle: string
  /** The editor decides what each way of leaving does; the shell stays open until the caller unmounts it. */
  onDismiss(reason: Dismiss): void
  /** In-cell fields lie over the cell instead of under it. */
  overCell?: boolean
  maxWidth?: number
  children: ReactNode
}
/**
 * A phone sheet closing leaves no caret in the page. The sheet's focus scope gives focus back towards the cell, which
 * sits inside the page editor, so the editor took it: a caret at the page's start, and after a Text sheet the keyboard
 * stayed up (native run on dc9b8db7). A tap on a cell has already left any line he was typing in, so after a sheet
 * the keyboard stays down.
 */
function useNoCaretAfterSheet(sheet: boolean) {
  useEffect(() => {
    if (!sheet) return
    return () => {
      const settle = () => {
        const active = document.activeElement as HTMLElement | null
        if (!active?.closest?.('[contenteditable=true]')) return
        active.blur()
        getSelection()?.removeAllRanges()
      }
      requestAnimationFrame(() => { settle(); setTimeout(settle, 60) })
    }
  }, [sheet])
}

function EditorShell({ wide, anchor, property, rowTitle, onDismiss, overCell, maxWidth = 320, children }: ShellProps) {
  useNoCaretAfterSheet(!wide)
  // Keys stay inside: nothing typed here reaches the page editor's handlers through the React tree (§10). That also
  // keeps Esc from the dismiss listeners on the document, so the shell handles Esc itself. (They still catch an Esc
  // after focus has left, as after an outside click that Too long refused.)
  const keep = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape' && !composing(e)) { e.preventDefault(); onDismiss('escape') }
  }
  if (wide) return <Popover anchor={anchor} label={property.name} onDismiss={onDismiss} overCell={overCell} maxWidth={maxWidth}><div onKeyDown={keep}>{children}</div></Popover>
  return (
    <Modal.Backdrop isOpen isDismissable onOpenChange={open => { if (!open) onDismiss('outside') }}>
      <Modal.Container placement="bottom" scroll="inside" className="property-sheet">
        <Modal.Dialog aria-label={`${property.name} · ${rowTitle || 'Untitled'}`}>
          <div onKeyDown={keep} className="property-sheet-body">
            <div className="sheet-handle" aria-hidden="true" />
            <header className="property-sheet-head">
              <div className="property-sheet-title">
                <h2>{property.name}</h2>
                <small>{rowTitle || 'Untitled'}</small>
              </div>
              <button type="button" className="app-link" onClick={() => onDismiss('done')}>Done</button>
            </header>
            {children}
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function Popover({ anchor, label, onDismiss, overCell, maxWidth, children }: { anchor: HTMLElement | null; label: string; onDismiss(reason: Dismiss): void; overCell?: boolean; maxWidth: number; children: ReactNode }) {
  const placement: Placement = 'bottom-start'
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open, _event, reason) => { if (!open) onDismiss(reason === 'escape-key' ? 'escape' : 'outside') },
    elements: { reference: anchor },
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => (overCell ? -rects.reference.height : 4)),
      // Flip above the cell when there's less than 280 px below it (§6.3.1).
      flip({ padding: 8, fallbackPlacements: ['top-start'] }),
      shift({ padding: 8 }),
      size({ apply: ({ rects, elements }) => {
        elements.floating.style.width = `${Math.min(maxWidth, Math.max(240, rects.reference.width))}px`
      } }),
    ],
  })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getFloatingProps } = useInteractions([dismiss, role])
  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} returnFocus modal={false}>
        <div ref={refs.setFloating} style={floatingStyles} className={`property-popover ${overCell ? 'is-over-cell' : ''}`} aria-label={label} {...getFloatingProps()}>
          {children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
}

function FieldError({ children }: { children: ReactNode }) {
  return <p className="property-field-error" role="alert">{children}</p>
}

/** Saves an open in-cell field when the page is hidden (a tab closed, the app sent away), so typing is never lost. */
function useSaveOnHide(save: () => void) {
  const latest = useRef(save)
  latest.current = save
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') latest.current() }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
}

/**
 * An editor opened on a value starts with the caret after it, to add to it; typing doesn't replace it by surprise. An
 * `onFocus` handler, since the popover's portal mounts the field after the editor's own effects have run.
 */
function useCaretAtEnd() {
  const placed = useRef(false)
  return (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
    if (placed.current) return
    placed.current = true
    const el = e.currentTarget
    el.setSelectionRange(el.value.length, el.value.length)
  }
}

// ---------- Text and URL (§6.3.3, §6.3.10) ----------

function TextEditor(p: EditorProps & { kind: 'text' | 'url' }) {
  const wide = useWide()
  const before = typeof p.value === 'string' ? p.value : ''
  const [draft, setDraft] = useState(before)
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const long = tooLong(draft)
  const save = (): boolean => {
    if (long) return false
    // The phone has no ⌘Z, so any change to a Text or URL value gets the Undo notice there (Lead f1e56ab4). A value
    // typed into an empty field (naming a new row) has nothing to lose, so it's quiet.
    const info = !wide && before !== '' && draft !== before ? { notice: changedNotice(p.property.name) } : undefined
    return finish(p, draft, p.property, info)
  }
  useSaveOnHide(() => { void save() })
  const onFocus = useCaretAtEnd()
  // Grow with its lines, so a long value never scrolls inside a one-line box.
  useEffect(() => {
    const el = field.current
    if (el && p.kind === 'text') { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }, [draft, p.kind])
  const onDismiss = (reason: Dismiss) => {
    // Too long stays open with the reason under it; Esc at ≥ 900 is the one way back to the old value (§6.3.3).
    if (long) { if (reason === 'escape') p.onCancel(); return }
    void save()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !composing(e)) { e.preventDefault(); void save() }
    else if (e.key === 'Enter' && e.shiftKey && (p.kind === 'url' || !wide)) e.preventDefault()
    else if (e.key === 'Tab' && wide) { e.preventDefault(); if (save()) p.onMove?.(e.shiftKey ? 'previous' : 'next') }
  }
  const href = p.kind === 'url' ? urlHref(draft) : null
  const common = {
    ref: field,
    className: 'property-field',
    value: draft,
    autoFocus: true,
    'aria-label': p.property.name,
    'aria-invalid': long || undefined,
    enterKeyHint: wide ? undefined : 'done' as const,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); p.onDraft?.(e.target.value) },
    onKeyDown,
    onFocus,
  }
  return (
    <EditorShell wide={wide} anchor={p.anchor} property={p.property} rowTitle={p.rowTitle} onDismiss={onDismiss} overCell={wide} maxWidth={360}>
      {p.kind === 'text'
        ? <textarea {...common} rows={wide ? 1 : 3} />
        : <input {...common} type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />}
      {long && <FieldError>{tooLongMessage}</FieldError>}
      {!wide && href && (
        <a className="property-row" href={href} target="_blank" rel="noopener noreferrer">Open link ↗</a>
      )}
    </EditorShell>
  )
}

// ---------- Number (§6.3.4) ----------

function NumberEditor(p: EditorProps) {
  const wide = useWide()
  const [draft, setDraft] = useState(numberDraft(typeof p.value === 'number' ? p.value : null))
  const onFocus = useCaretAtEnd()
  const reading = readNumberInput(draft, p.property.format)
  const invalid = reading === 'invalid'
  const save = (): boolean => (invalid ? false : finish(p, reading))
  useSaveOnHide(() => { void save() })
  // Input that can't be stored goes back to the old value on every way out except Enter, which keeps the field open.
  const onDismiss = () => { if (invalid) p.onCancel(); else void save() }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); void save() }
    else if (e.key === 'Tab' && wide) { e.preventDefault(); if (save()) p.onMove?.(e.shiftKey ? 'previous' : 'next') }
  }
  return (
    <EditorShell wide={wide} anchor={p.anchor} property={p.property} rowTitle={p.rowTitle} onDismiss={onDismiss} overCell={wide}>
      <div className="property-number">
        <input className="property-field is-number" value={draft} autoFocus onFocus={onFocus} inputMode="decimal" enterKeyHint={wide ? undefined : 'done'}
          aria-label={p.property.name} aria-invalid={invalid || undefined} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} />
        {/* iOS's decimal keypad has no minus sign (§6.3.4). */}
        {!wide && <button type="button" className="property-sign" aria-label="Change sign" onMouseDown={e => e.preventDefault()} onClick={() => setDraft(flipSign)}>±</button>}
      </div>
      {invalid && <FieldError>Numbers only</FieldError>}
    </EditorShell>
  )
}

// ---------- Select, Multi-select, Status (§6.3.5–7) ----------

type Choice = { kind: 'option'; option: Option } | { kind: 'create'; name: string }

function OptionsEditor(p: EditorProps) {
  const wide = useWide()
  const multi = p.property.type === 'multiSelect'
  const status = p.property.type === 'status'
  // Options made while the editor is open, so a commit is checked against them before the caller's property catches up.
  const [created, setCreated] = useState<Option[]>([])
  const property = useMemo(() => ({ ...p.property, options: [...(p.property.options ?? []), ...created.filter(c => !p.property.options?.some(o => o.id === c.id))] }), [p.property, created])
  const options = property.options
  const [picked, setPicked] = useState<string[]>(() => (Array.isArray(p.value) ? p.value : typeof p.value === 'string' ? [p.value] : []))
  const [query, setQuery] = useState('')
  // The list and its highlight are worked out together from the query, so Enter right after a key uses this query's
  // highlight, never the one from the key before.
  const listFor = (q: string): Choice[] => {
    const { matches, create } = matchOptions(options, q)
    const list: Choice[] = status
      ? statusGroups.flatMap(g => matches.filter(o => (o.group ?? 'todo') === g.group)).map(option => ({ kind: 'option' as const, option }))
      : matches.map(option => ({ kind: 'option' as const, option }))
    return create ? [...list, { kind: 'create', name: create }] : list
  }
  const highlightFor = (list: Choice[], q: string): number => {
    const choice = enterChoice(options, q)
    if (!choice) return 0
    return Math.max(0, list.findIndex(c => ('option' in choice ? c.kind === 'option' && c.option.id === choice.option.id : c.kind === 'create')))
  }
  const choices = listFor(query)
  const [active, setActive] = useState(0)
  const search = (q: string) => { setQuery(q); setActive(highlightFor(listFor(q), q)) }

  const make = (name: string): Option | null => {
    if (!p.onCreateOption) return null
    const option: Option = { id: p.onCreateOption(name), name, ...(status ? { group: 'todo' as const } : {}) }
    setCreated(list => [...list, option])
    return option
  }
  const commitMulti = (ids: string[], withOptions: Property = property) => finish(p, ids.length ? ids : undefined, withOptions)
  const choose = (choice: Choice) => {
    let option = choice.kind === 'option' ? choice.option : null
    let withOptions = property
    if (choice.kind === 'create') {
      option = make(choice.name)
      if (!option) return
      withOptions = { ...property, options: [...options, option] }
    }
    if (!option) return
    if (!multi) { finish(p, option.id, withOptions); return }
    const id = option.id
    setPicked(list => (list.includes(id) && choice.kind === 'option' ? list.filter(x => x !== id) : [...new Set([...list, id])]))
    if (choice.kind === 'create') search('')
  }
  // Select and Status commit on the pick, so leaving changes nothing. Multi-select commits what's picked on any way out.
  const onDismiss = () => { if (multi) commitMulti(picked); else p.onCancel() }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(0, Math.min(choices.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter' && !composing(e)) {
      e.preventDefault()
      const choice = choices[active]
      if (choice) choose(choice)
    } else if (e.key === 'Backspace' && multi && wide && !query && picked.length) {
      setPicked(list => list.slice(0, -1))
    }
  }
  const nameOf = (id: string) => options.find(o => o.id === id)?.name ?? ''
  // On the phone the keyboard stays down so a pick is one tap, except when typing is all there is to do (§6.3.5).
  const focusField = wide || options.length === 0
  let lastGroup: string | undefined
  return (
    <EditorShell wide={wide} anchor={p.anchor} property={p.property} rowTitle={p.rowTitle} onDismiss={onDismiss}>
      <div className="property-search">
        {multi && picked.map(id => (
          <span key={id} className="property-chip is-removable">
            {nameOf(id)}
            <button type="button" aria-label={`Remove ${nameOf(id)}`} onMouseDown={e => e.preventDefault()} onClick={() => setPicked(list => list.filter(x => x !== id))}>×</button>
          </span>
        ))}
        <input className="property-field" value={query} autoFocus={focusField} placeholder={options.length ? 'Search or create' : 'Type to create an option'}
          aria-label={`Search ${p.property.name}`} aria-controls="property-options" aria-activedescendant={choices[active] ? `property-choice-${active}` : undefined}
          onChange={e => search(e.target.value)} onKeyDown={onKeyDown} />
      </div>
      <div className="property-options" id="property-options" role="listbox" aria-multiselectable={multi || undefined} aria-label={p.property.name}>
        {!options.length && !query && <p className="property-empty">No options yet</p>}
        {choices.map((choice, i) => {
          const heading = status && choice.kind === 'option' && (choice.option.group ?? 'todo') !== lastGroup
            ? statusGroups.find(g => g.group === ((choice.option.group ?? 'todo')))!.title : null
          if (choice.kind === 'option') lastGroup = choice.option.group ?? 'todo'
          const selected = choice.kind === 'option' && picked.includes(choice.option.id)
          return (
            <div key={choice.kind === 'option' ? choice.option.id : 'create'} role="presentation">
              {heading && <p className="menu-title" role="presentation">{heading}</p>}
              <button type="button" role="option" id={`property-choice-${i}`} aria-selected={selected}
                className={`property-row ${i === active ? 'active' : ''} ${selected ? 'checked' : ''}`}
                onMouseDown={e => e.preventDefault()} onMouseEnter={() => wide && setActive(i)} onClick={() => choose(choice)}>
                {choice.kind === 'option'
                  ? <OptionLabel option={choice.option} status={status} />
                  : <span className="property-create">Create <span className="property-chip">{choice.name}</span></span>}
              </button>
            </div>
          )
        })}
      </div>
      {!multi && !status && p.value !== null && (
        <button type="button" className="property-row is-quiet" onMouseDown={e => e.preventDefault()} onClick={() => finish(p, undefined)}>Clear</button>
      )}
    </EditorShell>
  )
}
function OptionLabel({ option, status }: { option: Option; status: boolean }) {
  return status
    ? <span className="property-status"><span className="property-dot" aria-hidden="true">{statusDot(option)}</span>{option.name}</span>
    : <span className="property-chip">{option.name}</span>
}

// ---------- Date (§6.3.9) ----------

function DateEditor(p: EditorProps) {
  const wide = useWide()
  const today = todayIso()
  const initial = p.value && typeof p.value === 'object' && !Array.isArray(p.value) ? p.value as DateValue : null
  const [start, setStart] = useState<string | null>(initial?.start ?? null)
  const [end, setEnd] = useState<string | null>(initial?.end ?? null)
  const [endOn, setEndOn] = useState(Boolean(initial?.end))
  const [timeOn, setTimeOn] = useState(Boolean(p.property.withTime) || hasTime(initial))
  const [which, setWhich] = useState<'start' | 'end'>('start')
  const [query, setQuery] = useState('')
  const [calendar, setCalendar] = useState(false)

  const typed = query.trim()
  const reading = typed ? readDate(typed, today) : null
  const readable = reading && reading.used === typed.length ? reading : null
  const current = which === 'end' ? end : start

  const value = (s: string | null, e: string | null, ends: boolean, times: boolean): DateValue | undefined => {
    if (!s) return undefined
    const v = orderedDate(s, ends ? e ?? undefined : undefined)
    return times ? v : withoutTime(v)
  }
  const commit = (v: DateValue | undefined) => finish(p, v)
  /** Sets the start or end day, keeping its time when Include time is on. Without End date, a pick saves and closes. */
  const setDay = (day: LocalDate, time: string | null = null) => {
    const keepTime = time ?? (timeOn && current ? splitDate(current).time : null)
    const text = joinDate(day, timeOn || time ? keepTime : null)
    if (time) setTimeOn(true)
    setQuery(''); setCalendar(false)
    if (which === 'end') { setEnd(text); return }
    setStart(text)
    if (!endOn) { commit(value(text, null, false, timeOn || Boolean(time))); return }
    setWhich('end')
  }
  const setTime = (part: 'start' | 'end', time: string) => {
    const base = (part === 'end' ? end : start) ?? joinDate(today, null)
    const next = joinDate(splitDate(base).day, time || null)
    if (part === 'end') setEnd(next); else setStart(next)
  }
  const onDismiss = () => {
    if (!start) { if (initial) commit(undefined); else p.onCancel(); return }
    commit(value(start, end, endOn, timeOn))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); if (readable) setDay(readable.date, readable.time) }
  }
  const quick = [0, 1, 2, 3].map(i => addDays(today, i))
  const dayOf = (text: string | null) => (text ? splitDate(text).day : null)
  return (
    <EditorShell wide={wide} anchor={p.anchor} property={p.property} rowTitle={p.rowTitle} onDismiss={onDismiss}>
      {endOn && (
        <div className="property-date-ends" role="radiogroup" aria-label="Which date">
          {(['start', 'end'] as const).map(part => {
            const text = part === 'end' ? end : start
            return (
              <div key={part} className={`property-date-end ${which === part ? 'active' : ''}`}>
                <button type="button" role="radio" aria-checked={which === part} onClick={() => setWhich(part)}>
                  <span className="property-date-end-name">{part === 'start' ? 'Start' : 'End'}</span>
                  <span>{text ? dateLabel({ start: text.slice(0, 10) }, today) : 'Empty'}</span>
                </button>
                {timeOn && <input type="time" className="property-time" aria-label={`${part === 'start' ? 'Start' : 'End'} time`} value={text ? splitDate(text).time ?? '' : ''} onChange={e => setTime(part, e.target.value)} />}
              </div>
            )
          })}
        </div>
      )}
      <input className="property-field" value={query} autoFocus={wide} placeholder="Type a date" aria-label={`${p.property.name}: type a date`}
        onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      {readable && <p className="property-reading">{readingLabel(readable.date, readable.time, today)}</p>}
      {typed && !readable && !mayRead(typed, today) && <p className="property-reading is-not">Not a date</p>}
      <div className="property-options" role="listbox" aria-label="Days">
        {quick.map(day => (
          <button key={day} type="button" role="option" aria-selected={dayOf(current) === day} className={`property-row ${dayOf(current) === day ? 'checked' : ''}`}
            onMouseDown={e => e.preventDefault()} onClick={() => setDay(day)}>
            <span>{pickerLabel(day, today)}</span><span className="property-row-hint">{relativeDay(day, today)}</span>
          </button>
        ))}
        <button type="button" className="property-row" aria-expanded={calendar} onMouseDown={e => e.preventDefault()} onClick={() => setCalendar(open => !open)}>Pick on calendar…</button>
      </div>
      {calendar && (
        <Calendar className="day-picker property-calendar" aria-label={which === 'end' ? 'End date' : 'Date'}
          value={dayOf(current) ? parseDate(dayOf(current)!) : undefined} onChange={d => setDay(d.toString())}>
          <Calendar.Header>
            <Calendar.Heading />
            <Calendar.NavButton slot="previous" />
            <Calendar.NavButton slot="next" />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>{day => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
            <Calendar.GridBody>{day => <Calendar.Cell date={day} />}</Calendar.GridBody>
          </Calendar.Grid>
        </Calendar>
      )}
      <div className="property-switches">
        <Toggle label="End date" on={endOn} onChange={on => { setEndOn(on); setWhich(on ? 'end' : 'start'); if (!on) setEnd(null) }} />
        <Toggle label="Include time" on={timeOn} onChange={setTimeOn} />
        {timeOn && !endOn && (
          <input type="time" className="property-time" aria-label="Time" value={start ? splitDate(start).time ?? '' : ''} onChange={e => setTime('start', e.target.value)} />
        )}
      </div>
      {initial && (
        <button type="button" className="property-row is-quiet" onMouseDown={e => e.preventDefault()} onClick={() => commit(undefined)}>Clear</button>
      )}
    </EditorShell>
  )
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <label className="property-toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={on} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

// ---------- Cells (§6.3.2) ----------

/** What a cell shows for its value. The cell itself (size, cursor, press, save states) is the table's. */
export function PropertyCell({ property, value, today = todayIso() }: { property: Property; value: CellValue; today?: LocalDate }) {
  const read = value
  if (read === null) return null
  switch (property.type) {
    case 'text': return <span className="cell-text">{String(read).replace(/\s*\n\s*/g, ' ')}</span>
    case 'number': return <span className="cell-number">{numberLabel(read as number, property.format)}</span>
    case 'url': {
      const href = urlHref(read as string)
      return href ? <span className="cell-text cell-url">{urlLabel(read as string)}</span> : <span className="cell-text">{read as string}</span>
    }
    case 'select': {
      const option = property.options?.find(o => o.id === read)
      return option ? <span className="property-chip">{option.name}</span> : null
    }
    case 'status': {
      const option = property.options?.find(o => o.id === read)
      return option ? <OptionLabel option={option} status /> : null
    }
    case 'multiSelect': {
      const chosen = (read as string[]).map(id => property.options?.find(o => o.id === id)).filter((o): o is Option => Boolean(o))
      return <span className="cell-chips">{chosen.map(o => <span key={o.id} className="property-chip">{o.name}</span>)}</span>
    }
    case 'date': return <span className="cell-text">{dateLabel(read as DateValue, today)}</span>
    case 'checkbox': return null
  }
}

/**
 * The checkbox property's plain square (§6.1), not the task tick. A tick never takes focus, so the caret and the
 * keyboard stay where they were (the B72 rule); the tap area is the whole cell, which the caller gives it.
 */
export function PropertyCheckbox({ checked, label, disabled, onToggle }: { checked: boolean; label: string; disabled?: boolean; onToggle(next: boolean): void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled} tabIndex={-1}
      className={`property-checkbox ${checked ? 'is-checked' : ''}`}
      onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()} onClick={() => onToggle(!checked)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
    </button>
  )
}
