import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dayTemplate } from '../domain/editor-document'
import type { DayView, LocalDate, NoteBlock, Page, Task, Workspace } from '../domain/types'
import { weekday } from './dates'
import { DateTag } from './date-tag'
import { flushEditor } from './editor-flush'
import { RowMenu } from './row-menu'
import { TagText } from './tag-text'
import { anotherDayItems, useTaskActions } from './task-row'
import { useWorkspace } from './use-day'

// Morning card (Jazz docs/design/morning-card-build.md, §12 at 5f05fc2): one Tasks group with a reason per row, a
// round + that adds at once with an Undo strip, and yesterday's lines collapsed with Bring to today. Proposals ("From
// your notes") come with A6b.

export function previousDailyPage(workspace: Workspace, date: LocalDate): Page | undefined {
  return workspace.pages
    .filter(p => p.type === 'daily' && p.date !== null && p.date < date)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1))[0]
}

/** "Later" is screen-only (01 §3.5): it collapses the card for the rest of the day. */
export function useHandoffLater(date: LocalDate): [boolean, (v: boolean) => void] {
  const key = `daythread.handoff-later.${date}`
  const [later, setLater] = useState(() => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === '1')
  return [
    later,
    v => {
      sessionStorage.setItem(key, v ? '1' : '0')
      setLater(v)
    },
  ]
}

interface TaskSuggestion { task: Task; reason: string; section: 'top3' | 'other' }

/** §3: suggested tasks first (to Top 3), then unfinished ones (to the plan list); each task once, first reason kept. */
export function taskSuggestions(view: DayView, workspace: Workspace, today: LocalDate): TaskSuggestion[] {
  const page = view.page
  if (!page) return []
  const prev = previousDailyPage(workspace, today)
  const inTop3 = new Set(page.sections.filter(s => s.kind === 'top3').flatMap(s => s.blocks).map(b => b.taskId))
  const eligible = (t: Task | undefined): t is Task => Boolean(t) && t!.status === 'open' && !t!.paused && t!.plannedOn !== today && !inTop3.has(t!.id)
  const out: TaskSuggestion[] = []
  const seen = new Set<string>()
  for (const t of (page.draft?.taskIds ?? []).map(id => workspace.tasks.find(x => x.id === id)))
    if (eligible(t) && !seen.has(t.id)) { seen.add(t.id); out.push({ task: t, reason: 'Suggested last night', section: 'top3' }) }
  for (const t of view.handoffTasks)
    if (eligible(t) && !seen.has(t.id)) { seen.add(t.id); out.push({ task: t, reason: `Unfinished · from ${prev?.date ? weekday(prev.date) : 'yesterday'}`, section: 'other' }) }
  return out
}

export function hasHandoffContent(view: DayView, workspace: Workspace, today: LocalDate): boolean {
  return taskSuggestions(view, workspace, today).length > 0 || view.handoffBlocks.length > 0
}

/** The section's real name on his page ("TODO - Top 3"), or the template's when the page has none. */
function sectionName(page: Page, kind: 'top3' | 'other'): string {
  return page.sections.find(s => s.kind === kind)?.title || dayTemplate.find(t => t.kind === kind)!.title
}

type Strip = { text: string; undo?: string; refused?: boolean }
const allKey = 'task:all'
const stripMs = 5000

