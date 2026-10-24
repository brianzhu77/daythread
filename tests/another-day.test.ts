import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anotherDayOptions } from '../src/components/dates.ts'

// B57: "This weekend" only Monday to Thursday, and never two options for one date. Oct 19 2026 is a Monday.
const week: Record<string, [string, string][]> = {
  '2026-10-19': [['Tomorrow', '2026-10-20'], ['This weekend', '2026-10-24'], ['Next week', '2026-10-26']], // Mon
  '2026-10-22': [['Tomorrow', '2026-10-23'], ['This weekend', '2026-10-24'], ['Next week', '2026-10-26']], // Thu
  '2026-10-23': [['Tomorrow', '2026-10-24'], ['Next week', '2026-10-26']], // Fri: the weekend is tomorrow
  '2026-10-24': [['Tomorrow', '2026-10-25'], ['Next week', '2026-10-26']], // Sat: no "This weekend · Sat 10/31"
  '2026-10-25': [['Tomorrow', '2026-10-26']], // Sun: next week's Monday is tomorrow, offered once
}
test('another-day options by weekday', () => {
  for (const [today, expected] of Object.entries(week)) assert.deepEqual(anotherDayOptions(today).map(o => [o.label, o.date]), expected, today)
})
test('every day of a month: no option twice, none today or earlier, "This weekend" only Mon-Thu', () => {
  for (let day = 1; day <= 31; day++) {
    const today = `2026-10-${String(day).padStart(2, '0')}`, options = anotherDayOptions(today), weekday = new Date(2026, 9, day).getDay()
    assert.equal(new Set(options.map(o => o.date)).size, options.length, today)
    assert.ok(options.every(o => o.date > today), today)
    assert.equal(options.some(o => o.label === 'This weekend'), weekday >= 1 && weekday <= 4, today)
  }
})
