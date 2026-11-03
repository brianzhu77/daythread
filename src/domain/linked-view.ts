// A linked view (design §9, model §2.1): any `database` block that isn't its database's home. Rows and properties are the
// source's; the view's settings live in the block, as JSON in its `view` prop, and save with the host page.
import type { Database, View } from './database.ts'

export interface LinkedView extends View {
  /** The block's own label; the source's name until he renames it (§9.2). */
  title?: string
}

/** The block's view. No view yet (a block from before R2) or a broken one reads as the source's first view. */
export function linkedViewOf(db: Database, json: unknown): LinkedView {
  const first = db.views[0]!
  if (typeof json !== 'string' || !json) return first
  try {
    const parsed = JSON.parse(json) as Partial<LinkedView>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return first
    // Whatever else it carries stays: a later build's fields must survive this one's edits.
    return { ...first, ...parsed, columns: Array.isArray(parsed.columns) ? parsed.columns : first.columns, sort: Array.isArray(parsed.sort) ? parsed.sort : [], filter: Array.isArray(parsed.filter) ? parsed.filter : [] }
  } catch { return first }
}

/** A new block's view: a copy, its own from then on (§9.1). */
export function linkedViewJson(view: View, id: string = crypto.randomUUID()): string {
  return JSON.stringify({ ...view, id })
}
