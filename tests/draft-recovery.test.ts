import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { recoveredDocument } from '../src/components/draft-recovery.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B3 export (Bumblebee option 1, Lead ff82e7c8): a kept draft is saved the way opening its page would.
const day = '2026-10-23'
const t = (text: string) => [{ type: 'text', text, styles: {} }]
function setup() {
  let ws: Workspace = createEmptyWorkspace(), n = 0
  const run = (action: Action) => { ws = applyCommand(ws, { operationId: `r-${++n}`, expectedRevision: ws.revision, action }).workspace; return ws }
  run({ type: 'create-document', title: 'Notes', body: '', pageId: 'doc' })
  const page = () => ws.pages.find(p => p.id === 'doc')!
  const save = (nodes: EditorNode[]) => run({ type: 'save-editor', pageId: 'doc', expectedContent: pageContentKey(page()), document: JSON.stringify(nodes) })
  save([{ id: 'a', type: 'paragraph', props: {}, content: t('first'), children: [] }])
  return { page, save, get ws() { return ws } }
}
const texts = (nodes: EditorNode[]) => nodes.map(n => inlineText(n.content))

test('this tab\'s draft on an unchanged page is saved as it is: an edited line stays one line', () => {
  const s = setup(), base = pageContentKey(s.page())
  const draft = [{ id: 'a', type: 'paragraph', props: {}, content: t('first, edited'), children: [] }, { id: 'b', type: 'paragraph', props: {}, content: t('new line'), children: [] }]
  assert.deepEqual(texts(recoveredDocument(s.ws, s.page(), { base, document: JSON.stringify(draft), seen: 0 }, true, day)), ['first, edited', 'new line'])
})

test('a draft whose page changed since, or a gone tab\'s draft, is merged into the latest page (nothing lost, nothing undone)', () => {
  const s = setup(), base = pageContentKey(s.page())
  const draft = [...editorSeed(s.page(), s.ws), { id: 'b', type: 'paragraph', props: {}, content: t('typed offline'), children: [] }] as EditorNode[]
  s.save([{ id: 'a', type: 'paragraph', props: {}, content: t('first'), children: [] }, { id: 'c', type: 'paragraph', props: {}, content: t('from the phone'), children: [] }])
  for (const own of [true, false]) {
    const out = texts(recoveredDocument(s.ws, s.page(), { base, document: JSON.stringify(draft), seen: 0 }, own, day))
    assert.ok(out.includes('typed offline') && out.includes('from the phone') && out.filter(x => x === 'first').length === 1, JSON.stringify(out))
  }
})
