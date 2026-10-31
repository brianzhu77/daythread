import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, dayId, today, tomorrow, text, todo, bullet, para, heading, nodesOf, under } from './v2-helpers.ts'
import { inlineText, type EditorNode } from '../src/domain/editor-document.ts'
import { getDayView } from '../src/domain/workspace.ts'

// B74 (Bumblebee 8bb0f23d, Lead 3d87f348): carried to-dos go as their own group right under the outermost heading above
// the page's first to-do row, above that section's first line; with no heading, at the top. His empty to-dos stay empty.

const level = (n: EditorNode, l: number): EditorNode => ({ ...n, props: { level: l } })
const divider = (id: string): EditorNode => ({ id, type: 'divider', props: {}, children: [] })
const shape = (nodes: EditorNode[]) => nodes.map(n => `${n.type}${n.type === 'heading' ? n.props?.level : ''}:${inlineText(n.content).trim()}`)

/** Yesterday has two open to-dos; `template` (if any) is the day pages' default; tomorrow is made and both are added. */
function carry(template?: EditorNode[]) {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')))
  if (template) {
    h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
    h.save('tpl', () => template)
  }
  const made = shape(nodesOf(h.day(tomorrow)))
  const handoff = getDayView(h.ws, tomorrow).handoffTasks
  assert.deepEqual(handoff.map(t => t.title), ['Book the flights', 'Buy a dog bed'])
  h.run({ type: 'plan-tasks', date: tomorrow, items: handoff.map(t => ({ taskId: t.id })) })
  return { h, made, after: shape(nodesOf(h.page(dayId(tomorrow)))) }
}

test('carry: the built-in day is unchanged: under TODO, above its empty row', () => {
  const { after } = carry()
  assert.deepEqual(after.slice(0, 4), ['heading2:TODO', 'task:Book the flights', 'task:Buy a dog bed', 'task:'])
  assert.equal(after[4], 'heading2:Events')
})

// The shape of Brian's Day template (labels in paragraphs, empty to-do slots under them, a drop list, dividers),
// with neutral words.
const labelled = (): EditorNode[] => [
  heading('s1', 'Start of the day'),
  para('p1', text('One start')), todo('e1', '', 'reference', ''),
  para('p2', text('Long term')), todo('e2', '', 'reference', ''),
  para('x1'), para('p3', text('Drop list (optional)')), bullet('b1'), para('x2'), divider('d1'),
  heading('s2', 'Raw notes'), bullet('b2'), level(heading('s3', 'Ideas'), 3), bullet('b3'), divider('d2'),
  heading('s4', 'End of the day'), level(heading('q1', 'Enough?'), 4), para('a1', text('→ …')),
]

test("carry: with labelled slots, carried to-dos go right under the heading, never under one of his labels", () => {
  const { made, after } = carry(labelled())
  assert.deepEqual(after.slice(0, 6), ['heading2:Start of the day', 'task:Book the flights', 'task:Buy a dog bed', 'paragraph:One start', 'task:', 'paragraph:Long term'])
  assert.deepEqual(after.slice(6), made.slice(4), 'everything else stays where he put it')
  assert.equal(after.indexOf('paragraph:Drop list (optional)') + 1, after.indexOf('bulletListItem:'), 'nothing lands under the drop list')
})

test('carry: his empty to-do slots stay empty and the copy is exact, dividers included', () => {
  const { h, made } = carry(labelled())
  assert.deepEqual(made, shape(labelled()).map(s => s.replace(/^task:.*/, 'task:')))
  const slots = nodesOf(h.page(dayId(tomorrow))).filter(n => n.type === 'task' && !inlineText(n.content).trim())
  assert.equal(slots.length, 2)
  assert.ok(slots.every(n => !h.ws.tasks.some(t => t.id === n.props?.taskId && t.title.trim())))
})

test('carry: a later carry joins the group, after the ones already there', () => {
  const { h } = carry(labelled())
  h.save(dayId(tomorrow), d => d)
  const extra = h.run({ type: 'add-task', pageId: dayId(today), title: 'Call the vet', plannedOn: tomorrow })
  assert.ok(extra)
  const after = shape(nodesOf(h.page(dayId(tomorrow))))
  assert.deepEqual(after.slice(0, 5), ['heading2:Start of the day', 'task:Book the flights', 'task:Buy a dog bed', 'task:Call the vet', 'paragraph:One start'])
})

