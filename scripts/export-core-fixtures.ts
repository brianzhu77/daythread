// Writes fixtures/core: the cases the native app (native/) is held to, made from the domain in src/domain so the two
// cannot drift. `node scripts/export-core-fixtures.ts` writes them; with `--check` it writes nothing and exits 1,
// naming every file that differs, is missing, or exists without the script writing it.
// Output must be byte-identical on every run: no clock, no random source. Ids come from each command's operation id,
// and every command is given its own `at` and `today`.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harness, todo, bullet, para, heading, chip, pageRef, card, text } from '../tests/v2-helpers.ts'
import { inlineText, pageNodes, type EditorNode } from '../src/domain/editor-document.ts'
import { applyChanges, changesBetween } from '../src/domain/workspace-changes.ts'
import { forBrowser } from '../src/server/browser-workspace.ts'
import { strippedWorkspace } from '../src/domain/synced.ts'
import { localDayIn } from '../src/domain/workspace.ts'
import type { Page, Workspace } from '../src/domain/types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'fixtures', 'core')
const files = new Map<string, string>()

/** Two-space JSON and a trailing newline. U+2028/U+2029 are written as escapes: the same string, safe in any editor. */
const render = (value: unknown): string => JSON.stringify(value, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '\n'
const put = (path: string, value: unknown) => files.set(path, render(value))

const day = '2026-10-22'
const stamp = (n: number) => `2026-10-22T09:${String(n).padStart(2, '0')}:00.000Z`

// ---- documents ------------------------------------------------------------------------------------------------------
const documents = new Map<string, EditorNode[]>()
const block = (id: string, type: string, props: Record<string, unknown> = {}, content?: unknown[], children: EditorNode[] = []): EditorNode =>
  ({ id, type, props, ...(content ? { content } : {}), children } as EditorNode)
const styled = (t: string, styles: Record<string, unknown>) => ({ type: 'text', text: t, styles })
const link = (href: string, t: string) => ({ type: 'link', href, content: [text(t)] })

documents.set('empty', [])
documents.set('empty-paragraph', [para('p1')])
documents.set('lines', [
  para('l1', text('A paragraph')),
  heading('l2', 'Heading two'),
  block('l3', 'heading', { level: 1 }, [text('Heading one')]),
  block('l4', 'heading', { level: 3 }, [text('Heading three')]),
  bullet('l5', text('A bullet')),
  block('l6', 'numberedListItem', {}, [text('First')]),
  block('l7', 'numberedListItem', {}, [text('Second')]),
  bullet('l8', text('A bullet breaks the run')),
  block('l9', 'numberedListItem', {}, [text('Third, a new run')]),
  block('l10', 'quote', {}, [text('A quote')]),
  block('l11', 'divider'),
  todo('l12', 'A plan to-do', 'plan'),
  todo('l13', 'A reference to-do', 'reference'),
])
const under = (n: EditorNode, ...children: EditorNode[]): EditorNode => ({ ...n, children })
documents.set('nesting', [under(bullet('n1', text('Level one')), under(bullet('n2', text('Level two')), under(bullet('n3', text('Level three')), bullet('n4', text('Level four')))))])
documents.set('todo-nesting', [{ ...todo('t1', 'Parent', 'plan', day, [todo('t2', 'Child', 'plan', day, [todo('t3', 'Grandchild', 'reference', day)])]) }])
documents.set('inline', [
  para('i1', text('Before '), chip('ev-1', day), text(' and '), chip('ev-2', day, '14:30'), text(' after')),
  para('i2', text('See '), pageRef('doc-a', 'ref-1'), text(' and '), link('https://example.com/a?b=1&c=2', 'a link'), text('.')),
  para('i3', styled('bold', { bold: true }), styled('italic', { italic: true }), styled('underline', { underline: true }), styled('strike', { strike: true }), styled('code', { code: true }), styled('color', { textColor: 'red', backgroundColor: 'yellow' }), styled('all', { bold: true, italic: true, underline: true, strike: true, code: true })),
])
documents.set('text-edge-cases', [
  para('e1', text('中文：你好，世界')),
  para('e2', text('Emoji outside the BMP: \u{1F600} \u{1F468}\u200D\u{1F469}\u200D\u{1F467}')),
  para('e3', text('A quote " and a backslash \\ and \\" together')),
  para('e4', text('Separator \u2028 and bell \u0007 inside')),
  para('e5', text('Tab\tand newline\nand a slash / and </script>')),
])
documents.set('cards-and-blocks', [
  card('c1', 'doc-a'),
  block('c2', 'database', { pageId: 'db-1', view: '{"id":"v1","type":"table"}' }),
  block('c3', 'syncedBlock', { syncId: 'sync-1', rev: 0, key: '', roles: '' }, undefined, [para('c3a', text('Shown in two places'))]),
  block('c4', 'button', { label: 'Go', steps: '[]' }),
  block('c5', 'smartNote', { noteId: 'note-1' }),
  block('c6', 'image', { url: 'https://example.com/a.png', name: 'a.png', caption: 'A caption' }),
  block('c7', 'file', { url: 'https://example.com/a.pdf', name: 'a.pdf', caption: '' }),
  block('c8', 'pageLink', { pageId: 'doc-a', url: 'https://example.com/', line: 'bulletListItem' }),
  block('c9', 'sourceChecklist', { checked: true }, [text('An imported item')]),
  block('c10', 'table', {}, undefined),
  block('c11', 'codeBlock', { language: 'ts' }, [text('const a = 1')]),
])

// ---- the day with everything, with its workspace ----------------------------------------------------------------------
{
  const h = harness()
  h.run({ type: 'create-document', title: 'Reading list', body: '', pageId: 'doc-a' }, 'make-doc-a')
  h.run({ type: 'ensure-day', date: day }, 'make-day')
  const dayId = `day:${day}`
  const numbered = (id: string, t: string) => block(id, 'numberedListItem', {}, [text(t)])
  h.save(dayId, () => [
    para('d1', text('A top-level paragraph before any heading')),
    heading('d2', 'Plan'),
    todo('d3', 'Write the report', 'plan', day, [todo('d4', 'Outline it', 'plan', day, [todo('d5', 'Collect numbers', 'reference', day)])]),
    todo('d6', 'Call the dentist', 'plan', day),
    todo('d7', 'Read the paper', 'reference', day),
    block('d8', 'heading', { level: 1 }, [text('Notes')]),
    numbered('d9', 'First'), numbered('d10', 'Second'), bullet('d11', text('A bullet between runs')), numbered('d12', 'A new run'),
    block('d13', 'quote', {}, [text('A quote')]),
    block('d14', 'divider'),
    block('d15', 'heading', { level: 3 }, [text('Details')]),
    para('d16', text('Meet '), chip('ev-a', day), text(' or '), chip('ev-b', day, '09:30'), text(', see '), pageRef('doc-a', 'ref-a'), text(' and '), link('https://example.com/x', 'this link')),
    para('d17', styled('bold', { bold: true }), text(' '), styled('italic', { italic: true }), text(' '), styled('underline', { underline: true }), text(' '), styled('strike', { strike: true }), text(' '), styled('code', { code: true })),
    para('d18', text('中文 \u{1F600} " \\ \u2028 \u0007')),
    card('d19', 'doc-a'),
  ], { at: stamp(1), today: day })
  h.run({ type: 'task-status', taskId: h.task('Call the dentist').id, status: 'done', today: day }, 'tick-dentist')
  const page = h.page(dayId)
  const saved = pageNodes(page)
  const missing = todo('d20', 'A to-do whose task is not in the workspace', 'plan', day)
  const literal: EditorNode[] = [
    block('d21', 'database', { pageId: 'db-1', view: '' }),
    block('d22', 'syncedBlock', { syncId: 'sync-1', rev: 0, key: '', roles: '' }, undefined, [para('d22a', text('Shown in two places'))]),
    block('d23', 'button', { label: 'Go', steps: '' }),
    block('d24', 'smartNote', { noteId: 'note-1' }),
    block('d25', 'image', { url: 'https://example.com/a.png', name: 'a.png', caption: 'A caption' }),
    block('d26', 'file', { url: 'https://example.com/a.pdf', name: 'a.pdf', caption: '' }),
  ]
  page.document = JSON.stringify([...saved, missing, ...literal])
  const ws = forBrowser(h.ws)
  put('documents/day-with-everything.json', { document: page.document })
  put('workspaces/day-with-everything.json', ws)
}
for (const [name, nodes] of documents) put(`documents/${name}.json`, { document: JSON.stringify(nodes) })

// ---- inline text -----------------------------------------------------------------------------------------------------
{
  const contents: unknown[] = [
    '', 'plain string', [], null, 'not an array', [text('Hello')], [text('Hello, '), text('world')],
    [styled('bold', { bold: true }), styled(' and italic', { italic: true })],
    [text('see '), link('https://example.com', 'a link'), text('!')],
    [{ type: 'link', href: 'https://example.com', content: [text('a '), styled('styled', { bold: true }), text(' link')] }],
    [chip('e', day)], [chip('e', day, '09:30')], [chip('e', day, '14:05')], [chip('e', '2025-03-04', '00:00')], [chip('e', '2026-01-01', '23:59')],
    [text('At '), chip('e', day, '12:00'), text(' sharp')],
    // Every month's name, with and without a time; the day is also the month number so a mix-up shows.
    Array.from({ length: 12 }, (_, i) => { const n = String(i + 1).padStart(2, '0'); return chip('e', `2026-${n}-${n}`, i % 2 ? '08:05' : null) }),
    [pageRef('doc-a', 'r1')], [text('a'), pageRef('doc-a', 'r1', { newTitle: 'New' }), text('b')],
    [text('中文 \u{1F600} " \\ \u2028 \u0007')],
    [1, 'x', null, { type: 'text' }, { type: 'unknown' }, text('kept')],
    [{ type: 'text', text: 42, styles: {} }],
  ]
  const cases: unknown[] = []
  for (const content of contents) for (const pageDate of [null, day, '2025-06-01'] as const)
    cases.push({ content, pageDate, text: inlineText(content, pageDate) })
  put('inline-text/cases.json', cases)
}

// ---- changes -----------------------------------------------------------------------------------------------------------
type Step = (h: ReturnType<typeof harness>) => void
const world = () => {
  const h = harness()
  h.run({ type: 'create-document', title: 'First', body: '', pageId: 'doc-a' }, 'make-a')
  h.run({ type: 'create-document', title: 'Second', body: '', pageId: 'doc-b' }, 'make-b')
  h.run({ type: 'create-template', title: 'A template', pageId: 'tpl-1' }, 'make-template')
  h.run({ type: 'ensure-day', date: day }, 'make-day')
  h.save(`day:${day}`, () => [heading('h1', 'Plan'), todo('r1', 'Write the report', 'plan', day), todo('r2', 'Call the dentist', 'plan', day)], { at: stamp(1), today: day })
  return h
}
const changeCase = (name: string, step: Step, wrongBase = false) => {
  const h = world()
  const was = structuredClone(h.ws)
  step(h)
  const changes = changesBetween(was, h.ws)
  const before = forBrowser(wrongBase ? h.ws : was)
  const applied = applyChanges(before, changes)
  if (wrongBase !== (applied === null)) throw new Error(`${name}: expected ${wrongBase ? 'a refusal' : 'the changes to apply'}`)
  const after = applied ? strippedWorkspace(applied) : null
  if (after && JSON.stringify(after.pages) !== JSON.stringify(forBrowser(h.ws).pages)) throw new Error(`${name}: the app's copy does not match the server's`)
  put(`changes/${name}.json`, { before, changes, after })
}
changeCase('task-ticked', h => { h.run({ type: 'task-status', taskId: h.task('Write the report').id, status: 'done', today: day }, 'tick') })
changeCase('task-added', h => { h.run({ type: 'add-task', pageId: `day:${day}`, title: 'Water the plants', plannedOn: day }, 'add') })
changeCase('page-removed', h => { h.run({ type: 'delete-template', pageId: 'tpl-1' }, 'remove-template') })
changeCase('pages-reordered', h => { h.run({ type: 'move-page', pageId: 'doc-b', parentId: null, beforeId: 'doc-a' }, 'move-b') })
changeCase('wrong-base', h => { h.run({ type: 'task-status', taskId: h.task('Write the report').id, status: 'done', today: day }, 'tick') }, true)
if (!JSON.parse(files.get('changes/pages-reordered.json')!).changes.pages.order) throw new Error('pages-reordered must set `order`')
if (!JSON.parse(files.get('changes/page-removed.json')!).changes.pages.remove.length) throw new Error('page-removed must remove a page')
{
  const f = JSON.parse(files.get('changes/task-added.json')!)
  if (!f.changes.pages.upsert.length || !f.changes.tasks.upsert.length) throw new Error('task-added must upsert a page and a task')
}

// ---- today -------------------------------------------------------------------------------------------------------------
{
  const ats = ['2026-10-22T06:30:00Z', '2026-10-22T07:00:00Z', '2026-10-22T16:00:00Z', '2026-03-08T09:59:00Z', '2026-03-08T10:00:00Z']
  // The midnight after the Vancouver clock change: a fixed UTC-8 would read the second instant as the 8th.
  const springForward = ['2026-03-09T06:59:00Z', '2026-03-09T07:00:00Z']
  put('today/cases.json', [
    ...['America/Vancouver', 'Asia/Shanghai'].flatMap(timezone => ats.map(at => ({ timezone, at, day: localDayIn(timezone, at) }))),
    ...springForward.map(at => ({ timezone: 'America/Vancouver', at, day: localDayIn('America/Vancouver', at) })),
  ])
}

// ---- README ------------------------------------------------------------------------------------------------------------
files.set('README.md', `# Core cases

The cases the native app (\`native/\`) is held to, made from the TypeScript domain in \`src/domain\` so the two cannot drift.

- \`documents/\`: \`{ "document": string }\`, a page's stored string, one case per file. \`day-with-everything.json\` is the day page of 2026-10-22.
- \`workspaces/\`: the workspace around a document, as the app holds it (what the server sends: no receipts, no undo copy, pages without their synced lines).
- \`inline-text/cases.json\`: \`{ content, pageDate, text }\`, what \`inlineText\` reads from inline content.
- \`changes/\`: \`{ before, changes, after }\`, a workspace, the changes a command made, and the workspace they give (\`null\` when \`changes.from\` is not \`before.revision\`).
- \`today/cases.json\`: \`{ timezone, at, day }\`, the local day of an instant in a time zone.

These files are generated. Never edit them by hand; CI fails when they differ from the domain. To regenerate them:

\`\`\`sh
npm run fixtures
\`\`\`
`)

// ---- write or check ----------------------------------------------------------------------------------------------------
const onDisk = (d: string): string[] => !existsSync(d) ? [] : readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? onDisk(p) : [p] })
const rel = (p: string) => relative(root, p).split('\\').join('/')
if (process.argv.includes('--check')) {
  const bad: string[] = []
  for (const [path, content] of files) {
    const full = join(dir, path)
    if (!existsSync(full)) bad.push(`${rel(full)} (missing)`)
    else if (readFileSync(full, 'utf8') !== content) bad.push(`${rel(full)} (differs)`)
  }
  for (const full of onDisk(dir)) if (!files.has(relative(dir, full).split('\\').join('/'))) bad.push(`${rel(full)} (stale: the script does not write it)`)
  if (bad.length) { console.error(`fixtures/core is out of date:\n${bad.map(b => `  ${b}`).join('\n')}\nRun: npm run fixtures`); process.exit(1) }
  console.log(`fixtures/core is up to date (${files.size} files)`)
} else {
  for (const [path, content] of files) { const full = join(dir, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content) }
  console.log(`wrote ${files.size} files to fixtures/core`)
}
