import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDraft } from '../src/domain/draft-merge.ts'
import { inlineText, type EditorNode } from '../src/domain/editor-document.ts'

// B23 (docs/design/save-conflict-states.md §2): Load latest puts his changes below their lines in the latest page.
const t = (text: string) => (text ? [{ type: 'text', text, styles: {} }] : [])
const line = (id: string, text: string, type = 'bulletListItem', children: EditorNode[] = []): EditorNode => ({ id, type, props: {}, content: t(text), children })
const task = (id: string, text: string, taskId = `editor-task:${id}`): EditorNode => ({ id, type: 'task', props: { taskId, role: 'plan', planDate: '' }, content: t(text), children: [] })
const texts = (nodes: EditorNode[]): string[] => nodes.flatMap(n => [`${n.type === 'task' ? '[] ' : ''}${inlineText(n.content)}`, ...texts(n.children ?? []).map(x => `  ${x}`)])
let n = 0
const ids = () => `new-${++n}`
const merge = (base: EditorNode[], draft: EditorNode[], latest: EditorNode[], known: string[] = []) => { n = 0; return mergeDraft(base, draft, latest, new Set(known), ids) }

const base = [line('1', 'one'), line('2', 'two'), line('3', 'three'), line('5', 'five')]

test('his changed line goes right below it; a line only the other side changed is left alone', () => {
  const draft = [line('1', 'one'), line('2', 'two (mine)'), line('3', 'three'), line('5', 'five')] // his draft still has the old "five"
  const latest = [line('1', 'one'), line('2', 'two'), line('3', 'three'), line('5', 'five (theirs)')]
  const { document, inserted } = merge(base, draft, latest)
  assert.deepEqual(texts(document), ['one', 'two', 'two (mine)', 'three', 'five (theirs)'])
  assert.deepEqual(inserted, ['new-1'])
})

test('an added line goes after the line it followed; after a deleted neighbour, at the end', () => {
  const draft = [line('1', 'one'), line('a', 'added after one'), line('3', 'three'), line('b', 'added after three'), line('5', 'five')]
  const latest = [line('1', 'one'), line('2', 'two'), line('5', 'five')] // the other side deleted "three"
  const { document } = merge(base, draft, latest)
  assert.deepEqual(texts(document), ['one', 'added after one', 'two', 'five', 'added after three'])
})

test('two added lines in a row keep their order', () => {
  const draft = [line('1', 'one'), line('a', 'first new'), line('b', 'second new'), line('2', 'two'), line('3', 'three'), line('5', 'five')]
  const { document } = merge(base, draft, structuredClone(base))
  assert.deepEqual(texts(document), ['one', 'first new', 'second new', 'two', 'three', 'five'])
})

test('a line he edited that the other side deleted lands at the end; his deletions are not repeated', () => {
  const draft = [line('1', 'one'), line('3', 'three (mine)'), line('5', 'five')] // he deleted "two"
  const latest = [line('1', 'one'), line('2', 'two'), line('5', 'five')] // they deleted "three"
  assert.deepEqual(texts(merge(base, draft, latest).document), ['one', 'two', 'five', 'three (mine)'])
})

test('the same edit on both sides comes back once; no changes at all inserts nothing', () => {
  const same = [line('1', 'one'), line('2', 'two!'), line('3', 'three'), line('5', 'five')]
  assert.deepEqual(merge(base, same, structuredClone(same)).inserted, [])
  assert.deepEqual(merge(base, structuredClone(base), [line('1', 'changed elsewhere')]).inserted, [])
})

test('tasks: a new one stays a task once, an existing one is not repeated, a renamed one comes back as a bullet', () => {
  const b = [task('t1', 'existing', 'task-1'), task('t2', 'to rename', 'task-2'), line('1', 'one')]
  const draft = [task('t1', 'existing', 'task-1'), task('t2', 'renamed by me', 'task-2'), line('1', 'one'), task('t3', 'brand new')]
  const latest = [task('t1', 'existing', 'task-1'), task('t2', 'to rename', 'task-2'), line('1', 'one (theirs)')]
  const { document } = merge(b, draft, latest, ['task-1', 'task-2'])
  assert.deepEqual(texts(document), ['[] existing', '[] to rename', 'renamed by me', 'one (theirs)', '[] brand new'])
  const fresh = document.find(x => inlineText(x.content) === 'brand new')!
  assert.equal(fresh.props?.taskId, `editor-task:${fresh.id}`)
  assert.equal(document.find(x => inlineText(x.content) === 'renamed by me')!.type, 'bulletListItem')
})