// The shape of his Day template since 10-31 18:09Z (361325a5): the first to-do slots sit under a sub-heading ("Top 3")
// inside a top-level section. A sub-heading he wrote is a label too, so the group goes under the top-level heading.
const nested = (): EditorNode[] => [
  heading('m', 'Morning'), level(heading('ev', 'Events'), 3), bullet('b1'),
  level(heading('t3', 'Top 3'), 3), todo('e1', '', 'reference', ''), todo('e2', '', 'reference', ''), todo('e3', '', 'reference', ''),
  level(heading('ot', 'Other'), 3), todo('e4', '', 'reference', ''), divider('d1'),
  heading('n', 'Notes'), bullet('b2'),
]

test('carry: with the first to-do slots under a sub-heading, they go under the top-level heading, not into its slots', () => {
  const { made, after } = carry(nested())
  assert.deepEqual(after.slice(0, 4), ['heading2:Morning', 'task:Book the flights', 'task:Buy a dog bed', 'heading3:Events'])
  assert.deepEqual(after.slice(3), made.slice(1), 'everything else stays where he put it')
  const top3 = after.indexOf('heading3:Top 3')
  assert.deepEqual(after.slice(top3 + 1, top3 + 4), ['task:', 'task:', 'task:'], 'Top 3 keeps exactly its three empty slots')
  assert.equal(after[top3 + 4], 'heading3:Other')
})

test('carry: a lower-level heading later on the page does not pull the group away from its section', () => {
  const { after } = carry([heading('m', 'Morning'), level(heading('t3', 'Top 3'), 3), todo('e1', '', 'reference', ''), level(heading('ev', 'Evening'), 1), bullet('b1')])
  assert.deepEqual(after.slice(0, 4), ['heading2:Morning', 'task:Book the flights', 'task:Buy a dog bed', 'heading3:Top 3'])
})

test('carry: with no heading above the first to-do row, they go at the top of the page', () => {
  const { after } = carry([para('p1', text('Morning')), todo('e1', '', 'reference', ''), heading('s1', 'Notes'), bullet('b1')])
  assert.deepEqual(after.slice(0, 4), ['task:Book the flights', 'task:Buy a dog bed', 'paragraph:Morning', 'task:'])
})

test('carry: with no to-do rows, under the first heading, and the group stays together', () => {
  // Before B74 the first went to the end of the section and the second jumped above "Gym?", splitting the group.
  const { after } = carry([heading('s1', 'Journal'), para('p1', text('Gym?')), bullet('b1'), heading('s2', 'Notes'), bullet('b2')])
  assert.deepEqual(after, ['heading2:Journal', 'task:Book the flights', 'task:Buy a dog bed', 'paragraph:Gym?', 'bulletListItem:', 'heading2:Notes', 'bulletListItem:'])
})

test('carry: with no heading and no to-do rows, at the top of the page', () => {
  const { after } = carry([para('p1', text('Gym?')), bullet('b1')])
  assert.deepEqual(after.slice(0, 3), ['task:Book the flights', 'task:Buy a dog bed', 'paragraph:Gym?'])
})

test('carry: a slot he filled before adding them does not pull them under its label', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights')))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => labelled())
  const day = nodesOf(h.day(tomorrow))
  const slot = day.find(n => n.type === 'task')!
  h.save(dayId(tomorrow), d => d.map(n => (n.id === slot.id ? { ...n, content: [text('Write the intro')] } : n)))
  const t = getDayView(h.ws, tomorrow).handoffTasks.find(x => x.title === 'Book the flights')!
  h.run({ type: 'plan-tasks', date: tomorrow, items: [{ taskId: t.id }] })
  assert.deepEqual(shape(nodesOf(h.page(dayId(tomorrow)))).slice(0, 4), ['heading2:Start of the day', 'task:Book the flights', 'paragraph:One start', 'task:Write the intro'])
})

