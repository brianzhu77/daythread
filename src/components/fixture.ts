// DEV-ONLY sample data: a short history (a page 4 days ago, yesterday, today) built from ordinary commands, so it
// obeys the domain rules and gives the morning card something to carry.
import type { Action } from '../domain/types'
import { addDays } from './dates'

export function sampleActions(today: string): Action[] {
  const pageId = (date: string) => `day:${date}`
  const y = addDays(today, -1)
  const older = addDays(today, -4)
  return [
    { type: 'ensure-day', date: older },
    { type: 'add-task', pageId: pageId(older), title: 'Fix export bug', plannedOn: older },
    { type: 'ensure-day', date: y },
    { type: 'add-task', pageId: pageId(y), title: 'Call Kathy’s school', plannedOn: y },
    { type: 'add-task', pageId: pageId(y), title: 'Renew passport photos', plannedOn: y, deadlineOn: addDays(today, 6) },
    { type: 'ensure-day', date: today },
    { type: 'add-task', pageId: pageId(today), title: 'Rewind - APPX PR - Provider', plannedOn: today, deadlineOn: addDays(today, 1) },
    { type: 'add-task', pageId: pageId(today), title: 'Tax return', plannedOn: today },
    { type: 'add-task', pageId: pageId(today), title: 'Submit materials', attentionOn: y, deadlineOn: addDays(today, 2) },
  ]
}
