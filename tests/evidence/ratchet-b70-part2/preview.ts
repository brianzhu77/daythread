import assert from 'node:assert/strict'
import { harness, heading, todo, bullet } from '../../v2-helpers.ts'
import { pageNodes } from '../../../src/domain/editor-document.ts'

for (const row of [todo('only-task', '', 'reference', ''), bullet('only-bullet')]) {
  const h = harness()
  h.run({ type: 'create-document', title: 'Reading', body: '', pageId: 'reading' })
  h.run({ type: 'create-template', title: 'Minimal', pageId: 'template' })
  h.save('template', () => [row])
  h.run({ type: 'set-template-target', pageId: 'template', target: 'reading' })
  h.run({
    type: 'make-link-pages',
    parentPageId: 'reading',
    items: [{ url: 'https://example.com/fixture', pageId: 'link' }],
  })
  const before = structuredClone(pageNodes(h.page('link')))
  h.run({
    type: 'apply-link-preview',
    pageId: 'link',
    url: 'https://example.com/fixture',
    title: 'Preview',
    description: 'Excerpt',
  })
  const after = pageNodes(h.page('link'))
  console.log(JSON.stringify({ templateRowType: row.type, before, after }))
  assert.deepEqual(after.slice(1), before, 'preview must preserve the template row below the quote')
}
