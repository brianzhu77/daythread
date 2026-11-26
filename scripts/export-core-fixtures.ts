// Writes fixtures/core: the cases the native app (native/) is held to, made from the domain in src/domain so the two
// cannot drift. `node scripts/export-core-fixtures.ts` writes them; with `--check` it writes nothing and exits 1,
// naming every file that differs, is missing, or exists without the script writing it.
// Output must be byte-identical on every run: no clock, no random source. Ids come from each command's operation id,
// and every command is given its own `at` and `today`.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harness, dayId, todo, bullet, para, heading, chip, pageRef, card, text } from '../tests/v2-helpers.ts'
import { inlineText, pageContentKey, pageNodes, type EditorNode } from '../src/domain/editor-document.ts'
import { applyChanges, changesBetween } from '../src/domain/workspace-changes.ts'
import { forBrowser } from '../src/server/browser-workspace.ts'
import { strippedWorkspace } from '../src/domain/synced.ts'
import { applyCommand, DomainError, localDayIn } from '../src/domain/workspace.ts'
import { writtenDays } from '../src/domain/page-tree.ts'
import { draftPageId } from '../src/domain/day-draft.ts'
import { labelFor } from '../src/components/outbox.ts'
import type { Action, Command, Page, Workspace } from '../src/domain/types.ts'

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
    // A chip's date must be a year from 100 on (validDate); stored dates are not held to that.
    [text('a'), chip('e', '0026-10-22'), text('b')], [chip('e', '0099-12-31', '09:00')], [chip('e', '0100-01-01')],
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

// ---- commands ----------------------------------------------------------------------------------------------------------
// What the native app predicts for a command before the server answers. `rows.tasks` is the expectation, written here
// and then held against what the domain did, so a case cannot quietly say something the domain does not.
const dayPageId = `day:${day}`
const plain = (name: string, h: ReturnType<typeof harness>, action: Action, rows: string[], repeating = false) => {
  const before = forBrowser(h.ws)
  let after = before
  try { after = forBrowser(h.run(action, `cmd-${name}`).workspace) } catch (e) { if (rows.length) throw e }
  const byId = <E extends { id: string }>(list: readonly E[]) => new Map(list.map(e => [e.id, JSON.stringify(e)]))
  const changed = <E extends { id: string }>(was: readonly E[], now: readonly E[]) => [...new Set([...was.map(e => e.id), ...now.map(e => e.id)])].filter(id => byId(was).get(id) !== byId(now).get(id))
  const tasks = changed(before.tasks, after.tasks), pages = changed(before.pages, after.pages)
  if (JSON.stringify([...rows].sort()) !== JSON.stringify([...tasks].sort()) && !(repeating && rows.every(id => tasks.includes(id)))) throw new Error(`${name}: rows.tasks ${JSON.stringify(rows)} but the domain changed ${JSON.stringify(tasks)}`)
  if (!repeating && pages.length) throw new Error(`${name}: the domain also changed pages ${JSON.stringify(pages)}`)
  put(`commands/${name}.json`, { before, action, rows: { tasks: rows }, after })
}
{
  const idOf = (h: ReturnType<typeof harness>) => h.task('Write the report').id
  const status = (h: ReturnType<typeof harness>, status: 'open' | 'done' | 'cancelled', extra: Record<string, string> = {}): Action => ({ type: 'task-status', taskId: idOf(h), status, ...extra } as Action)
  const ticked = () => { const h = world(); h.run({ type: 'task-status', taskId: idOf(h), status: 'done', today: day }, 'tick-first'); return h }
  { const h = world(); plain('tick', h, status(h, 'done', { today: day }), [idOf(h)]) }
  { const h = ticked(); plain('reopen', h, status(h, 'open'), [idOf(h)]) }
  { const h = world(); plain('tick-open-again', h, status(h, 'open'), [idOf(h)]) }
  { const h = world(); plain('cancel', h, status(h, 'cancelled', { today: day }), [idOf(h)]) }
  { const h = world(); plain('task-missing', h, { type: 'task-status', taskId: 'no-such-task', status: 'done', today: day }, []) }
  {
    const h = world()
    h.run({ type: 'set-todo-repeat', taskId: idOf(h), repeat: { every: 'day', interval: 1, from: 'schedule' }, today: day, at: stamp(2) }, 'repeat-daily')
    plain('tick-repeating', h, status(h, 'done', { today: day }), [idOf(h)], true)
    const f = JSON.parse(files.get('commands/tick-repeating.json')!)
    if (f.after.tasks.length !== f.before.tasks.length + 1) throw new Error('tick-repeating must make the next to-do')
  }
}

