import type { Action } from '../domain/types'
import type { OutboxEntry } from './outbox'

/**
 * Tap feedback release 2 (#374): which of his changes are drawn as soon as the device has stored them, before the
 * server answers. A Record, so a new action type doesn't compile until it's placed here.
 * - `ahead`: an edit, move or delete of something that already exists. Drawn at once; if the server holds it, it goes
 *   back on screen with a notice naming it (Lead f00eb610, Ratchet b527e8d8).
 * - `wait`: makes something he can type into (Lead 5b22d29e: not shown before the server has it), its result depends on
 *   the answer (Ratchet's contract §3), or it rewrites a page document the open editor also holds.
 * - `own`: has its own lifecycle already: the tick's hold, a cell's pending value, the editor's drafts, the draft's
 *   release 1 marks, the app's own writes, and Undo.
 */
export type DrawRule = 'ahead' | 'wait' | 'own'

export const drawRule = {
  'rename-page': 'ahead', 'rename-task': 'ahead', 'set-page-icon': 'ahead', 'set-page-cover': 'ahead', 'move-page': 'ahead',
  'delete-page': 'ahead', 'delete-pages': 'ahead', 'set-template-target': 'ahead', 'delete-template': 'ahead',
  'plan-task': 'ahead', 'plan-tasks': 'ahead', 'not-today': 'ahead', 'remove-task-row': 'ahead', 'set-task-dates': 'ahead',
  'link-tasks': 'ahead', 'edit-todos': 'ahead', 'paste-cells': 'ahead', 'change-database': 'ahead', 'delete-comment': 'ahead',
  'resolve-thread': 'ahead', 'set-timezone': 'ahead', 'set-week-start': 'ahead', 'handoff-done': 'ahead',

  'create-document': 'wait', 'create-template': 'wait', 'create-database': 'wait', 'add-row': 'wait', 'add-rows': 'wait',
  'add-task': 'wait', 'add-comment': 'wait', 'edit-comment': 'wait', 'make-link-pages': 'wait', 'restore-page': 'wait',
  'restore-batch': 'wait', 'import-csv': 'wait', 'move-row': 'wait', 'answer-form': 'wait', 'run-button': 'wait',
  'run-row-button': 'wait', 'save-smart-note': 'wait', 'save-review': 'wait', 'bring-line': 'wait',
  'apply-link-preview': 'wait', 'unsync-block': 'wait', 'delete-synced-place': 'wait',

  'task-status': 'own', 'set-values': 'own', 'set-values-many': 'own', 'save-editor': 'own', 'apply-draft': 'own',
  'skip-draft': 'own', 'snooze-draft': 'own', 'reopen-draft': 'own', 'ensure-day': 'own', 'set-draft': 'own',
  'run-repeats': 'own', 'set-smart-note-result': 'own', undo: 'own',
} as const satisfies Record<Action['type'], DrawRule>

type AheadType = { [K in Action['type']]: (typeof drawRule)[K] extends 'ahead' ? K : never }[Action['type']]

/**
 * What the notice calls a change drawn ahead and then taken back: `<What> not saved · changed elsewhere` (Jazz 0a65952a).
 * Every drawn-ahead type has one (Jazz 5869fde3); the plain `Not saved` is only for a type added later.
 */
export const aheadNoun: Record<AheadType, string> = {
  'rename-page': 'Name', 'rename-task': 'Name', 'set-page-icon': 'Icon', 'set-page-cover': 'Cover', 'move-page': 'Move',
  'delete-page': 'Delete', 'delete-pages': 'Delete', 'set-template-target': 'Template', 'delete-template': 'Delete',
  'plan-task': 'Plan', 'plan-tasks': 'Plan', 'not-today': 'Not today', 'remove-task-row': 'Remove', 'set-task-dates': 'Dates',
  'link-tasks': 'Blockers', 'edit-todos': 'Edit', 'paste-cells': 'Paste', 'change-database': 'Change',
  'delete-comment': 'Delete', 'resolve-thread': 'Resolve', 'set-timezone': 'Time zone', 'set-week-start': 'Week start',
  'handoff-done': 'Handoff',
}

/**
 * A database change drawn ahead: only one that edits, moves or removes what's there (Ratchet 6458ed11). Anything that
 * adds a column, view or automation, or a kind added later, waits: a new column could take typed values before the
 * answer, and those must never be findable only in the queue.
 */
const aheadChangeKinds: ReadonlySet<string> = new Set([
  'updateProperty', 'removeProperty', 'moveProperty', 'updateView', 'removeView', 'moveView', 'setRepeat', 'setDefaultTemplate',
  'updateAutomation', 'setAutomationActive', 'removeAutomation', 'moveAutomation',
  'setDashboardFilter', 'updateWidget', 'moveWidget', 'swapWidget', 'removeWidget',
])

/** Whether this change is drawn as soon as it's stored. By payload where a type can also make things (Ratchet 6458ed11). */
export function drawsAhead(action: Action): boolean {
  if (drawRule[action.type] !== 'ahead') return false
  // A paste past the last row makes rows: it waits, as add-rows does.
  if (action.type === 'paste-cells') return action.rows.length === 0
  if (action.type === 'change-database') return aheadChangeKinds.has((action.change as { kind: string }).kind)
  return true
}

/** The notice for a drawn-ahead change the server held: named, never silent (Lead 5d9ce740, f00eb610). */
export function takenBackText(entry: Pick<OutboxEntry, 'action' | 'held'>): string {
  const a = entry.action
  const noun = a.type === 'change-database' ? changeNoun((a.change as { kind: string }).kind) : (aheadNoun as Record<string, string | undefined>)[a.type]
  return `${noun ? `${noun} not saved` : 'Not saved'} · changed elsewhere`
}

/** A database change by what it touches (Jazz 0a65952a: Property, View, …). */
function changeNoun(kind: string): string {
  if (/Property$/.test(kind)) return 'Property'
  if (/Automation/.test(kind)) return 'Automation'
  if (/Widget$/.test(kind)) return 'Widget'
  if (kind === 'setDashboardFilter') return 'Filter'
  if (kind === 'setRepeat') return 'Repeat'
  if (kind === 'setDefaultTemplate') return 'Template'
  if (/View$/.test(kind)) return 'View'
  return aheadNoun['change-database']
}
