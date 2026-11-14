// Forms, Only me (docs/design/forms.md): a layout of a view whose questions map to properties, where an answer adds a row.
// The settings live on the view, which an older build keeps whole and draws as a table (§6).
import type { Database, Json, Property, View } from './database.ts'

export interface FormQuestion {
  propertyId: string
  /** How it's asked. It names a new property once, and never renames one after (G7-2). */
  wording: string
  description?: string
  required?: true
  /** Choices as a list or a dropdown; text as a short or long answer (§3). */
  display?: 'list' | 'dropdown' | 'short' | 'long'
  /** Multi-select and Relation: at most this many. */
  max?: number
  /** Asked only when an earlier choice question has one of these answers (G7-6). */
  showIf?: { propertyId: string; values: string[] }
}
export interface FormSettings {
  questions: FormQuestion[]
  /** "Only me" when absent; the public link waits (§5). */
  closed?: true
  submit?: { button?: string; title?: string; body?: string }
  /** Answers sent through it, for "12 responses". */
  responses?: number
}
export const formLimits = { questions: 100, wording: 500, description: 2_000, submit: 2_000 }

/** What can be asked: not what's worked out or read-only, nor a Button. Files, on Only me (G7-6). */
export function questionable(p: Pick<Property, 'type' | 'readOnly' | 'formula' | 'rollup'>): boolean {
  if (p.readOnly || p.formula !== undefined || p.rollup) return false
  // A Place question waits for a place editor in a form (place-contract.md §7).
  return !['formula', 'rollup', 'id', 'createdTime', 'editedTime', 'button', 'place'].includes(p.type)
}
const titleQuestion = (titleId: string): FormQuestion => ({ propertyId: titleId, wording: 'Name' })
/** A new form asks one question for each property it can, Name first (§3). */
export function defaultForm(db: Database, titleId: string): FormSettings {
  return { questions: [titleQuestion(titleId), ...db.properties.filter(questionable).map(p => ({ propertyId: p.id, wording: p.name }))] }
}
/** The questions still asked: one whose property has gone, or can't be asked any more, drops out rather than breaking the form. */
export function liveQuestions(db: Database, form: FormSettings, titleId: string): FormQuestion[] {
  const kept = form.questions.filter(q => q.propertyId === titleId || db.properties.some(p => p.id === q.propertyId && questionable(p)))
  // A condition on a question that's gone, moved below it or can't lead any more is dropped, so the question is simply asked.
  return kept.map((q, i) => {
    if (!q.showIf) return q
    const on = kept.slice(0, i).find(x => x.propertyId === q.showIf!.propertyId), p = on ? db.properties.find(x => x.id === on.propertyId) : null
    if (canLeadOn(p)) return q
    const { showIf: _dropped, ...rest } = q
    return rest
  })
}
const choiceTypes = new Set<Property['type']>(['select', 'status', 'multiSelect'])
/** The questions whose condition this form drops: one pointing at a question that's gone, or isn't above it any more. For the notice that says so. */
export function droppedConditions(before: readonly FormQuestion[], after: readonly FormQuestion[]): FormQuestion[] {
  return after.filter((q, i) => { if (!q.showIf) return false; const had = before.find(b => b.propertyId === q.propertyId)?.showIf; return Boolean(had) && !after.slice(0, i).some(x => x.propertyId === q.showIf!.propertyId) })
}
/** What a condition can point at: a choice question above this one. */
export const canLeadOn = (p: Pick<Property, 'type'> | null | undefined): boolean => Boolean(p && choiceTypes.has(p.type))
/**
 * The questions asked, given the answers so far: each in turn, one with a condition only when the question it points at is
 * asked and answered with one of its values. A hidden question isn't required, and its answer isn't sent (G7-6).
 */
export function askedQuestions(questions: readonly FormQuestion[], answers: Readonly<Record<string, Json | undefined>>): FormQuestion[] {
  const asked = new Set<string>(), out: FormQuestion[] = []
  for (const q of questions) {
    if (q.showIf) {
      const answer = answers[q.showIf.propertyId], given = Array.isArray(answer) ? answer : answer === undefined || answer === null ? [] : [answer]
      // A condition with no values chosen in it yet doesn't hold the question back. One whose chosen values have all been deleted never lets it show, rather than quietly always (Bumblebee).
      if (q.showIf.values.length && (!asked.has(q.showIf.propertyId) || !given.some(v => typeof v === 'string' && q.showIf!.values.includes(v)))) continue
    }
    asked.add(q.propertyId)
    out.push(q)
  }
  return out
}
export const isEmptyAnswer = (value: Json | undefined): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
export const formOf = (view: Pick<View, 'layout' | 'form'>): FormSettings | null => (view.layout === 'form' && view.form ? view.form : null)