// ---- a day's page ------------------------------------------------------------------------------------------------------
// `live` is the rule of dayPage in src/domain/workspace.ts (not exported): a daily page of that date, not trashed.
{
  const isLive = (p: Page, date: string) => p.type === 'daily' && p.date === date && !p.trashedAt
  const lookup = (name: string, ws: Workspace) => {
    const days = ws.pages.filter(p => p.type === 'daily' && p.date === day)
    const trashed = days.filter(p => p.trashedAt).sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!))[0]
    return { name, workspace: forBrowser(ws), date: day, live: days.find(p => isLive(p, day))?.id ?? null, trashed: trashed?.id ?? null }
  }
  const fresh = () => { const h = harness(); h.run({ type: 'create-document', title: 'First', body: '', pageId: 'doc-a' }, 'make-a'); return h }
  const trash = (h: ReturnType<typeof harness>, id: string, n: number) => h.run({ type: 'delete-page', pageId: id, at: stamp(n) }, `trash-${n}`)
  const cases = []
  { const h = fresh(); h.run({ type: 'ensure-day', date: day }, 'make-day'); cases.push(lookup('live', h.ws)) }
  { const h = fresh(); cases.push(lookup('none', h.ws)) }
  { const h = fresh(); h.run({ type: 'ensure-day', date: day }, 'make-day'); trash(h, dayPageId, 10); cases.push(lookup('only-in-trash', h.ws)) }
  { const h = fresh(); h.run({ type: 'ensure-day', date: day }, 'make-day'); trash(h, dayPageId, 10); h.run({ type: 'ensure-day', date: day }, 'make-day-again'); cases.push(lookup('trashed-and-new', h.ws)) }
  {
    const h = fresh(); h.run({ type: 'ensure-day', date: day }, 'make-day'); trash(h, dayPageId, 10)
    h.run({ type: 'ensure-day', date: day }, 'make-day-again'); trash(h, `${dayPageId}:2`, 20)
    cases.push(lookup('two-in-trash', h.ws))
  }
  const byName = new Map(cases.map(c => [c.name, c]))
  if (byName.get('trashed-and-new')!.live !== `${dayPageId}:2`) throw new Error('trashed-and-new: the new page must be day:<date>:2')
  if (byName.get('two-in-trash')!.trashed !== `${dayPageId}:2`) throw new Error('two-in-trash: the later trashedAt must be day:<date>:2')
  put('day-page/cases.json', cases)
}

