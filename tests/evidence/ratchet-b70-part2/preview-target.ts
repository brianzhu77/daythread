import assert from 'node:assert/strict'
import { harness, heading } from '../../v2-helpers.ts'
import { inlineText, pageNodes } from '../../../src/domain/editor-document.ts'
const h = harness()
h.run({ type: 'create-document', pageId: 'reading', title: 'Reading', body: '' })
h.run({ type: 'create-template', pageId: 'parent-template', title: 'Article' })
h.save('parent-template', () => [heading('summary', 'Summary')])
h.run({ type: 'set-template-target', pageId: 'parent-template', target: 'reading' })
h.run({
  type: 'make-link-pages',
  parentPageId: 'reading',
  items: [{ pageId: 'link', url: 'https://example.com/target' }],
})
h.run({ type: 'create-template', pageId: 'child-template', title: 'Child' })
h.run({ type: 'set-template-target', pageId: 'child-template', target: 'link' })
h.run({
  type: 'apply-link-preview',
  pageId: 'link',
  url: 'https://example.com/target',
  title: 'Preview title',
  description: 'Preview excerpt',
})
console.log(
  h.page('link').title,
  pageNodes(h.page('link')).map((n) => [n.type, inlineText(n.content)]),
)
assert.equal(
  h.page('link').title,
  'Preview title',
  'a default configuration is not a child page or body edit',
)
