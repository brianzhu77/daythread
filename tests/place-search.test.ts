// Place search through the Worker (place-contract.md §2, D15 G8-3, G8-5): what goes out, every way it can fail with his
// words kept, the cache, and the limits shared by every instance, on PGlite and in memory.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { pgliteClient } from '../src/server/db/sql.ts'
import { MemoryPlaceLimiter, PostgresPlaceLimiter, placeQuota, type PlaceLimiter } from '../src/server/place-limits.ts'
import { photonPlaces, resetPlaceSearch, searchPlaces, upstreamOrigin, userAgent, type SearchDeps } from '../src/server/place-search.ts'

const feature = (name: string | undefined, lon: number, lat: number, extra: Record<string, unknown> = {}) =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { ...(name ? { name } : {}), ...extra } })
const reply = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features })
const park = feature('Stanley Park', -123.1443, 49.3017, { osm_type: 'R', osm_id: 2048, city: 'Vancouver', state: 'British Columbia', country: 'Canada' })

/** A fetch that records every call and answers from `answer`. */
function upstream(answer: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = []
  const fetch = (async (input: URL | string, init: RequestInit = {}) => { const url = new URL(String(input)); calls.push({ url, init }); return answer(url, init) }) as typeof globalThis.fetch
  return { fetch, calls }
}
const deps = (fetch: typeof globalThis.fetch, limiter: PlaceLimiter = new MemoryPlaceLimiter(), extra: Partial<SearchDeps> = {}): SearchDeps => ({ fetch, limiter, owner: 'acct-1', ...extra })

test('Photon replies become small checked objects: point in range, a name, text only, at most five', () => {
  const places = photonPlaces({ features: [
    park,
    feature(undefined, -123.12, 49.28, { housenumber: '1055', street: 'Canada Pl', city: 'Vancouver', country: 'Canada' }),
    feature('Nowhere', 0, 95),
    feature('Bad', Number.NaN, 0),
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0]] }, properties: { name: 'Line' } },
    feature('<img src=x onerror=alert(1)>', 1, 1, { osm_type: 'node', osm_id: 7 }),
    feature('Six', 2, 2), feature('Seven', 3, 3), feature('Eight', 4, 4),
  ] })!
  assert.equal(places.length, 5)
  assert.deepEqual(places[0], { value: { name: 'Stanley Park', address: 'Vancouver, British Columbia, Canada', lat: 49.3017, lon: -123.1443, ref: 'osm:R2048' }, area: 'Vancouver' })
  assert.deepEqual(places[1]!.value, { name: '1055 Canada Pl', address: 'Vancouver, Canada', lat: 49.28, lon: -123.12 }, 'an address with no name is named by its street')
  assert.equal(places[2]!.value.name, '<img src=x onerror=alert(1)>', 'kept as text; drawn as text')
  assert.equal(places[2]!.value.ref, 'osm:N7')
  assert.equal(photonPlaces({ nope: 1 }), null)
  assert.equal(photonPlaces('[]'), null)
})

test('one GET to the fixed upstream with the words and a limit, and nothing of his else', async () => {
  resetPlaceSearch()
  const up = upstream(() => new Response(reply([park]), { headers: { 'content-type': 'application/json' } }))
  const result = await searchPlaces({ q: '  Stanley   Park ', explicit: false }, deps(up.fetch))
  assert.equal(result.status, 'ok')
  assert.equal(up.calls.length, 1)
  const { url, init } = up.calls[0]!
  assert.equal(url.origin + url.pathname, 'https://photon.komoot.io/api')
  assert.deepEqual([...url.searchParams.entries()], [['q', 'Stanley Park'], ['limit', '5']], 'no lang, no area, nothing else')
  assert.deepEqual(init.headers, { 'user-agent': userAgent, accept: 'application/json' }, 'no cookie, authorization, IP or ids')
  assert.equal(init.redirect, 'error')
  assert.equal(init.credentials, 'omit')
  assert.equal(init.referrerPolicy, 'no-referrer')
  assert.ok(init.signal instanceof AbortSignal)
})