// ---- written days ------------------------------------------------------------------------------------------------------
// Each workspace has a day that counts and one that does not, for one rule of hasContent (src/domain/page-tree.ts).
// Days are made by ensure-day; the rows and lines are set on the page's document directly, since the commands that
// make them also add a template's lines.
{
  const [first, second] = ['2026-10-20', '2026-10-21']
  // `h.page` is read afresh in each step: a command replaces the workspace's pages.
  const build = (name: string, set: (h: ReturnType<typeof harness>, counts: string, doesNot: string) => void) => {
    const h = harness()
    for (const d of [first, second]) { h.day(d); h.page(dayId(d)).document = JSON.stringify([]) }
    set(h, dayId(first), dayId(second))
    const written = [...writtenDays(h.ws)].sort()
    if (JSON.stringify(written) !== JSON.stringify([first])) throw new Error(`written-days ${name}: expected only ${first}, got ${written}`)
    return { name, workspace: forBrowser(h.ws), days: written }
  }
  const doc = (h: ReturnType<typeof harness>, id: string, ...nodes: EditorNode[]) => { h.page(id).document = JSON.stringify(nodes) }
  const row = (id: string, taskId: string, ...content: unknown[]): EditorNode => block(id, 'task', { taskId, role: 'plan', planDate: '' }, content)
  const cases = [
    // A real to-do from add-task, so the row's task exists; its template lines are cleared to leave the row alone.
    build('todo-row-with-a-task', (h, a, b) => { h.run({ type: 'add-task', pageId: a, title: 'Pay rent', plannedOn: first }, 'add'); doc(h, a, ...pageNodes(h.page(a)).filter(n => n.type === 'task')); doc(h, b, row('r2', 'editor-task:r2')) }),
    build('todo-row-editor-id-without-words', (h, a, b) => { doc(h, a, para('p1', text('Words'))); doc(h, b, row('r1', 'editor-task:r1')) }),
    build('file-block-with-a-url', (h, a, b) => { doc(h, a, block('f1', 'file', { url: 'https://example.com/a.pdf', name: 'a.pdf', caption: '' })); doc(h, b, block('f2', 'file', { url: '', name: '', caption: '' })) }),
    build('smart-note', (h, a) => { doc(h, a, block('s1', 'smartNote', { noteId: 'note-1' })) }),
    build('line-with-words', (h, a, b) => { doc(h, a, para('p1', text('Went for a run'))); doc(h, b, para('p2', text('   '))) }),
    build('heading-only', (h, a, b) => { doc(h, a, para('p1', text('Words'))); doc(h, b, heading('h1', 'Plan')) }),
    build('day-in-trash-with-words', (h, a, b) => { doc(h, a, para('p1', text('Words'))); doc(h, b, para('p2', text('Words'))); h.run({ type: 'delete-page', pageId: b, at: stamp(10) }, 'trash-b') }),
    build('empty-day-with-a-page-under-it', (h, a) => { h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'doc-under', parentId: a }, 'make-under') }),
    // No command makes a draft page without the model's answer, so this one page is built by hand (day-draft.ts).
    build('empty-day-with-only-its-draft', (h, a, b) => {
      doc(h, a, para('p1', text('Words')))
      h.ws.pages.push({ id: draftPageId(b), type: 'draft', date: null, title: '', parentId: b, document: JSON.stringify({ status: 'ready', items: [], moreOpen: false }) })
    }),
  ]
  put('written-days/cases.json', cases)
}

// ---- labels ------------------------------------------------------------------------------------------------------------
{
  const longTitle = 'A to-do whose title runs well past the forty characters the banner keeps'
  const cases: unknown[] = []
  const label = (name: string, action: Action, h = world()) => {
    const workspace = forBrowser(h.ws)
    cases.push({ name, workspace, action, label: labelFor(action, workspace) })
  }
  const withTask = (title: string) => { const h = world(); h.run({ type: 'add-task', pageId: dayPageId, title, plannedOn: day }, `add-${title.length}`); return h }
  const status = (h: ReturnType<typeof harness>, title: string, to: 'open' | 'done' | 'cancelled'): Action => ({ type: 'task-status', taskId: h.task(title).id, status: to, today: day })
  { const h = world(); label('task-status-done', status(h, 'Write the report', 'done'), h); label('task-status-open', status(h, 'Write the report', 'open'), h); label('task-status-cancelled', status(h, 'Write the report', 'cancelled'), h) }
  { const h = withTask(longTitle); label('title-longer-than-40', status(h, longTitle, 'done'), h) }
  { const h = withTask('Call "Sam" back'); label('title-with-a-quote', status(h, 'Call "Sam" back', 'done'), h) }
  { const h = withTask('给妈妈打电话'); label('title-in-chinese', status(h, '给妈妈打电话', 'done'), h) }
  label('ensure-day', { type: 'ensure-day', date: day })
  label('restore-batch', { type: 'restore-batch', trashId: 'trash-1' })
  put('labels/cases.json', cases)
}

