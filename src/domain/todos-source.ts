// To-dos as a source (design §11, model §7): a built-in database whose rows are his tasks. Nothing here is stored: the
// layouts read a workspace with this database added (`withTodos`, only ever handed to them, so Pages, search and the
// export never see it), and an edit becomes the task command the day page uses (`todoChange`).
import { inView, newRowValues, titleId, type Database, type DateValue, type Json, type Property, type View, type ViewContext } from './database.ts'
import type { LineTarget } from './page-refs.ts'
import type { Action, LocalDate, Page, Task, Workspace } from './types.ts'
import { canRenameTask, isBlankTask, plannedOn, taskRows } from './workspace.ts'

export { canRenameTask }

/** The `pageId` of a block that shows To-dos. No real page has it; an older build draws such a block as a card and keeps it. */
export const todosSourceId = 'source:tasks'
export const todosTitle = 'To-dos'
const rowPrefix = 'todo:'
export const todoRowId = (taskId: string) => `${rowPrefix}${taskId}`
export const taskIdOfRow = (rowId: string): string | null => (rowId.startsWith(rowPrefix) ? rowId.slice(rowPrefix.length) : null)
/** `+ New`'s row before it has words: there's no blank to-do to show (B69), so it isn't made until it has them. */
export const newTodoRowId = todoRowId('new')

export const todoStatus = { id: 'status', open: 'open', done: 'done', paused: 'paused', cancelled: 'cancelled' } as const
const planned = 'planned', start = 'start', deadline = 'deadline', page = 'page'
const properties: Property[] = [
  { id: todoStatus.id, name: 'Status', type: 'status', options: [
    { id: todoStatus.open, name: 'Open', group: 'todo' },
    { id: todoStatus.paused, name: 'Paused', group: 'active' },
    { id: todoStatus.done, name: 'Done', group: 'done' },
    { id: todoStatus.cancelled, name: 'Cancelled', group: 'done' },
  ] },
  { id: planned, name: 'Planned', type: 'date', dayOnly: true },
  { id: start, name: 'Start', type: 'date', dayOnly: true },
  { id: deadline, name: 'Deadline', type: 'date', dayOnly: true },
  { id: page, name: 'Page', type: 'text', readOnly: true },
]
/** The first view: what's open, with the chip showing (Bumblebee, R2-8); the rest is a tap on the chip away. */
const firstView: View = {
  id: 'todos-open', name: 'Table', layout: 'table',
  columns: properties.map(p => ({ id: p.id })), sort: [],
  filter: [{ by: todoStatus.id, op: 'isAnyOf', value: [todoStatus.open] }],
}
export const todosDatabase: Database = { homeBlockId: null, properties, views: [firstView], fixed: true }

// Noon, so the day doesn't move with the time zone.
const dayLabel = (d: LocalDate) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const statusOf = (t: Task): string => (t.status === 'done' ? todoStatus.done : t.status === 'cancelled' ? todoStatus.cancelled : t.paused ? todoStatus.paused : todoStatus.open)
const day = (d: LocalDate | null | undefined): DateValue | undefined => (d ? { start: d } : undefined)

/** The page a to-do lives on: the one it was written on while its line is there, else any with a line of it. */
function homeOf(ws: Workspace, t: Task): Page | undefined {
  const rows = taskRows(ws, t.id)
  return rows.find(r => r.page.id === t.sourcePageId)?.page ?? rows[0]?.page
}
function rowOf(ws: Workspace, t: Task): Page {
  const home = homeOf(ws, t)
  const values: Record<string, Json> = { [todoStatus.id]: statusOf(t) }
  const set = (id: string, value: DateValue | undefined) => { if (value) values[id] = value as unknown as Json }
  set(planned, day(plannedOn(ws, t.id)))
  set(start, day(t.attentionOn))
  set(deadline, day(t.deadlineOn))
  const label = home ? (home.date ? dayLabel(home.date) : home.title) : ''
  if (label) values[page] = label
  return { id: todoRowId(t.id), type: 'document', date: null, title: t.title, document: '[]', parentId: todosSourceId, values } as Page
}

const projected = new WeakMap<Workspace, Workspace>()
/** The workspace as the layouts read it: every task with words as one row. Deleted tasks aren't in `tasks`, blank lines aren't rows. */
export function withTodos(ws: Workspace): Workspace {
  const known = projected.get(ws)
  if (known) return known
  const source = { id: todosSourceId, type: 'document', date: null, title: todosTitle, document: '[]', database: todosDatabase } as Page
  const next = { ...ws, pages: [...ws.pages, source, ...ws.tasks.filter(t => !isBlankTask(t)).map(t => rowOf(ws, t))] }
  projected.set(ws, next)
  return next
}
/** A block's database, To-dos included. */
export const databaseSource = (ws: Workspace, pageId: string): Page | undefined => (pageId === todosSourceId ? withTodos(ws) : ws).pages.find(p => p.id === pageId)

