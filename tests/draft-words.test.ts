// The day draft's words (docs/design/native-phase-1.md §13.4, §13.8): the line's state and words, a band's skipped
// days, and the notices.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appliedNotice, draftLineState, draftLineWords, draftWords, skippedLabel, skippedNotice } from '../src/components/draft-words.ts'
import type { DraftItemView } from '../src/domain/day-draft.ts'

const ON = '2026-11-26'
const viewOf = (status: 'preparing' | 'ready' | 'failed', n: number) => ({ status, items: Array.from({ length: n }, (_, i): DraftItemView => ({ id: `i${i}`, kind: 'after', anchorId: null, block: { id: `b${i}`, type: 'paragraph', props: {}, content: [], children: [] } })) })

test('skippedLabel: up to three days by weekday, a day more than six days before as its date, four or more counted', () => {
  assert.deepEqual(skippedLabel(['2026-11-21', '2026-11-22'], ON), { text: 'skipped Sat, Sun', full: 'skipped Sat 11/21, Sun 11/22' })
  assert.equal(skippedLabel(['2026-11-19'], ON).text, 'skipped 11/19')
  assert.equal(skippedLabel(['2026-11-20'], ON).text, 'skipped Fri')
  assert.equal(skippedLabel(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'], ON).text, 'skipped 4 times')
})

test('draftLineState: each state of the line, as the hook gave it', () => {
  assert.equal(draftLineState(null, null, false), 'none', 'no draft, never asked')
  assert.equal(draftLineState(null, 'done', false), 'none', 'asked, and the answer stored nothing')
  assert.equal(draftLineState(null, 'in-flight', false), 'preparing')
  assert.equal(draftLineState(viewOf('ready', 0), 'in-flight', false), 'preparing', 'an older draft with nothing to show while asked again')
  assert.equal(draftLineState(viewOf('ready', 2), 'in-flight', false), 'ready', 'suggestions already shown')
  assert.equal(draftLineState(null, 'lost', false), 'failed')
  assert.equal(draftLineState(null, 'failed', false), 'failed')
  assert.equal(draftLineState(viewOf('ready', 1), 'failed', false), 'ready', 'a stored draft is what the line says')
  assert.equal(draftLineState(viewOf('failed', 1), null, false), 'failed', 'a stored draft marked failed')
  assert.equal(draftLineState(viewOf('preparing', 0), null, false), 'ready')
  assert.equal(draftLineState(null, null, true), 'offline')
  assert.equal(draftLineState(null, 'in-flight', true), 'offline')
  assert.equal(draftLineState(viewOf('ready', 1), null, true), 'ready', 'offline with a stored draft')
})

test('draftLineWords: preparing, held, the count and Couldn’t draft or Offline; nothing to say is null', () => {
  assert.deepEqual(draftLineWords('preparing', 0, false), { kind: 'preparing' })
  assert.deepEqual(draftLineWords('preparing', 2, true), { kind: 'preparing' })
  assert.deepEqual(draftLineWords('ready', 2, true), { kind: 'held' })
  assert.deepEqual(draftLineWords('ready', 3, false), { kind: 'segments', count: '3 suggestions', failed: false, offline: false })
  assert.deepEqual(draftLineWords('ready', 1, false), { kind: 'segments', count: '1 suggestion', failed: false, offline: false })
  assert.deepEqual(draftLineWords('failed', 2, false), { kind: 'segments', count: '2 suggestions', failed: true, offline: false })
  assert.deepEqual(draftLineWords('failed', 0, false), { kind: 'segments', count: null, failed: true, offline: false })
  assert.deepEqual(draftLineWords('offline', 0, false), { kind: 'segments', count: null, failed: false, offline: true })
  assert.equal(draftLineWords('ready', 0, false), null)
  assert.equal(draftLineWords('none', 0, false), null)
})

test('the line\'s and the notices\' fixed words', () => {
  assert.equal(draftWords.failed, 'Couldn’t draft')
  assert.equal(draftWords.preparing, 'Preparing…')
  assert.equal(draftWords.cantUndo, "Can't undo · edited since")
  assert.deepEqual([appliedNotice(1), appliedNotice(2), skippedNotice(1), skippedNotice(3)], ['Applied', 'Applied 2', 'Skipped', 'Skipped 3'])
})