// ---- the content key ---------------------------------------------------------------------------------------------------
// `document` is the page's stored string, as a client holds it; the key is `pageContentKey` of it. A synced block is
// stored without its lines, and the key is of that stored form, so the server's expanded copy gives the same key.
{
  const syncedPage = () => {
    const h = harness()
    h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'notes' }, 'make-notes')
    h.save('notes', d => [...d, para('p1', text('Before')), block('s1', 'syncedBlock', { syncId: 'sync-1', roles: '' }, undefined, [para('l1', text('Shown in two places'))])], { at: stamp(1) })
    return h
  }
  const h = syncedPage()
  const stored = forBrowser(h.ws).pages.find(p => p.id === 'notes')!
  const keyOfStored = pageContentKey(stored)
  if (keyOfStored !== pageContentKey(h.page('notes'))) throw new Error('content-key synced-block: the stored form and the expanded form must give one key')
  if (JSON.parse(stored.document).some((n: EditorNode) => n.type === 'syncedBlock' && n.children?.length)) throw new Error('content-key synced-block: the stored form must hold no lines')
  const caseOf = (name: string, document: string) => ({ name, document, key: pageContentKey({ document }) })
  put('content-key/cases.json', [
    caseOf('empty', JSON.stringify([])),
    caseOf('ascii', JSON.stringify([para('k1', text('Hello, world'))])),
    caseOf('chinese', JSON.stringify([para('k1', text('中文：你好，世界'))])),
    caseOf('emoji-outside-the-basic-plane', JSON.stringify([para('k1', text('A \u{1F600} and a family \u{1F468}‍\u{1F469}‍\u{1F467}'))])),
    caseOf('synced-block', stored.document),
  ])
}

