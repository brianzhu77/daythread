// Place search through our Worker (place-contract.md §2, D15 G8-5): one fixed upstream, Photon's public `/api`, asked
// only for the typed words, under limits shared by every instance, with a short in-memory cache that never becomes
// search history. Everything outside the request (fetch, the clock, the limiter) is passed in, so tests drive it whole.
import { createHash } from 'node:crypto'
import { placeLimits, searchable, searchesAsTyped, searchQuery, type PlaceValue } from '../domain/place.ts'
import type { PlaceLimiter } from './place-limits.ts'

export const photonOrigin = 'https://photon.komoot.io'
/** Names the app, as Photon asks, and nothing about him. */
export const userAgent = 'Daythread place search (a personal notes app; one person typing)'
export const searchLimits = {
  timeoutMs: 5_000,
  maxBytes: 256 * 1024,
  cacheMs: 5 * 60_000,
  cacheEntries: 200,
  /** Searches this instance has out at once; past it, a normal "limit reached". */
  inFlight: 8,
} as const

/** A suggestion: the value to store, and where it is ("Richmond") for the pick's notice, which isn't stored (Jazz d5c18c44). */
export interface PlaceSuggestion { value: PlaceValue; area?: string }
export type SearchResult = { status: 'ok'; places: PlaceSuggestion[] } | { status: 'limit' } | { status: 'unavailable' } | { status: 'refused' }

export interface SearchDeps {
  fetch: typeof fetch
  limiter: PlaceLimiter
  now?: () => number
  /** Who is searching: the signed-in account, or "local" with sign-in off. */
  owner: string
  log?: (event: Record<string, unknown>) => void
}

// One per Worker instance: gone with it, and never written anywhere.
const cache = new Map<string, { at: number; places: PlaceSuggestion[] }>()
let inFlight = 0
export const resetPlaceSearch = () => { cache.clear(); inFlight = 0 }

const cacheKey = (owner: string, q: string, lang: string) => createHash('sha256').update(`${owner}\u0000${q}\u0000${lang}`).digest('hex')

export async function searchPlaces(input: { q: string; explicit: boolean }, deps: SearchDeps): Promise<SearchResult> {
  const now = deps.now ?? Date.now, started = now()
  const log = (status: SearchResult['status'] | 'cached', extra: Record<string, unknown> = {}) =>
    deps.log?.({ event: 'place.search', status, ms: Math.round(now() - started), ...extra })
  const q = searchQuery(input.q)
  // The same rule the editor follows: a short query goes only when he asks (Lead b41107d1, cb4e0d08).
  if (!searchable(q) || (!input.explicit && !searchesAsTyped(q))) { log('refused'); return { status: 'refused' } }
  const key = cacheKey(deps.owner, q, 'default')
  const hit = cache.get(key)
  if (hit && now() - hit.at < searchLimits.cacheMs) {
    cache.delete(key); cache.set(key, hit)
    log('cached', { places: hit.places.length })
    return { status: 'ok', places: hit.places }
  }
  if (inFlight >= searchLimits.inFlight) { log('limit'); return { status: 'limit' } }
  inFlight++
  try {
    // Counted before it goes, so a failed call still counts; a refusal counts nothing.
    if (!(await deps.limiter.take(deps.owner, new Date(now())))) { log('limit'); return { status: 'limit' } }
    const result = await askPhoton(q, deps)
    if (result.status === 'ok') remember(key, { at: now(), places: result.places })
    if (result.status === 'pause') {
      await deps.limiter.pause(new Date(now() + result.ms))
      log('limit', { upstream: 429 })
      return { status: 'limit' }
    }
    log(result.status, result.status === 'ok' ? { places: result.places.length } : { reason: result.reason })
    return result.status === 'ok' ? { status: 'ok', places: result.places } : { status: 'unavailable' }
  } catch {
    log('unavailable', { reason: 'limiter' })
    return { status: 'unavailable' }
  } finally {
    inFlight--
  }
}

