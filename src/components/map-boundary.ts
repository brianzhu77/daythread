// The Map view's one outside host, enforced in code (map-contract.md §3, Lead 26f8f7c5): MapLibre asks only
// tiles.openfreemap.org, with no credentials and no referrer, and a style naming any other host isn't drawn. No
// MapLibre import here, so the rules are tested on their own.
export const mapOrigin = 'https://tiles.openfreemap.org'
export const mapStyles = { light: `${mapOrigin}/styles/positron`, dark: `${mapOrigin}/styles/dark` } as const

/** Whether MapLibre may ask this URL: our one host, over HTTPS, and nothing else. */
export function allowedMapUrl(url: string): boolean {
  try { const u = new URL(url); return u.origin === mapOrigin && !u.username && !u.password } catch { return false }
}

/** Anything else becomes a local empty answer, so nothing leaves the browser for it. */
const inert = 'data:application/json,%7B%7D'
export function mapRequest(url: string): { url: string; credentials: 'omit'; referrerPolicy?: ReferrerPolicy } {
  return allowedMapUrl(url) ? { url, credentials: 'omit', referrerPolicy: 'no-referrer' } : { url: inert, credentials: 'omit' }
}

/** A style's own outside addresses: its sources' TileJSON and tile URLs, its sprite and its glyphs. */
export function styleUrls(style: unknown): string[] {
  if (!style || typeof style !== 'object') return []
  const s = style as { sources?: Record<string, { url?: unknown; tiles?: unknown }>; sprite?: unknown; glyphs?: unknown }
  const out: string[] = []
  for (const source of Object.values(s.sources ?? {})) {
    if (typeof source?.url === 'string') out.push(source.url)
    if (Array.isArray(source?.tiles)) out.push(...source.tiles.filter((t): t is string => typeof t === 'string'))
  }
  const sprites = typeof s.sprite === 'string' ? [s.sprite] : Array.isArray(s.sprite) ? s.sprite.map(x => (x as { url?: unknown })?.url).filter((u): u is string => typeof u === 'string') : []
  out.push(...sprites)
  if (typeof s.glyphs === 'string') out.push(s.glyphs)
  return out
}

/** A style we may draw: an object whose every address is on our host (placeholders like `{z}` are fine). */
export function styleAllowed(style: unknown): boolean {
  if (!style || typeof style !== 'object' || !(style as { sources?: unknown }).sources) return false
  return styleUrls(style).every(u => allowedMapUrl(u.replace(/\{[^}]+\}/g, '0')))
}

/** Our own fetch of the style: no credentials, no referrer; null when it fails or names another host. */
export async function fetchMapStyle(scheme: 'light' | 'dark', f: typeof fetch = fetch): Promise<object | null> {
  try {
    const response = await f(mapStyles[scheme], { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' })
    if (!response.ok) return null
    const style = await response.json()
    return styleAllowed(style) ? style : null
  } catch { return null }
}