// ---- saves -------------------------------------------------------------------------------------------------------------
// A save as the native app sends it (its document is the stored one, edited), and what the server does with it.
// `{ before, operationId, expectedRevision, action, after, message }` for a save taken and `{ before, operationId,
// expectedRevision, action, refused }` for one refused; `after` and `before` are workspaces as the browser gets them.
{
  const saveAs = (h: ReturnType<typeof harness>, pageId: string, edit: (nodes: EditorNode[]) => EditorNode[], extra: Partial<Extract<Action, { type: 'save-editor' }>> = {}): Extract<Action, { type: 'save-editor' }> => {
    const page = forBrowser(h.ws).pages.find(p => p.id === pageId)!
    return { type: 'save-editor', pageId, expectedContent: pageContentKey(page), document: JSON.stringify(edit(structuredClone(pageNodes(page)))), today: day, at: stamp(30), ...extra }
  }
  const command = (h: ReturnType<typeof harness>, operationId: string, action: Action, expectedRevision = h.ws.revision): Command => ({ operationId, expectedRevision, action })
  const taken = (name: string, h: ReturnType<typeof harness>, c: Command, check: (before: Workspace, after: Workspace, message: string) => void) => {
    const before = forBrowser(h.ws)
    const result = applyCommand(h.ws, c)
    h.ws = result.workspace
    const after = forBrowser(result.workspace)
    check(before, after, result.receipt.message)
    put(`saves/${name}.json`, { before, operationId: c.operationId, expectedRevision: c.expectedRevision, action: c.action, after, message: result.receipt.message })
    return { before, after, result }
  }
  const refused = (name: string, h: ReturnType<typeof harness>, c: Command, message: string) => {
    const before = forBrowser(h.ws)
    try { applyCommand(h.ws, c) } catch (e) {
      if (!(e instanceof DomainError) || e.message !== message) throw new Error(`saves ${name}: expected the refusal "${message}", got ${e instanceof Error ? e.message : e}`)
      put(`saves/${name}.json`, { before, operationId: c.operationId, expectedRevision: c.expectedRevision, action: c.action, refused: message })
      return
    }
    throw new Error(`saves ${name}: the save was not refused`)
  }
  const must = (ok: boolean, what: string) => { if (!ok) throw new Error(`saves: ${what}`) }
  const pageOf = (ws: Workspace, id: string) => ws.pages.find(p => p.id === id)!
  const wordsOf = (ws: Workspace, id: string) => pageNodes(pageOf(ws, id)).map(n => inlineText(n.content)).join('\n')

  const run = (name: string, build: (h: ReturnType<typeof world>) => Command, check: (before: Workspace, after: Workspace, message: string) => void) => { const h = world(); return taken(name, h, build(h), check) }

  run('typed-words', h => command(h, 'save-typed', saveAs(h, dayPageId, d => [...d, para('typed', text('Went for a run'))])), (_b, after, message) => {
    must(message === 'Page saved', 'typed-words: message'); must(wordsOf(after, dayPageId).includes('Went for a run'), 'typed-words: the words are in the page')
  })
  run('new-to-do', h => command(h, 'save-new-todo', saveAs(h, dayPageId, d => [...d, todo('n1', 'Water the plants', 'plan', day)])), (before, after) => {
    const made = after.tasks.find(t => t.id === 'editor-task:n1')
    must(!before.tasks.some(t => t.id === 'editor-task:n1') && made?.title === 'Water the plants', 'new-to-do: the to-do is made under editor-task:n1')
  })
  run('new-to-do-without-words', h => command(h, 'save-new-todo-empty', saveAs(h, dayPageId, d => [...d, todo('n2', '', 'plan', day)])), (before, after) => {
    must(after.tasks.length === before.tasks.length, 'new-to-do-without-words: no to-do is made')
    must(pageNodes(pageOf(after, dayPageId)).some(n => n.id === 'n2'), 'new-to-do-without-words: the row is kept')
  })
  run('to-do-words-deleted', h => command(h, 'save-words-deleted', saveAs(h, dayPageId, d => d.map(n => n.id === 'r1' ? { ...n, content: [] } : n))), (_b, after) => {
    must(after.tasks.find(t => t.id === 'editor-task:r1')?.title === '', 'to-do-words-deleted: the title becomes ""')
  })
  run('row-removed', h => command(h, 'save-row-removed', saveAs(h, dayPageId, d => d.filter(n => n.id !== 'r2'))), (before, after) => {
    must(before.tasks.some(t => t.id === 'editor-task:r2') && !after.tasks.some(t => t.id === 'editor-task:r2'), 'row-removed: the to-do leaves tasks')
    must(after.deletedTasks.some(t => t.id === 'editor-task:r2'), 'row-removed: the to-do goes to deletedTasks')
  })
  // settleAfterRowsLeft: a removed row only pauses its to-do when it was a plan row removed on its own (singleDeleteIds), on
  // today's page, planned there, and the to-do still has a row on another page. Here another page holds a reference row.
  {
    const h = world()
    h.run({ type: 'create-document', title: 'Reading', body: '', pageId: 'doc-c' }, 'make-c')
    const elsewhere = saveAs(h, 'doc-c', d => [...d, block('x1', 'task', { taskId: 'editor-task:r2', role: 'reference', planDate: '' }, [text('Call the dentist')])], { at: stamp(2) })
    h.run(elsewhere, 'save-elsewhere-row')
    taken('row-removed-kept-elsewhere', h, command(h, 'save-row-removed-kept', saveAs(h, dayPageId, d => d.filter(n => n.id !== 'r2'), { singleDeleteIds: ['r2'] })), (before, after) => {
      const t = after.tasks.find(x => x.id === 'editor-task:r2')
      must(Boolean(t) && !after.deletedTasks.some(x => x.id === 'editor-task:r2'), 'row-removed-kept-elsewhere: the to-do is kept')
      must(before.tasks.find(x => x.id === 'editor-task:r2')?.paused !== true && t?.paused === true, 'row-removed-kept-elsewhere: the to-do is paused')
      must(!pageNodes(pageOf(after, dayPageId)).some(n => n.id === 'r2') && pageNodes(pageOf(after, 'doc-c')).some(n => n.id === 'x1'), 'row-removed-kept-elsewhere: the row left today and stays on the other page')
    })
  }
  // A page holding a synced block and a database block, saved from its stored form with one paragraph's words changed.
  // The stored form carries the synced block without its lines; no detach or adopt field is sent, and none is needed.
  {
    const h = harness()
    h.run({ type: 'create-document', title: 'Books', body: '', pageId: 'books' }, 'make-books')
    h.save('books', d => [...d, para('p1', text('Hello')), block('s1', 'syncedBlock', { syncId: 'sync-1', roles: '' }, undefined, [para('l1', text('Shown in two places'))]), block('home', 'database', { pageId: 'list', view: '' }), para('p2', text('Tail'))], { at: stamp(1) })
    h.run({ type: 'create-database', pageId: 'list', parentId: 'books', homeBlockId: 'home', title: 'Reading list' }, 'make-list')
    const action = saveAs(h, 'books', d => d.map(n => n.id === 'p1' ? { ...n, content: [text('Hello, world')] } : n))
    if ('detachDatabaseIds' in action || 'adoptDatabaseBlocks' in action) throw new Error('untouched-synced-and-database: the save must not send detach or adopt fields')
    taken('untouched-synced-and-database', h, command(h, 'save-untouched', action), (before, after, message) => {
      must(message === 'Page saved', 'untouched-synced-and-database: message')
      must(JSON.stringify(after.synced) === JSON.stringify(before.synced), 'untouched-synced-and-database: the synced record is unchanged')
      must(after.pages.some(p => p.id === 'list' && !p.trashedAt && p.parentId === 'books'), 'untouched-synced-and-database: the database stays on the page')
      const nodes = pageNodes(pageOf(after, 'books'))
      must(nodes.some(n => n.id === 's1' && n.type === 'syncedBlock') && nodes.some(n => n.id === 'home' && n.type === 'database'), 'untouched-synced-and-database: both blocks are kept')
      must(wordsOf(after, 'books').includes('Hello, world') && !wordsOf(before, 'books').includes('Hello, world'), 'untouched-synced-and-database: the paragraph\'s words changed')
    })
  }
  // The same operation again is answered with the same receipt and changes nothing; its expected revision is not looked at.
  {
    const h = world()
    const c = command(h, 'save-twice', saveAs(h, dayPageId, d => [...d, para('typed', text('Went for a run'))]))
    const first = taken('same-operation-twice', h, c, () => {})
    const again = applyCommand(h.ws, c)
    must(JSON.stringify(again.receipt) === JSON.stringify(first.result.receipt), 'same-operation-twice: the second answer equals the first')
    must(JSON.stringify(forBrowser(again.workspace)) === JSON.stringify(first.after), 'same-operation-twice: the workspace is unchanged by the second')
    const file = JSON.parse(files.get('saves/same-operation-twice.json')!)
    put('saves/same-operation-twice.json', { ...file, second: { message: again.receipt.message, after: forBrowser(again.workspace) } })
  }
  {
    const h = world()
    const stale = saveAs(h, dayPageId, d => [...d, para('mine', text('Mine'))])
    h.save(dayPageId, d => [...d, para('theirs', text('Theirs'))], { at: stamp(3) })
    refused('page-changed-elsewhere', h, command(h, 'save-stale-page', stale), 'Page changed elsewhere. Your editor draft is kept; reload or copy it before resolving.')
  }
  {
    const h = world()
    const c = command(h, 'save-stale-revision', saveAs(h, dayPageId, d => [...d, para('mine', text('Mine'))]), h.ws.revision - 1)
    refused('saved-elsewhere', h, c, 'Saved elsewhere. Reload before applying; your input is kept here.')
  }
}

