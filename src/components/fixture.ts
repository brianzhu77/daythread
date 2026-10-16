// DEV-ONLY sample data: a short history (a page 4 days ago, yesterday, today) built from ordinary
// commands, so it obeys the domain rules and gives the review a Good Stuffs item saved 2+ days ago.
import type { Action } from '../domain/types'
import { addDays } from './dates'

export function sampleActions(today: string): Action[] {
  const pageId = (date: string) => `day:${date}`
  const section = (date: string, kind: string) => `day:${date}:${kind}`
  const y = addDays(today, -1)
  const older = addDays(today, -4)
  return [
    { type: 'ensure-day', date: older },
    { type: 'add-task', pageId: pageId(older), sectionId: section(older, 'other'), title: 'Fix export bug' },
    { type: 'add-text', pageId: pageId(older), sectionId: section(older, 'good-stuffs'), text: 'https://www.inkandswitch.com/local-first/' },

    { type: 'ensure-day', date: y },
    { type: 'add-task', pageId: pageId(y), sectionId: section(y, 'top3'), title: 'Call Kathy’s school' },
    { type: 'add-task', pageId: pageId(y), sectionId: section(y, 'other'), title: 'Renew passport photos', deadlineOn: addDays(today, 6) },
    { type: 'add-text', pageId: pageId(y), sectionId: section(y, 'good-stuffs'), text: 'https://calmtech.com/' },
    { type: 'add-text', pageId: pageId(y), sectionId: section(y, 'notes'), text: 'Idea: the review should open straight on the phone.' },
    { type: 'add-text', pageId: pageId(y), sectionId: section(y, 'notes'), text: '“Slow is fast.”' },

    { type: 'ensure-day', date: today },
    { type: 'add-task', pageId: pageId(today), sectionId: section(today, 'top3'), title: 'Rewind - APPX PR - Provider', deadlineOn: addDays(today, 1) },
    { type: 'add-task', pageId: pageId(today), sectionId: section(today, 'other'), title: 'Tax return' },
    { type: 'add-task', pageId: pageId(today), sectionId: section(today, 'notes'), title: 'Submit materials', plannedOn: null, attentionOn: y, deadlineOn: addDays(today, 2) },
    { type: 'add-event', pageId: pageId(today), title: 'Lunch with Kevin', date: today },
  ]
}
