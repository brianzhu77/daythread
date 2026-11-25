// A command sent the way row actions send (repeating-to-dos.md §6): through every open editor whose page it rewrites,
// flush → hold → command → apply. Whatever an editor does, the command goes exactly once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerEditorHold, sendHolding, trackLeaveSave, type EditorHold } from '../src/components/editor-flush.ts'

const receipt = { operationId: 'op', message: 'Done' }

test('with no page to hold, the command goes at once, as it always did', async () => {
  let sent = 0
  const out = sendHolding([], async () => { sent++; return receipt })
  assert.equal(sent, 1, 'sent in the same turn: a tick with no repeat is unchanged')
  assert.equal(await out, receipt)
})

test('a page with no editor open is not held', async () => {
  let sent = 0
  assert.equal(await sendHolding(['nobody'], async () => { sent++; return receipt }), receipt)
  assert.equal(sent, 1)
})

test('each open editor saves and holds before the command, and shows its page after, outermost first; a page named twice is held once', async () => {
  const log: string[] = []
  const editor = (name: string): EditorHold => async send => { log.push(`${name}: saved, held`); const r = await send(); log.push(`${name}: shows its page, lets go`); return r }
  const offA = registerEditorHold('a', editor('a')), offB = registerEditorHold('b', editor('b'))
  try {
    assert.equal(await sendHolding(['a', 'b', 'a', 'c'], async () => { log.push('sent'); return receipt }), receipt)
    assert.deepEqual(log, ['a: saved, held', 'b: saved, held', 'sent', 'b: shows its page, lets go', 'a: shows its page, lets go'])
  } finally { offA(); offB() }
})

test('a command is never lost to a hold: an editor that sends nothing, or throws, still leaves it sent once', async () => {
  const holds: Array<[string, EditorHold]> = [
    ['returns without sending', async () => null],
    ['throws before sending', async () => { throw new Error('editor gone') }],
    ['throws after sending', async send => { await send(); throw new Error('could not show the page') }],
  ]
  for (const [name, hold] of holds) {
    let sent = 0
    const off = registerEditorHold('a', hold)
    try {
      assert.equal(await sendHolding(['a'], async () => { sent++; return receipt }), receipt, name)
      assert.equal(sent, 1, name)
    } finally { off() }
  }
})

test("a closing editor's save lands before the command is sent", async () => {
  let land!: () => void, sent = false
  trackLeaveSave(new Promise<void>(resolve => { land = resolve }))
  const out = sendHolding(['a'], async () => { sent = true; return receipt })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(sent, false)
  land()
  assert.equal(await out, receipt)
  assert.equal(sent, true)
})

test('an editor that has closed is no longer held, and closing an old one leaves the new one registered', async () => {
  let held = 0
  const hold: EditorHold = async send => { held++; return send() }
  const first = registerEditorHold('a', hold), second = registerEditorHold('a', async send => { held += 10; return send() })
  first()
  await sendHolding(['a'], async () => receipt)
  assert.equal(held, 10)
  second()
  await sendHolding(['a'], async () => receipt)
  assert.equal(held, 10)
})
