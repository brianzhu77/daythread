import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dayTemplate } from '../domain/editor-document'
import { carrySection, isBlankTask } from '../domain/workspace'
import type { DayView, LocalDate, NoteBlock, Page, Task, Workspace } from '../domain/types'
import { longLabel, shortLabel, weekday } from './dates'
import { DateTag } from './date-tag'
import { flushEditor } from './editor-flush'
import { RowMenu } from './row-menu'
import { TagText } from './tag-text'
import { LineText } from './line-text'
import { anotherDayItems, notTodayText } from './task-row'
import { liveProposal } from '../domain/draft'
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
  const eligible = (t: Task | undefined): t is Task => Boolean(t) && !isBlankTask(t!) && t!.status === 'open' && !t!.paused && t!.plannedOn !== today && !inTop3.has(t!.id)
  const out: TaskSuggestion[] = []
  const seen = new Set<string>()
  // A Draft my day pick reads "Drafted for today" and goes to the plan list, never Top 3: Top 3 holds what he chose,
  // including "Suggested last night" from his review (Lead c1ba8868, morning-model-states §4).
  // A task the card already offers keeps its own reason and place; a model pick of it adds nothing (Lead, Bumblebee).
  const drafted = isCardDraft(page)
  const draftTasks = (page.draft?.taskIds ?? []).map(id => workspace.tasks.find(x => x.id === id))
  if (!drafted) for (const t of draftTasks)
    if (eligible(t) && !seen.has(t.id)) { seen.add(t.id); out.push({ task: t, reason: 'Suggested last night', section: 'top3' }) }
  for (const t of view.handoffTasks)
    // B34a: Top 3 carries into Top 3, Other into Other, by where its row was yesterday.
    if (eligible(t) && !seen.has(t.id)) { seen.add(t.id); out.push({ task: t, reason: `Unfinished · from ${prev?.date ? weekday(prev.date) : 'yesterday'}`, section: carrySection(prev, t.id) }) }
  if (drafted) for (const t of draftTasks)
    if (eligible(t) && !seen.has(t.id)) { seen.add(t.id); out.push({ task: t, reason: 'Drafted for today', section: 'other' }) }
  return out
}

/** A draft made by Draft my day (a real run, or its simulated stand-in from the card), not by the evening review. */
export function isCardDraft(page: Page): boolean {
  return Boolean(page.draft?.run || page.draft?.proposals)
}

/**
 * Draft my day finished and found nothing new: no task the card wouldn't offer anyway and no proposal. Read from what
 * the run returned, not from the rows left, so adding a drafted task never turns it into "nothing".
 */
export function draftFoundNothing(page: Page, view: DayView): boolean {
  if (!page.draft || !isCardDraft(page) || (page.draft.run && page.draft.run.status !== 'ready')) return false
  return page.draft.taskIds.every(id => view.handoffTasks.some(t => t.id === id)) && !page.draft.proposals?.length
}

/** Proposals still standing: the line unchanged, its page not trashed, not carried forward, not hidden today. */
export function liveProposals(page: Page, workspace: Workspace) {
  const hidden = new Set(page.draft?.hidden ?? [])
  return (page.draft?.proposals ?? []).filter(p => !hidden.has(p.lineId)).flatMap(p => { const live = liveProposal(workspace, p); return live ? [{ proposal: p, ...live }] : [] })
}

/**
 * Lines to bring from the previous page, minus those that are live proposals right now: one line is never offered twice
 * in the card, and the proposal is the stronger offer. Hidden or withdrawn, it comes back here (Jazz c3a84702).
 */
export function cardLines(view: DayView, workspace: Workspace) {
  const proposed = new Set(view.page ? liveProposals(view.page, workspace).map(p => `${p.page.id}/${p.block.id}`) : [])
  return view.handoffBlocks.filter(l => !proposed.has(`${l.pageId}/${l.block.id}`))
}

