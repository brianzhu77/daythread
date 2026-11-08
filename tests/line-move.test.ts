// Moving lines on a phone (line-drag.ts, line-move.ts): what's held lands before or after its target as its siblings, at any depth.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveInTree } from '../src/domain/line-move.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'

const n = (id: string, children: EditorNode[] = []): EditorNode => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text: id, styles: {} }], children })
const ids = (doc: readonly EditorNode[] | null): string => (doc ?? []).map(x => (x.children?.length ? `${x.id}(${ids(x.children)})` : x.id)).join(' ')
const doc = [n('a'), n('b', [n('b1'), n('b2')]), n('c'), n('d')]

test('a line lands where it was let go, before or after, not at the end', () => {
  assert.equal(ids(moveInTree(doc, ['d'], { id: 'a', place: 'before' })), 'd a b(b1 b2) c')
  assert.equal(ids(moveInTree(doc, ['a'], { id: 'c', place: 'after' })), 'b(b1 b2) c a d')
  assert.equal(ids(moveInTree(doc, ['a'], { id: 'c', place: 'before' })), 'b(b1 b2) a c d')
})

test('a line moves with what is nested under it, and into or out of another line', () => {
  assert.equal(ids(moveInTree(doc, ['b'], { id: 'd', place: 'after' })), 'a c d b(b1 b2)')
  assert.equal(ids(moveInTree(doc, ['c'], { id: 'b2', place: 'before' })), 'a b(b1 c b2) d')
  assert.equal(ids(moveInTree(doc, ['b1'], { id: 'a', place: 'after' })), 'a b1 b(b2) c d')
})

test('a section, held together, keeps its order', () => {
  assert.equal(ids(moveInTree(doc, ['b', 'c'], { id: 'a', place: 'before' })), 'b(b1 b2) c a d')
})

test('nothing moves onto itself or into what is held', () => {
  assert.equal(moveInTree(doc, ['b'], { id: 'b', place: 'after' }), null)
  assert.equal(moveInTree(doc, ['b'], { id: 'b1', place: 'before' }), null)
  assert.equal(moveInTree(doc, ['x'], { id: 'a', place: 'before' }), null)
  assert.equal(ids(doc), 'a b(b1 b2) c d', 'the document given is left as it was')
})
