import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mayRead, readDate } from '../src/domain/date-reading.ts'
import { mentionText, readMention } from '../src/domain/date-chip.ts'

// B27 plan §3: the `@` picker's reading, anchored on the page's date. Oct 22 2026 is a Thursday.
const anchor = '2026-10-22'
const read = (q: string, at = anchor) => { const r = readDate(q, at); return r && [r.date, r.time, r.used] }

test('English days: today, tomorrow, weekdays (the coming one; that weekday itself is the anchor)', () => {
  assert.deepEqual(read('today'), ['2026-10-22', null, 5])
  assert.deepEqual(read('tmr'), ['2026-10-23', null, 3])
  assert.deepEqual(read('Tomorrow'), ['2026-10-23', null, 8])
  assert.deepEqual(read('Fri'), ['2026-10-23', null, 3])
  assert.deepEqual(read('thu'), ['2026-10-22', null, 3])
  assert.deepEqual(read('wednesday'), ['2026-10-28', null, 9])
  assert.equal(read('sunny'), null)
  assert.equal(read('todays'), null)
})

test('month-day forms; a date with no year is the next one on or after the page\'s date', () => {
  assert.deepEqual(read('Nov 20'), ['2026-11-20', null, 6])
  assert.deepEqual(read('November 20th'), ['2026-11-20', null, 13])
  assert.deepEqual(read('20 Nov'), ['2026-11-20', null, 6])
  assert.deepEqual(read('11/20'), ['2026-11-20', null, 5])
  assert.deepEqual(read('3/4'), ['2027-03-04', null, 3])
  assert.deepEqual(read('Jan 5'), ['2027-01-05', null, 5])
  assert.deepEqual(read('Oct 22'), ['2026-10-22', null, 6])
  assert.deepEqual(read('Oct 21'), ['2027-10-21', null, 6])
  assert.deepEqual(read('Nov 20, 2027'), ['2027-11-20', null, 12])
  assert.deepEqual(read('2026-12-31'), ['2026-12-31', null, 10])
  assert.deepEqual(read('11/20/2028'), ['2028-11-20', null, 10])
})

test('year boundaries, leap days and impossible dates', () => {
  assert.deepEqual(read('Jan 1', '2026-12-31'), ['2027-01-01', null, 5])
  assert.deepEqual(read('Dec 31', '2026-12-31'), ['2026-12-31', null, 6])
  assert.deepEqual(read('Feb 29'), ['2028-02-29', null, 6], 'the next Feb 29')
  assert.equal(read('Feb 30'), null)
  assert.equal(read('13/1'), null)
  assert.equal(read('2026-02-30'), null)
  assert.equal(read('2/29/2027'), null)
})

test('Chinese forms: 今天, 明天, 周X, 11月20日', () => {
  assert.deepEqual(read('今天'), ['2026-10-22', null, 2])
  assert.deepEqual(read('明天'), ['2026-10-23', null, 2])
  assert.deepEqual(read('周五'), ['2026-10-23', null, 2])
  assert.deepEqual(read('周日'), ['2026-10-25', null, 2])
  assert.deepEqual(read('11月20日'), ['2026-11-20', null, 6])
  assert.deepEqual(read('11月20号'), ['2026-11-20', null, 6])
  assert.deepEqual(read('1月5'), ['2027-01-05', null, 3])
})

test('times after a date, and a time alone means the page\'s day', () => {
  assert.deepEqual(read('Fri 3pm'), ['2026-10-23', '15:00', 7])
  assert.deepEqual(read('Nov 20 12pm'), ['2026-11-20', '12:00', 11])
  assert.deepEqual(read('Nov 20, 3:30 pm'), ['2026-11-20', '15:30', 15])
  assert.deepEqual(read('tomorrow 15:00'), ['2026-10-23', '15:00', 14])
  assert.deepEqual(read('明天 9am'), ['2026-10-23', '09:00', 6])
  assert.deepEqual(read('12am'), ['2026-10-22', '00:00', 4])
  assert.deepEqual(read('3pm'), ['2026-10-22', '15:00', 3])
  assert.deepEqual(read('Fri dentist'), ['2026-10-23', null, 3], 'the rest stays text after the chip')
  assert.equal(read('13pm'), null)
  assert.equal(read('24:00'), null)
})

test('emails, handles and prices don\'t read', () => {
  for (const q of ['brian', 'b.zhu', 'gmail.com', 'home', '5', '$5', ' Fri', 'everyone', 'mayor'])
    assert.equal(readDate(q, anchor), null, q)
})

test('mayRead keeps the list open only while typing can still reach a reading', () => {
  for (const q of ['', 't', 'tom', 'No', 'Nov', 'Nov ', 'Nov 2', '11', '11/', '11/2', '11月', '周', 'Fri ', 'Fri 3', 'Fri 3p', 'Nov 20 3:3'])
    assert.equal(mayRead(q, anchor), true, q)
  for (const q of ['brian', 'x', 'Fri dentist', 'Nov 20 at', 'everyone', '$'])
    assert.equal(mayRead(q, anchor), false, q)
})

test('the chip\'s stored text: year only off the holding page\'s year, always on a document page', () => {
  assert.equal(mentionText({ date: '2026-11-20', time: null }, '2026-10-22'), '@Nov 20')
  assert.equal(mentionText({ date: '2026-11-20', time: '15:00' }, '2026-10-22'), '@Nov 20 3pm')
  assert.equal(mentionText({ date: '2026-11-20', time: '09:30' }, '2026-10-22'), '@Nov 20 9:30am')
  assert.equal(mentionText({ date: '2027-01-05', time: null }, '2026-10-22'), '@Jan 5, 2027')
  assert.equal(mentionText({ date: '2026-11-20', time: null }, null), '@Nov 20, 2026')
  // Typing `@` before the stored text reads back the same date and time (Jazz §3c).
  const text = mentionText({ date: '2026-11-20', time: '15:30' }, '2026-10-22')
  assert.deepEqual(read(text.slice(1)), ['2026-11-20', '15:30', text.length - 1])
})

test('a malformed chip is not a chip', () => {
  assert.equal(readMention({ type: 'dateMention', props: { eventId: 'e', date: '2026-02-30' } }), null)
  assert.equal(readMention({ type: 'dateMention', props: { eventId: '', date: '2026-02-03' } }), null)
  assert.deepEqual(readMention({ type: 'dateMention', props: { eventId: 'e', date: '2026-02-03', time: '25:00' } }), { eventId: 'e', date: '2026-02-03', time: null })
  assert.equal(readMention({ type: 'pageRef', props: {} }), null)
})
