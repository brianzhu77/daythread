import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { carryAncestors, isBlankTask, previousDayPage } from '../domain/workspace'
import { inlineText, textDate, type EditorNode } from '../domain/editor-document'
import type { DayView, LocalDate, Page, Task, Workspace } from '../domain/types'
import { shortLabel, weekday } from './dates'
import { DateTag } from './date-tag'
import { flushEditor } from './editor-flush'
import { RowMenu } from './row-menu'
import { TagText } from './tag-text'
import { LineText } from './line-text'
import { anotherDayItems, notTodayText } from './task-row'
import { useWorkspace } from './use-day'

// The morning card: yesterday's open tasks with a reason per row, a round + that adds at once with an Undo strip, and
// yesterday's lines collapsed with Bring to today. Deterministic: nothing here calls a model.

export function previousDailyPage(workspace: Workspace, date: LocalDate): Page | undefined {
  return previousDayPage(workspace, date)
}

/** "Later" is screen-only: it collapses the card for the rest of the day. */
export function useHandoffLater(date: LocalDate): [boolean, (v: boolean) => void] {
  const key = `daythread.handoff-later.${date}`
  const [later, setLater] = useState(() => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === '1')
  return [later, v => { sessionStorage.setItem(key, v ? '1' : '0'); setLater(v) }]
}

interface TaskSuggestion { task: Task; reason: string }

/** Unfinished tasks from the previous day, each once, in the previous page's order, as a tree. */
export function taskSuggestions(view: DayView, workspace: Workspace, today: LocalDate): TaskSuggestion[] {
  if (!view.page) return []
  const prev = previousDailyPage(workspace, today)
  const out: TaskSuggestion[] = []
  for (const t of view.handoffTasks) if (!isBlankTask(t) && t.status === 'open' && !t.paused) out.push({ task: t, reason: `Unfinished · from ${prev?.date ? weekday(prev.date) : 'yesterday'}` })
  return asTree(out, prev)
}

/** A sub-task right after its nearest ancestor on the previous page that the card also offers. */
function asTree(out: TaskSuggestion[], prev: Page | undefined): TaskSuggestion[] {
  const ids = new Set(out.map(s => s.task.id))
  const parentOf = new Map(out.map(s => [s.task.id, carryAncestors(prev, s.task.id).find(a => ids.has(a)) ?? null]))
  const tree: TaskSuggestion[] = []
  const emit = (parent: string | null) => out.filter(s => parentOf.get(s.task.id) === parent).forEach(s => { tree.push(s); emit(s.task.id) })
  emit(null)
  return tree
}

/** Lines to bring from the previous page. */
export function cardLines(view: DayView): { pageId: string; block: EditorNode }[] {
  return view.handoffBlocks
}

export function hasHandoffContent(view: DayView, workspace: Workspace, today: LocalDate): boolean {
  return taskSuggestions(view, workspace, today).length > 0 || cardLines(view).length > 0
}

type Strip = { text: string; undo?: string; refused?: boolean }
const allKey = 'task:all'
const stripMs = 5000

/** The nearest heading above a line on its page, for the quiet second line of a brought line. */
function headingOf(page: Page | undefined, blockId: string): string {
  if (!page) return ''
  let heading = ''
  for (const n of JSON.parse(page.document) as EditorNode[]) {
    if (n.type === 'heading') heading = inlineText(n.content).trim()
    const inside = (list: EditorNode[]): boolean => list.some(c => c.id === blockId || inside(c.children ?? []))
    if (n.id === blockId || inside(n.children ?? [])) return heading
  }
  return ''
}

