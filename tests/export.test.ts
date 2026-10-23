import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createEmptyWorkspace } from '../src/domain/workspace.ts'
import { editorSeed, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import { exportFiles, fileNames, safeName } from '../src/domain/export.ts'
import type { Action, Workspace } from '../src/domain/types.ts'

// B3 export (Lead 1ce5dd8b, Jazz f10f8de5): Markdown per page plus workspace.json; names safe, links to final names.
const day = '2026-10-23'
const t = (text: string, styles = {}) => ({ type: 'text', text, styles })
function setup() {
  let ws: Workspace = createEmptyWorkspace(), n = 0
  const run = (action: Action) => { ws = applyCommand(ws, { operationId: `x-${++n}`, expectedRevision: ws.revision, action }).workspace; return ws }
  run({ type: 'ensure-day', date: day })
  const page = (id: string) => ws.pages.find(p => p.id === id)!
  const today = () => ws.pages.find(p => p.date === day)!
  const save = (p: { id: string }, edit: (nodes: EditorNode[]) => EditorNode[]) => { const q = page(p.id); run({ type: 'save-editor', pageId: q.id, expectedContent: pageContentKey(q), document: JSON.stringify(edit(editorSeed(q, ws))) }) }
  return { run, page, today, save, get ws() { return ws } }
}
const file = (files: { path: string; text: string }[], end: string) => files.find(f => f.path.endsWith(end))!

test('file names: unsafe characters replaced, CJK, full-width punctuation and emoji kept, a second title gets (2)', () => {
  assert.equal(safeName('a/b: c?'), 'a-b- c-')
  assert.equal(safeName('原生家庭创伤导致的讨好型人格如何解决？（是否强关联？）'), '原生家庭创伤导致的讨好型人格如何解决？（是否强关联？）')
  assert.equal(safeName('Plans 🌱 [draft] #1'), 'Plans 🌱 -draft- -1')
  assert.equal(safeName('  '), 'Untitled')
  assert.equal(safeName('CON'), 'CON-')
  const s = setup()
  s.run({ type: 'create-document', title: 'Reading', body: '', pageId: 'r1' })
  s.run({ type: 'create-document', title: 'reading', body: '', pageId: 'r2' })
  s.run({ type: 'create-document', title: day, body: '', pageId: 'r3' })
  const names = fileNames(s.ws)
  assert.equal(names.get('r1'), 'Reading')
  assert.equal(names.get('r2'), 'reading (2)')
  assert.equal(names.get(s.today().id), day, 'a day page is its date')
  assert.equal(names.get('r3'), `${day} (2)`)
})

test('a day page as Markdown: sections, to-dos done and open, nesting, styles, and [[links]] to final names', () => {
  const s = setup()
  s.run({ type: 'create-document', title: 'Reading', body: '', pageId: 'r1' })
  s.run({ type: 'create-document', title: 'Reading', body: '', pageId: 'r2' })
  const top = s.today().sections.find(x => x.kind === 'top3')!.id
  s.run({ type: 'add-task', pageId: s.today().id, sectionId: top, title: 'Parent', plannedOn: day })
  const parent = s.ws.tasks.at(-1)!
  s.run({ type: 'add-task', pageId: s.today().id, sectionId: top, title: 'Child', plannedOn: day })
  const child = s.ws.tasks.at(-1)!
  s.run({ type: 'task-status', taskId: child.id, status: 'done', today: day })
  s.save(s.today(), nodes => {
    const p = nodes.find(n => n.props?.taskId === parent.id)!, c = nodes.find(n => n.props?.taskId === child.id)!
    return [...nodes.filter(n => n !== c).map(n => n === p ? { ...n, children: [c] } : n),
      { id: 'note', type: 'paragraph', props: {}, content: [t('Read '), t('slowly', { bold: true }), t(' see '), { type: 'pageRef', props: { pageId: 'r2', refId: 'ref1', newTitle: '', lineId: '', taskId: '' } }], children: [{ id: 'sub', type: 'paragraph', props: {}, content: [t('a nested thought')], children: [] }] }] as EditorNode[]
  })
  const files = exportFiles(s.ws, new Date('2026-10-23T20:00:00Z'))
  const md = file(files, `days/${day}.md`).text
  assert.match(md, /^---\ndaythread-id: "day:2026-10-23"\ndate: 2026-10-23\n---\n\n# 2026-10-23\n/)
  assert.match(md, /## TODO - Top 3\n\n- \[ \] Parent\n\t- \[x\] Child/)
  assert.match(md, /- Read \*\*slowly\*\* see \[\[Reading \(2\)\]\]\n\t- a nested thought/)
  assert.ok(file(files, 'pages/Reading (2).md'), 'the link\'s target exists under that name')
})

test('workspace.json: format version, every fact, trash included; no receipts, Undo copy or editor bookkeeping', () => {
  const s = setup()
  s.run({ type: 'create-document', title: 'Gone', body: '', pageId: 'g' })
  s.run({ type: 'delete-page', pageId: 'g', at: '2026-10-23T18:00:00.000Z' })
  const files = exportFiles(s.ws, new Date('2026-10-24T02:00:00Z'))
  assert.equal(files[0]!.path, 'daythread-export-2026-10-23/README.md', 'named for the local day (Vancouver), not UTC')
  assert.ok(!files.some(f => f.path.endsWith('Gone.md')), 'a trashed page has no Markdown file')
  const json = JSON.parse(file(files, 'workspace.json').text)
  assert.equal(json.format, 'daythread-export')
  assert.equal(json.formatVersion, 1)
  for (const key of ['receipts', 'undo', 'ledger']) assert.equal(key in json, false, key)
  const gone = json.pages.find((p: { id: string }) => p.id === 'g')
  assert.ok(gone.trashedAt)
  assert.equal(gone.markdownFile, null)
  for (const key of ['editorJSON', 'editorSections', 'editorBlockMetadata', 'editorDeletions']) assert.equal(key in gone, false, key)
  assert.ok(Array.isArray(json.pages.find((p: { date: string }) => p.date === day).document))
  for (const key of ['tasks', 'placements', 'events', 'materials', 'captures']) assert.ok(Array.isArray(json[key]), key)
})

test('a link page carries its address: in the front matter and as its first line (Bumblebee f9d81e16)', () => {
  const s = setup()
  s.run({ type: 'create-document', title: 'github.com/mattpocock/skills/pull/1316', body: '', pageId: 'link' })
  const ws = structuredClone(s.ws); ws.pages.find(p => p.id === 'link')!.url = 'https://github.com/mattpocock/skills/pull/1316'
  const md = file(exportFiles(ws, new Date('2026-10-23T20:00:00Z')), 'pages/github.com-mattpocock-skills-pull-1316.md').text
  assert.match(md, /\nurl: "https:\/\/github.com\/mattpocock\/skills\/pull\/1316"\n/)
  assert.match(md, /# github.com\/mattpocock\/skills\/pull\/1316\n\n<https:\/\/github.com\/mattpocock\/skills\/pull\/1316>\n/)
})
