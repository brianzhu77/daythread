// Repeating to-dos (docs/design/repeating-to-dos.md §4): the day the next one lands on. Pure: no workspace, no pages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstOccurrenceAfter } from '../src/domain/repeats.ts'
import { mendDay, nextDay, repeatTaskId, repeatWords, type TodoRepeat } from '../src/domain/todo-repeats.ts'

// Nov 23, 2026 is a Monday.
const mon = '2026-11-23', wed = '2026-11-25', thu = '2026-11-26', sat = '2026-11-28', nextMon = '2026-11-30'
const rep = (o: Partial<TodoRepeat> = {}): TodoRepeat => ({ id: 'r', taskId: 't', slot: mon, start: mon, every: 'week', interval: 1, from: 'schedule', createdAt: '2026-11-23T10:00:00.000Z', ...o })

test('the first schedule day after a day: weekly, two weekdays, every 2 weeks', () => {
  assert.equal(firstOccurrenceAfter(rep(), mon), nextMon)
  assert.equal(firstOccurrenceAfter(rep(), '2026-11-29'), nextMon)
  assert.equal(firstOccurrenceAfter(rep(), nextMon), '2026-12-07')
  const twice = rep({ interval: 2, weekdays: [1, 4] })
  assert.equal(firstOccurrenceAfter(twice, mon), thu)
  assert.equal(firstOccurrenceAfter(twice, thu), '2026-12-07', 'the week between is skipped')
  assert.equal(firstOccurrenceAfter(rep({ every: 'day', interval: 3 }), mon), thu)
})

test('calendar weeks go by the Week starts setting', () => {
  // Sunday and Monday, every 2 weeks, from Monday Nov 23.
  const r = rep({ interval: 2, weekdays: [0, 1] })
  assert.equal(firstOccurrenceAfter(r, mon, 0), '2026-12-06', 'weeks from Sunday: Nov 22 is before the start, the next pair is Dec 6 and 7')
  assert.equal(firstOccurrenceAfter(r, mon, 1), '2026-11-29', 'weeks from Monday: Sunday Nov 29 closes the first week')
})

test('"Its day": the first schedule day after both its own day and the day it was finished', () => {
  assert.equal(nextDay(rep(), mon), nextMon, 'done on its day')
  assert.equal(nextDay(rep(), wed), nextMon, 'done late')
  assert.equal(nextDay(rep(), '2026-12-02'), '2026-12-07', 'done after a whole period was missed: what was missed is skipped')
  assert.equal(nextDay(rep(), '2026-11-21'), nextMon, 'done early, the Saturday before: the Monday after its own')
  assert.equal(nextDay(rep({ every: 'day' }), wed), thu, 'daily, carried from Monday and done on Wednesday')
  assert.equal(nextDay(rep({ weekdays: [3] }), mon), wed, 'weekdays that leave its own day out')
})

test('"When it\'s done": the day it was finished plus the interval', () => {
  const r = rep({ every: 'day', interval: 5, from: 'done', slot: '2026-11-24', start: '2026-11-24' })
  assert.equal(nextDay(r, '2026-11-24'), '2026-11-29')
  assert.equal(nextDay(r, '2026-11-27'), '2026-12-02', 'a late finish counts from the finish')
  assert.equal(nextDay(rep({ from: 'done', interval: 2 }), wed), '2026-12-09')
  assert.equal(nextDay(rep({ every: 'month', from: 'done', slot: '2026-01-31', start: '2026-01-31' }), '2026-01-31'), '2026-02-28')
})

test('monthly and yearly keep their day where they can', () => {
  const rent = rep({ every: 'month', slot: '2026-01-31', start: '2026-01-31' })
  assert.equal(nextDay(rent, '2026-01-31'), '2026-02-28')
  assert.equal(nextDay({ ...rent, slot: '2026-02-28' }, '2026-02-28'), '2026-03-31', 'the start is fixed, so March is the 31st again')
  assert.equal(nextDay(rep({ every: 'year', slot: '2028-02-29', start: '2028-02-29' }), '2028-02-29'), '2029-02-28')
})

test('Ends on a date: the last day is still made, the one after it is not', () => {
  assert.equal(nextDay(rep({ until: nextMon }), mon), nextMon)
  assert.equal(nextDay(rep({ until: '2026-11-29' }), mon), null)
  assert.equal(nextDay(rep({ every: 'day', interval: 5, from: 'done', until: '2026-11-27' }), mon), null)
})

test('the mend never lands on a past day', () => {
  assert.equal(mendDay(rep(), mon, sat), nextMon, '"Its day": the first schedule day on or after today that is after its own')
  assert.equal(mendDay(rep(), mon, nextMon), nextMon, 'on a schedule day, that day')
  assert.equal(mendDay(rep({ every: 'day' }), mon, sat), sat, 'daily, five days late: today, not Tuesday')
  assert.equal(mendDay(rep({ slot: nextMon }), '2026-11-21', '2026-11-22'), '2026-12-07', 'finished early: still after its own day')
  const fromDone = rep({ every: 'day', interval: 5, from: 'done' })
  assert.equal(mendDay(fromDone, mon, wed), sat, 'the day it was finished plus the interval, when that is still to come')
  assert.equal(mendDay(fromDone, mon, '2026-12-05'), '2026-12-05', 'today, when that has passed')
  assert.equal(mendDay(fromDone, null, wed), nextMon, 'no day recorded (a Cancel sent without one): today plus the interval')
  assert.equal(mendDay(rep({ until: '2026-11-29' }), mon, sat), null, 'ended')
})

test('a schedule too long to walk has ended, rather than hanging or throwing', () => {
  const ancient = rep({ every: 'day', start: '1900-01-01', slot: '1900-01-01' })
  assert.equal(firstOccurrenceAfter(ancient, mon), null)
  assert.equal(nextDay(ancient, mon), null)
  assert.equal(mendDay(ancient, mon, wed), null)
})

test('the rule in words', () => {
  assert.equal(repeatWords(rep()), 'every week')
  assert.equal(repeatWords(rep({ every: 'day' })), 'every day')
  assert.equal(repeatWords(rep({ interval: 2 })), 'every 2 weeks')
  assert.equal(repeatWords(rep({ weekdays: [4, 1] })), 'every week on Mon, Thu')
  assert.equal(repeatWords(rep({ interval: 2, weekdays: [3] })), 'every 2 weeks on Wed')
  assert.equal(repeatWords(rep({ every: 'month' })), 'every month')
  assert.equal(repeatWords(rep({ every: 'year', interval: 3 })), 'every 3 years')
  assert.equal(repeatWords(rep({ every: 'day', interval: 5, from: 'done' })), "every 5 days, from when it's done")
  assert.equal(repeatWords(rep({ until: nextMon })), 'every week', 'the end is not part of the words')
})

test("the next to-do's id comes from the repeat and its day", () => {
  assert.equal(repeatTaskId('abc', nextMon), 'abc.2026-11-30')
  assert.equal(repeatTaskId('x'.repeat(150), nextMon).length, 100 + 1 + 10)
})