test('the upstream is Photon on any hosting platform; a stand-in only on this machine, only on 127.0.0.1', () => {
  assert.equal(upstreamOrigin({}, false), 'https://photon.komoot.io')
  assert.equal(upstreamOrigin({ DAYTHREAD_PLACE_UPSTREAM: 'http://127.0.0.1:3799' }, false), 'http://127.0.0.1:3799')
  assert.equal(upstreamOrigin({ DAYTHREAD_PLACE_UPSTREAM: 'http://127.0.0.1:3799' }, true), 'https://photon.komoot.io', 'never when hosted')
  for (const bad of ['https://evil.example', 'http://localhost:3799', 'http://127.0.0.1:3799/api', 'http://10.0.0.1:80'])
    assert.equal(upstreamOrigin({ DAYTHREAD_PLACE_UPSTREAM: bad }, false), 'https://photon.komoot.io', bad)
})

test('the 2/3-character rule is the server\'s too; past 256 characters nothing is searched', async () => {
  resetPlaceSearch()
  const up = upstream(() => new Response(reply([])))
  for (const q of ['ab', '京']) assert.equal((await searchPlaces({ q, explicit: false }, deps(up.fetch))).status, 'refused', q)
  assert.equal(up.calls.length, 0, 'nothing sent until he asks')
  for (const q of ['ab', '京', '西湖', 'abc']) assert.equal((await searchPlaces({ q, explicit: q.length < 3 && q !== '西湖' }, deps(up.fetch))).status, 'ok', q)
  assert.equal(up.calls.length, 4)
  assert.equal((await searchPlaces({ q: 'a'.repeat(257), explicit: true }, deps(up.fetch))).status, 'refused')
  assert.equal(up.calls.length, 4, 'never a cut-off part')
})

test('every failure is "unavailable", nothing is cached, and a later search tries again', async () => {
  const cases: [string, () => Response | Promise<Response>][] = [
    ['500', () => new Response('oops', { status: 500 })],
    ['malformed', () => new Response('{"features": [')],
    ['not a collection', () => new Response('{"hello": 1}')],
    ['oversized by header', () => new Response('{}', { headers: { 'content-length': String(300 * 1024) } })],
    ['oversized by body', () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 300; i++) c.enqueue(new Uint8Array(1024).fill(32)); c.close() } }))],
    ['redirect', () => { throw new TypeError('fetch failed: redirect mode is error') }],
    ['offline', () => { throw new TypeError('fetch failed') }],
  ]
  for (const [name, answer] of cases) {
    resetPlaceSearch()
    const up = upstream(answer)
    assert.deepEqual(await searchPlaces({ q: 'Stanley Park', explicit: false }, deps(up.fetch)), { status: 'unavailable' }, name)
    await searchPlaces({ q: 'Stanley Park', explicit: false }, deps(up.fetch))
    assert.equal(up.calls.length, 2, `${name}: not cached`)
  }
})