/** Where opening a to-do goes: its line, or null when no line of it is left. */
export function todoLine(ws: Workspace, taskId: string): LineTarget | null {
  const t = ws.tasks.find(x => x.id === taskId)
  if (!t) return null
  const rows = taskRows(ws, taskId)
  const row = rows.find(r => r.page.id === t.sourcePageId) ?? rows[0]
  return row ? { pageId: row.page.id, lineId: row.node.id, taskId } : null
}

export type TodoChange = { action: Action; notice: string } | { refused: string } | null
const dateOf = (raw: Json | undefined): LocalDate | null => (raw && typeof raw === 'object' && 'start' in raw && typeof raw.start === 'string' ? raw.start.slice(0, 10) : null)
/** What setting a cell means for the task: the command the day page and Tasks use, and its notice. Null: nothing to send. */
export function todoChange(ws: Workspace, taskId: string, columnId: string, raw: Json | undefined, today: LocalDate): TodoChange {
  const t = ws.tasks.find(x => x.id === taskId)
  if (!t) return null
  if (columnId === titleId) {
    const title = typeof raw === 'string' ? raw.trim() : ''
    // Renaming to nothing keeps the words, or the blank to-do of B69 comes back.
    if (!title || title === t.title) return null
    if (!canRenameTask(ws, taskId)) return { refused: 'Open its line to change it' }
    return { action: { type: 'rename-task', taskId, title }, notice: 'Renamed' }
  }
  if (columnId === start || columnId === deadline) {
    const field = columnId === start ? 'attentionOn' : 'deadlineOn', value = dateOf(raw)
    return value === t[field] ? null : { action: { type: 'set-task-dates', taskId, [field]: value }, notice: `${columnId === start ? 'Start' : 'Deadline'} ${value ? 'set' : 'cleared'}` }
  }
  const was = plannedOn(ws, taskId)
  if (columnId === planned) {
    const value = dateOf(raw)
    if (value === was) return null
    return value
      ? { action: { type: 'plan-task', taskId, date: value, today, ...(was ? { from: was } : {}) }, notice: value === today ? 'On today' : `Planned for ${value}` }
      : { action: { type: 'not-today', taskId, date: was ?? today }, notice: 'Not today' }
  }
  if (columnId !== todoStatus.id) return null
  const to = typeof raw === 'string' ? raw : null, from = statusOf(t)
  if (!to || to === from) return null
  if (to === todoStatus.done) return { action: { type: 'task-status', taskId, status: 'done', today }, notice: 'Done' }
  if (to === todoStatus.cancelled) return { action: { type: 'task-status', taskId, status: 'cancelled' }, notice: 'Cancelled' }
  if (to === todoStatus.paused) return from === todoStatus.open ? { action: { type: 'not-today', taskId, date: was ?? today }, notice: 'Not today' } : { refused: 'Reopen it first' }
  if (from === todoStatus.paused) return { action: { type: 'plan-task', taskId, date: today, today }, notice: 'On today' }
  return { action: { type: 'task-status', taskId, status: 'open' }, notice: from === todoStatus.cancelled ? 'Restored' : 'Reopened' }
}

/** `+ New` (§11, R2-11): today's page, planned for today; in a view pinned to this page's day, that day. Dates the view pins come along. */
export function newTodo(view: View, context: ViewContext, group?: string, placed?: Record<string, Json>): { date: LocalDate; attentionOn?: LocalDate; deadlineOn?: LocalDate; status?: string; visible: boolean } {
  const made = newRowValues(todosDatabase, view, context, group)
  const values = { ...made.values, ...placed }
  const visible = placed ? inView(todosDatabase, { id: '', type: 'document', date: null, title: '', document: '[]', values } as Page, view, context) : made.visible
  const pinned = (id: string) => dateOf(values[id]) ?? undefined
  const on = pinned(planned) ?? context.today
  const startOn = pinned(start), deadlineOn = pinned(deadline)
  // `+ New` at the foot of a Done column, say: that status once it's made.
  const status = typeof values[todoStatus.id] === 'string' && values[todoStatus.id] !== todoStatus.open ? String(values[todoStatus.id]) : undefined
  return { date: on, ...(startOn ? { attentionOn: startOn } : {}), ...(deadlineOn ? { deadlineOn } : {}), ...(status ? { status } : {}), visible }
}