/** Morning hand-off. Skipping is normal; nothing here needs clearing. */
export function StartTheDay({ view, workspace, today, onLater, onBusy }: { view: DayView; workspace: Workspace; today: LocalDate; onLater: () => void; onBusy: (busy: boolean) => void }) {
  const { run: runUnsaved } = useWorkspace()
  const navigate = useNavigate()
  const page = view.page!
  const prev = previousDailyPage(workspace, today)
  const prevDay = prev?.date ? weekday(prev.date) : 'yesterday'
  const tasks = taskSuggestions(view, workspace, today)
  const lines = cardLines(view)
  const [linesOpen, setLinesOpen] = useState(false)
  const [strips, setStrips] = useState<Map<string, Strip>>(new Map())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // Rows keep their place while their strip shows: the order is every key seen so far, in first-seen order.
  const order = useRef<string[]>([])
  for (const key of [...tasks.map(t => `task:${t.task.id}`), ...lines.map(l => `line:${l.block.id}`)]) if (!order.current.includes(key)) order.current.push(key)
  // Busy from the tap until its strip has gone, so the card doesn't close under its own Undo when the last row leaves.
  const [working, setWorking] = useState(0)
  useEffect(() => { onBusy(working > 0 || strips.size > 0) }, [working, strips.size, onBusy])
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t) }, [])

  const showStrip = (key: string, strip: Strip, ms = stripMs) => {
    clearTimeout(timers.current.get(key))
    setStrips(s => new Map(s).set(key, strip))
    timers.current.set(key, setTimeout(() => setStrips(s => { const next = new Map(s); next.delete(key); return next }), ms))
  }
  /** Every write on this card saves what he typed on today's page first, and does nothing if that save fails. */
  const write: typeof runUnsaved = async (action, notice, operationId, options) => {
    setWorking(n => n + 1); onBusy(true)
    try { return (await flushEditor(page.id)) ? await runUnsaved(action, notice, operationId, options) : null } finally { setWorking(n => n - 1) }
  }

  const add = async (s: TaskSuggestion) => {
    const receipt = await write({ type: 'plan-tasks', date: today, items: [{ taskId: s.task.id }] }, null)
    if (!receipt) return
    showStrip(`task:${s.task.id}`, { text: 'Added to today', undo: receipt.operationId })
  }
  const addAll = async () => {
    const receipt = await write({ type: 'plan-tasks', date: today, items: tasks.map(s => ({ taskId: s.task.id })) }, null)
    if (!receipt) return
    showStrip(allKey, { text: `Added ${tasks.length} to today`, undo: receipt.operationId })
  }
  const bring = async (line: { pageId: string; block: EditorNode }) => {
    const receipt = await write({ type: 'bring-line', date: today, sourcePageId: line.pageId, sourceBlockId: line.block.id }, null)
    if (receipt) showStrip(`line:${line.block.id}`, { text: 'Brought to today', undo: receipt.operationId })
  }
  const undo = async (key: string, operationId: string) => {
    let refused = false
    const receipt = await write({ type: 'undo', targetOperationId: operationId }, null, undefined, { inlineRefusal: /Cannot undo|Can't undo/, onRefused: () => { refused = true } })
    if (refused) showStrip(key, { text: 'Can’t undo · edited since', refused: true }, 3000)
    else if (receipt) setStrips(s => new Map([...s].filter(([, strip]) => strip.undo !== operationId)))
  }

  // The card shows the page's tree: a row is indented once per ancestor shown above it, a strip included.
  const depthOf = (key: string, shown: string[]) => key.startsWith('task:') ? carryAncestors(prev, key.slice(5)).filter(a => shown.includes(`task:${a}`)).length : 0
  const indent = (depth: number) => (depth ? { style: { '--mc-depth': depth } as CSSProperties } : {})
  const row = (key: string, depth = 0) => {
    const strip = strips.get(key)
    if (strip) return (
      <li key={key} className={`mc-strip ${strip.refused ? 'refused' : ''}`} role="status" {...indent(depth)}>
        <span>{strip.text}</span>
        {strip.undo && !strip.refused && <button type="button" className="app-link" onClick={() => void undo(key, strip.undo!)}>Undo</button>}
      </li>
    )
    if (key.startsWith('task:')) {
      const s = tasks.find(t => `task:${t.task.id}` === key)
      if (!s) return null
      return (
        <li key={key} className="mc-row" {...indent(depth)}>
          <AddButton label={`Add ${s.task.title} to today`} onPress={() => void add(s)} />
          <span className="mc-text">
            <span className="mc-title-line"><span className="mc-title"><TagText text={s.task.title} /></span><DateTag task={s.task} today={today} /></span>
            <span className="mc-reason">{s.reason}</span>
          </span>
          <RowMenu label={`More for ${s.task.title}`} groups={[
            { items: [{ label: 'Not today', onSelect: () => void write({ type: 'not-today', taskId: s.task.id, date: today }, r => ({ text: notTodayText(s.task, today, today), undoOperationId: r.operationId })) }] },
            { title: 'Another day', items: anotherDayItems(s.task, today, (t, d) => void write({ type: 'plan-task', taskId: t.id, date: d, today }, r => ({ text: `Moved to ${shortLabel(d)}`, undoOperationId: r.operationId }))) },
            { items: [{ label: 'Open task', onSelect: () => void navigate({ to: '/tasks', search: { view: 'today' } }) }] },
          ]} />
        </li>
      )
    }
    return null
  }
  const taskKeys = order.current.filter(k => k.startsWith('task:') && (strips.has(k) || tasks.some(t => `task:${t.task.id}` === k)))
  const lineKeys = order.current.filter(k => k.startsWith('line:') && (strips.has(k) || lines.some(l => `line:${l.block.id}` === k)))

  return (
    <section className="app-card start-the-day" aria-labelledby="std-title">
      <header className="card-head">
        <h2 id="std-title">Start the day</h2>
      </header>

      {(taskKeys.length > 0 || strips.has(allKey)) && (
        <div className="mc-group">
          <h3 className="mc-label">Tasks</h3>
          <ul className="plain mc-list">{strips.has(allKey) && row(allKey)}{taskKeys.map(k => row(k, depthOf(k, taskKeys)))}</ul>
          {tasks.length >= 2 && <button type="button" className="app-link mc-add-all" onClick={() => void addAll()}>Add all tasks</button>}
        </div>
      )}

      {lineKeys.length > 0 && (
        <div className="mc-group">
          <button type="button" className="mc-lines-toggle" aria-expanded={linesOpen} onClick={() => setLinesOpen(o => !o)}>
            {lines.length} line{lines.length === 1 ? '' : 's'} from {prevDay} <span aria-hidden="true">{linesOpen ? '▾' : '▸'}</span>
          </button>
          {linesOpen && (
            <ul className="plain mc-list">
              {lineKeys.map(key => {
                const strip = strips.get(key)
                if (strip) return row(key)
                const l = lines.find(x => `line:${x.block.id}` === key)!
                const from = headingOf(prev, l.block.id)
                return (
                  <li key={key} className="mc-row">
                    <AddButton label="Bring to today" onPress={() => void bring(l)} />
                    <span className="mc-text">
                      <span className="mc-title"><LineText workspace={workspace} page={prev} node={l.block} /></span>
                      {from && <span className="mc-reason">{from}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <footer className="card-foot">
        <button type="button" className="primary" onClick={() => void write({ type: 'handoff-done', date: today }, { text: 'Day started' })}>
          Done
        </button>
        <button type="button" className="ghost" onClick={onLater}>
          Later
        </button>
      </footer>
    </section>
  )
}

function AddButton({ label, onPress, dashed = false }: { label: string; onPress: () => void; dashed?: boolean }): ReactNode {
  return <button type="button" className={`mc-add ${dashed ? 'dashed' : ''}`} aria-label={label} onClick={onPress}><span aria-hidden="true">+</span></button>
}
export { textDate }
