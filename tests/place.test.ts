// Place step 1's domain (place-contract.md §1, D15 G8-1, G8-2, G8-6): the stored value, the 2/3-character rule both
// sides use, links built from two templates, and the type's reading, filter, sort, CSV and paste.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readValue, storedValue, viewRows, type Property, type View } from '../src/domain/database.ts'
import { databaseSheet, pastedValue } from '../src/domain/csv.ts'
import { cleanPlace, isPlaceValue, locationName, placeFromText, placeLink, placeText, searchesAsTyped, searchFrom, searchQuery } from '../src/domain/place.ts'
import type { Action } from '../src/domain/types.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-11-14T10:00:00.000Z'
const place: Property = { id: 'pl', name: 'Where', type: 'place' }
const dumpling = { name: 'Golden Dumpling', address: '8391 Alexandra Rd, Richmond, BC, Canada', lat: 49.1859, lon: -123.1338, ref: 'osm:N123' }

test('a value: a name, and a pin only as a pair in range; name only is valid', () => {
  assert.ok(isPlaceValue(dumpling))
  assert.ok(isPlaceValue({ name: 'golden dumpling' }), 'name only')
  for (const bad of [{}, { name: '' }, { name: '  ' }, { name: 'x', lat: 1 }, { name: 'x', lon: 1 }, { name: 'x', lat: 91, lon: 0 }, { name: 'x', lat: 0, lon: 181 },
    { name: 'x', lat: Number.NaN, lon: 0 }, { name: 'x'.repeat(201) }, { name: 'x', address: 'y'.repeat(301) }, { name: 'x', ref: 'r'.repeat(65) }, { name: 'x', url: 'https://evil' }, 'x', ['x'], null])
    assert.equal(isPlaceValue(bad), false, JSON.stringify(bad))
  assert.deepEqual(cleanPlace({ name: '  Golden\nDumpling ', lat: 49.18591234567, lon: -123.13381234567 }), { name: 'Golden Dumpling', lat: 49.1859123, lon: -123.1338123 })
  assert.equal(cleanPlace({ name: 'x', lat: '49', lon: 1 }), null)
  assert.equal(cleanPlace({ name: 'x', href: 'https://evil' }), null, 'nothing else is kept, a provider URL least of all')
})

test('one threshold for the editor and the server: 2 characters with Chinese, Japanese or Korean, 3 otherwise (Lead cb4e0d08)', () => {
  assert.equal(searchesAsTyped('西湖'), true)
  assert.equal(searchesAsTyped('外滩'), true)
  assert.equal(searchesAsTyped('京'), false)
  assert.equal(searchesAsTyped('ab'), false)
  assert.equal(searchesAsTyped('abc'), true)
  assert.equal(searchFrom('a西'), 2, 'mixed: CJK present')
  assert.equal(searchesAsTyped('a西'), true)
  assert.equal(searchesAsTyped('ソウ'), true, 'katakana')
  assert.equal(searchesAsTyped('서울'), true, 'hangul')
  assert.equal(searchesAsTyped('  ab  '), false, 'trimmed first')
  assert.equal(searchQuery(' Stanley\u0000  Park '), 'Stanley Park')
  assert.equal(searchQuery('é'), 'é', 'NFC')
})

test('links come from two templates with encoded values, and only with a pin', () => {
  const v = { name: 'A & B "Café"', lat: 49.3, lon: -123.14 }
  assert.equal(placeLink(v, true), 'https://maps.apple.com/?ll=49.3%2C-123.14&q=A%20%26%20B%20%22Caf%C3%A9%22')
  assert.equal(placeLink(v, false), 'https://www.openstreetmap.org/?mlat=49.3&mlon=-123.14#map=17/49.3/-123.14')
  assert.equal(placeLink({ name: 'no pin' }, true), null)
  assert.equal(locationName(new Date(2026, 10, 14, 9)), 'Location on Nov 14')
})

test('stored as checked: a bad value is refused and writes nothing', () => {
  assert.deepEqual(storedValue(place, dumpling), dumpling)
  assert.deepEqual(storedValue(place, { name: 'kept' }), { name: 'kept' })
  assert.throws(() => storedValue(place, { name: '' }), /Not a value/)
  assert.throws(() => storedValue(place, 'words'), /Not a value/)
  assert.throws(() => storedValue(place, { name: 'x', lat: 1 }), /Not a value/)
  assert.equal(storedValue(place, null), undefined)
})

function shelf() {
  const h = harness()
  const C = (change: Extract<Action, { type: 'change-database' }>['change']) => h.run({ type: 'change-database', pageId: 'eats', change })
  h.run({ type: 'create-database', pageId: 'eats', homeBlockId: null, title: 'Eats' })
  C({ kind: 'addProperty', property: { id: 'pl', name: 'Where', type: 'text' } })
  const rows: [string, string, unknown][] = [['r1', 'Dumplings', 'golden dumpling'], ['r2', 'Noodles', 'Ramen Danbo'], ['r3', 'Nothing', '  '], ['r4', 'Empty', undefined]]
  for (const [id, title, v] of rows) h.run({ type: 'add-row', databaseId: 'eats', pageId: id, title, values: v === undefined ? {} : { pl: v }, at } as never)
  return { h, C, raw: (id: string) => h.page(id).values?.pl, prop: () => h.page('eats').database!.properties.find(p => p.id === 'pl')! }
}

