// How a day's events are worded in the strip (docs/design/native-phase-1.md §12.2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventsHeading, eventsLine, shortTime } from '../src/components/event-words.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'
import type { DayEvent } from '../src/domain/types.ts'
import { bullet, heading, para, text } from './v2-helpers.ts'

const event = (title: string, time: string | null = null): DayEvent => ({ id: title, title, date: '2026-11-26', time })

test('shortTime leaves out :00 and words noon and midnight as 12', () => {
  assert.deepEqual(['10:30', '15:00', '12:00', '00:15'].map(shortTime), ['10:30 AM', '3 PM', '12 PM', '12:15 AM'])
})

test('eventsLine: nothing for no events, All day after a lone untimed one, +N more past two', () => {
  assert.equal(eventsLine([]), null)
  assert.deepEqual(eventsLine([event('Lunch with Kathy')]), { text: 'Lunch with Kathy · All day', more: null })
  assert.deepEqual(eventsLine([event('Lunch with Kathy'), event('Standup with Lu', '10:30'), event('Dentist', '15:00')]), { text: 'Lunch with Kathy · 10:30 AM Standup with Lu', more: '+1 more' })
  assert.equal(eventsLine([event('')])!.text, 'Untitled event · All day')
})

test('eventsHeading matches a top-level heading titled Events, whatever its case and spaces, and nothing else', () => {
  assert.equal(eventsHeading([para('p', text('Events')), heading('h', ' events ')])?.id, 'h')
  assert.equal(eventsHeading([heading('h', 'EVENTS')])?.id, 'h')
  const nested: EditorNode = { ...bullet('b', text('A line')), children: [heading('n', 'Events')] }
  assert.equal(eventsHeading([nested]), undefined)
  assert.equal(eventsHeading([para('p', text('Events'))]), undefined)
})
