// B43 (Lead, task #179): the title and description of a page he pasted a link to, read on our server. It fetches a URL
// he gave it, so it only ever reaches the public internet: http(s) on the default ports, an address checked when the
// connection is made (not before, so a DNS answer can't change in between), every redirect checked again, a short
// timeout and a small byte cap, and only HTML. What comes back is plain text. Any failure is simply "no preview".
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

export interface LinkPreview { title: string | null; description: string | null }

export const previewLimits = { redirects: 3, timeoutMs: 4000, maxBytes: 256 * 1024, title: 200, description: 500 }

/**
 * Loopback for local tests only: set by the test harness, never honoured on Vercel. Even then, only 127.0.0.1 and ::1
 * (on any port); every other private range stays refused.
 */
const testLoopback = () => process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK === '1' && !process.env.VERCEL

const v4 = (ip: string) => ip.split('.').map(Number)
/** True for an address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = v4(ip) as [number, number]
    if (a === 0 || a === 10 || a === 127) return false // this network, private, loopback
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    if (a === 169 && b === 254) return false // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && [0, 2].includes(v4(ip)[2]!)) return false // IETF protocol assignments, TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
    if (a === 198 && b === 51 && v4(ip)[2] === 100) return false // TEST-NET-2
    if (a === 203 && b === 0 && v4(ip)[2] === 113) return false // TEST-NET-3
    if (a >= 224) return false // multicast, reserved, broadcast
    return true
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase()
    // An IPv4 address written as IPv6 (::ffff:a.b.c.d, or its hex form) is judged as that IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1]
    if (mapped) return isPublicAddress(mapped)
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
    if (hexMapped) { const hi = parseInt(hexMapped[1]!, 16), lo = parseInt(hexMapped[2]!, 16); return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`) }
    if (lower === '::' || lower === '::1') return false
    const first = parseInt(lower.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return false // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false // link-local fe80::/10
    if ((first & 0xffc0) === 0xfec0) return false // site-local fec0::/10 (deprecated, still private)
    if ((first & 0xff00) === 0xff00) return false // multicast
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8:') || lower.startsWith('::')) return false // NAT64, documentation, other v4-compatible forms
    return true
  }
  return false
}
const allowed = (ip: string) => isPublicAddress(ip) || (testLoopback() && (ip === '127.0.0.1' || ip === '::1'))

/** DNS lookup that refuses a name with any non-public address, used by the connection itself (no rebinding gap). */
export function checkedLookup(hostname: string, options: { all?: boolean; family?: number }, callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void): void {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
    if (error) return callback(error, '')
    const list = addresses as LookupAddress[]
    if (!list.length || list.some(a => !allowed(a.address))) return callback(new Error('Not a public address'), '')
    if (options.all) return callback(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

/** A URL we may fetch: http(s), default port, no user or password, and a literal IP only if public. */
function fetchable(raw: string): URL | null {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.port && !testLoopback()) return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !allowed(host)) return null
  if (!isIP(host) && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.'))) return null
  return url
}

type Hop = { redirect: string } | { html: string } | null

/**
 * The page's bytes as text, in its own charset: the Content-Type's, else a `<meta charset>` (or http-equiv) near the
 * start, else UTF-8. Decoding is strict (Lead: gbk and gb18030 for the Chinese sites he reads); an unknown charset or
 * bytes that don't decode give no preview, never a garbled title.
 */
export function decodeHtml(bytes: Buffer, contentType: string): string | null {
  const declared = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1]
    ?? /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1]
    ?? 'utf-8'
  try { return new TextDecoder(declared.toLowerCase(), { fatal: true }).decode(bytes) } catch { return null }
}

/**
 * One request. Every way it ends goes through `end`, which settles once and destroys the response and the request, so
 * no body keeps downloading after we've stopped reading it (a redirect, a refused type, the cap; Ratchet 778e5e0d), and
 * no throw from anything a site sends can escape a callback (Ratchet 80f75716, Lead 3c7f684c).
 */
