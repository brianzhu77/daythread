// Rules on a database (docs/design/automations.md): when something happens to a row, do these steps, inside the command that made the change. Nothing here writes:
// `applyCommand` stages each rule on its own copy, so a rule's failure can't touch his edit. A database with no rules costs one look at its field.
import { readSteps, writeSteps, type ButtonStep } from './buttons.ts'
import { conditionHolds, cellValue, databaseRows, inView, isDatabase, opsFor, propertyOf, titleId, type Condition, type Database, type ViewContext } from './database.ts'
import type { Action, Page, Workspace } from './types.ts'

export type AutomationTrigger = { kind: 'row-added' } | { kind: 'property-edited'; propertyId: string; name: string; condition?: Condition }
export interface Automation {
  id: string
  name: string
  active: boolean
  triggers: AutomationTrigger[]
  /** With more than one trigger: any of them, rather than all. */
  any?: true
  /** Only rows this view's filter shows. */
  viewId?: string
  /** As a button's, in the same string (buttons.md). */
  steps: string
  lastRanAt?: string
  /** Why it stopped: a failed run, or the command's limit, which can simply be turned on again. */
  paused?: { reason: string; limit?: true }
}
export const automationSteps: readonly ButtonStep['kind'][] = ['edit-property', 'add-row', 'edit-rows']

/** What's not "a row was made" or "a value was edited": they'd fire hundreds of times, or undo what's being undone (§3, §5.7). A rule's own writes never get here, as matches are frozen first. */
const quietActions: ReadonlySet<string> = new Set(['undo', 'restore-page', 'restore-batch', 'import-csv', 'add-rows', 'run-repeats', 'change-database', 'move-row', 'move-page', 'delete-page', 'delete-pages', 'ensure-day'])
export const firesRules = (action: Pick<Action, 'type'>): boolean => !quietActions.has(action.type)

/** What's wrong with a rule now, in its own words, without its having to run: a delete or a type change shows at once (§5.4). */
export function automationProblem(ws: Pick<Workspace, 'pages'>, db: Database, rule: Automation): string | null {
  if (rule.viewId && !db.views.some(v => v.id === rule.viewId)) return 'Its view was deleted'
  for (const t of rule.triggers) {
    if (t.kind !== 'property-edited' || t.propertyId === titleId) continue
    const property = propertyOf(db, t.propertyId)
    if (!property) return `${t.name} was deleted`
    // A condition this type can't hold would just never be met, with the rule looking healthy (Ratchet).
    if (t.condition && !opsFor(property.type).includes(t.condition.op)) return `${t.name} changed type`
  }
  for (const step of readSteps(rule.steps)) { const problem = stepBroken(ws, db, step); if (problem) return problem }
  return null
}
const stepDatabase = (ws: Pick<Workspace, 'pages'>, db: Database, step: Extract<ButtonStep, { kind: 'edit-property' | 'add-row' | 'edit-rows' }>): { database: Database; title?: string } | null => {
  if (step.kind === 'edit-property') return { database: db }
  const p = ws.pages.find(x => x.id === step.databaseId)
  return p && isDatabase(p) && !p.trashedAt ? { database: p.database, title: p.title } : null
}
/** What's gone from under one step, so its row can say so. */
export function stepBroken(ws: Pick<Workspace, 'pages'>, db: Database, step: ButtonStep): string | null {
  if (step.kind !== 'edit-property' && step.kind !== 'add-row' && step.kind !== 'edit-rows') return null
  const target = stepDatabase(ws, db, step)
  if (!target) return `${step.kind === 'edit-property' ? 'That database' : step.databaseName || 'That database'} was deleted`
  for (const set of step.set) {
    const property = target.database.properties.find(p => p.id === set.id)
    if (!property) return `${set.name} was deleted`
    if (set.type && property.type !== set.type) return `${set.name} changed type`
  }
  return null
}
/** A rule as it reads now: targets are held by id, so a rename keeps it working, and only its words need bringing up to date (§5.4). */
export function withLiveNames(ws: Pick<Workspace, 'pages'>, db: Database, rule: Automation): Automation {
  const steps = readSteps(rule.steps).map(step => {
    if (step.kind !== 'edit-property' && step.kind !== 'add-row' && step.kind !== 'edit-rows') return step
    const target = stepDatabase(ws, db, step)
    if (!target) return step
    const set = step.set.map(s => ({ ...s, name: target.database.properties.find(p => p.id === s.id)?.name ?? s.name }))
    return step.kind === 'edit-property' ? { ...step, set } : { ...step, set, databaseName: target.title?.trim() || step.databaseName }
  })
  return { ...rule, steps: writeSteps(steps), triggers: rule.triggers.map(t => (t.kind === 'property-edited' ? { ...t, name: propertyOf(db, t.propertyId)?.name ?? t.name } : t)) }
}

const rawOf = (row: Page, id: string): unknown => (id === titleId ? row.title : row.values?.[id])
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** Does this change to this row set the rule off? From his action's before and after alone, ahead of any rule's writes (§5.6). */
function fires(db: Database, rule: Automation, was: Page | undefined, now: Page, context: ViewContext): boolean {
  const results = rule.triggers.map(t => {
    if (t.kind === 'row-added') return { changed: !was, holds: !was }
    const changed = Boolean(was) && !same(rawOf(was!, t.propertyId), rawOf(now, t.propertyId))
    if (!t.condition) return { changed, holds: changed }
    const property = t.propertyId === titleId ? { id: titleId, name: 'Name', type: 'text' as const } : propertyOf(db, t.propertyId)
    return { changed, holds: Boolean(property && conditionHolds(property, t.condition, cellValue(db, now, t.propertyId), context)) }
  })
  if (!results.length) return false
  // All: every condition true after this edit, and at least one of them just changed, so an unrelated edit doesn't repeat it (§5.6).
  const set = rule.any || results.length === 1 ? results.some(r => r.changed && r.holds) : results.every(r => r.holds) && results.some(r => r.changed)
  if (!set) return false
  const view = rule.viewId ? db.views.find(v => v.id === rule.viewId) : undefined
  return !view || inView(db, now, view, context)
}

export interface FiredRule { databaseId: string; ruleId: string; rowIds: string[] }
/** The rules this command sets off, in each database's list order, frozen before any of them runs. */
export function firedRules(before: Workspace, after: Workspace, action: Pick<Action, 'type'>, context: ViewContext): FiredRule[] {
  if (!firesRules(action)) return []
  const out: FiredRule[] = []
  for (const page of after.pages) {
    const rules = page.database?.automations
    if (!rules?.length || page.trashedAt) continue
    const live = rules.filter(r => r.active && !r.paused)
    if (!live.length) continue
    const rowsNow = databaseRows(after, page.id), rowsWas = new Map(databaseRows(before, page.id).map(r => [r.id, r]))
    // What didn't change needs no more than this.
    const moved = rowsNow.filter(r => { const was = rowsWas.get(r.id); return !was || !same(was.values, r.values) || was.title !== r.title })
    if (!moved.length) continue
    for (const rule of live) {
      const rowIds = moved.filter(r => fires(page.database!, rule, rowsWas.get(r.id), r, context)).map(r => r.id)
      if (rowIds.length) out.push({ databaseId: page.id, ruleId: rule.id, rowIds })
    }
  }
  return out
}
