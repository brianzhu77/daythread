// A button block before anything can make one (docs/design/buttons.md §5, §8): it's kept and copied whole, and never read as an empty line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDraft } from '../src/domain/draft-merge.ts'
import { flatNodes, isEmptyLine, type EditorNode } from '../src/domain/editor-document.ts'
import { blocksMarkdown } from '../src/domain/export.ts'
import { createEmptyWorkspace } from '../src/domain/workspace.ts'
import { harness, nodesOf, tomorrow } from './v2-helpers.ts'

const button = (id = 'b1'): EditorNode => ({ id, type: 'button', props: { label: 'Log a run', steps: '[{"kind":"addRow"}]' }, children: [] })
const line = (id: string, text: string): EditorNode => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })

test('a button is not an empty line, so a trailing one is never tidied away or filled', () => {
  assert.equal(isEmptyLine(button()), false)
})

test('Load latest keeps a button whole, and once', () => {
  const base = [line('a', 'One'), button()]
  const kept = mergeDraft(base, [line('a', 'One typed'), button()], base, new Set())
  assert.equal(flatNodes(kept.document).filter(n => n.type === 'button' && n.props?.steps === '[{"kind":"addRow"}]').length, 1, 'kept whole, once')
})

test('export writes its label, so a page never loses a line on the way out', () => {
  const ws = createEmptyWorkspace()
  assert.equal(blocksMarkdown([button()], ws, new Map()), 'Log a run')
  assert.equal(blocksMarkdown([{ ...button(), props: { label: '', steps: '' } }], ws, new Map()), '')
})

test('a day template copies a button, with its own id and its steps', () => {
  const h = harness()
  h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  h.save('tpl', () => [line('l1', 'Plan'), button()])
  const copied = nodesOf(h.day(tomorrow)).find(n => n.type === 'button')!
  assert.equal(copied.props?.label, 'Log a run')
  assert.equal(copied.props?.steps, '[{"kind":"addRow"}]')
  assert.notEqual(copied.id, 'b1')
})