/** Morning hand-off (01 §3.5). Skipping is normal; nothing here needs clearing. */
export function StartTheDay({ view, workspace, today, onLater, onBusy }: { view: DayView; workspace: Workspace; today: LocalDate; onLater: () => void; onBusy: (busy: boolean) => void }) {
  const { run, simOutcome } = useWorkspace()
  const { planOn, notToday } = useTaskActions(today)
  const navigate = useNavigate()
  const page = view.page!
  const prev = previousDailyPage(workspace, today)
  const prevDay = prev?.date ? weekday(prev.date) : 'yesterday'
  const tasks = taskSuggestions(view, workspace, today)
  const lines = view.handoffBlocks
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
  /** Saves what he typed on today's page first; a failed save stops the action and his draft stays (Lead 5f3615d0). */
  const guarded = async (action: () => Promise<unknown>) => {
    setWorking(n => n + 1); onBusy(true)
    try { if (await flushEditor(page.id)) await action() } finally { setWorking(n => n - 1) }
  }

  const top3 = sectionName(page, 'top3'), other = sectionName(page, 'other')
  const hasPlanSection = page.sections.some(s => s.kind === 'top3' || s.kind === 'other')
  const top3Full = () => page.sections.filter(s => s.kind === 'top3').flatMap(s => s.blocks).filter(b => b.kind === 'task' && b.taskId).length >= 3
  const addedText = (section: 'top3' | 'other', created: boolean) => {
    if (created) return `Added · ${section === 'top3' ? top3 : other} section created`
    if (section === 'top3' && top3Full()) return `Top 3 is full · added to ${other}`
    return `Added to ${section === 'top3' ? top3 : other}`
  }

  const add = (s: TaskSuggestion) => guarded(async () => {
    const key = `task:${s.task.id}`
    const created = !page.sections.some(x => x.kind === (s.section === 'top3' && !top3Full() ? 'top3' : 'other'))
    const text = addedText(s.section, created)
    const section = s.section === 'top3' && top3Full() ? 'other' : s.section
    const receipt = await run({ type: 'plan-task', taskId: s.task.id, date: today, section }, null)
    if (receipt) showStrip(key, { text, undo: receipt.operationId })
  })
  const addAll = () => guarded(async () => {
    // One strip for the whole Add all, as it is one operation with one Undo (Bumblebee b82493ff, Jazz 446d101 §12.6). Destinations are
    // worked out before the command fills Top 3; the domain applies the same overflow rule.
    let top3Count = page.sections.filter(s => s.kind === 'top3').flatMap(s => s.blocks).filter(b => b.kind === 'task' && b.taskId).length
    let toTop3 = 0, toOther = 0
    for (const s of tasks) if (s.section === 'top3' && top3Count < 3) { top3Count++; toTop3++ } else toOther++
    const text = toTop3 && toOther ? `Added ${toTop3} to ${top3} · ${toOther} to ${other}` : `Added ${toTop3 + toOther} to ${toTop3 ? top3 : other}`
    const receipt = await run({ type: 'plan-tasks', date: today, items: tasks.map(s => ({ taskId: s.task.id, section: s.section })) }, null)
    if (receipt) showStrip(allKey, { text, undo: receipt.operationId })
  })
  const bring = (line: { pageId: string; block: NoteBlock }) => guarded(async () => {
    const receipt = await run({ type: 'bring-line', date: today, sourcePageId: line.pageId, sourceBlockId: line.block.id }, null)
    if (receipt) showStrip(`line:${line.block.id}`, { text: 'Brought to today', undo: receipt.operationId })
  })
  const undo = (key: string, operationId: string) => guarded(async () => {
    let refused = false
    await run({ type: 'undo', targetOperationId: operationId }, null, undefined, { inlineRefusal: /Cannot undo|Can't undo/, onRefused: () => { refused = true } })
    // An Undo after a later change is refused whole (§6); the strip says so, then goes.
    if (refused) showStrip(key, { text: 'Can’t undo · edited since', refused: true }, 3000)
    else {
      // The undone strip goes; any other strip of the same operation would go with it.
      setStrips(s => new Map([...s].filter(([, strip]) => strip.undo !== operationId)))
    }
  })

  const row = (key: string) => {
    const strip = strips.get(key)
    if (strip) return (
      <li key={key} className={`mc-strip ${strip.refused ? 'refused' : ''}`} role="status">
        <span>{strip.text}</span>
        {strip.undo && !strip.refused && <button type="button" className="app-link" onClick={() => void undo(key, strip.undo!)}>Undo</button>}
      </li>
    )
    if (key.startsWith('task:')) {
      const s = tasks.find(t => `task:${t.task.id}` === key)
      if (!s) return null
      return (
        <li key={key} className="mc-row">
          <AddButton label={`Add ${s.task.title} to ${s.section === 'top3' && !top3Full() ? top3 : other}`} onPress={() => void add(s)} />
          <span className="mc-text">
            <span className="mc-title-line"><span className="mc-title"><TagText text={s.task.title} /></span><DateTag task={s.task} today={today} /></span>
            <span className="mc-reason">{s.reason}</span>
          </span>
          <RowMenu label={`More for ${s.task.title}`} groups={[
            { items: [{ label: 'Not today', onSelect: () => void guarded(() => notToday(s.task, today)) }] },
            { title: 'Another day', items: anotherDayItems(s.task, today, (t, d) => void guarded(() => planOn(t, d))) },
            { items: [{ label: 'Open task', onSelect: () => void navigate({ to: '/tasks', search: { view: 'today' } }) }] },
          ]} />
        </li>
      )
    }
    return null
  }
  const taskKeys = order.current.filter(k => k.startsWith('task:') && (strips.has(k) || tasks.some(t => `task:${t.task.id}` === k)))
  const lineKeys = order.current.filter(k => k.startsWith('line:') && (strips.has(k) || lines.some(l => `line:${l.block.id}` === k)))
  const noTasksLine = !page.draft && (
    <p className="line">
      {page.draftError ? 'Suggestions couldn’t be prepared' : 'No suggestions from last night'} ·{' '}
      <button type="button" className="app-link" onClick={() => run({ type: 'generate-draft', date: today, outcome: simOutcome }, null)}>
        {page.draftError ? 'Retry' : 'Draft my day'}
      </button>
    </p>
  )

  return (
    <section className="app-card start-the-day" aria-labelledby="std-title">
      <header className="card-head">
        <h2 id="std-title">Start the day</h2>
        {page.draft?.simulated && <span className="sim">Simulated</span>}
      </header>
      {prev && !prev.reviewSaved && prev.date && (
        <p className="line">
          {weekday(prev.date)}’s review wasn’t finished · <a href={`/review?date=${prev.date}`}>Finish (1 min)</a>
        </p>
      )}
      {!hasPlanSection && tasks.length > 0 && <p className="line quiet">Adding creates a {top3} section at the top</p>}

      {(taskKeys.length > 0 || strips.has(allKey) || noTasksLine) && (
        <div className="mc-group">
          <h3 className="mc-label">Tasks</h3>
          {taskKeys.length > 0 || strips.has(allKey) ? <ul className="plain mc-list">{strips.has(allKey) && row(allKey)}{taskKeys.map(row)}</ul> : noTasksLine}
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
                const from = prev?.sections.find(s => s.blocks.some(b => b.id === l.block.id))?.title
                return (
                  <li key={key} className="mc-row">
                    <AddButton label="Bring to today" onPress={() => void bring(l)} />
                    <span className="mc-text">
                      <span className="mc-title"><TagText text={l.block.text} /></span>
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
        <button type="button" className="primary" onClick={() => run({ type: 'handoff-done', date: today }, { text: 'Day started' })}>
          Done
        </button>
        <button type="button" className="ghost" onClick={onLater}>
          Later
        </button>
      </footer>
    </section>
  )
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }): ReactNode {
  return <button type="button" className="mc-add" aria-label={label} onClick={onPress}><span aria-hidden="true">+</span></button>
}
