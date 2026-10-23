import type { LineTarget } from './page-refs.ts'
import type { Page } from './types.ts'

/**
 * A11 §4: a link to one line, as it travels. In the app it's `application/x-daythread-line`; as text it's this app's
 * own URL, `/pages?page=<pageId>&block=<lineId>[&task=<taskId>]`, which opens the line from anywhere.
 */
export const lineClipboardType = 'application/x-daythread-line'

const idPattern = /^[A-Za-z0-9:_-]{1,200}$/

export function lineLinkPath(target: LineTarget): string {
  const search = new URLSearchParams({ page: target.pageId, block: target.lineId, ...(target.taskId ? { task: target.taskId } : {}) })
  return `/pages?${search}`
}

/** The clipboard's line type: exactly `{ pageId, lineId, taskId? }` with well-formed ids, else null. */
export function parseLineClipboard(raw: string): LineTarget | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    return checked(value.pageId, value.lineId, value.taskId)
  } catch {
    return null
  }
}

/**
 * A pasted text that is exactly one of this app's line URLs: the same origin, the `/pages` path, `page` and `block`,
 * an optional `task`, and nothing else. Other hosts, unknown params and malformed URLs are ordinary text.
 */
export function parseLineUrl(text: string, origin: string): LineTarget | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.origin !== origin || url.pathname !== '/pages' || url.hash) return null
  const keys = [...url.searchParams.keys()]
  if (keys.some((k) => k !== 'page' && k !== 'block' && k !== 'task') || new Set(keys).size !== keys.length) return null
  return checked(url.searchParams.get('page'), url.searchParams.get('block'), url.searchParams.get('task') ?? undefined)
}

function checked(pageId: unknown, lineId: unknown, taskId: unknown): LineTarget | null {
  const ok = (v: unknown): v is string => typeof v === 'string' && idPattern.test(v)
  if (!ok(pageId) || !ok(lineId) || (taskId !== undefined && taskId !== null && !ok(taskId))) return null
  return { pageId, lineId, ...(ok(taskId) ? { taskId } : {}) }
}

/** A page's own address, opened at a line: a day page by its date, any other page by its id (as pageHref). */
export function pagePath(page: Pick<Page, 'id' | 'type' | 'date'>, blockId?: string): string {
  if (page.type === 'daily' && page.date) return `/day/${page.date}${blockId ? `?block=${encodeURIComponent(blockId)}` : ''}`
  return `/pages?page=${encodeURIComponent(page.id)}${blockId ? `&block=${encodeURIComponent(blockId)}` : ''}`
}
