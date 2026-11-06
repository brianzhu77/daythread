// A to-do blocked by others (docs/design/todo-dependency.md §2): the mark under its words, and the picker its menu opens.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@heroui/react'
import { blockedNow, blockersOf, makesLoop, type Blocked } from '../domain/task-links'
import { liveTaskIds } from '../domain/workspace'
import { taskIdOfRow, todoLine, todoRowId } from '../domain/todos-source'
import { todosSourceId, type Property } from '../domain/database'
import type { Task, Workspace } from '../domain/types'
import { PropertyEditor } from './property-editors'
import { RowMenu } from './row-menu'
import { useWorkspace } from './use-day'

const worked = new WeakMap<Workspace, Map<string, Blocked>>()
/** Every to-do blocked now, worked out once for each copy of the workspace. */
export function blockedIn(ws: Workspace): Map<string, Blocked> {
  let found = worked.get(ws)
  if (!found) { found = blockedNow(ws, liveTaskIds(ws)); worked.set(ws, found) }
  return found
}
/** Its blockers that are still to-dos, in force or not: what the picker ticks, and the menu counts. */
export const linkedBlockers = (ws: Workspace, taskId: string): Task[] => blockersOf(ws, taskId).flatMap(id => ws.tasks.find(t => t.id === id) ?? [])
export const blockedByLabel = (ws: Workspace, taskId: string): string => { const n = linkedBlockers(ws, taskId).length; return n ? `Blocked by ${n}…` : 'Blocked by…' }

// A tap is only a tap: it mustn't put the caret in the line, or raise the phone's keyboard.
const noCaret = { onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onPointerDown: (e: React.PointerEvent) => e.preventDefault() }

/**
 * "Blocked by {title}" on its own line under the words, or "Blocked by 2" with a menu naming them. Once it goes, its line keeps
 * its height until the next scroll, so nothing below moves under a finger reaching for the next box (Jazz).
 */
export function BlockedMark({ taskId }: { taskId: string }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const blocked = workspace ? blockedIn(workspace).get(taskId) : undefined
  const [held, setHeld] = useState(false)
  const had = useRef(false)
  const now = Boolean(blocked)
  useEffect(() => {
    if (now) { had.current = true; setHeld(false); return }
    if (!had.current) return
    had.current = false
    setHeld(true)
    const off = () => setHeld(false)
    window.addEventListener('scroll', off, { capture: true, once: true })
    return () => window.removeEventListener('scroll', off, { capture: true })
  }, [now])
  if (!blocked) return held ? <span contentEditable={false} className="blocked-mark is-held" aria-hidden="true" /> : null
  const open = (t: Task) => {
    const line = workspace ? todoLine(workspace, t.id) : null
    if (line) void navigate({ to: '/pages', search: { page: line.pageId, block: line.lineId } })
    else toast("That to-do's line is gone", { timeout: 6000 })
  }
  const [first] = blocked.by
  if (blocked.by.length === 1) return <button type="button" contentEditable={false} className="blocked-mark" {...noCaret} onClick={() => open(first!)}><span className="blocked-mark-words">Blocked by {first!.title}</span></button>
  return <span contentEditable={false} className="blocked-mark-menu" {...noCaret}>
    <RowMenu label={`Blocked by ${blocked.by.length}`} trigger={<span className="blocked-mark-words">Blocked by {blocked.by.length}</span>} triggerClass="blocked-mark" groups={[{ items: blocked.by.map(t => ({ label: t.title, onSelect: () => open(t) })) }]} />
  </span>
}

let current: { taskId: string; anchor: HTMLElement | null } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
export function openBlockerPicker(taskId: string, anchor: HTMLElement | null) { current = { taskId, anchor }; notify() }
const close = () => { current = null; notify() }

/** The picker a relation to To-dos uses, with the current blockers ticked, and any that would make a loop greyed with why. */
export function BlockerPickerHost() {
  const open = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => current, () => null)
  const { workspace, run } = useWorkspace()
  const task = open && workspace?.tasks.find(t => t.id === open.taskId)
  if (!open || !workspace || !task) return null
  const live = liveTaskIds(workspace), linked = linkedBlockers(workspace, task.id).map(t => t.id)
  // Not itself; one that's in Trash only while it's linked, so it can be taken off.
  const offered = workspace.tasks.filter(t => t.id !== task.id && t.title.trim() && (live.has(t.id) || linked.includes(t.id)))
  const property: Property = { id: 'blockedBy', name: 'Blocked by', type: 'relation', target: todosSourceId, targetTitle: 'To-dos', options: offered.map(t => ({ id: todoRowId(t.id), name: t.title })) }
  const unavailable = new Map(offered.filter(t => !linked.includes(t.id) && makesLoop(workspace.links ?? [], task.id, t.id)).map(t => [todoRowId(t.id), 'Waits on this one']))
  const commit = (raw: unknown) => {
    close()
    const ids = (Array.isArray(raw) ? raw as string[] : []).flatMap(id => taskIdOfRow(id) ?? [])
    const add = ids.filter(id => !linked.includes(id)), remove = linked.filter(id => !ids.includes(id))
    if (!add.length && !remove.length) return
    const action = { type: 'link-tasks' as const, taskId: task.id, add, remove, at: new Date().toISOString() }
    void run(action, r => ({ text: r.message, undoOperationId: r.operationId }))
  }
  return <PropertyEditor key={task.id} property={property} value={linked.map(todoRowId)} rowTitle={task.title} anchor={open.anchor} unavailable={unavailable} onCommit={commit} onCancel={close} />
}
