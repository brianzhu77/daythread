// Place step 2, the Map view (map-contract.md §2 to §5, D15 G8-9 to G8-11): its storage, the pins it draws and its
// counts, and the one-host boundary MapLibre is held to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandSchema } from '../src/domain/command-schema.ts'
import { mapRows, shownLine } from '../src/domain/map.ts'
import { allowedMapUrl, fetchMapStyle, mapRequest, styleAllowed, styleUrls } from '../src/components/map-boundary.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-14T10:00:00.000Z'
function eats() {
  const h = harness()
  const C = (change: unknown) => h.run({ type: 'change-database', pageId: 'eats', change } as never)
  h.run({ type: 'create-database', pageId: 'eats', homeBlockId: null, title: 'Eats' })
  C({ kind: 'addProperty', property: { id: 'pl', name: 'Where', type: 'place' } })
  C({ kind: 'addProperty', property: { id: 'nt', name: 'Notes', type: 'text' } })
  const db = () => h.page('eats').database!
  return { h, C, db, view: (id: string) => db().views.find(v => v.id === id)! }
}

test('a Map view: layout "map" by a Place property; a new one must be a live Place, the one held may go and come back', () => {
  const { C, db, view } = eats()
  C({ kind: 'addView', view: { id: 'm', name: 'Map', layout: 'map', mapBy: 'pl', columns: [], sort: [], filter: [] } })
  assert.equal(view('m').layout, 'map')
  assert.equal(view('m').mapBy, 'pl')
  assert.throws(() => C({ kind: 'updateView', viewId: 'm', mapBy: 'nt' }), /Can't place rows by that/)
  C({ kind: 'removeProperty', propertyId: 'pl' })
  C({ kind: 'updateView', viewId: 'm', name: 'Places' })
  assert.equal(view('m').mapBy, 'pl', 'kept unread while its property is gone, so Undo reads it again')
  // Switching away and back keeps it, as every view field is kept.
  const table = db().views[0]!.id
  C({ kind: 'updateView', viewId: table, layout: 'map' })
  C({ kind: 'updateView', viewId: table, layout: 'table' })
  assert.equal(db().views[0]!.layout, 'table')
})

test('the schema takes a map view and mapBy', () => {
  const ok = (change: unknown) => commandSchema.safeParse({ operationId: 'o', expectedRevision: 0, action: { type: 'change-database', pageId: 'eats', change } }).success
  assert.ok(ok({ kind: 'addView', view: { id: 'm', name: 'Map', layout: 'map', mapBy: 'pl', columns: [], sort: [], filter: [] } }))
  assert.ok(ok({ kind: 'updateView', viewId: 'm', mapBy: 'pl' }))
  assert.ok(!ok({ kind: 'addView', view: { id: 'm', name: 'Map', layout: 'globe', columns: [], sort: [], filter: [] } }))
})

test('pins: the first 100 with a pin, in the view\'s order; the counts add up to the filtered rows', () => {
  const rows = Array.from({ length: 240 + 3 + 2 }, (_, i) => ({ id: `r${i}` }))
  const value = (i: number) => (i < 240 ? { name: `P${i}`, lat: 49 + i / 1000, lon: -123 } : i < 243 ? { name: `words ${i}` } : undefined)
  const m = mapRows(rows, r => value(Number(r.id.slice(1))))
  assert.equal(m.pinned.length, 100)
  assert.deepEqual(m.pinned.slice(0, 2).map(p => p.row.id), ['r0', 'r1'])
  assert.equal(m.withPin, 240)
  assert.equal(m.noPlace.length, 5, 'words with no pin and empty cells')
  assert.equal(m.withPin + m.noPlace.length, rows.length)
  assert.equal(shownLine(m), '100 of 240 shown')
  assert.equal(shownLine(mapRows(rows.slice(0, 20), r => value(Number(r.id.slice(1))))), null, 'nothing left out, no line')
  assert.equal(mapRows([{ id: 'x' }], () => ({ name: 'bad', lat: 91, lon: 0 })).noPlace.length, 1, 'a value that isn\'t one has no pin')
})

const style = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'] } },
  sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [],
}

test('one host: only tiles.openfreemap.org, with no credentials and no referrer; anything else asks nothing', () => {
  assert.deepEqual(mapRequest('https://tiles.openfreemap.org/planet/20261101/1/2/3.pbf'), { url: 'https://tiles.openfreemap.org/planet/20261101/1/2/3.pbf', credentials: 'omit', referrerPolicy: 'no-referrer' })
  for (const url of ['https://example.com/a.png', 'http://tiles.openfreemap.org/planet', 'https://tiles.openfreemap.org.evil.com/x', 'https://user:pw@tiles.openfreemap.org/x', 'blob:https://x/1', 'nonsense'])
    assert.ok(!allowedMapUrl(url) && mapRequest(url).url.startsWith('data:'), url)
})

test('a style is drawn only when every source, sprite and glyph address is on our host', async () => {
  assert.equal(styleUrls(style).length, 4)
  assert.ok(styleAllowed(style))
  assert.ok(!styleAllowed({ ...style, sprite: 'https://example.org/sprite' }))
  assert.ok(!styleAllowed({ ...style, glyphs: 'https://fonts.example/{fontstack}/{range}.pbf' }))
  assert.ok(!styleAllowed({ ...style, sources: { ...style.sources, evil: { type: 'raster', tiles: ['https://example.com/{z}/{x}/{y}.png'] } } }))
  assert.ok(!styleAllowed({ ...style, sprite: [{ id: 'x', url: 'https://example.org/s' }] }))
  assert.ok(!styleAllowed(null) && !styleAllowed({ layers: [] }))
  // Our own fetch: no credentials, no referrer, no redirects; a hostile or failed style is null and nothing else is asked.
  const calls: { url: string; init: RequestInit }[] = []
  const answer = (body: unknown, status = 200) => (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }) }) as unknown as typeof fetch
  assert.deepEqual(await fetchMapStyle('light', answer(style)), style)
  assert.equal(calls[0]!.url, 'https://tiles.openfreemap.org/styles/positron')
  assert.deepEqual([calls[0]!.init.credentials, calls[0]!.init.referrerPolicy, calls[0]!.init.redirect], ['omit', 'no-referrer', 'error'])
  assert.equal(await fetchMapStyle('dark', answer({ ...style, sprite: 'https://example.org/s' })), null)
  assert.equal(calls.at(-1)!.url, 'https://tiles.openfreemap.org/styles/dark')
  assert.equal(await fetchMapStyle('light', answer({}, 500)), null)
  assert.equal(await fetchMapStyle('light', (async () => { throw new TypeError('offline') }) as typeof fetch), null)
})