test('Text to Place keeps the words as names with no pin and says how many; back to Text restores them; nothing is rewritten', () => {
  const { h, C, raw, prop } = shelf()
  const before = JSON.stringify(h.page('r1').values)
  const receipt = C({ kind: 'updateProperty', propertyId: 'pl', type: 'place' })
  assert.match(receipt.receipt.message, /2 kept as names without a place/)
  assert.deepEqual(readValue(prop(), raw('r1')), { name: 'golden dumpling' })
  assert.equal(readValue(prop(), raw('r3')), null, 'spaces are no name')
  // A pick on one row stores a value; the others keep their words as stored.
  h.run({ type: 'set-values', pageId: 'r2', values: { pl: dumpling }, expected: {}, at } as never)
  assert.equal(JSON.stringify(h.page('r1').values), before, 'a type change rewrites no value')
  C({ kind: 'updateProperty', propertyId: 'pl', type: 'text' })
  assert.equal(readValue(prop(), raw('r1')), 'golden dumpling')
  assert.equal(readValue(prop(), raw('r2')), placeText(dumpling), 'Place to Text: name and address')
  C({ kind: 'updateProperty', propertyId: 'pl', type: 'place' })
  assert.deepEqual(readValue(prop(), raw('r2')), dumpling, 'and back: the value as it was')
})

test('filter on text in the name or the address; sort by name; empty last', () => {
  const { h, C } = shelf()
  C({ kind: 'updateProperty', propertyId: 'pl', type: 'place' })
  h.run({ type: 'set-values', pageId: 'r2', values: { pl: dumpling }, expected: {}, at } as never)
  const view = (filter: View['filter'], sort: View['sort'] = []): View => ({ id: 'v', name: 'T', layout: 'table', columns: [{ id: 'pl' }], filter, sort })
  const titles = (v: View) => viewRows(h.ws, 'eats', v, { today: '2026-11-14', pageDate: null }).map(r => r.title)
  assert.deepEqual(titles(view([{ by: 'pl', op: 'contains', value: 'richmond' }])), ['Noodles'], 'the address')
  assert.deepEqual(titles(view([{ by: 'pl', op: 'contains', value: 'GOLDEN' }])), ['Dumplings', 'Noodles'], 'the name, words or picked')
  assert.deepEqual(titles(view([{ by: 'pl', op: 'doesNotContain', value: 'golden' }])), ['Nothing', 'Empty'])
  assert.deepEqual(titles(view([{ by: 'pl', op: 'isEmpty' }])), ['Nothing', 'Empty'])
  assert.deepEqual(titles(view([], [{ by: 'pl', direction: 'asc' }])), ['Dumplings', 'Noodles', 'Nothing', 'Empty'])
  assert.deepEqual(titles(view([], [{ by: 'pl', direction: 'desc' }])).slice(2), ['Nothing', 'Empty'], 'empty last either way')
})

test('CSV writes name, address and coordinates; a paste keeps words as a name with no pin', () => {
  const { h, C } = shelf()
  C({ kind: 'updateProperty', propertyId: 'pl', type: 'place' })
  h.run({ type: 'set-values', pageId: 'r2', values: { pl: dumpling }, expected: {}, at } as never)
  const db = h.page('eats').database!, prop = db.properties.find(p => p.id === 'pl')!
  const sheet = databaseSheet(db, ['r1', 'r2', 'r4'].map(h.page), [prop])
  assert.deepEqual(sheet.map(r => r[1]), ['Where', 'golden dumpling', 'Golden Dumpling, 8391 Alexandra Rd, Richmond, BC, Canada (49.1859, -123.1338)', ''])
  assert.deepEqual(pastedValue(db, prop, '  Ramen Danbo '), { name: 'Ramen Danbo' })
  assert.equal(pastedValue(db, prop, '   '), undefined)
  assert.deepEqual(placeFromText('x'.repeat(250)), { name: 'x'.repeat(200) })
})

test("Place isn't offered for Group, Rollup or a form question in step 1", async () => {
  const { h, C } = shelf()
  C({ kind: 'updateProperty', propertyId: 'pl', type: 'place' })
  const { groupableProperties } = await import('../src/domain/database.ts')
  assert.equal(groupableProperties(h.page('eats').database!, 'table').some(p => p.id === 'pl'), false)
  assert.equal(groupableProperties(h.page('eats').database!, 'board').some(p => p.id === 'pl'), false)
  const { questionable } = await import('../src/domain/forms.ts')
  assert.equal(questionable({ id: 'pl', name: 'Where', type: 'place' }), false)
})
