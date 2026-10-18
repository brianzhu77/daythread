import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTags, tagIndex } from '../src/domain/tags.ts'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import type { Action, Workspace } from '../src/domain/types.ts'
function run(ws: Workspace, action: Action) { return applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }).workspace }
const tags = (text: string) => findTags(text).map(m => m.tag)

test('a tag is # and the characters after it, up to whitespace or the end of the block', () => {
  assert.deepEqual(tags('Lunch with Sam #friends'), ['friends'])
  assert.deepEqual(tags('#work standup notes'), ['work'])
  assert.deepEqual(tags('今天 #工作 很忙'), ['工作'])
  // No exclusions beyond the rule (Brian: any run of characters), so trailing text and punctuation belong to the tag.
  assert.deepEqual(tags('今天 #工作很忙'), ['工作很忙'])
  assert.deepEqual(tags('done #work.'), ['work.'])
  assert.deepEqual(tags('#1 priority'), ['1'])
  assert.deepEqual(tags('line one #a\nline two #b'), ['a', 'b'])
})

test('a # right after other text still starts a tag, and full-width ＃ counts', () => {
  assert.deepEqual(tags('今天#工作'), ['工作'])
  assert.deepEqual(tags('读书＃阅读 笔记'), ['阅读'])
  assert.deepEqual(tags('mixed＃Work and #work'), ['Work', 'work'])
})

test('a bare # is not a tag: heading shorthand, C#, and a lone mark', () => {
  assert.deepEqual(tags('# Heading'), [])
  assert.deepEqual(tags('learning C# today'), [])
  assert.deepEqual(tags('#'), [])
  assert.deepEqual(tags('# # #'), [])
})

test('only whitespace ends a tag, so later marks and punctuation belong to it', () => {
  assert.deepEqual(tags('#工作#生活'), ['工作#生活'])
  assert.deepEqual(tags('#话题#'), ['话题#'])
  assert.deepEqual(tags('##deep'), ['#deep'])
  assert.deepEqual(tags('#工作，今天很忙。'), ['工作，今天很忙。'])
  assert.deepEqual(tags('#a #b'), ['a', 'b'])
  assert.deepEqual(tags('C#开发'), ['开发'])
})

test('the # in a link is not a tag', () => {
  assert.deepEqual(tags('see https://example.com/docs#setup'), [])
  assert.deepEqual(tags('example.com/soup#recipe try it'), [])
  assert.deepEqual(tags('www.example.com#top'), [])
  assert.deepEqual(tags('example.com#top'), [])
  assert.deepEqual(tags('https://x.dev/a #reading'), ['reading'])
  assert.deepEqual(tags('v1.2#note'), ['note'])
  assert.deepEqual(tags('1.5#x'), ['x'])
})

test('match positions cover the mark and the tag, for the editor tint', () => {
  assert.deepEqual(findTags('ab #cd ef'), [{ tag: 'cd', start: 3, end: 6 }])
  assert.deepEqual(findTags('今天#工作'), [{ tag: '工作', start: 2, end: 5 }])
})

test('tagIndex reads paragraph and task blocks, counts a block once per tag, and groups case-insensitively under the latest form', () => {
  let ws = run(createEmptyWorkspace(), { type: 'ensure-day', date: '2026-10-16' })
  ws = run(ws, { type: 'ensure-day', date: '2026-10-17' })
  const day = (date: string) => ws.pages.find(p => p.date === date)!
  const notes = (date: string) => day(date).sections.find(s => s.kind === 'notes')!.id
  ws = run(ws, { type: 'add-text', pageId: day('2026-10-16').id, sectionId: notes('2026-10-16'), text: 'Standup #work #work' })
  ws = run(ws, { type: 'add-text', pageId: day('2026-10-17').id, sectionId: notes('2026-10-17'), text: 'Lunch #Work #friends' })
  ws = run(ws, { type: 'add-task', pageId: day('2026-10-17').id, sectionId: day('2026-10-17').sections[0]!.id, title: 'Fix export bug #work' })
  const index = tagIndex(ws)
  assert.deepEqual(index.map(t => [t.key, t.occurrences.length]), [['work', 3], ['friends', 1]])
  assert.deepEqual([index[0]!.occurrences[0]!.sectionTitle, Boolean(index[0]!.occurrences[0]!.taskId)], [day('2026-10-17').sections[0]!.title, true])
  // Newest day first, page order within a day; the task row counts like any other block.
  assert.deepEqual(index[0]!.occurrences.map(o => [o.date, o.text]), [['2026-10-17', 'Fix export bug #work'], ['2026-10-17', 'Lunch #Work #friends'], ['2026-10-16', 'Standup #work #work']])
  // Shown as last written on the newest page: "#Work" in Notes sits below the "#work" task row.
  assert.equal(index[0]!.tag, 'Work')
  // Equal counts: the tag used most recently comes first.
  ws = run(ws, { type: 'add-text', pageId: day('2026-10-16').id, sectionId: notes('2026-10-16'), text: 'Old #archive' })
  assert.deepEqual(tagIndex(ws).slice(1).map(t => t.key), ['friends', 'archive'])
  // Section titles are not read.
  ws = run(ws, { type: 'rename-section', pageId: day('2026-10-16').id, sectionId: notes('2026-10-16'), title: 'Notes #heading' })
  assert.equal(tagIndex(ws).some(t => t.key === 'heading'), false)
})
