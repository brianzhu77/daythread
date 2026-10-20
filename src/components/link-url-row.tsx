import type { Page } from '../domain/types'
import { GlobeIcon } from './icons'

/**
 * A2 (Jazz link-pages-states §3): a link page's URL exactly as pasted, under the title, on one muted line cut with …,
 * the full URL on hover or long-press. Read-only in A2. "Open ↗" works on a trashed page too: it changes nothing.
 */
export function LinkUrlRow({ page }: { page: Page }) {
  if (!page.url) return null
  return (
    <p className="link-url-row">
      <GlobeIcon />
      <span className="link-url-text" title={page.url}>{page.url}</span>
      <a className="link-url-open" href={page.url} target="_blank" rel="noreferrer">Open ↗</a>
    </p>
  )
}
