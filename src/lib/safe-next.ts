/**
 * Where to go after signing in: only a path on this site. The value is resolved the way the browser would resolve it
 * (so `/\evil.example`, `//evil.example` or `https://…` can't leave the site, Ratchet 4f235d84), and the sign-in screen
 * itself falls back to today.
 */
export function safeNext(next: string | undefined, origin: string): string {
  if (!next || !next.startsWith('/')) return '/'
  let url: URL
  try { url = new URL(next, origin) } catch { return '/' }
  if (url.origin !== origin || url.pathname.startsWith('/sign-in')) return '/'
  return url.pathname + url.search + url.hash
}
