// Place (docs/design/place.md, place-contract.md; D15 G8-1): a name, an address and an optional pin, with the provider's
// id as metadata. Pure: the domain, the Worker's search and the browser share it. No URL from a provider is ever kept;
// links to a maps app are built here from two templates.

export interface PlaceValue {
  name: string
  address?: string
  lat?: number
  lon?: number
  /** The provider's id ("osm:N123456"): metadata only, never needed to read or open the value. */
  ref?: string
}

export const placeLimits = {
  /** Text's own limit, so Text to Place and a kept name never cut his words (Ratchet c504bd98, Bumblebee fba653ee). */
  name: 10_000,
  address: 300,
  ref: 64,
  /** Suggestions shown, and asked of the provider. */
  suggestions: 5,
  query: 256,
} as const

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places
const text = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

/** Whether this is a value as stored: a name, and a pin only as a pair in range. */
export function isPlaceValue(raw: unknown): raw is PlaceValue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(k => !['name', 'address', 'lat', 'lon', 'ref'].includes(k))) return false
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > placeLimits.name) return false
  if (v.address !== undefined && (typeof v.address !== 'string' || v.address.length > placeLimits.address)) return false
  if (v.ref !== undefined && (typeof v.ref !== 'string' || v.ref.length > placeLimits.ref)) return false
  if ((v.lat === undefined) !== (v.lon === undefined)) return false
  if (v.lat !== undefined && !(finite(v.lat) && finite(v.lon) && v.lat >= -90 && v.lat <= 90 && v.lon >= -180 && v.lon <= 180)) return false
  return true
}

/** The value to store from an edit, trimmed and checked; null when it isn't one. Coordinates keep 7 decimals. */
export function cleanPlace(input: unknown): PlaceValue | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const v = input as Record<string, unknown>
  if (Object.keys(v).some(k => !['name', 'address', 'lat', 'lon', 'ref'].includes(k))) return null
  const name = typeof v.name === 'string' ? text(v.name) : ''
  const address = typeof v.address === 'string' ? text(v.address) : ''
  const out: PlaceValue = { name, ...(address ? { address } : {}) }
  if (v.lat !== undefined || v.lon !== undefined) {
    if (!finite(v.lat) || !finite(v.lon)) return null
    out.lat = round(v.lat, 7); out.lon = round(v.lon, 7)
  }
  if (v.ref !== undefined) { if (typeof v.ref !== 'string') return null; if (v.ref) out.ref = v.ref }
  return isPlaceValue(out) ? out : null
}

/** Words read as a place: the name, whole, with no pin. Only words with something in them; they're never cut. */
export const placeFromText = (words: string): PlaceValue | null => (words.trim() ? { name: words.trim() } : null)

export const hasPin = (v: PlaceValue): v is PlaceValue & { lat: number; lon: number } => finite(v.lat) && finite(v.lon)

/** As text, wherever a place is read as words: Text, paste, search and filters. */
export const placeText = (v: PlaceValue): string => (v.address ? `${v.name}, ${v.address}` : v.name)

/** One CSV cell: the parts it has, "name, address (lat, lon)". */
export const placeCsv = (v: PlaceValue): string => `${placeText(v)}${hasPin(v) ? ` (${v.lat}, ${v.lon})` : ''}`

/**
 * Where a tap on a pinned name goes (G8-1): Apple Maps on a phone and in the Home Screen app, OpenStreetMap's own page
 * at 1280, as Photon has none. Only these two templates, with encoded values.
 */
export function placeLink(v: PlaceValue, phone: boolean): string | null {
  if (!hasPin(v)) return null
  const lat = String(v.lat), lon = String(v.lon)
  return phone
    ? `https://maps.apple.com/?ll=${encodeURIComponent(`${lat},${lon}`)}&q=${encodeURIComponent(v.name)}`
    : `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`
}

/** Chinese, Japanese or Korean in it: suggestions start at 2 characters then, 3 otherwise (Lead b41107d1). */
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
export const searchFrom = (q: string): number => (cjk.test(q) ? 2 : 3)
/** The query as searched: normalised and trimmed. */
export const searchQuery = (q: string): string => text(q.normalize('NFC'))
/**
 * Whether these words can be searched at all: past 256 characters they're kept whole but never searched, rather than
 * searching a cut-off part that may name another place (Ratchet 086c93e0). The Search row reads "Too long to search".
 */
export const searchable = (q: string): boolean => { const n = [...searchQuery(q)].length; return n > 0 && n <= placeLimits.query }
/** Whether words this long search as he types; shorter ones wait for the Search row or Enter. */
export const searchesAsTyped = (q: string): boolean => { const s = searchQuery(q); return searchable(s) && [...s].length >= searchFrom(s) }

/** "Location on Nov 14": the name a current location takes when the field is empty (Jazz 2b3eb494), his local date. */
export const locationName = (now: Date = new Date()): string =>
  `Location on ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
