import type { LocalDate, Page, Workspace } from './types.ts'
import { dayTemplate, emptyLine, emptyTaskRow, headingNode, inlineText, pageNodes, type EditorNode } from './editor-document.ts'
import { readMention } from './date-chip.ts'
import { isSyncedBlock } from './synced.ts'

// B70 (Brian 27f8c724, Lead 4f1dfc60): templates are pages of their own (`type: "template"`), edited with the normal
// editor and listed under Templates. A template can be the default for one target, kept in its `parentId` so no
// column is added: `"days"` = new day pages, `"top-level"` = new top-level pages, `"day-subpages"` = pages made
// directly inside any day, a page id = pages made directly inside that page. New pages start from their target's default, copied as written with fresh ids;
// to-dos come empty. Day pages with no default get the built-in four headings; other pages start blank.

export const dayPagesTarget = 'days'
export const daySubpagesTarget = 'day-subpages'
export const topLevelTarget = 'top-level'
/** Target names no page id may take. */
export const reservedTargets: ReadonlySet<string> = new Set([dayPagesTarget, daySubpagesTarget, topLevelTarget])
/** `"days"`, `"top-level"`, `"day-subpages"`, or the id of the page whose new subpages start from the template. */
export type TemplateTarget = string

export const isTemplate = (p: Pick<Page, 'type'>): boolean => p.type === 'template'
// A row template (R3-12) is a template page too, so it's in no list, search, count or To-dos, and a save of it makes no task.
// Its `parentId` says which database's `+ New ⌄` it's in, so it isn't a row of that database and no column is added.
const rowTemplatePrefix = 'rows-of:'
export const rowTemplateTarget = (databaseId: string): string => `${rowTemplatePrefix}${databaseId}`
/** The database a row template belongs to; null for any other page. */
export const rowTemplateDatabaseId = (p: Pick<Page, 'type' | 'parentId'>): string | null => isTemplate(p) && p.parentId?.startsWith(rowTemplatePrefix) ? p.parentId.slice(rowTemplatePrefix.length) : null
/** A database's templates, in the order they were made. */
export const rowTemplates = (ws: Workspace, databaseId: string): Page[] => ws.pages.filter(p => isTemplate(p) && p.parentId === rowTemplateTarget(databaseId))
/** What `+ New` starts from: this view's default, else the database's. One deleted since is no default, and comes back with its Undo. */
export function defaultRowTemplate(ws: Workspace, db: Pick<Page, 'id' | 'database'>, view: { defaultTemplate?: string | null }): Page | undefined {
  const list = rowTemplates(ws, db.id)
  return list.find(p => p.id === view.defaultTemplate) ?? list.find(p => p.id === db.database?.defaultTemplate)
}
/** The templates in the Templates list, in the workspace's order. */
export const templates = (ws: Workspace): Page[] => ws.pages.filter(p => isTemplate(p) && !p.trashedAt && !rowTemplateDatabaseId(p))
/** What the template is the default for, if anything. */
export const templateTarget = (p: Page): TemplateTarget | null => p.parentId ?? null
export const defaultTemplate = (ws: Workspace, target: TemplateTarget): Page | undefined => templates(ws).find(p => templateTarget(p) === target)
/**
 * The template a new empty page starts from: at the top level, the top-level default; directly inside `parent`, the parent's own default, else, inside a
 * day page, the default for pages inside days (the nearer target wins, states §3).
 */
export function newPageTemplate(ws: Workspace, parent: Page | undefined): Page | undefined {
  if (!parent) return defaultTemplate(ws, topLevelTarget)
  return defaultTemplate(ws, parent.id) ?? (parent.type === 'daily' ? defaultTemplate(ws, daySubpagesTarget) : undefined)
}

/** The template Edit makes from the built-in headings (states §1). */
export const dayTemplateTitle = 'Day'
export function builtInDayNodes(): EditorNode[] {
  return dayTemplate.flatMap(t => [headingNode(t.title), t.row === 'task' ? emptyTaskRow(null) : emptyLine('bulletListItem')])
}

/**
 * A template save stores rows only: every to-do row gets its own row identity as its task id, so no Task is ever made,
 * renamed or settled from a template, and a real to-do pasted in leaves its task alone (Ratchet c2ec12b5).
 */
export function templateRows(nodes: EditorNode[]): EditorNode[] {
  const visit = (n: EditorNode) => {
    if (n.type === 'task') n.props = { ...n.props, taskId: `editor-task:${n.id}`, role: 'reference', planDate: '' }
    n.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return nodes
}

/** The page is still the template's copy as it was made: same types, words and nesting (ids aside). */
export function isUntouchedCopy(template: Page, nodes: readonly EditorNode[]): boolean {
  // A synced block's lines aren't this page's writing: they're the same on every page, or another's edit would make it look touched.
  const shape = (list: readonly EditorNode[]): unknown[] => list.map(n => (isSyncedBlock(n) ? [n.type] : [n.type, inlineText(n.content).trim(), shape(n.children ?? [])]))
  return JSON.stringify(shape(nodes)) === JSON.stringify(shape(pageFromTemplate(template, null)))
}

// B74: dividers, toggles and code blocks are his structure too (his Day template's two dividers were dropped).
// A database block: with a fresh id, it's a linked view on each new page, with the same filter (design §9.4).
const copiedTypes = new Set(['heading', 'paragraph', 'bulletListItem', 'numberedListItem', 'quote', 'task', 'checkListItem', 'divider', 'toggleListItem', 'codeBlock', 'database', 'button'])

/** A line's inline content with fresh identities: a `[[` link gets its own refId, a `@date` chip its own event. */
function freshInline(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return content.map(item => {
    if (!item || typeof item !== 'object') return item
    const c = item as { type?: string; props?: Record<string, unknown> }
    if (c.type === 'pageRef' && c.props) { const { at: _at, ...props } = c.props; return { ...c, props: { ...props, refId: crypto.randomUUID() } } }
    if (readMention(c) && c.props) return { ...c, props: { ...c.props, eventId: crypto.randomUUID() } }
    return c
  })
}

/**
 * A new page's document from a template: what he wrote, with fresh ids everywhere; to-dos become empty, unticked rows
 * (planned on `date` for a day page) with fresh task ids. Page cards and other blocks aren't copied: a card would point
 * every new page at the same page.
 */
export function pageFromTemplate(template: Page, date: LocalDate | null, todo?: (row: EditorNode) => EditorNode, isOriginal: (n: EditorNode) => boolean = () => false): EditorNode[] {
  const copy = (n: EditorNode): EditorNode[] => {
    // Made on the template: each new page gets its own, connected to nothing. A copy pasted into it stays connected, its lines read
    // from the record, so one note is edited once on every new day (design §7).
    if (isSyncedBlock(n) && !isOriginal(n)) return [{ id: crypto.randomUUID(), type: n.type, props: { syncId: String(n.props?.syncId), roles: '' }, children: [] }]
    if (isSyncedBlock(n)) return [{ id: crypto.randomUUID(), type: n.type, props: { syncId: crypto.randomUUID(), roles: '' }, children: (n.children ?? []).flatMap(copy) }]
    const children = (n.children ?? []).flatMap(copy)
    if (!copiedTypes.has(n.type)) return children
    if (n.type === 'task' || n.type === 'checkListItem') return [{ ...(todo ? todo(n) : emptyTaskRow(date)), children }]
    return [{ id: crypto.randomUUID(), type: n.type, props: { ...n.props }, content: freshInline(structuredClone(n.content)), children }]
  }
  const out = pageNodes(template).flatMap(copy)
  return out.length ? out : [emptyLine('paragraph')]
}