test('a task he typed into an empty template row goes in that row, still a task', () => {
  const b = [{ id: 'h', type: 'heading', props: { level: 2 }, content: t('TODO - Top 3'), children: [] }, task('row', '')]
  const draft = [b[0]!, task('row', 'plan the trip')]
  const latest = structuredClone(b).concat([line('x', 'theirs')])
  const { document, inserted } = merge(b, draft, latest)
  assert.deepEqual(texts(document), ['TODO - Top 3', '[] plan the trip', 'theirs'])
  assert.deepEqual(inserted, ['row'])
  assert.equal(document[1]!.props?.taskId, 'editor-task:row')
})

test('a changed heading comes back as a bullet, so no new section appears', () => {
  const b = [{ id: 'h', type: 'heading', props: { level: 2 }, content: t('Notes'), children: [] }]
  const draft = [{ ...b[0]!, content: t('Notes and ideas') }]
  const { document } = merge(b, draft, [{ ...b[0]!, content: t('Notes (theirs)') }])
  assert.deepEqual(document.map(x => x.type), ['heading', 'bulletListItem'])
})

test('nested lines: his change to a child goes below that child; links keep their target with a new identity', () => {
  const ref = (refId: string) => ({ type: 'pageRef', props: { pageId: 'P', refId, newTitle: '' } })
  const b = [line('p', 'parent', 'bulletListItem', [{ id: 'c', type: 'bulletListItem', props: {}, content: [...t('see '), ref('r1')], children: [] }])]
  const draft = [line('p', 'parent', 'bulletListItem', [{ id: 'c', type: 'bulletListItem', props: {}, content: [...t('see also '), ref('r1')], children: [] }])]
  const latest = [line('p', 'parent (theirs)', 'bulletListItem', structuredClone(b[0]!.children))]
  const { document } = merge(b, draft, latest)
  assert.deepEqual(texts(document), ['parent (theirs)', '  see ', '  see also '])
  const copied = (document[0]!.children![1]!.content as { type?: string; props?: { refId?: string; pageId?: string } }[]).find(c => c.type === 'pageRef')!
  assert.equal(copied.props?.pageId, 'P')
  assert.notEqual(copied.props?.refId, 'r1')
})

test('the latest page is not changed in place', () => {
  const latest = [line('1', 'one'), line('2', 'two')]
  const before = JSON.stringify(latest)
  merge(base, [line('1', 'one'), line('2', 'two (mine)')], latest)
  assert.equal(JSON.stringify(latest), before)
})

test('a line holding only a [[ link is not empty: his changed link goes below, the latest link stays (Ratchet #97)', () => {
  const link = (pageId: string) => ({ id: 'l', type: 'bulletListItem', props: {}, content: [{ type: 'pageRef', props: { pageId, refId: `r-${pageId}`, newTitle: '' } }], children: [] }) as EditorNode
  const { document } = merge([link('A')], [link('B')], [link('C')])
  const targets = document.map(n => (n.content as { props: { pageId: string } }[])[0]!.props.pageId)
  assert.deepEqual(targets, ['C', 'B'])
})

test('checklist tick: only his tick changed → in place; both sides changed → his ticked line below (Jazz, Ratchet #97)', () => {
  const item = (id: string, text: string, checked: boolean): EditorNode => ({ id, type: 'sourceChecklist', props: { checked }, content: t(text), children: [] })
  const tickOnly = merge([item('c', 'milk', false)], [item('c', 'milk', true)], [item('c', 'milk', false), line('x', 'theirs')])
  assert.deepEqual(tickOnly.document.map(n => [inlineText(n.content), n.props?.checked ?? null]), [['milk', true], ['theirs', null]])
  assert.deepEqual(tickOnly.inserted, ['c'])
  const both = merge([item('c', 'milk', false)], [item('c', 'milk', true)], [item('c', 'oat milk', false)])
  assert.deepEqual(both.document.map(n => [n.type, inlineText(n.content), n.props?.checked]), [['sourceChecklist', 'oat milk', false], ['sourceChecklist', 'milk', true]])
})
