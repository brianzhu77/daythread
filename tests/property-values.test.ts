import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  changedNotice, dateLabel, enterChoice, flipSign, matchOptions, numberLabel, orderedDate, readNumberInput, readingLabel,
  splitDate, statusDot, tooLong, urlHref, urlLabel, withoutTime,
} from '../src/components/property-values.ts'
import type { Option } from '../src/domain/database.ts'

test('Number reads what he types, and only in its format', () => {
  assert.equal(readNumberInput('', 'plain'), null)
  assert.equal(readNumberInput('  ', 'plain'), null)
  assert.equal(readNumberInput('1,234.5', 'comma'), 1234.5)
  assert.equal(readNumberInput('-3', 'plain'), -3)
  assert.equal(readNumberInput('−3', 'plain'), -3)
  assert.equal(readNumberInput('.5', 'plain'), 0.5)
  assert.equal(readNumberInput('１２', 'plain'), 12)
  assert.equal(readNumberInput('12%', 'percent'), 12)
  assert.equal(readNumberInput('12%', 'plain'), 'invalid')
  assert.equal(readNumberInput('$9.99', 'currency'), 9.99)
  assert.equal(readNumberInput('$9.99', 'plain'), 'invalid')
  assert.equal(readNumberInput('abc', 'plain'), 'invalid')
  assert.equal(readNumberInput('1.2.3', 'plain'), 'invalid')
  assert.equal(readNumberInput('1e999', 'plain'), 'invalid')
})

test('the ± button flips the sign of what is typed', () => {
  assert.equal(flipSign('12'), '-12')
  assert.equal(flipSign('-12'), '12')
  assert.equal(flipSign(''), '-')
})

test('a number shows in its format', () => {
  assert.equal(numberLabel(1234.5, 'plain'), '1234.5')
  assert.equal(numberLabel(1234.5, 'comma'), '1,234.5')
  assert.equal(numberLabel(12, 'percent'), '12%')
  assert.equal(numberLabel(9.5, 'currency'), '$9.50')
})

test('Text and URL: the length limit and the phone notice', () => {
  assert.equal(tooLong('x'.repeat(10_000)), false)
  assert.equal(tooLong('x'.repeat(10_001)), true)
  assert.equal(changedNotice('Notes'), 'Notes changed · Undo')
  assert.equal(changedNotice(''), 'Text changed · Undo')
})

const options: Option[] = [
  { id: 'a', name: 'To read', group: 'todo' },
  { id: 'b', name: 'Reading', group: 'active' },
  { id: 'c', name: 'Read', group: 'done' },
]

test('options filter by substring, ignoring case, and Create only offers a new name', () => {
  assert.deepEqual(matchOptions(options, '').matches.map(o => o.id), ['a', 'b', 'c'])
  assert.equal(matchOptions(options, '').create, null)
  assert.deepEqual(matchOptions(options, 'READ').matches.map(o => o.id), ['a', 'b', 'c'])
  assert.equal(matchOptions(options, ' read ').create, null)
  assert.equal(matchOptions(options, 'Rea').create, 'Rea')
  assert.deepEqual(matchOptions(options, 'Paused'), { matches: [], create: 'Paused' })
})

test('Enter picks an exact name first, then the first match, then Create', () => {
  assert.deepEqual(enterChoice(options, 'read'), { option: options[2] })
  assert.deepEqual(enterChoice(options, 'ing'), { option: options[1] })
  assert.deepEqual(enterChoice(options, ' Paused '), { create: 'Paused' })
  assert.equal(enterChoice([], ''), null)
})

test('a status shows the dot of its group', () => {
  assert.equal(statusDot(options[0]), '○')
  assert.equal(statusDot(options[1]), '◐')
  assert.equal(statusDot(options[2]), '●')
  assert.equal(statusDot(undefined), '○')
})

test('dates: an end before the start is swapped, and an equal end is dropped', () => {
  assert.deepEqual(orderedDate('2026-11-05', '2026-11-01'), { start: '2026-11-01', end: '2026-11-05' })
  assert.deepEqual(orderedDate('2026-11-05', '2026-11-05'), { start: '2026-11-05' })
  assert.deepEqual(orderedDate('2026-11-05', undefined), { start: '2026-11-05' })
  assert.deepEqual(withoutTime({ start: '2026-11-05T09:00', end: '2026-11-05T17:00' }), { start: '2026-11-05' })
  assert.deepEqual(splitDate('2026-11-05T09:30'), { day: '2026-11-05', time: '09:30' })
  assert.deepEqual(splitDate('2026-11-05'), { day: '2026-11-05', time: null })
})

test('a date cell has no relative words, and the year only when it differs', () => {
  const today = '2026-11-01'
  assert.equal(dateLabel({ start: '2026-10-12' }, today), 'Oct 12')
  assert.equal(dateLabel({ start: '2025-10-12' }, today), 'Oct 12, 2025')
  assert.equal(dateLabel({ start: '2026-10-12', end: '2026-10-20' }, today), 'Oct 12 → Oct 20')
  assert.equal(dateLabel({ start: '2026-10-12T09:14' }, today), 'Oct 12, 9:14 AM')
  assert.equal(dateLabel({ start: '2026-10-12T15:00' }, today), 'Oct 12, 3 PM')
  assert.equal(readingLabel('2026-11-20', '15:00', today), 'Fri, Nov 20, 3 PM')
})

test('a URL opens only when it is a link, and the value is never rewritten', () => {
  assert.equal(urlHref('example.com/path'), 'https://example.com/path')
  assert.equal(urlHref('https://example.com'), 'https://example.com')
  assert.equal(urlHref('mailto:a@b.co'), 'mailto:a@b.co')
  assert.equal(urlHref('javascript:alert(1)'), null)
  assert.equal(urlHref('not a link'), null)
  assert.equal(urlHref('nodot'), null)
  assert.equal(urlLabel('https://www.example.com/'), 'example.com')
  assert.equal(urlLabel('https://example.com/a/b'), 'example.com/a/b')
  assert.equal(urlLabel('not a link'), 'not a link')
})
