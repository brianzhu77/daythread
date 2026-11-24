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
  'link-tasks': 'ahead', 'set-todo-repeat': 'ahead', 'edit-todos': 'ahead', 'paste-cells': 'ahead', 'change-database': 'ahead', 'delete-comment': 'ahead',
  'resolve-thread': 'ahead', 'set-timezone': 'ahead', 'set-week-start': 'ahead', 'handoff-done': 'ahead',

  'create-document': 'wait', 'create-template': 'wait', 'create-database': 'wait', 'add-row': 'wait', 'add-rows': 'wait',
  'add-task': 'wait', 'add-comment': 'wait', 'edit-comment': 'wait', 'make-link-pages': 'wait', 'restore-page': 'wait',
  'restore-batch': 'wait', 'import-csv': 'wait', 'move-row': 'wait', 'answer-form': 'wait', 'run-button': 'wait',
  'run-row-button': 'wait', 'save-smart-note': 'wait', 'save-review': 'wait', 'bring-line': 'wait',
  'apply-link-preview': 'wait', 'unsync-block': 'wait', 'delete-synced-place': 'wait',

  'task-status': 'own', 'set-values': 'own', 'set-values-many': 'own', 'save-editor': 'own', 'apply-draft': 'own',
  'skip-draft': 'own', 'snooze-draft': 'own', 'move-draft': 'own', 'reopen-draft': 'own', 'ensure-day': 'own', 'set-draft': 'own',
  'run-repeats': 'own', 'set-smart-note-result': 'own', undo: 'own',
} as const satisfies Record<Action['type'], DrawRule>

type AheadType = { [K in Action['type']]: (typeof drawRule)[K] extends 'ahead' ? K : never }[Action['type']]
type WaitType = { [K in Action['type']]: (typeof drawRule)[K] extends 'wait' ? K : never }[Action['type']]
/**
 * What the notice says when a change of his is held after all (Jazz 0a65952a, f92b65df, b0351898), per type: the phrase
 * (`<What> not saved` for an edit, what didn't happen otherwise), the thing that can be deleted under it, and what may
 * already have happened when the answer was lost. Drawn types (Lead f00eb610) and waiting ones (Lead 88aeff42) alike.
 */
