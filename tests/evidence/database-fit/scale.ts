// How the whole-workspace model scales with database rows stored as child pages (docs/research/database-fit.md).
// Synthetic data only. Usage: node tests/evidence/database-fit/scale.ts
import { applyCommand, createEmptyWorkspace, getDayView } from '../../../src/domain/workspace.ts'
import { forBrowser } from '../../../src/server/browser-workspace.ts'
import { planWrites, rowsOf } from '../../../src/server/workspace-rows.ts'
import { emptyTaskRow, headingNode, pageContentKey, textRun } from '../../../src/domain/editor-document.ts'
import type { Page, Workspace } from '../../../src/domain/types.ts'

const day = '2026-11-01'
const line = (text: string) => ({ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [textRun(text)], children: [] })
// About Brian's median page (708 bytes of document), plus ~250 bytes of property values per row.
const rowDoc = () => JSON.stringify([line('Notes on this row, a sentence or two of text.'), line('Another short line with a little more detail.'), line('A third line.')])
const props = () => ({ status: 'In progress', tags: ['work', 'reading'], due: '2026-11-08', rating: 4, url: 'https://example.com/some/long/path', note: 'A short text property value' })

function workspace(rows: number): Workspace {
  const ws = createEmptyWorkspace()
  ws.revision = 1
  const pages: (Page & { properties?: unknown })[] = []
  for (let i = 0; i < 12; i++) pages.push({ id: `day:2026-10-${String(20 + i).padStart(2, '0')}`, type: 'daily', date: `2026-10-${String(20 + i).padStart(2, '0')}`, title: '', document: JSON.stringify([headingNode('TODO'), emptyTaskRow(day), line('x'.repeat(600))]) })
  pages.push({ id: `day:${day}`, type: 'daily', date: day, title: '', document: JSON.stringify([headingNode('TODO'), line('today')]) })
  for (let i = 0; i < 13; i++) pages.push({ id: `doc-${i}`, type: 'document', date: null, title: `Doc ${i}`, document: JSON.stringify([line('y'.repeat(700))]) })
  pages.push({ id: 'db', type: 'document', date: null, title: 'Reading list', document: '[]' })
  for (let i = 0; i < rows; i++) pages.push({ id: `row-${i}`, type: 'document', date: null, title: `Row ${i}`, parentId: 'db', document: rowDoc(), properties: props() })
  ws.pages = pages
  // Brian has 17 tasks: each with a plan row on today's page.
  const today = pages.find(p => p.id === `day:${day}`)!
  const taskRows = Array.from({ length: 17 }, (_, i) => ({ id: `r${i}`, type: 'task', props: { taskId: `t${i}`, role: 'plan', planDate: day }, content: [textRun(`Task ${i}`)], children: [] }))
  today.document = JSON.stringify([headingNode('TODO'), ...taskRows, line('today')])
  ws.tasks = taskRows.map((_, i) => ({ id: `t${i}`, title: `Task ${i}`, status: 'open', version: 1, paused: false, deadlineOn: null, attentionOn: null, createdOn: day, sourcePageId: today.id }))
  return ws
}

const time = (f: () => unknown, n = 5): number => { f(); const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n }
console.log('rows\tbrowser_kb\tsave_ms\ttick_ms\tdiff_ms\tparse_all_ms')
for (const rows of [0, 100, 500, 1000, 2000, 5000, 10000]) {
  const ws = workspace(rows), before = rowsOf(ws)
  const page = ws.pages.find(p => p.id === `day:${day}`)!
  const save = () => applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify([headingNode('TODO'), ...JSON.parse(page.document).slice(1, -1), line('today, edited')]), today: day } })
  let result: ReturnType<typeof save> | undefined
  const command = time(() => { try { result = save() } catch { result = undefined } })
  const after = result?.workspace ?? ws
  const diff = time(() => planWrites(before, after))
  const tick = time(() => applyCommand(ws, { operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'task-status', taskId: 't0', status: 'done', today: day } }))
  // A cold isolate parses every document once before its first view (pageNodes caches by document text).
  const parseAll = time(() => { for (const p of ws.pages) JSON.parse(p.document) })
  getDayView(ws, day)
  const kb = Buffer.byteLength(JSON.stringify(forBrowser(ws))) / 1024
  console.log([rows, kb.toFixed(0), command.toFixed(1), tick.toFixed(1), diff.toFixed(1), parseAll.toFixed(1)].join('\t') + (result ? '' : '\t(save refused)'))
}
