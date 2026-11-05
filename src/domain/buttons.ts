// A button's steps (docs/design/buttons.md §2). They live in the block's `steps` prop as one string, which is all a build at the floor keeps,
// with ids read at the tap (§4.4). Nothing here writes: `run-button` in workspace.ts does every step in one operation.
import { type Condition, type Json, type Property, todosSourceId } from './database.ts'
import { flatNodes, pageContentKey, type EditorNode } from './editor-document.ts'
import type { LocalDate, Page } from './types.ts'

/** What a step sets: fixed, or read at the tap (§2). */
export type ButtonValue = { kind: 'fixed'; raw: Json } | { kind: 'today' } | { kind: 'day' } | { kind: 'page' }
/** A property a step sets. Its name is kept for when the property's gone: "Status was deleted" (§4.4). */
export interface ButtonSet { id: string; name: string; value: ButtonValue }
export type InsertPlace = 'above' | 'below' | 'top' | 'bottom'
export type ButtonStep = { id: string } & (
  | { kind: 'insert'; place: InsertPlace; blocks: EditorNode[] }
  | { kind: 'add-row'; databaseId: string; databaseName: string; title: string; set: ButtonSet[] }
  | { kind: 'edit-rows'; databaseId: string; databaseName: string; filter: Condition[]; any?: boolean; set: ButtonSet[] }
  | { kind: 'open'; target: { kind: 'page'; pageId: string; name: string } | { kind: 'url'; url: string } | { kind: 'made' } }
  | { kind: 'confirm'; text: string }
)
export type StepKind = ButtonStep['kind']
export const stepKinds: readonly { kind: StepKind; name: string }[] = [
  { kind: 'insert', name: 'Insert blocks' }, { kind: 'add-row', name: 'Add row to' }, { kind: 'edit-rows', name: 'Edit rows in' }, { kind: 'open', name: 'Open page or URL' }, { kind: 'confirm', name: 'Show confirmation' },
]
const version = 1
/** The text a block keeps. The version is inside it, as this string is all the floor can keep (Lead 962245dd). */
export const writeSteps = (steps: readonly ButtonStep[]): string => JSON.stringify({ v: version, steps })
/** What's written. Anything else, as a newer build's, reads as no steps: it's kept untouched and doesn't run. */
export function readSteps(stored: unknown): ButtonStep[] {
  if (typeof stored !== 'string' || !stored) return []
  try {
    const value = JSON.parse(stored) as { v?: unknown; steps?: unknown }
    return value?.v === version && Array.isArray(value.steps) ? value.steps as ButtonStep[] : []
  } catch { return [] }
}
/** Who this tap thinks it's pressing: refused if the button's been edited since (§4.8). */
export const stepsKey = (stored: string): string => pageContentKey({ document: stored })
export const changesStored = (step: ButtonStep): boolean => step.kind === 'insert' || step.kind === 'add-row' || step.kind === 'edit-rows'
/** Anything in the page's words changes under an open editor, so a stale one is refused. */
export const changesWords = (steps: readonly ButtonStep[]): boolean => steps.some(s => s.kind === 'insert')
export const isTodosTarget = (databaseId: string): boolean => databaseId === todosSourceId

/** A row the list shows: "Add row to Runs". */
export function stepTitle(step: ButtonStep): string {
  switch (step.kind) {
    case 'insert': return `Insert ${step.blocks.length === 1 ? '1 block' : `${step.blocks.length} blocks`}`
    case 'add-row': return step.databaseId ? `Add row to ${step.databaseName}` : 'Add row to…'
    case 'edit-rows': return step.databaseId ? `Edit rows in ${step.databaseName}` : 'Edit rows in…'
    case 'open': return step.target.kind === 'page' ? (step.target.pageId ? `Open ${step.target.name}` : 'Open…') : step.target.kind === 'made' ? 'Open the row just made' : step.target.url ? `Open ${step.target.url}` : 'Open…'
    case 'confirm': return step.text ? `Confirm: ${step.text}` : 'Show confirmation'
  }
}
const words = (nodes: readonly EditorNode[]) => flatNodes(nodes as EditorNode[]).some(n => !['paragraph'].includes(n.type) || (Array.isArray(n.content) && n.content.length > 0))
/** What a step still needs, in its own words. Done goes to the first (G3-2). */
export function stepProblem(step: ButtonStep, earlier: readonly ButtonStep[] = []): string | null {
  switch (step.kind) {
    case 'insert': return words(step.blocks) ? null : 'Needs something to insert'
    case 'add-row': return step.databaseId ? null : 'Needs a database'
    case 'edit-rows': return !step.databaseId ? 'Needs a database' : step.set.length ? null : 'Needs a property to set'
    case 'open': return step.target.kind === 'page' ? (step.target.pageId ? null : 'Needs a page') : step.target.kind === 'url' ? (safeUrl(step.target.url) ? null : 'Needs a link') : earlier.some(s => s.kind === 'add-row') ? null : 'Needs an Add row step before it'
    case 'confirm': return step.text.trim() ? null : 'Needs its words'
  }
}
/** A web or mail link: a saved button is never a way to run script. */
export function safeUrl(url: string): string | null {
  const text = url.trim()
  if (!text) return null
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:' ? parsed.href : null
  } catch { return null }
}

/** A step's value, as the property's own stored form, read at the tap: `today` is the tap's date, even on a retry past midnight (§4.9). */
export function valueAtTap(value: ButtonValue, property: Pick<Property, 'type'>, on: Pick<Page, 'id' | 'date' | 'title'>, today: LocalDate): Json {
  if (value.kind === 'fixed') return value.raw
  if (value.kind === 'page') return property.type === 'relation' ? [on.id] : on.title
  const day = value.kind === 'day' ? on.date ?? today : today
  return property.type === 'date' ? { start: day } : day
}
/** The values a property offers beyond a fixed one. */
export function tapValues(property: Pick<Property, 'type'>): readonly ButtonValue['kind'][] {
  if (property.type === 'date') return ['today', 'day']
  if (property.type === 'relation') return ['page']
  if (property.type === 'text') return ['today', 'day', 'page']
  return []
}
export const tapValueName: Record<Exclude<ButtonValue['kind'], 'fixed'>, string> = { today: '@today', day: "@this page's day", page: '@this page' }