test('carry: one Add from the morning card takes the same path as Add all', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'TODO', todo('r1', 'Book the flights')))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => labelled())
  h.day(tomorrow)
  const t = getDayView(h.ws, tomorrow).handoffTasks[0]!
  h.run({ type: 'plan-task', taskId: t.id, date: tomorrow, today: tomorrow })
  assert.deepEqual(shape(nodesOf(h.page(dayId(tomorrow)))).slice(0, 3), ['heading2:Start of the day', 'task:Book the flights', 'paragraph:One start'])
})

test('carry: a line from the Tomorrow block (add-task on that day page) joins the same group', () => {
  const h = harness()
  h.day(today)
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => labelled())
  h.day(tomorrow)
  h.run({ type: 'add-task', pageId: dayId(tomorrow), title: 'Renew the passport', plannedOn: tomorrow })
  assert.deepEqual(shape(nodesOf(h.page(dayId(tomorrow)))).slice(0, 3), ['heading2:Start of the day', 'task:Renew the passport', 'paragraph:One start'])
})

test('carry: a to-do added to an ordinary page still goes where it did (below a link page quote)', () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'Link', body: '', pageId: 'doc' })
  h.save('doc', () => [{ id: 'q', type: 'quote', props: {}, content: [text('A quote')], children: [] }, para('e')])
  h.run({ type: 'add-task', pageId: 'doc', title: 'Read it' })
  assert.deepEqual(shape(nodesOf(h.page('doc'))).slice(0, 2), ['quote:A quote', 'task:Read it'])
})

// B75 (Bumblebee 13a9a7f6, Lead 9ded39e6): with no matching heading, brought lines join the carried group too.
test('bring: with no matching heading, a brought line goes right after the carried to-dos, in the order brought', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(under(d, 'TODO', todo('r1', 'Book the flights')), 'Notes', bullet('n1', text('Mood: tired')), bullet('n2', text('Gym at 6'))))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => labelled())
  h.day(tomorrow)
  const view = getDayView(h.ws, tomorrow)
  h.run({ type: 'plan-tasks', date: tomorrow, items: view.handoffTasks.map(t => ({ taskId: t.id })) })
  const r1 = h.run({ type: 'bring-line', date: tomorrow, sourcePageId: dayId(today), sourceBlockId: 'n1' })
  h.run({ type: 'bring-line', date: tomorrow, sourcePageId: dayId(today), sourceBlockId: 'n2' })
  assert.equal(r1.receipt.message, 'Brought to today')
  const after = shape(nodesOf(h.page(dayId(tomorrow))))
  assert.deepEqual(after.slice(0, 5), ['heading2:Start of the day', 'task:Book the flights', 'bulletListItem:Mood: tired', 'bulletListItem:Gym at 6', 'paragraph:One start'])
  assert.ok(!after.slice(-3).some(s => s.includes('Mood')), 'nothing lands under his last prompt')
})

test('bring: a brought line before the carry still leaves the to-dos first', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(under(d, 'TODO', todo('r1', 'Book the flights')), 'Notes', bullet('n1', text('Mood: tired'))))
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => labelled())
  h.day(tomorrow)
  h.run({ type: 'bring-line', date: tomorrow, sourcePageId: dayId(today), sourceBlockId: 'n1' })
  const t = getDayView(h.ws, tomorrow).handoffTasks[0]!
  h.run({ type: 'plan-task', taskId: t.id, date: tomorrow, today: tomorrow })
  assert.deepEqual(shape(nodesOf(h.page(dayId(tomorrow)))).slice(0, 4), ['heading2:Start of the day', 'task:Book the flights', 'bulletListItem:Mood: tired', 'paragraph:One start'])
})

test('bring: the built-in day is unchanged: a line from Notes goes under Notes', () => {
  const h = harness()
  h.day(today)
  h.save(dayId(today), d => under(d, 'Notes', bullet('n1', text('Mood: tired'))))
  h.day(tomorrow)
  const r = h.run({ type: 'bring-line', date: tomorrow, sourcePageId: dayId(today), sourceBlockId: 'n1' })
  assert.equal(r.receipt.message, 'Brought to Notes')
  const after = shape(nodesOf(h.page(dayId(tomorrow))))
  assert.equal(after[after.indexOf('heading2:Notes') + 1], 'bulletListItem:Mood: tired')
})
