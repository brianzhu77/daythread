// A2 · pages-delta N-4: when two pasted URLs are "the same", and the title a new link page starts with (Jazz
// link-pages-states §3). Both work on the raw string as he pasted it; neither is ever fetched.

/** An http(s) URL with a host, checked by the platform parser. The key itself is never taken from `URL.href`. */
export function isHttpUrl(raw: string): boolean {
  const v = raw.trim()
  if (!/^https?:\/\/\S+$/i.test(v)) return false
  try {
    const u = new URL(v)
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname)
  } catch { return false }
}

/**
 * N-4's dedup key, built by hand from the raw text (Ratchet a68af09f): trim; lower-case the scheme and the host (userinfo
 * kept as typed); drop the default port (:80 for http, :443 for https); an empty path becomes `/`. Path, query (order
 * included) and fragment are kept byte for byte, so percent-escapes, tracking parameters and redirects are never
 * normalised. `URL.href` would re-encode the path and isn't used. Null when it isn't an http(s) URL.
 */
export function urlKey(raw: string): string | null {
  const v = raw.trim()
  if (!isHttpUrl(v)) return null
  const m = /^(https?):\/\/([^/?#]*)(.*)$/i.exec(v)
  if (!m) return null
  const scheme = m[1]!.toLowerCase()
  const authority = m[2]!
  const at = authority.lastIndexOf('@')
  const userinfo = at >= 0 ? authority.slice(0, at + 1) : ''
  let host = (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase()
  if ((scheme === 'http' && host.endsWith(':80')) || (scheme === 'https' && host.endsWith(':443'))) host = host.slice(0, host.lastIndexOf(':'))
  const rest = m[3]!
  return `${scheme}://${userinfo}${host}${rest.startsWith('/') ? rest : `/${rest}`}`
}

export const sameUrl = (a: string, b: string): boolean => {
  const k = urlKey(a)
  return k !== null && k === urlKey(b)
}

/**
 * Jazz §3: the URL without `http(s)://` and a leading `www.`, percent-escapes decoded (Chinese paths read as Chinese;
 * a bad escape keeps the raw text), no trailing `/`. Query and fragment are kept, so two videos don't share a name.
 */
export function defaultLinkTitle(raw: string): string {
  let t = raw.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  try { t = decodeURI(t) } catch { /* keep the raw text */ }
  return t.replace(/\/+$/, '')
}
