// Bookmarks (docs/design/bookmarks.md, B83): which pages, and in what order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookmarkPages } from '../src/domain/page-tree.ts'
import { harness } from './v2-helpers.ts'

const at = '2026-10-22T18:00:00.000Z'
test('every page with a url, newest first: made-at, then the day above it, then later position; no date goes last', () => {
  const h = harness()
  for (const date of ['2026-10-20', '2026-10-25']) h.run({ type: 'ensure-day', date })
  const link = (id: string, parent: string, when?: string) => h.run({ type: 'make-link-pages', parentPageId: parent, items: [{ url: `https://example.com/${id}`, pageId: id }], ...(when ? { at: when } : {}) })
  link('old', 'day:2026-10-20'); link('old2', 'day:2026-10-20'); link('late', 'day:2026-10-25')
  h.run({ type: 'create-document', title: 'Top', body: '', pageId: 'top' })
  link('undated', 'top'); link('new', 'top', at)
  // Between: Oct 22, which beats Oct 20's end and loses to Oct 25's.
  assert.deepEqual(bookmarkPages(h.ws).map(p => p.id), ['late', 'new', 'old2', 'old', 'undated'])
})
test('the time is set once: a repeat paste keeps it, and an ordinary page never gets one this way', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Top', body: '', pageId: 'top' })
  h.run({ type: 'make-link-pages', parentPageId: 'top', items: [{ url: 'https://example.com/a', pageId: 'a' }], at })
  assert.equal(h.ws.pages.find(p => p.id === 'a')!.createdAt, at)
  h.run({ type: 'make-link-pages', parentPageId: 'top', items: [{ url: 'https://example.com/a', pageId: 'b' }], at: '2026-11-01T00:00:00.000Z' })
  assert.equal(h.ws.pages.find(p => p.id === 'a')!.createdAt, at)
  assert.equal(h.ws.pages.some(p => p.id === 'b'), false)
  assert.equal(h.ws.pages.find(p => p.id === 'top')!.createdAt, undefined)
})
test('not listed: Trash, a page without a url; and it comes back with Restore at its own date', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Top', body: '', pageId: 'top' })
  h.run({ type: 'make-link-pages', parentPageId: 'top', items: [{ url: 'https://example.com/a', pageId: 'a' }], at })
  assert.deepEqual(bookmarkPages(h.ws).map(p => p.id), ['a'])
  h.run({ type: 'delete-page', pageId: 'a', at })
  assert.deepEqual(bookmarkPages(h.ws), [])
  h.run({ type: 'make-link-pages', parentPageId: 'top', items: [{ url: 'https://example.com/a', pageId: 'again' }], at: '2026-11-01T00:00:00.000Z' })
  assert.deepEqual(bookmarkPages(h.ws).map(p => [p.id, p.createdAt]), [['a', at]])
  h.run({ type: 'delete-page', pageId: 'top', at })
  assert.deepEqual(bookmarkPages(h.ws), [])
})