export function hasHandoffContent(view: DayView, workspace: Workspace, today: LocalDate): boolean {
  const page = view.page
  // Draft my day needs a place to be tapped: while today has no draft and no failure, the card shows (Jazz §2).
  // Not on day one: with no earlier day and no open task from another day, "from last night" is false and Draft my day
  // has nothing to read (empty-start-states §2). Tasks planned today don't count, so typing one doesn't push the page down.
  const hasStartingPoint =
    Boolean(previousDailyPage(workspace, today)) || workspace.tasks.some(t => t.status === 'open' && !isBlankTask(t) && t.plannedOn !== today)
  const needsDraftLink = Boolean(page && !page.draft && !page.draftError && hasStartingPoint)
  const runShowing = Boolean(page?.draft?.run && page.draft.run.status !== 'ready') || Boolean(page?.draftError)
  // A Draft my day result stays on the card even when it found nothing, until Done or Later (Ratchet #80, Jazz 8437503d):
  // the card vanishing after his tap would look like a failure.
  // Only an empty one: a result with rows still closes on its own once he has dealt with them (Jazz).
  const draftResult = Boolean(page && draftFoundNothing(page, view))
  return taskSuggestions(view, workspace, today).length > 0 || cardLines(view, workspace).length > 0 || needsDraftLink || runShowing || draftResult || Boolean(page && liveProposals(page, workspace).length)
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
  const { run: runUnsaved, latest, draftMyDay } = useWorkspace()
  const navigate = useNavigate()
  const page = view.page!
  const prev = previousDailyPage(workspace, today)
  const prevDay = prev?.date ? weekday(prev.date) : 'yesterday'
  const tasks = taskSuggestions(view, workspace, today)
  const lines = cardLines(view, workspace)
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
  /**
   * Every write on this card goes through here, never `run` directly: it saves what he typed on today's page first,
   * and does nothing if that save fails, so his draft stays and the card changes nothing (Lead 5f3615d0, 764b1887).
   * Screen-only state (Later, expanding lines) doesn't need it.
   */
  const write: typeof runUnsaved = async (action, notice, operationId, options) => {
    setWorking(n => n + 1); onBusy(true)
    try { return (await flushEditor(page.id)) ? await runUnsaved(action, notice, operationId, options) : null } finally { setWorking(n => n - 1) }
  }

  const top3 = sectionName(page, 'top3'), other = sectionName(page, 'other')
  const hasPlanSection = page.sections.some(s => s.kind === 'top3' || s.kind === 'other')
  /** Which plan section each task is in on today's page right now. */
  const placedIn = (taskIds: string[]) => {
    const today_ = latest()?.pages.find(p => p.id === page.id)
    return taskIds.map(id => today_?.sections.find(s => (s.kind === 'top3' || s.kind === 'other') && s.blocks.some(b => b.taskId === id))?.kind as 'top3' | 'other' | undefined)
  }
  const planSectionExists = (kind: 'top3' | 'other') => Boolean(latest()?.pages.find(p => p.id === page.id)?.sections.some(s => s.kind === kind))

  // The server decides where each task goes (a full Top 3 sends it to the plan list), and the strip says where it
  // actually went, read after the command; nothing is worked out from the page as it was before typing was saved
  // (Ratchet #75, Lead 51b3c990).
  const add = async (s: TaskSuggestion) => {
    const hadSection = { top3: planSectionExists('top3'), other: planSectionExists('other') }
    const receipt = await write({ type: 'plan-tasks', date: today, items: [{ taskId: s.task.id, section: s.section }] }, null)
    if (!receipt) return
    const placed = placedIn([s.task.id])[0] ?? s.section
    const name = placed === 'top3' ? top3 : other
    const text = !hadSection[placed] ? `Added · ${name} section created`
      : s.section === 'top3' && placed === 'other' ? `Top 3 is full · added to ${other}` : `Added to ${name}`
    showStrip(`task:${s.task.id}`, { text, undo: receipt.operationId })
  }
  const addAll = async () => {
    // One strip for the whole Add all, as it is one operation with one Undo (Bumblebee b82493ff, Jazz 446d101 §12.6).
    const ids = tasks.map(s => s.task.id)
    const receipt = await write({ type: 'plan-tasks', date: today, items: tasks.map(s => ({ taskId: s.task.id, section: s.section })) }, null)
    if (!receipt) return
    const placed = placedIn(ids)
    const toTop3 = placed.filter(k => k === 'top3').length, toOther = placed.length - toTop3
    const text = toTop3 && toOther ? `Added ${toTop3} to ${top3} · ${toOther} to ${other}` : `Added ${toTop3 + toOther} to ${toTop3 ? top3 : other}`
    showStrip(allKey, { text, undo: receipt.operationId })
  }
  const bring = async (line: { pageId: string; block: NoteBlock }) => {
    const receipt = await write({ type: 'bring-line', date: today, sourcePageId: line.pageId, sourceBlockId: line.block.id }, null)
    if (receipt) showStrip(`line:${line.block.id}`, { text: 'Brought to today', undo: receipt.operationId })
  }
  const undo = async (key: string, operationId: string) => {
    let refused = false
    const receipt = await write({ type: 'undo', targetOperationId: operationId }, null, undefined, { inlineRefusal: /Cannot undo|Can't undo/, onRefused: () => { refused = true } })
    // An Undo after a later change is refused whole (§6); the strip says so, then goes.
    if (refused) showStrip(key, { text: 'Can’t undo · edited since', refused: true }, 3000)
    else if (receipt) {
      // The undone strip goes; any other strip of the same operation would go with it.
      setStrips(s => new Map([...s].filter(([, strip]) => strip.undo !== operationId)))
    }
  }

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
          <AddButton label={`Add ${s.task.title} to ${s.section === 'top3' ? top3 : other}`} onPress={() => void add(s)} />
          <span className="mc-text">
            <span className="mc-title-line"><span className="mc-title"><TagText text={s.task.title} /></span><DateTag task={s.task} today={today} /></span>
            <span className="mc-reason">{s.reason}</span>
          </span>
          <RowMenu label={`More for ${s.task.title}`} groups={[
            { items: [{ label: 'Not today', onSelect: () => void write({ type: 'not-today', taskId: s.task.id, date: today }, r => ({ text: notTodayText(s.task, today, today), undoOperationId: r.operationId })) }] },
            { title: 'Another day', items: anotherDayItems(s.task, today, (t, d) => void write({ type: 'plan-task', taskId: t.id, date: d }, r => ({ text: `Moved to ${shortLabel(d)}`, undoOperationId: r.operationId }))) },
            { items: [{ label: 'Open task', onSelect: () => void navigate({ to: '/tasks', search: { view: 'today' } }) }] },
          ]} />
        </li>
      )
    }
    return null
  }
  const proposals = liveProposals(page, workspace)
  for (const key of proposals.map(p => `prop:${p.proposal.lineId}`)) if (!order.current.includes(key)) order.current.push(key)
  const addProposal = async (lineId: string, date: string | null) => {
    const receipt = await write({ type: 'add-proposal', date: today, lineId }, null)
    // "Added for Fri, Oct 23" for a dated proposal (planned for that day), "Added to {Section}" otherwise.
    if (receipt) showStrip(`prop:${lineId}`, { text: date && date > today ? `Added for ${longLabel(date)}` : receipt.message, undo: receipt.operationId })
  }
  const startDraft = async () => { setWorking(n => n + 1); try { if (await flushEditor(page.id)) await draftMyDay(today) } finally { setWorking(n => n - 1) } }
  const taskKeys = order.current.filter(k => k.startsWith('task:') && (strips.has(k) || tasks.some(t => `task:${t.task.id}` === k)))
  const propKeys = order.current.filter(k => k.startsWith('prop:') && (strips.has(k) || proposals.some(p => `prop:${p.proposal.lineId}` === k)))
  const lineKeys = order.current.filter(k => k.startsWith('line:') && (strips.has(k) || lines.some(l => `line:${l.block.id}` === k)))
  // The status line of Draft my day (morning-model-states §3): one line for both drafted tasks and proposals.
  const run = page.draft?.run
  const retryable = !run?.failure || ['key-rejected', 'unavailable', 'busy'].includes(run.failure)
  const statusLine = run?.status === 'drafting'
    ? <p className="line mc-status" role="status"><span className="mc-spinner" aria-hidden="true" />Drafting your day…</p>
    : page.draftError
      ? <p className="line mc-status warn" role="alert">
          {page.draftError}
          {retryable && <> · <button type="button" className="app-link" onClick={() => void startDraft()}>Retry</button></>}
          {run?.costUnknown && <span className="mc-cost-unknown">Cost unknown</span>}
        </p>
      : !page.draft
        ? <p className="line">No suggestions from last night · <button type="button" className="app-link" onClick={() => void startDraft()}>Draft my day</button></p>
        // Nothing new: no task the card wouldn't offer anyway and no proposal (Lead, after the first real run).
        : draftFoundNothing(page, view)
          ? <p className="line mc-status nothing">Nothing to suggest today</p>
          : null
  const omitted = run?.manifest.omittedPages.length ?? 0
  const linkedTotal = omitted + Math.max(0, (run?.manifest.sentPages.length ?? 0) - (prev && run?.manifest.sentPages.includes(prev.id) ? 1 : 0))
  const contextLine = run?.status === 'ready' && omitted > 0 && <p className="line mc-context">Read yesterday's page and {linkedTotal - omitted} of {linkedTotal} linked pages</p>
  const proposalRow = (key: string) => {
    if (strips.has(key)) return row(key)
    const p = proposals.find(x => `prop:${x.proposal.lineId}` === key)
    if (!p) return null
    const where = p.page.type === 'daily' && p.page.date ? weekday(p.page.date) : (p.page.title || 'Untitled')
    return (
      <li key={key} className="mc-row">
        <AddButton dashed label={`Add ${p.block.text} as a task`} onPress={() => void addProposal(p.proposal.lineId, p.proposal.date)} />
        <span className="mc-text">
          <span className="mc-title-line"><span className="mc-title"><TagText text={p.block.text} /></span>{p.proposal.date && <span className="app-tag">{shortLabel(p.proposal.date)}</span>}</span>
          <span className="mc-reason">{where} · {p.section || 'Page'}</span>
        </span>
        <RowMenu label={`More for ${p.block.text}`} groups={[{ items: [{ label: 'Hide for today', onSelect: () => void write({ type: 'hide-proposal', date: today, lineId: p.proposal.lineId }, null) }] }]} />
      </li>
    )
  }

  return (
    <section className="app-card start-the-day" aria-labelledby="std-title">
      <header className="card-head">
        <h2 id="std-title">Start the day</h2>
        {page.draft?.simulated && <span className="sim">Simulated</span>}
      </header>
      {/* No nudge toward an unfinished review: he finds it too rigid (Brian 0a58be58, B37). It returns only with B31. */}
      {!hasPlanSection && tasks.length > 0 && <p className="line quiet">Adding creates a {top3} section at the top</p>}

      {(taskKeys.length > 0 || strips.has(allKey) || statusLine) && (
        <div className="mc-group">
          <h3 className="mc-label">Tasks</h3>
          {statusLine}
          {(taskKeys.length > 0 || strips.has(allKey)) && <ul className="plain mc-list">{strips.has(allKey) && row(allKey)}{taskKeys.map(row)}</ul>}
          {tasks.length >= 2 && <button type="button" className="app-link mc-add-all" onClick={() => void addAll()}>Add all tasks</button>}
          {contextLine}
        </div>
      )}

      {propKeys.length > 0 && (
        <div className="mc-group">
          <h3 className="mc-label">From your notes</h3>
          <ul className="plain mc-list">{propKeys.map(proposalRow)}</ul>
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
                      <span className="mc-title"><LineText workspace={workspace} pageId={l.pageId} block={l.block} /></span>
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