function remember(key: string, entry: { at: number; places: PlaceSuggestion[] }) {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > searchLimits.cacheEntries) cache.delete(cache.keys().next().value!)
}

type Asked = { status: 'ok'; places: PlaceSuggestion[] } | { status: 'unavailable'; reason: string } | { status: 'pause'; ms: number }

/** One GET to the fixed upstream with the query and a limit, and nothing of his but the words. */
async function askPhoton(q: string, deps: SearchDeps): Promise<Asked> {
  const url = new URL('/api', photonOrigin)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(placeLimits.suggestions))
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), searchLimits.timeoutMs)
  try {
    const response = await deps.fetch(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      signal: controller.signal,
    })
    if (response.status === 429) {
      const after = Number(response.headers.get('retry-after'))
      return { status: 'pause', ms: Math.min(3_600_000, Math.max(60_000, Number.isFinite(after) ? after * 1000 : 0)) }
    }
    if (!response.ok) return { status: 'unavailable', reason: `http ${response.status}` }
    const body = await readCapped(response, searchLimits.maxBytes)
    if (body === null) return { status: 'unavailable', reason: 'oversized' }
    let json: unknown
    try { json = JSON.parse(body) } catch { return { status: 'unavailable', reason: 'malformed' } }
    const places = photonPlaces(json)
    return places ? { status: 'ok', places } : { status: 'unavailable', reason: 'malformed' }
  } catch (error) {
    return { status: 'unavailable', reason: controller.signal.aborted ? 'timeout' : error instanceof TypeError ? 'network' : 'error' }
  } finally {
    clearTimeout(timer)
  }
}

/** The reply's text, or null past `max` bytes: it's read only that far. */
async function readCapped(response: Response, max: number): Promise<string | null> {
  if (Number(response.headers.get('content-length')) > max) { void response.body?.cancel(); return null }
  if (!response.body) return ''
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { void reader.cancel(); return null }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return new TextDecoder().decode(all)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : undefined)
const osmTypes: Record<string, string> = { N: 'N', W: 'W', R: 'R', node: 'N', way: 'W', relation: 'R' }

/**
 * Photon's GeoJSON as our own small objects, each checked; null when the reply isn't a feature collection. A feature
 * without a point in range, or without anything to call it, is left out. Names and addresses are text only.
 */
export function photonPlaces(json: unknown): PlaceSuggestion[] | null {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { features?: unknown }).features)) return null
  const out: PlaceSuggestion[] = []
  for (const f of (json as { features: unknown[] }).features) {
    if (out.length >= placeLimits.suggestions) break
    if (!f || typeof f !== 'object') continue
    const geometry = (f as { geometry?: { type?: unknown; coordinates?: unknown } }).geometry
    const p = ((f as { properties?: unknown }).properties ?? {}) as Record<string, unknown>
    const [lon, lat] = Array.isArray(geometry?.coordinates) ? geometry!.coordinates as unknown[] : []
    if (geometry?.type !== 'Point' || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const street = [str(p.housenumber), str(p.street)].filter(Boolean).join(' ') || undefined
    const name = str(p.name) ?? street
    if (!name) continue
    const city = str(p.city) ?? str(p.town) ?? str(p.village) ?? str(p.district)
    const address = [street !== name ? street : undefined, city, str(p.state), str(p.country)].filter(Boolean).join(', ').slice(0, placeLimits.address).trim()
    const osmType = typeof p.osm_type === 'string' ? osmTypes[p.osm_type] : undefined
    const osmId = typeof p.osm_id === 'number' && Number.isSafeInteger(p.osm_id) ? p.osm_id : undefined
    const value: PlaceValue = {
      name: name.slice(0, placeLimits.name).trim(),
      ...(address ? { address } : {}),
      lat: Math.round(lat * 1e7) / 1e7,
      lon: Math.round(lon * 1e7) / 1e7,
      ...(osmType && osmId !== undefined ? { ref: `osm:${osmType}${osmId}` } : {}),
    }
    const area = city ?? str(p.state) ?? str(p.country)
    out.push({ value, ...(area ? { area } : {}) })
  }
  return out
}
