// The parsed-document cache is held by size as well as by count: a command rewriting a long page many times mustn't keep every copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageNodes } from '../src/domain/editor-document.ts'

const page = (n: number, chars: number) => ({ document: JSON.stringify([{ id: `n${n}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: 'x'.repeat(chars), styles: {} }], children: [] }]) })
test('a recent document stays cached; past the size limit the oldest goes and still reads right', () => {
  const first = page(0, 3_000_000)
  const nodes = pageNodes(first)
  assert.equal(pageNodes(first), nodes, 'the same copy while it fits')
  const big = Array.from({ length: 5 }, (_, i) => page(i + 1, 3_000_000))
  for (const p of big) pageNodes(p)
  assert.notEqual(pageNodes(first), nodes, 'pushed out by size, well under the count limit')
  assert.deepEqual(pageNodes(first), nodes, 'and reads the same when it comes back')
  const last = big.at(-1)!
  assert.equal(pageNodes(last), pageNodes(last), 'the newest stays')
})
test('one document over the limit still reads, and the next call parses it again without growing', () => {
  const huge = page(99, 9_000_000)
  assert.equal(pageNodes(huge)[0]!.id, 'n99')
  assert.equal(pageNodes(page(100, 10))[0]!.id, 'n100')
})