type Words = readonly [phrase: string, gone: string, maybe: string]
const ahead: Record<AheadType, Words> = {
  'rename-page': ['Name not saved', 'page', 'name may already be saved'],
  'rename-task': ['Name not saved', 'to-do', 'name may already be saved'],
  'set-page-icon': ['Icon not saved', 'page', 'icon may already be saved'],
  'set-page-cover': ['Cover not saved', 'page', 'cover may already be saved'],
  'move-page': ['Not moved', 'page', 'page may already be moved'],
  'delete-page': ['Page not deleted', 'page', 'page may already be deleted'],
  'delete-pages': ['Pages not deleted', 'page', 'pages may already be deleted'],
  'set-template-target': ['Template not saved', 'template', 'template may already be saved'],
  'delete-template': ['Template not deleted', 'template', 'template may already be deleted'],
  'plan-task': ['Plan not saved', 'to-do', 'plan may already be saved'],
  'plan-tasks': ['Plan not saved', 'to-do', 'plan may already be saved'],
  'not-today': ['Not set aside', 'to-do', 'to-do may already be set aside'],
  'remove-task-row': ['Not removed', 'to-do', 'to-do may already be removed'],
  'set-task-dates': ['Dates not saved', 'to-do', 'dates may already be saved'],
  'link-tasks': ['Blockers not saved', 'to-do', 'blockers may already be saved'],
  'set-todo-repeat': ['Repeat not saved', 'to-do', 'repeat may already be saved'],
  'edit-todos': ['Edit not saved', 'to-do', 'edit may already be saved'],
  'paste-cells': ['Paste not saved', 'row', 'paste may already be saved'],
  'change-database': ['Change not saved', 'database', 'change may already be saved'],
  'delete-comment': ['Comment not deleted', 'comment', 'comment may already be deleted'],
  'resolve-thread': ['Not resolved', 'comment', 'comment may already be resolved'],
  'set-timezone': ['Time zone not saved', 'it', 'time zone may already be saved'],
  'set-week-start': ['Week start not saved', 'it', 'week start may already be saved'],
  'handoff-done': ['Handoff not saved', 'day', 'handoff may already be saved'],
}
const waits: Record<WaitType, Words> = {
  'create-document': ['Page not created', 'page', 'page may already be created'],
  'create-template': ['Template not created', 'database', 'template may already be created'],
  'create-database': ['Database not created', 'page', 'database may already be created'],
  'add-row': ['Row not added', 'database', 'row may already be added'],
  'add-rows': ['Rows not added', 'database', 'rows may already be added'],
  'add-task': ['To-do not added', 'page', 'to-do may already be added'],
  'add-comment': ['Comment not posted', 'page', 'comment may already be posted'],
  'edit-comment': ['Comment not saved', 'comment', 'comment may already be saved'],
  'make-link-pages': ['Links not saved', 'page', 'links may already be saved'],
  'restore-page': ['Page not restored', 'page', 'page may already be restored'],
  'restore-batch': ['Not restored', 'it', 'it may already be restored'],
  'import-csv': ['Import not saved', 'database', 'import may already be saved'],
  'move-row': ['Row not moved', 'row', 'row may already be moved'],
  'answer-form': ['Answer not sent', 'form', 'answer may already be sent'],
  'run-button': ['Button not run', 'page', 'button may already have run'],
  'run-row-button': ['Button not run', 'row', 'button may already have run'],
  'save-smart-note': ['Smart note not saved', 'page', 'smart note may already be saved'],
  'save-review': ['Review not saved', 'day', 'review may already be saved'],
  'bring-line': ['Line not brought over', 'line', 'line may already be brought over'],
  'apply-link-preview': ['Link preview not saved', 'page', 'preview may already be saved'],
  'unsync-block': ['Not unsynced', 'block', 'block may already be unsynced'],
  'delete-synced-place': ['Not deleted', 'block', 'block may already be deleted'],
}
/** Every type that can be said, for the coverage test. */
export const notSavedWords: Readonly<Record<string, Words>> = { ...ahead, ...waits }

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

/**
 * The words for a change of his the server held (Jazz b0351898): its phrase and the reason as the banner has it, never
 * claiming more than is known. A lost answer (maybe-applied) says what may already have happened, never "not saved".
 */
export function takenBackText(entry: Pick<OutboxEntry, 'action' | 'held'>): string {
  const [phrase, gone, maybe] = wordsOf(entry.action)
  switch (entry.held?.reason) {
    case 'changed-since': return `${phrase} · changed since`
    case 'gone': return `${phrase} · ${gone} was deleted elsewhere`
    case 'refused': return `${phrase} · can’t do this now`
    case 'maybe-applied': return `Couldn’t confirm · ${maybe}`
    default: return `${phrase} · changed elsewhere`
  }
}

function wordsOf(a: Action): Words {
  if (a.type === 'change-database') return changeWords((a.change as { kind: string }).kind)
  if (a.type === 'paste-cells' && a.rows.length) return waits['add-rows']
  return notSavedWords[a.type] ?? ['Not saved', 'it', 'it may already be saved']
}

/** A database change by what it touches (Jazz 0a65952a: Property, View, …), and what didn't happen to it. */
function changeWords(kind: string): Words {
  const what = /Property$/.test(kind) ? 'Property' : /Automation/.test(kind) ? 'Automation' : /Widget$/.test(kind) ? 'Widget'
    : kind === 'setDashboardFilter' ? 'Filter' : kind === 'setRepeat' ? 'Repeat' : kind === 'setDefaultTemplate' ? 'Template' : /View$/.test(kind) ? 'View' : null
  if (!what) return ahead['change-database']
  const done = /^(add|duplicate)/.test(kind) ? 'added' : /^remove/.test(kind) ? 'deleted' : /^(move|swap)/.test(kind) ? 'moved' : 'saved'
  return [`${what} not ${done}`, 'database', `${what.toLowerCase()} may already be ${done}`]
}
