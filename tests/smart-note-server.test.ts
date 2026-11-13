import { test } from 'node:test'
import assert from 'node:assert/strict'
import { today, text, para } from './v2-helpers.ts'
import { createEmptyWorkspace } from '../src/domain/workspace.ts'
import type { EditorNode } from '../src/domain/editor-document.ts'
import type { SmartInput, SmartRange, SmartResult } from '../src/domain/smart-note.ts'
import type { Page, Workspace } from '../src/domain/types.ts'
import { ModelError, modelBaseUrl, type callStructured } from '../src/server/model/openrouter.ts'
import { readAnswer, runSmartNote, smartMessages, smartNoteSchema } from '../src/server/model/smart-note.ts'

const page = (id: string, doc: EditorNode[], extra: Partial<Page> = {}): Page =>
  ({ id, type: 'document', date: null, title: id, document: JSON.stringify(doc), ...extra })
const world = (pages: Page[]): Workspace => ({ ...createEmptyWorkspace(), pages })
const range: SmartRange = { where: { kind: 'workspace' }, days: 0 }
const config = { apiKey: 'k', model: 'm' }
const input: SmartInput = {
  pages: [
    { pageId: 'page-secret-1', label: 'Trip plan', lines: [{ alias: 'L1', pageId: 'page-secret-1', blockId: 'block-secret-1', text: 'Book the train' }, { alias: 'L2', pageId: 'page-secret-1', blockId: 'block-secret-2', text: 'Pack light' }] },
    { pageId: 'page-secret-2', label: '2026-11-10 (Tue)', lines: [{ alias: 'L3', pageId: 'page-secret-2', blockId: 'block-secret-3', text: 'Called the bank' }] },
  ],
  key: 'k', pagesRead: 2, pagesLeftOut: 0, from: '2026-11-10', to: '2026-11-10',
}
const previous: SmartResult = { blocks: [{ kind: 'paragraph', text: 'Earlier statement', sources: [{ pageId: 'page-secret-1', blockId: 'block-secret-1' }] }], at: 'x', inputKey: 'old', pagesRead: 1, pagesLeftOut: 0, from: null, to: null }
const fake = (value: unknown, spy?: { calls: number }): typeof callStructured =>
  (async () => { if (spy) spy.calls++; return { value, raw: '', generationId: null, costUsd: 0.01, promptTokens: 1, completionTokens: 1 } }) as typeof callStructured

test('messages: the system message forbids anything not in the notes and asks for the prompt\'s language; the user message holds each page label and each line as "L3 text"', () => {
  const [system, user] = smartMessages(input, 'What did I do?', null, today)
  assert.equal(system!.role, 'system')
  assert.match(system!.content, /nothing else/i)
  assert.match(system!.content, /language of the prompt/i)
  assert.equal(user!.role, 'user')
  assert.match(user!.content, new RegExp(`Today is ${today}\\.`))
  assert.match(user!.content, /What did I do\?/)
  for (const part of ['Trip plan', '2026-11-10 (Tue)', 'L1 Book the train', 'L2 Pack light', 'L3 Called the bank']) assert.ok(user!.content.includes(part), part)
})

test('messages: a previous result is included, with the instruction to keep statements that still hold', () => {
  const [system, user] = smartMessages(input, 'p', previous, today)
  assert.match(system!.content, /keep each statement that still holds/i)
  assert.ok(user!.content.includes('Earlier statement'))
  assert.ok(!smartMessages(input, 'p', null, today)[1]!.content.includes('Earlier statement'))
})

test('messages: no page id, block id or account detail appears, only aliases', () => {
  const all = smartMessages(input, 'p', previous, today).map(m => m.content).join('\n')
  assert.ok(!all.includes('page-secret') && !all.includes('block-secret'))
})

test('answer: an alias that was not sent is dropped; a known one becomes { pageId, blockId }', () => {
  const [b] = readAnswer({ blocks: [{ kind: 'paragraph', text: 'x', sources: ['L2', 'L99', 'page-secret-1'] }] }, input)
  assert.deepEqual(b!.sources, [{ pageId: 'page-secret-1', blockId: 'block-secret-2' }])
})

