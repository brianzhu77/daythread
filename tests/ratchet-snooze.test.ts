import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, todo, para, heading, text, nodesOf, under } from './v2-helpers.ts'
import { draftOf, draftView, type DraftItem } from '../src/domain/day-draft.ts'
import { plannedOn } from '../src/domain/workspace.ts'
import { buildDayDraftRequest, withFallback } from '../src/server/model/day-draft.ts'

// Brian 17e7b7f2, Lead d2d043f0: from the day's draft, a suggested to-do can be moved to a later day. It is planned
// there, and no draft before that day offers it again: not the model's input, not its answer, not a draft already made.
const monday = '2026-10-26' // tomorrow is Fri Oct 23

function setup() {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [heading('p', 'Plan'), todo('s1', '', 'reference', ''), todo('s2', '', 'reference', ''), heading('n', 'Notes'), para('nn')])
  const day = h.day(tomorrow)
  const slot = nodesOf(day).find(n => n.type === 'task')!.id
  const book = h.task('Book the flights').id, dog = h.task('Buy a dog bed').id
  const draft = (items: Partial<DraftItem>[], moreOpen: string[] = [], pageId = dayId(tomorrow)) => h.run({
    type: 'set-draft', pageId, status: 'ready', moreOpen, allowedTaskIds: [book, dog],
    items: items.map((x, i) => ({ id: `i${i}`, anchor: slot, place: 'after', source: 'model', state: 'open', ...x }) as DraftItem),
  })
  const item = (id: string) => draftOf(h.ws, dayId(tomorrow))!.items.find(i => i.id === id)!
  const view = () => draftView(h.ws, h.page(dayId(tomorrow)))!
  return { h, book, dog, draft, item, view }
}
const line = (words: string) => ({ block: para('w', text(words)) })


test('review: reopen rejects ordinary plan-task after Undo move', () => {
 const {h, book, draft} = setup(); draft([{taskId:book}]);
 const skip=h.run({type:'skip-draft',pageId:dayId(tomorrow),itemIds:['i0']});
 const move=h.run({type:'snooze-draft',pageId:dayId(tomorrow),itemIds:['i0'],date:monday,today:tomorrow});
 h.run({type:'undo',targetOperationId:move.receipt.operationId});
 h.run({type:'plan-task',taskId:book,date:'2026-10-28',today:tomorrow});
 assert.throws(()=>h.run({type:'reopen-draft',pageId:dayId(tomorrow),itemIds:['i0'],skippedBy:skip.receipt.operationId}),/Cannot undo/);
});
test('review: old move notice cannot overwrite later move', () => {
 const {h, book, draft}=setup(); draft([{taskId:book}]);
 h.run({type:'skip-draft',pageId:dayId(tomorrow),itemIds:['i0']});
 h.run({type:'plan-task',taskId:book,date:'2026-10-28',today:tomorrow});
 assert.throws(()=>h.run({type:'snooze-draft',pageId:dayId(tomorrow),itemIds:['i0'],date:monday,today:tomorrow}), /changed|Nothing|Cannot/i);
});
