// A to-do's repeat (docs/design/repeating-to-dos.md §3): the editor `Repeat…` in its menu opens, a popover at ≥ 900 and a
// sheet below. The fields are the database Repeat menu's, less the time.
import { useEffect, useSyncExternalStore } from 'react'
import { toast } from '@heroui/react'
import { everyNames, RepeatEvery, RepeatWeekdays } from './repeat-fields'
import { EditorShell, useWide } from './property-editors'
import { nextLine, repeatFields, repeatMarkName, repeatsIn, ruleAfter, type RepeatEdit } from './todo-repeat-view'
import type { TodoRepeatRule } from '../domain/todo-repeats'
import { noCaret } from './blockers'
import { RepeatIcon } from './icons'
import { todayIso } from './dates'
import { useWorkspace } from './use-day'

/** Where focus goes back to when the editor closes: the control that opened it, or its row once that control is gone. */
interface FocusBack { opener: HTMLElement; focusRow(): void }
let current: { taskId: string; anchor: HTMLElement | null; back?: FocusBack } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
export function openRepeatEditor(taskId: string, anchor: HTMLElement | null, back?: FocusBack) { current = { taskId, anchor, back }; notify() }
const close = () => { current = null; notify() }

/**
 * The repeat icon at a line's end: not text, a tap opens the editor. The editor is placed against the line or row, as
 * from the menu, since Off takes this icon away. `focusRow`: how the row takes focus back (a line's caret); without
 * it, its ⋯, as the row menu's Esc does.
 */
export function RepeatMark({ taskId, rule, focusRow }: { taskId: string; rule: TodoRepeatRule; focusRow?: () => void }) {
  const name = repeatMarkName(rule)
  const open = (opener: HTMLElement) => {
    const row = opener.closest<HTMLElement>('.editor-task, .task-row')
    openRepeatEditor(taskId, row ?? opener, { opener, focusRow: focusRow ?? (() => row?.querySelector<HTMLElement>('[aria-haspopup=menu]')?.focus()) })
  }
  return <button type="button" contentEditable={false} className="repeat-mark" aria-label={name} title={name} aria-haspopup="dialog" {...noCaret} onClick={e => open(e.currentTarget)}><RepeatIcon /></button>
}

/**
 * Refusals the editor says itself, once, in their own words. A drawn change the server refuses (the limit reached
 * elsewhere, the to-do ticked on another device) goes back on screen as the outbox removes it.
 */
const inlineRefusal = /[\d,]+ repeating to-dos at most|Reopen it first|That to-do was deleted|That to-do is in Trash|A to-do needs words|Invalid repeat|Nothing to change/
// Nothing to change: what he sees is already what's stored, so there's nothing to say.
const onRefused = (message: string) => { if (message !== 'Nothing to change') toast(message, { timeout: 6000 }) }

const unitOf = (every: keyof typeof everyNames, interval: number) => `${every}${interval === 1 ? '' : 's'}`

/** Every change is sent as it's made, so closing it has nothing to save. */
export function RepeatEditorHost() {
  const open = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => current, () => null)
  const { workspace, run } = useWorkspace()
  const wide = useWide()
  const task = open && workspace ? workspace.tasks.find(t => t.id === open.taskId) : undefined
  // Gone, or finished here or on another device: there's no repeat left to set on it.
  const over = Boolean(open && workspace && task?.status !== 'open')
  useEffect(() => { if (over) close() }, [over])
  if (!open || !workspace || !task || over) return null

  const repeat = repeatsIn(workspace).get(task.id)
  const fields = repeatFields(repeat)
  const today = todayIso()
  const weekStart = workspace.weekStart ?? 0
  // Done or Esc on the popover: back to the icon, or to its row if Off took the icon away. Not after a click elsewhere,
  // which put focus where it was clicked. The sheet keeps its own way.
  const dismiss = (reason: string) => {
    const back = open.back
    close()
    if (!wide || !back || reason === 'outside') return
    if (back.opener.isConnected) back.opener.focus()
    else back.focusRow()
  }
  const send = (edit: RepeatEdit) => {
    const rule = ruleAfter(repeat, edit, today)
    if (rule === undefined) return
    void run({ type: 'set-todo-repeat', taskId: task.id, repeat: rule, today, at: new Date().toISOString() }, r => ({ text: r.message, undoOperationId: r.operationId }), undefined, { inlineRefusal, onRefused })
  }

  return <EditorShell wide={wide} anchor={open.anchor} property={{ name: 'Repeat' }} rowTitle={task.title} onDismiss={dismiss} minWidth={312} maxWidth={312}>
    <div className="todo-repeat-editor">
      <label className="database-menu-row database-repeat-field">Repeat
        <select aria-label="Repeat" value={fields.every} onChange={e => send({ field: 'every', value: e.target.value as typeof fields.every })}>
          <option value="off">Off</option>
          {(Object.keys(everyNames) as Array<keyof typeof everyNames>).map(k => <option key={k} value={k}>{everyNames[k]}</option>)}
        </select>
      </label>
      {repeat && <>
        <label className="database-menu-row database-repeat-field">Every
          <span className="database-repeat-every"><RepeatEvery repeat={repeat} set={({ interval }) => send({ field: 'interval', value: interval })} />{unitOf(repeat.every, repeat.interval)}</span>
        </label>
        {fields.showWeekdays && <RepeatWeekdays label="" repeat={{ weekdays: repeat.weekdays, start: repeat.slot }} weekStart={weekStart} set={days => send({ field: 'weekdays', value: days })} />}
        <label className="database-menu-row database-repeat-field">From
          <select aria-label="From" value={fields.from} onChange={e => send({ field: 'from', value: e.target.value as typeof fields.from })}>
            <option value="schedule">Its day</option>
            <option value="done">When it's done</option>
          </select>
        </label>
        <label className="database-menu-row database-repeat-field">Ends
          <select aria-label="Ends" value={fields.ends} onChange={e => send({ field: 'ends', value: e.target.value as typeof fields.ends })}>
            <option value="never">Never</option>
            <option value="date">On a date</option>
          </select>
        </label>
        {fields.ends === 'date' && <label className="database-menu-row database-repeat-field"><span />
          <input type="date" aria-label="Ends on" min={today} value={fields.until} onChange={e => send({ field: 'until', value: e.target.value })} />
        </label>}
        <p className="database-menu-quiet">{nextLine(repeat, today, weekStart)}</p>
      </>}
    </div>
  </EditorShell>
}