// ---- README ------------------------------------------------------------------------------------------------------------
files.set('README.md', `# Core cases

The cases the native app (\`native/\`) is held to, made from the TypeScript domain in \`src/domain\` so the two cannot drift.

- \`documents/\`: \`{ "document": string }\`, a page's stored string, one case per file. \`day-with-everything.json\` is the day page of 2026-10-22.
- \`workspaces/\`: the workspace around a document, as the app holds it (what the server sends: no receipts, no undo copy, pages without their synced lines).
- \`inline-text/cases.json\`: \`{ content, pageDate, text }\`, what \`inlineText\` reads from inline content.
- \`changes/\`: \`{ before, changes, after }\`, a workspace, the changes a command made, and the workspace they give (\`null\` when \`changes.from\` is not \`before.revision\`).
- \`commands/\`: \`{ before, action, rows: { tasks }, after }\`, a workspace, a command, the tasks it is predicted to change, and the workspace after it (\`after\` is \`before\` when the server refuses it).
- \`day-page/cases.json\`: \`{ name, workspace, date, live, trashed }\`, the id of a date's live day page and of its latest page in Trash (\`null\` for none).
- \`written-days/cases.json\`: \`{ name, workspace, days }\`, the days \`writtenDays\` counts, sorted.
- \`labels/cases.json\`: \`{ name, workspace, action, label }\`, what the outbox's \`labelFor\` says of a change.
- \`content-key/cases.json\`: \`{ name, document, key }\`, a page's stored string and its \`pageContentKey\` (a synced block is stored without its lines, and the key is of that form).
- \`saves/\`: one file per save. \`{ before, operationId, expectedRevision, action, after, message }\` for a \`save-editor\` the server takes, \`{ before, operationId, expectedRevision, action, refused }\` for one it refuses (the domain's message). \`same-operation-twice.json\` also has \`second: { message, after }\`, the answer to the same command sent again.
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
