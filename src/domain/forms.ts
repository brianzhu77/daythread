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

/** What can be asked: not what's worked out or read-only, not a Button, and Files waits for its own step (§3, G7-6). */
export function questionable(p: Pick<Property, 'type' | 'readOnly' | 'formula' | 'rollup'>): boolean {
  if (p.readOnly || p.formula !== undefined || p.rollup) return false
  return !['formula', 'rollup', 'id', 'createdTime', 'editedTime', 'button', 'files'].includes(p.type)
}
const titleQuestion = (titleId: string): FormQuestion => ({ propertyId: titleId, wording: 'Name' })
/** A new form asks one question for each property it can, Name first (§3). */
export function defaultForm(db: Database, titleId: string): FormSettings {
  return { questions: [titleQuestion(titleId), ...db.properties.filter(questionable).map(p => ({ propertyId: p.id, wording: p.name }))] }
}
/** The questions still asked: one whose property has gone, or can't be asked any more, drops out rather than breaking the form. */
export function liveQuestions(db: Database, form: FormSettings, titleId: string): FormQuestion[] {
  return form.questions.filter(q => q.propertyId === titleId || db.properties.some(p => p.id === q.propertyId && questionable(p)))
}
export const isEmptyAnswer = (value: Json | undefined): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
export const formOf = (view: Pick<View, 'layout' | 'form'>): FormSettings | null => (view.layout === 'form' && view.form ? view.form : null)
