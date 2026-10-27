import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchIndex, linesByPage, matchRanges, queryTerms, search, snippet } from '../src/domain/search.ts'
import { bullet, dayId, harness, para, text, today, todo, under, yesterday } from './v2-helpers.ts'

// Search (docs/design/search-states.md): pages by title, days by their date, tags by name, lines by every word typed.

function workspace() {
  const h = harness()
  h.day(yesterday); h.day(today)
  h.run({ type: 'create-document', title: 'Work', body: '', pageId: 'W' })
  h.run({ type: 'create-document', title: 'Korean soup recipes', body: 'Kimchi jjigae needs pork belly', pageId: 'S', parentId: 'W' })
  h.run({ type: 'create-document', title: 'Café notes', body: '', pageId: 'C', parentId: dayId(yesterday) })
  h.save(dayId(today), doc => under(doc, 'Notes', bullet('n1', text('Called the school about #kathy pickup')), bullet('n2', text('Soup for dinner, the Korean one'))))
  h.save(dayId(today), doc => under(doc, 'TODO', todo('t1', 'Renew passport photos')))
  h.save(dayId(yesterday), doc => under(doc, 'Notes', bullet('y1', text('School play on Friday #kathy')), bullet('y2', text('   '))))
  return h
}

const label = (date: string) => date

test('pages: titles match by prefix first, then anywhere; a nested page carries its path; days match their date words', () => {
  const h = workspace()
  const index = buildSearchIndex(h.ws, label)
  const r = search(index, 'soup', today)
  assert.deepEqual(r.pages.map(p => p.page.id), ['S'])
  assert.equal(r.pages[0]!.path, 'Pages › Work')
  const k = search(index, 'Korean', today)
  assert.deepEqual(k.pages.map(p => p.page.id), ['S'], 'a title starting with the word')
  assert.deepEqual(search(index, 'wor', today).pages.map(p => p.page.id), ['W'])
  const [y, m, d] = today.split('-').map(Number)
  const monthDay = new Date(y!, m! - 1, d!).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  assert.deepEqual(search(index, monthDay, today).pages.map(p => p.page.id), [dayId(today)], 'a day by "October 22"')
  assert.deepEqual(search(index, today, today).pages.map(p => p.page.id), [dayId(today)], 'a day by its ISO date')
  assert.deepEqual(search(index, 'today', today, yesterday).pages.map(p => p.page.id), [dayId(today)])
  assert.deepEqual(search(index, 'yesterday', today, yesterday).pages.map(p => p.page.id), [dayId(yesterday)])
  assert.equal(search(index, 'Café notes', today).pages[0]!.path, yesterday, "a day's subpage carries its day")
  // Days match at word starts and come after the pages named by title: "o" lists Work (by title) before the October days.
  assert.deepEqual(search(index, 'o', today).pages.map(p => p.page.id), ['C', 'S', 'W', dayId(today), dayId(yesterday)])
  assert.deepEqual(search(index, 'ber', today).pages.map(p => p.page.type), [], '"ber" is inside October, not a word start')
  assert.deepEqual(search(index, 'oct', today).pages.map(p => p.page.id), [dayId(today), dayId(yesterday)])
})