function request(url: URL, signal: AbortSignal): Promise<Hop> {
  return new Promise(resolve => {
    let settled = false, req: http.ClientRequest | undefined, res: http.IncomingMessage | undefined
    const end = (hop: Hop) => {
      if (settled) return
      settled = true
      try { res?.destroy() } catch { /* already closed */ }
      try { req?.destroy() } catch { /* already closed */ }
      resolve(hop)
    }
    const guard = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => { try { fn(...args) } catch { end(null) } }
    try {
      const get = url.protocol === 'https:' ? https.get : http.get
      req = get(url, {
        lookup: checkedLookup as never, signal,
        headers: { 'user-agent': 'Daythread link preview (+title and description only)', accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'identity' },
      }, guard((response: http.IncomingMessage) => {
        res = response
        response.on('error', guard(() => (chunks.length ? finish(true) : end(null))))
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400 && response.headers.location) {
          let to: string
          try { to = new URL(response.headers.location, url).toString() } catch { return end(null) } // a malformed Location
          return end({ redirect: to })
        }
        const type = String(response.headers['content-type'] ?? '')
        if (status < 200 || status >= 300 || !/text\/html|application\/xhtml\+xml/i.test(type)) return end(null)
        const chunks: Buffer[] = []; let size = 0
        const finish = (cut: boolean) => {
          let bytes = Buffer.concat(chunks)
          // A page cut at the cap may end mid-character; keep what's before </head>, or drop the last bytes, rather than
          // fail the strict decode.
          if (cut) { const head = /<\/head>/i.exec(bytes.toString('latin1')); bytes = head ? bytes.subarray(0, head.index) : bytes.subarray(0, Math.max(0, bytes.length - 4)) }
          const html = decodeHtml(bytes, type)
          end(html === null ? null : { html })
        }
        // Only the start of the page is read: the head is where the title and description are.
        response.on('data', guard((chunk: Buffer) => {
          const room = previewLimits.maxBytes - size
          chunks.push(room < chunk.length ? chunk.subarray(0, room) : chunk); size += Math.min(room, chunk.length)
          if (size >= previewLimits.maxBytes) finish(true)
        }))
        response.on('end', guard(() => finish(false)))
      }))
      req.on('error', () => end(null))
      signal.addEventListener('abort', () => end(null), { once: true })
    } catch { end(null) }
  })
}

/** The page's title and description, or nulls; never throws. */
export async function fetchLinkPreview(raw: string): Promise<LinkPreview> {
  const none = { title: null, description: null }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), previewLimits.timeoutMs)
  try {
    let next: string = raw
    for (let hop = 0; hop <= previewLimits.redirects; hop++) {
      const url = fetchable(next)
      if (!url) return none
      const result = await request(url, controller.signal)
      if (!result || controller.signal.aborted) return none
      if ('html' in result) return readPreview(result.html)
      next = result.redirect
    }
    return none
  } catch {
    return none
  } finally {
    clearTimeout(timer)
  }
}

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·' }
function plain(raw: string | undefined, max: number): string | null {
  if (!raw) return null
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') { const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ' }
      return named[code.toLowerCase()] ?? m
    })
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim()
  if (!text) return null
  const chars = [...text]
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text
}
/** `<meta property|name="key" content="…">`, in either attribute order. */
function meta(html: string, key: string): string | undefined {
  // A quoted value may itself hold '>' (a description quoting HTML), so the tag ends at the first '>' outside quotes.
  for (const tag of html.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
    const which = attr('property') ?? attr('name'), value = attr('content')
    if (which && (which[2] ?? which[3] ?? which[4])?.toLowerCase() === key) return value?.[2] ?? value?.[3] ?? value?.[4]
  }
  return undefined
}
/** og:title, else <title>; og:description, unless it's only the site's name (Bumblebee). Only these, as plain text. */
export function readPreview(html: string): LinkPreview {
  const title = plain(meta(html, 'og:title'), previewLimits.title) ?? plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], previewLimits.title)
  const description = plain(meta(html, 'og:description'), previewLimits.description), site = plain(meta(html, 'og:site_name'), previewLimits.title)
  return { title, description: description && site && description.toLocaleLowerCase() === site.toLocaleLowerCase() ? null : description }
}
