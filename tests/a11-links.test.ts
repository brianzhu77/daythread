import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { lineLinkPath, parseLineClipboard, parseLineUrl } from '../src/domain/line-link.ts'
import { linkedFrom, recentPages } from '../src/domain/page-tree.ts'
import type { Action } from '../src/domain/types.ts'

// A11 §4 (the link as it travels) and §5 (Linked from counts a line link on its resolved page).
const origin = 'https://daythread.example'

test('URL: own origin with page and block (and task) only', () => {
  const target = { pageId: 'p-1', lineId: 'b-2', taskId: 't-3' }
  assert.equal(lineLinkPath(target), '/pages?page=p-1&block=b-2&task=t-3')
  assert.equal(lineLinkPath({ pageId: 'day:x', lineId: 'b' }), '/pages?page=day%3Ax&block=b')
  assert.deepEqual(parseLineUrl(`${origin}${lineLinkPath(target)}`, origin), target)
  assert.deepEqual(parseLineUrl(`  ${origin}/pages?page=p-1&block=b-2\n`, origin), { pageId: 'p-1', lineId: 'b-2' })
  for (const text of [
    `https://other.example/pages?page=p-1&block=b-2`, // another host
    `${origin}/pages?page=p-1`, // no block
    `${origin}/pages?page=p-1&block=b-2&view=trash`, // unknown param
    `${origin}/pages?page=p-1&block=b-2&block=b-3`, // repeated param
    `${origin}/day/2026-10-18?block=b-2`, // another path
    `${origin}/pages?page=p-1&block=b-2#x`, // a fragment
    `${origin}/pages?page=p 1&block=b-2`, // malformed
    `${origin}/pages?page=p-1&block=b-2 and more words`,
    'not a url',
  ]) assert.equal(parseLineUrl(text, origin), null, text)
})

test('clipboard type: exactly the line target with well-formed ids', () => {
  assert.deepEqual(parseLineClipboard('{"pageId":"p","lineId":"b"}'), { pageId: 'p', lineId: 'b' })
  assert.deepEqual(parseLineClipboard('{"pageId":"p","lineId":"b","taskId":"t"}'), { pageId: 'p', lineId: 'b', taskId: 't' })
  for (const raw of ['', 'nope', '{"pageId":"p"}', '{"pageId":"p","lineId":"<b>"}', '{"pageId":1,"lineId":"b"}', '{"pageId":"p","lineId":"b","taskId":7}'])
    assert.equal(parseLineClipboard(raw), null, raw)
})

function setup() {
  let state = createEmptyWorkspace(), n = 0
  const run = (action: Action) => { state = applyCommand(state, { operationId: `l-${++n}`, expectedRevision: state.revision, action }).workspace; return state }
  const page = (id: string) => state.pages.find(p => p.id === id || p.date === id)!
  const save = (id: string, edit: (nodes: EditorNode[]) => EditorNode[]) => { const p = page(id); return run({ type: 'save-editor', pageId: p.id, expectedContent: pageContentKey(p), document: JSON.stringify(edit(editorSeed(p, state))) }) }
  return { run, page, save, get state() { return state } }
}
const lineRef = (pageId: string, lineId: string, refId: string, taskId?: string) => ({ type: 'pageRef', props: { pageId, refId, newTitle: '', lineId, taskId: taskId ?? '' } })
const pageRef = (pageId: string, refId: string) => ({ type: 'pageRef', props: { pageId, refId, newTitle: '' } })
const para = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'paragraph', content } as EditorNode)

test('Linked from: a line link counts on its page, once per linking page, with its own time', () => {
  const s = setup()
  s.run({ type: 'create-document', title: 'Target', body: '', pageId: 'T' })
  s.run({ type: 'create-document', title: 'Source', body: '', pageId: 'S' })
  s.save('T', nodes => [...nodes, para('line', { type: 'text', text: 'The line', styles: {} })])
  s.save('S', nodes => [...nodes, para('a', lineRef('T', 'line', 'r1')), para('b', pageRef('T', 'r2'), lineRef('T', 'line', 'r3'))])
  const from = linkedFrom(s.state, 'T')
  assert.deepEqual(from.map(e => e.page.id), ['S'], 'S once, with a page link and line links to T')
  const refs = s.page('S').sections.flatMap(x => x.blocks).flatMap(b => b.refs ?? [])
  assert.deepEqual(refs.map(r => [r.refId, r.lineId ?? null]), [['r1', 'line'], ['r2', null], ['r3', 'line']])
  assert.ok(refs.every(r => r.at === s.state.revision), "each link keeps its own save's time")
  assert.equal(recentPages(s.state, 'S')[0]!.id, 'T')
})

test('Linked from: a linked task moves with its task; a plain line stays on its last page', () => {
  const s = setup()
  s.run({ type: 'ensure-day', date: '2026-10-16' }); s.run({ type: 'ensure-day', date: '2026-10-17' })
  const today = s.page('2026-10-16')
  s.run({ type: 'add-task', pageId: today.id, sectionId: today.sections.find(x => x.kind === 'other')!.id, title: 'Linked task', plannedOn: '2026-10-16' })
  const t = s.state.tasks[0]!, row = s.page('2026-10-16').sections.flatMap(x => x.blocks).find(b => b.taskId === t.id)!
  s.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'N' })
  s.save('N', nodes => [...nodes, para('a', lineRef(today.id, row.id, 'r1', t.id))])
  assert.deepEqual(linkedFrom(s.state, today.id).map(e => e.page.id), ['N'])
  s.run({ type: 'plan-task', taskId: t.id, date: '2026-10-17', section: 'other', from: '2026-10-16', today: '2026-10-16' })
  assert.deepEqual(linkedFrom(s.state, today.id).map(e => e.page.id), [], 'the old day loses it')
  assert.deepEqual(linkedFrom(s.state, s.page('2026-10-17').id).map(e => e.page.id), ['N'], 'the new day gains it')
})

test('a new line link may point at a line on a trashed page; a new page link still may not', () => {
  const s = setup()
  s.run({ type: 'create-document', title: 'Binned', body: '', pageId: 'B' })
  s.run({ type: 'create-document', title: 'Source', body: '', pageId: 'S' })
  s.save('B', nodes => [...nodes, para('kept', { type: 'text', text: 'Kept line', styles: {} })])
  s.run({ type: 'delete-page', pageId: 'B', at: '2026-10-16T10:00:00.000Z' })
  s.save('S', nodes => [...nodes, para('a', lineRef('B', 'kept', 'r1'))])
  assert.equal(s.page('S').sections.flatMap(x => x.blocks).find(b => b.id === 'a')?.refs?.[0]?.lineId, 'kept')
  assert.throws(() => s.save('S', nodes => [...nodes, para('b', pageRef('B', 'r2'))]), /restore it first/)
})