test('a timeout aborts the request and is "unavailable"', async () => {
  resetPlaceSearch()
  let aborted = false
  const up = upstream((_url, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')) })))
  assert.deepEqual(await searchPlaces({ q: 'Stanley Park', explicit: false }, deps(up.fetch, undefined, { timeoutMs: 30 })), { status: 'unavailable' })
  assert.ok(aborted)
})

test('five minutes of cache per account and query: a hit sends nothing and counts nothing; no match is a result too', async () => {
  resetPlaceSearch()
  let now = 1_000_000
  const up = upstream(url => new Response(reply(url.searchParams.get('q') === 'zzzq' ? [] : [park])))
  const limiter = new MemoryPlaceLimiter(), d = (owner = 'acct-1') => deps(up.fetch, limiter, { owner, now: () => now })
  await searchPlaces({ q: 'Stanley Park', explicit: false }, d())
  await searchPlaces({ q: 'stanley park', explicit: false }, d())
  assert.equal(up.calls.length, 2, 'the query as typed is the key')
  await searchPlaces({ q: 'Stanley Park', explicit: false }, d())
  assert.equal(up.calls.length, 2, 'a hit')
  await searchPlaces({ q: 'Stanley Park', explicit: false }, d('acct-2'))
  assert.equal(up.calls.length, 3, 'never across accounts')
  assert.deepEqual(await searchPlaces({ q: 'zzzq', explicit: false }, d()), { status: 'ok', places: [] })
  await searchPlaces({ q: 'zzzq', explicit: false }, d())
  assert.equal(up.calls.length, 4, 'no match is cached as a result')
  now += 5 * 60_000
  await searchPlaces({ q: 'Stanley Park', explicit: false }, d())
  assert.equal(up.calls.length, 5, 'gone after five minutes')
})

test('a limit refuses before anything goes out; Photon\'s 429 pauses every search, its Retry-After honoured', async () => {
  resetPlaceSearch()
  let now = 5_000_000
  const limiter = new MemoryPlaceLimiter()
  let status = 429
  const up = upstream(() => (status === 429 ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : new Response(reply([park]))))
  const d = deps(up.fetch, limiter, { now: () => now })
  assert.deepEqual(await searchPlaces({ q: 'Stanley Park', explicit: false }, d), { status: 'limit' })
  status = 200
  assert.deepEqual(await searchPlaces({ q: 'Granville Island', explicit: false }, d), { status: 'limit' })
  assert.equal(up.calls.length, 1, 'paused: nothing goes')
  now += 121_000
  assert.equal((await searchPlaces({ q: 'Granville Island', explicit: false }, d)).status, 'ok')
})

test('a limiter that fails sends nothing to Photon', async () => {
  resetPlaceSearch()
  const up = upstream(() => new Response(reply([park])))
  const broken: PlaceLimiter = { take: async () => { throw new Error('db down') }, pause: async () => {} }
  assert.deepEqual(await searchPlaces({ q: 'Stanley Park', explicit: false }, deps(up.fetch, broken)), { status: 'unavailable' })
  assert.equal(up.calls.length, 0)
})

test('logs carry the status, the time and a count, never the words or a URL', async () => {
  resetPlaceSearch()
  const lines: string[] = []
  const up = upstream(() => new Response(reply([park])))
  await searchPlaces({ q: 'Secret Clinic Name', explicit: false }, deps(up.fetch, undefined, { log: e => lines.push(JSON.stringify(e)) }))
  await searchPlaces({ q: 'Secret Clinic Name', explicit: false }, deps(() => { throw new TypeError('x') }, undefined, { log: e => lines.push(JSON.stringify(e)) }))
  assert.ok(lines.length >= 2)
  for (const l of lines) assert.doesNotMatch(l, /Secret|Clinic|photon|komoot|acct-1|49\.3|123\.14/i, l)
})

async function limits(make: () => Promise<[PlaceLimiter, PlaceLimiter]>) {
  const [a, b] = await make()
  const t0 = new Date('2026-11-14T10:00:00Z'), at = (ms: number) => new Date(t0.getTime() + ms)
  // Two instances on one store: 30 a minute for one account, counted together.
  for (let i = 0; i < placeQuota.perAccountMinute; i++) assert.ok(await (i % 2 ? a : b).take('one', at(i)), `search ${i + 1}`)
  assert.equal(await a.take('one', at(100)), false, 'the 31st in a minute, on either instance')
  assert.equal(await b.take('one', at(100)), false)
  // 60 a minute across the deployment: another account gets the other 30, then everyone waits.
  for (let i = 0; i < placeQuota.perMinute - placeQuota.perAccountMinute; i++) assert.ok(await b.take(`acct-${i % 3}`, at(200 + i)))
  assert.equal(await a.take('fresh', at(300)), false, '61st across the deployment')
  assert.ok(await a.take('fresh', at(61_000)), 'a minute later')
  // A pause from one instance stops the other; a shorter one never reopens it early.
  await a.pause(at(200_000))
  await b.pause(at(120_000))
  assert.equal(await b.take('fresh', at(150_000)), false)
  assert.ok(await b.take('fresh', at(200_001)))
}

test('limits shared by two instances, in memory (one process)', async () => {
  const one = new MemoryPlaceLimiter()
  await limits(async () => [one, one])
})

test('limits shared by two instances on one Postgres (PGlite), counted under one lock, nothing but who and when', async () => {
  const db = await PGlite.create()
  const sql = pgliteClient(db)
  await limits(async () => [new PostgresPlaceLimiter(sql, 'daythread'), new PostgresPlaceLimiter(sql, 'daythread')])
  const cols = (await sql.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'daythread' and table_name = 'place_searches' order by ordinal_position`)).map(r => r.column_name)
  assert.deepEqual(cols, ['user_id', 'at'])
  const rls = await sql.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in ('place_searches', 'place_search_pause')`)
  assert.ok(rls.length === 2 && rls.every(r => r.relrowsecurity))
  // 500 a day per account.
  const c = new PostgresPlaceLimiter(sql, 'daythread'), day = new Date('2026-11-20T00:00:00Z')
  let taken = 0
  for (let i = 0; i < 600; i++) if (await c.take('heavy', new Date(day.getTime() + i * 3_000))) taken++
  assert.equal(taken, placeQuota.perAccountDay)
  await db.close()
})

// On a real Postgres, as the Worker runs it: separate connections racing, so the lock is what keeps the counts right.
// Skipped unless DATABASE_TEST_URL points at a disposable database (its `daythread_test_*` schemas are dropped).
test('real Postgres: 40 searches at once from two instances, exactly 30 counted; a pause seen by both', { skip: process.env.DATABASE_TEST_URL ? false : 'DATABASE_TEST_URL not set' }, async () => {
  const { default: postgres } = await import('postgres')
  const { postgresClient } = await import('../src/server/db/sql.ts')
  const schema = `daythread_test_place_${process.pid}`
  const [x, y] = [0, 1].map(() => postgres(process.env.DATABASE_TEST_URL!, { prepare: false, max: 8, onnotice: () => {} }))
  try {
    const [a, b] = [new PostgresPlaceLimiter(postgresClient(x!), schema), new PostgresPlaceLimiter(postgresClient(y!), schema)]
    await Promise.all([a.prepare(), b.prepare()])
    const now = new Date('2026-11-14T10:00:00Z')
    const taken = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).take('one', new Date(now.getTime() + i))))
    assert.equal(taken.filter(Boolean).length, placeQuota.perAccountMinute)
    await a.pause(new Date(now.getTime() + 600_000))
    assert.equal(await b.take('other', new Date(now.getTime() + 1_000)), false)
  } finally {
    await x!.unsafe(`drop schema if exists ${schema} cascade`)
    await Promise.all([x!.end(), y!.end()])
  }
})