test('lines: every word typed must appear, in any order; a to-do row reads its task title; results run newest day first; blank lines and headings are never hits', () => {
  const h = workspace()
  const index = buildSearchIndex(h.ws, label)
  const r = search(index, 'school', today)
  assert.deepEqual(r.lines.map(l => l.blockId), ['n1', 'y1'], 'today before yesterday')
  assert.equal(r.lines[0]!.sectionTitle, 'Notes')
  assert.equal(r.lines[0]!.date, today)
  assert.deepEqual(search(index, 'Notes', today).lines, [], 'the heading itself is not a line')
  assert.deepEqual(search(index, 'friday play', today).lines.map(l => l.blockId), ['y1'], 'words in any order')
  assert.deepEqual(search(index, 'friday soup', today).lines, [], 'all words must be on one line')
  const t = search(index, 'passport', today)
  assert.equal(t.lines.length, 1)
  assert.equal(t.lines[0]!.taskId, h.task('Renew passport photos').id)
  assert.equal(t.lines[0]!.text, 'Renew passport photos')
  assert.deepEqual(search(index, 'belly', today).lines.map(l => l.page.id), ['S'], 'document pages are searched too')
  // Grouped by the page each line was written on, a day page being a page, in the order the lines came.
  const o = search(index, 'o', today)
  assert.deepEqual(linesByPage(o.lines).map(g => [g.page.id, g.lines.length]), [[dayId(today), 3], [dayId(yesterday), 1], ["S", 1]])
  assert.deepEqual(linesByPage(o.lines).map(g => g.page.id), [dayId(today), dayId(yesterday), 'S'])
  assert.equal(search(index, '   ', today).lines.length, 0, 'nothing typed, nothing listed')
})

test('tags: #word prefers tags; a bare word still finds tags by name; the count is the tag’s blocks', () => {
  const index = buildSearchIndex(workspace().ws, label)
  const r = search(index, '#kathy', today)
  assert.deepEqual(r.tags, [{ key: 'kathy', tag: 'kathy', count: 2 }])
  assert.deepEqual(r.lines.map(l => l.blockId), ['n1', 'y1'], 'the lines with the tag are listed too')
  assert.deepEqual(search(index, 'kath', today).tags.map(t => t.key), ['kathy'])
  assert.deepEqual(search(index, 'school play', today).tags, [], 'two plain words are a line search, not a tag search')
})

test('folding: case, accents and full-width letters are ignored; trashed pages leave the index', () => {
  const h = workspace()
  let index = buildSearchIndex(h.ws, label)
  assert.deepEqual(search(index, 'cafe', today).pages.map(p => p.page.id), ['C'])
  assert.deepEqual(search(index, 'ＳＯＵＰ', today).pages.map(p => p.page.id), ['S'])
  h.run({ type: 'delete-page', pageId: 'W', at: '2026-10-22T12:00:00.000Z' })
  index = buildSearchIndex(h.ws, label)
  assert.deepEqual(search(index, 'soup', today).pages, [], 'the subtree went to the trash with it')
  assert.deepEqual(search(index, 'soup', today).lines.map(l => l.blockId), ['n2'], "only today's line is left")
})

test('the list stops at the line limit and says how many more there are', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), doc => under(doc, 'Notes', ...Array.from({ length: 60 }, (_, i) => para(`p${i}`, text(`repeat ${i}`)))))
  const r = search(buildSearchIndex(h.ws, label), 'repeat', today)
  assert.equal(r.lines.length, 50)
  assert.equal(r.moreLines, 10)
})

test('highlighting: every typed word is marked where it occurs, overlaps merged; a long line is cut around the first match', () => {
  assert.deepEqual(queryTerms('  Soup  #Kathy '), ['soup', '#kathy'])
  assert.deepEqual(matchRanges('Soup for dinner, the Korean soup', 'soup korean'), [{ start: 0, end: 4 }, { start: 21, end: 27 }, { start: 28, end: 32 }])
  assert.deepEqual(matchRanges('abcabc', 'abc bca'), [{ start: 0, end: 6 }])
  assert.deepEqual(matchRanges('Café', 'cafe'), [{ start: 0, end: 4 }], 'a precomposed accent folds in place')
  assert.deepEqual(matchRanges('Cafe\u0301', 'cafe'), [], 'a combining accent shifts positions, so nothing is bolded rather than the wrong letters')
  const long = `${'word '.repeat(40)}needle${' tail'.repeat(10)}`
  const s = snippet(long, 'needle', 60)
  assert.ok(s.includes('needle') && s.startsWith('…') && s.endsWith('…'))
  assert.equal(snippet('short line', 'short'), 'short line')
  assert.ok(snippet(`needle ${'x'.repeat(200)}`, 'needle', 60).startsWith('needle'), 'an early match keeps the start')
})