test('answer: an empty text block is dropped; text is cut at 600; sources at 8; blocks at 60; an unknown kind becomes paragraph', () => {
  const blocks = readAnswer({ blocks: [{ kind: 'heading', text: '   ', sources: ['L1'] }, { kind: 'poem', text: 'a'.repeat(700), sources: Array(12).fill('L1') }] }, input)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]!.kind, 'paragraph')
  assert.equal(blocks[0]!.text.length, 600)
  assert.equal(blocks[0]!.sources.length, 8)
  const many = readAnswer({ blocks: Array.from({ length: 80 }, (_, i) => ({ kind: 'bullet', text: `t${i}`, sources: [] })) }, input)
  assert.equal(many.length, 60)
  assert.equal(many[59]!.text, 't59')
})

test('answer: not an object, or blocks not a list, gives []', () => {
  for (const raw of [null, 'text', 4, [], {}, { blocks: 'x' }, { blocks: { a: 1 } }]) assert.deepEqual(readAnswer(raw, input), [])
})

test('run: an empty range makes no call and fails with empty-range', async () => {
  const spy = { calls: 0 }
  const run = await runSmartNote(world([]), { prompt: 'p', range, previous: null }, config, today, 'now', fake({}, spy))
  assert.equal(spy.calls, 0)
  assert.equal(run.status, 'failed')
  assert.equal(run.status === 'failed' && run.error, 'empty-range')
})

test('run: a ready result carries inputKey, pagesRead, pagesLeftOut, from, to from the input and `at` as given', async () => {
  const ws = world([page('doc', [para('a', text('Book the train'))])])
  let sent: { role: string; content: string }[] = []
  const call = (async (_c: unknown, messages: { role: string; content: string }[], schema: unknown) => {
    sent = messages
    assert.equal(schema, smartNoteSchema)
    return { value: { blocks: [{ kind: 'paragraph', text: 'You will book the train.', sources: ['L1'] }] }, raw: '', generationId: null, costUsd: 0.02, promptTokens: 1, completionTokens: 1 }
  }) as typeof callStructured
  const run = await runSmartNote(ws, { prompt: 'p', range, previous: null }, config, today, '2026-11-12T10:00:00.000Z', call)
  assert.ok(sent.length === 2)
  assert.equal(run.status, 'ready')
  if (run.status !== 'ready') return
  assert.equal(run.costUsd, 0.02)
  assert.equal(run.result.at, '2026-11-12T10:00:00.000Z')
  assert.equal(run.result.pagesRead, 1)
  assert.equal(run.result.pagesLeftOut, 0)
  assert.equal(run.result.inputKey.length > 0, true)
  assert.deepEqual(run.result.blocks[0]!.sources, [{ pageId: 'doc', blockId: 'a' }])
  assert.ok('from' in run.result && 'to' in run.result)
})

test('run: a ModelError of kind timeout gives { status: "failed", error: "timeout" }; an answer with no usable block gives invalid-output', async () => {
  const ws = world([page('doc', [para('a', text('Book the train'))])])
  const spec = { prompt: 'p', range, previous: null }
  const timeout = (async () => { throw new ModelError('slow', 'timeout') }) as typeof callStructured
  const a = await runSmartNote(ws, spec, config, today, 'now', timeout)
  assert.equal(a.status === 'failed' && a.error, 'timeout')
  const b = await runSmartNote(ws, spec, config, today, 'now', fake({ blocks: [{ kind: 'paragraph', text: '', sources: [] }] }))
  assert.equal(b.status === 'failed' && b.error, 'invalid-output')
})

test('model address: only a loopback http address replaces the default, so the key never goes to another host', () => {
  const fallback = 'https://openrouter.ai/api/v1'
  assert.equal(modelBaseUrl({}), fallback, 'unset')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: '' }), fallback, 'empty')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: '   ' }), fallback, 'whitespace')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: 'http://127.0.0.1:3514' }), 'http://127.0.0.1:3514')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: ' http://localhost:3514 ' }), 'http://localhost:3514')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: 'http://[::1]:3514' }), 'http://[::1]:3514')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: 'https://example.com/v1' }), fallback, 'another host')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: 'http://127.0.0.1.example.com:3514' }), fallback, 'a host that only starts like loopback')
  assert.equal(modelBaseUrl({ OPENROUTER_BASE_URL: 'not a url' }), fallback, 'malformed')
})