test('Retry-After as seconds or an HTTP date, then held between a minute and an hour (Ratchet a4352286)', async () => {
  const { retryAfterMs } = await import('../src/server/place-search.ts')
  const now = Date.parse('2026-11-14T10:00:00Z')
  assert.equal(retryAfterMs('120', now), 120_000)
  assert.equal(retryAfterMs('Sat, 14 Nov 2026 10:10:00 GMT', now), 600_000)
  assert.equal(retryAfterMs('soon', now), 0)
  assert.equal(retryAfterMs(null, now), 0)
  resetPlaceSearch()
  let t = now
  const limiter = new MemoryPlaceLimiter()
  const up = upstream(() => new Response('', { status: 429, headers: { 'retry-after': 'Sat, 14 Nov 2026 10:10:00 GMT' } }))
  assert.deepEqual(await searchPlaces({ q: 'Stanley Park', explicit: false }, deps(up.fetch, limiter, { now: () => t })), { status: 'limit' })
  t += 61_000
  assert.equal(await limiter.take('acct-1', new Date(t)), false, 'still paused after a minute: the date said ten')
  t = now + 600_001
  assert.equal(await limiter.take('acct-1', new Date(t)), true)
})

test('a limiter whose setup failed tries again on the next search, the failed one closed (Ratchet a4352286)', async () => {
  const db = await PGlite.create()
  const real = pgliteClient(db)
  let down = true
  const flaky = { ...real, query: (sql: string, params?: unknown[]) => (down ? Promise.reject(new Error('db down')) : real.query(sql, params)) } as typeof real
  const limiter = new PostgresPlaceLimiter(flaky, 'daythread')
  await assert.rejects(limiter.take('one', new Date()))
  down = false
  assert.equal(await limiter.take('one', new Date()), true)
  await db.close()
})
