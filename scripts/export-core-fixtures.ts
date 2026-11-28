// Writes fixtures/core: the cases the native app (native/) is held to, made from the domain in src/domain so the two
// cannot drift. `node scripts/export-core-fixtures.ts` writes them; with `--check` it writes nothing and exits 1,
// naming every file that differs, is missing, or exists without the script writing it.
// Output must be byte-identical on every run: no clock, no random source. Ids come from each command's operation id,
// and every command is given its own `at` and `today`.
import './fixed-time-zone.ts'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harness, dayId, todo, bullet, para, heading, chip, pageRef, card, text, under as underHeading, today as webToday, yesterday as webYesterday, tomorrow as webTomorrow, twoDaysAgo as webTwoDaysAgo } from '../tests/v2-helpers.ts'
import { flatNodes, inlineText, pageContentKey, pageNodes, rowRole, rowTaskId, type EditorNode } from '../src/domain/editor-document.ts'
import { applyChanges, changesBetween } from '../src/domain/workspace-changes.ts'
import { forBrowser } from '../src/server/browser-workspace.ts'
import { strippedWorkspace } from '../src/domain/synced.ts'
import { applyCommand, DomainError, getDayView, localDayIn, plannedOn } from '../src/domain/workspace.ts'
import { dayEvents } from '../src/domain/chip-events.ts'
import { writtenDays } from '../src/domain/page-tree.ts'
import { DRAFT_RECIPE, draftOf, draftPageId, draftSettled, draftStale, draftView, moreOpenAfterIndex, planningEndIndex, planningRange, sameWords, skippedDays, type DraftItem, type DraftItemView } from '../src/domain/day-draft.ts'
import { buildDayDraftRequest, itemsFromModel, withSkippedPlan, type ModelSuggestion } from '../src/server/model/day-draft.ts'
import { appliedNotice, draftLineState, draftLineWords, draftWords, skippedLabel, skippedNotice, type DraftAskSummary } from '../src/components/draft-words.ts'
import { applyDraftAction, draftTicket, reopenDraftAction, skipDraftAction, type DraftTicket } from '../src/components/draft-actions.ts'
import { labelFor } from '../src/components/outbox.ts'
import { carriedSince } from '../src/domain/carried.ts'
import { repeatWords, type TodoRepeatRule } from '../src/domain/todo-repeats.ts'
import { addDays, anotherDayOptions, daysBetween, deadlinePassed, longLabel, near, shortLabel, taskDateTag, weekday } from '../src/components/dates.ts'
import { rowAction, rowMenu, type RowIntent } from '../src/components/row-menu-model.ts'
import { rowNotices, rowNoticeText } from '../src/components/row-notices.ts'
import { rowMarks, sinceLabel, type RowMarks } from '../src/components/row-marks.ts'
import { blockedByWords, blockedIn } from '../src/components/blockers-view.ts'
import { nextDayLabel, repeatMarkName } from '../src/components/todo-repeat-view.ts'
import { eventsHeading, eventsLine, shortTime } from '../src/components/event-words.ts'
import { dayFacts } from '../src/components/day-facts.ts'
import { planOnAction, planOnNotice } from '../src/components/plan-on.ts'
import type { Action, Command, Page, Task, Workspace } from '../src/domain/types.ts'

// dates.ts words a date in the device's zone; the cases are the same wherever the script runs only if it is fixed.
if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'UTC') throw new Error('the time zone is not fixed: scripts/fixed-time-zone.ts must be the first import')
// sameWords lowercases in the host's locale (toLocaleLowerCase); the app lowercases as JavaScript does in English, so the
// cases are made only in an English one.
if (!Intl.DateTimeFormat().resolvedOptions().locale.startsWith('en')) throw new Error(`the locale is ${Intl.DateTimeFormat().resolvedOptions().locale}: the draft's cases are made in an English one. Run with LANG=en_US.UTF-8, and unset LC_ALL if it is set (set but empty, it resolves to "und")`)

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
      h.ws.pages.push({ id: draftPageId(b), type: 'draft', date: null, title: '', parentId: b, document: JSON.stringify({ status: 'ready', items: [], moreOpen: [] }) })
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

// ---- the to-do row -----------------------------------------------------------------------------------------------------
// What a to-do's row on a day page says and does (docs/design/native-phase-1.md §11), made by running the web's own functions
// (src/components) and the server's own commands. Today is Thu 2026-11-26 unless a case says otherwise, and the time zone is
// fixed (scripts/fixed-time-zone.ts). Each case is held to the words its name gives, so a change to the web that alters one
// fails here rather than quietly changing what the native app is held to.
const TODAY = '2026-11-26'
const expect = (what: string, actual: unknown, wanted: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${what}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`)
}
function aTask(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'A to-do', status: 'open', version: 1, paused: false, deadlineOn: null, attentionOn: null, createdOn: '2026-11-01', sourcePageId: 'p', ...over }
}

// dates/words.json
{
  const dates = [...Array.from({ length: 19 }, (_, i) => addDays(TODAY, i - 8)), '2025-11-03', '2026-12-31', '2027-01-01', '2027-11-24', '2028-02-29']
  const cases = dates.map(date => ({
    date, today: TODAY, daysBetween: daysBetween(TODAY, date), weekday: weekday(date), shortLabel: shortLabel(date), longLabel: longLabel(date),
    near: near(date, TODAY), sinceLabel: sinceLabel(date, TODAY), nextDayLabel: nextDayLabel(date, TODAY),
  }))
  const at = (date: string) => cases.find(c => c.date === date)!
  expect('dates/words: six days ahead is a short label', at('2026-12-02').near, 'Wed 12/2')
  expect('dates/words: five days ahead is a weekday', at('2026-12-01').near, 'Tue')
  expect('dates/words: Since carries another year', at('2025-11-03').sinceLabel, 'Nov 3, 2025')
  expect('dates/words: Next carries another year', at('2027-11-24').nextDayLabel, 'Wed, Nov 24, 2027')
  expect('dates/words: a leap day', [at('2028-02-29').weekday, at('2028-02-29').shortLabel], ['Tue', 'Tue 2/29'])
  put('dates/words.json', cases)
}

// dates/tags.json: each shape of a to-do's dates on today's page, a past page and a future page, planned and not.
{
  const shapes: [name: string, deadlineOn: string | null, attentionOn: string | null][] = [
    ['due-today', '2026-11-26', null], ['due-tomorrow', '2026-11-27', null], ['due-sunday', '2026-11-29', null], ['due-tuesday', '2026-12-01', null],
    ['due-six-days-ahead', '2026-12-02', null], ['due-passed', '2026-11-23', null], ['due-on-a-past-pages-day', '2026-11-20', null], ['due-on-a-future-pages-day', '2026-12-03', null],
    ['start-today', null, '2026-11-26'], ['start-tomorrow', null, '2026-11-27'], ['start-passed', null, '2026-11-20'],
    ['start-and-due-the-same-far-day', '2026-12-05', '2026-12-05'], ['start-and-due-tomorrow', '2026-11-27', '2026-11-27'], ['start-monday-due-far-sunday', '2026-12-06', '2026-11-30'],
    ['start-tomorrow-due-saturday', '2026-11-28', '2026-11-27'], ['start-today-due-sunday', '2026-11-29', '2026-11-26'], ['start-tomorrow-due-passed', '2026-11-23', '2026-11-27'],
  ]
  const pages = [['today', TODAY], ['a-past-page', '2026-11-20'], ['a-future-page', '2026-12-03']] as const
  const cases = shapes.flatMap(([shape, deadlineOn, attentionOn]) => pages.flatMap(([pageName, pageDate]) => [true, false].map(isPlanned => {
    const planned = isPlanned ? pageDate : null
    const task = aTask({ deadlineOn, attentionOn })
    return { name: `${shape}, ${pageName}, ${isPlanned ? 'planned' : 'unplanned'}`, deadlineOn, attentionOn, today: TODAY, pageDate, planned, text: taskDateTag(task, TODAY, pageDate, planned), passed: deadlinePassed(task, TODAY) }
  })))
  const text = (name: string) => cases.find(c => c.name === name)!.text
  const onToday: Record<string, string> = {
    'due-today': 'Due today', 'due-tomorrow': 'Due tomorrow', 'due-sunday': 'Due Sun', 'due-tuesday': 'Due Tue', 'due-six-days-ahead': 'Due Wed 12/2', 'due-passed': 'Was due Mon',
    'start-today': 'Start today', 'start-tomorrow': 'Start tomorrow', 'start-passed': '', 'start-and-due-the-same-far-day': 'Start Sat 12/5 · Due Sat 12/5',
    'start-and-due-tomorrow': 'Due tomorrow · Start tomorrow', 'start-monday-due-far-sunday': 'Start Mon · Due Sun 12/6', 'start-tomorrow-due-saturday': 'Due Sat · Start tomorrow',
    'start-today-due-sunday': 'Start today · Due Sun', 'start-tomorrow-due-passed': 'Was due Mon',
  }
  for (const [shape, words] of Object.entries(onToday)) expect(`dates/tags: ${shape} on today's page`, text(`${shape}, today, planned`), words)
  expect('dates/tags: nothing planned reads Unscheduled', text('start-passed, today, unplanned'), 'Unscheduled')
  expect('dates/tags: a Due date seen from a past page', text('due-passed, a-past-page, planned'), 'Due Mon 11/23')
  expect('dates/tags: Due that day on a past page', text('due-on-a-past-pages-day, a-past-page, planned'), 'Due that day')
  expect('dates/tags: Due that day on a future page', text('due-on-a-future-pages-day, a-future-page, planned'), 'Due that day')
  if (cases.length !== 17 * 3 * 2) throw new Error('dates/tags: expected 17 shapes on 3 pages, planned and not')
  put('dates/tags.json', cases)
}

// rows/menus.json and rows/another-day.json
{
  const menu = (name: string, status: Task['status'], role: string, planned: string | null, pageDate: string | null) =>
    ({ name, status, role, planned, pageDate, today: TODAY, menu: rowMenu(aTask({ status }), role, planned, pageDate, TODAY) })
  const past = '2026-11-20', tomorrow = '2026-11-27', later = '2026-11-30', evenLater = '2026-12-02'
  const cases = [
    menu('a page that is not a day', 'open', 'plan', TODAY, null),
    menu('done', 'done', 'plan', TODAY, TODAY),
    menu('cancelled on a past day', 'cancelled', 'plan', null, past),
    menu('cancelled today', 'cancelled', 'plan', null, TODAY),
    menu('cancelled on a future day', 'cancelled', 'plan', null, later),
    menu('open plan row on a past day', 'open', 'plan', past, past),
    menu('open reference row on a past day', 'open', 'reference', TODAY, past),
    menu('reference row today, planned today', 'open', 'reference', TODAY, TODAY),
    menu('reference row today, not planned today', 'open', 'reference', later, TODAY),
    menu('reference row on a future day, planned today', 'open', 'reference', TODAY, later),
    menu('reference row on a future day, not planned today', 'open', 'reference', evenLater, later),
    menu('plan row today, planned today', 'open', 'plan', TODAY, TODAY),
    menu('plan row today, planned tomorrow (stale)', 'open', 'plan', tomorrow, TODAY),
    menu('plan row today, planned on a later day (stale)', 'open', 'plan', later, TODAY),
    menu("plan row on tomorrow's page, planned there", 'open', 'plan', tomorrow, tomorrow),
    menu("plan row on tomorrow's page, planned elsewhere", 'open', 'plan', later, tomorrow),
    menu("plan row on a later day's page, planned there", 'open', 'plan', later, later),
    menu("plan row on a later day's page, planned elsewhere", 'open', 'plan', evenLater, later),
  ]
  const named = (name: string) => cases.find(c => c.name === name)!
  const items = (name: string) => named(name).menu?.groups.flatMap(g => g.items.map(i => i.label))
  expect('rows/menus: a page that is not a day offers nothing', named('a page that is not a day').menu, null)
  expect('rows/menus: done offers nothing', named('done').menu, null)
  expect('rows/menus: cancelled offers Restore on a past day', items('cancelled on a past day'), ['Restore'])
  expect('rows/menus: a past day offers Bring to today', items('open plan row on a past day'), ['Bring to today'])
  expect('rows/menus: planned today needs no Plan for today', named('reference row today, planned today').menu!.primary, [])
  expect('rows/menus: a stale row says Remove from', items('plan row today, planned tomorrow (stale)')![0], 'Remove from Thu')
  expect('rows/menus: a row planned for tomorrow has no Tomorrow of its own, but keeps it under Another day', [named('plan row today, planned tomorrow (stale)').menu!.groups[0]!.items.length, items('plan row today, planned tomorrow (stale)')![1]], [1, 'Tomorrow · Fri 11/27'])
  expect('rows/menus: a later day says Not on', items("plan row on tomorrow's page, planned there")!.includes('Not on Fri'), true)
  expect('rows/menus: today says Not today and Tomorrow', [items('plan row today, planned today')![0], items('plan row today, planned today')![1]], ['Tomorrow · Fri, Nov 27', 'Not today'])
  put('rows/menus.json', cases)

  // Sunday 2026-11-22 to Saturday 2026-11-28.
  const another = Array.from({ length: 7 }, (_, i) => addDays('2026-11-22', i)).map(today => ({ today, options: anotherDayOptions(today) }))
  expect('rows/another-day: Sunday holds Tomorrow alone', another[0]!.options.map(o => o.label), ['Tomorrow'])
  expect('rows/another-day: Monday holds all three', another[1]!.options.map(o => o.label), ['Tomorrow', 'This weekend', 'Next week'])
  expect('rows/another-day: Friday has no This weekend', another[5]!.options.map(o => o.label), ['Tomorrow', 'Next week'])
  put('rows/another-day.json', another)
}

// ---- worlds the row's cases are built in
type World = ReturnType<typeof harness>
const stamped = (n: number) => `2026-11-26T09:${String(n).padStart(2, '0')}:00.000Z`
const plan = (id: string, title: string, date = TODAY): EditorNode => todo(id, title, 'plan', date)
/** A reference row of a to-do that already exists, as a day page holds one: no plan day of its own. */
const reference = (id: string, taskId: string, title: string): EditorNode => ({ id, type: 'task', props: { taskId, role: 'reference', planDate: '' }, content: [text(title)], children: [] })
const rowsWorld = () => { const h = harness(); h.day(TODAY); return h }
const saveRows = (h: World, date: string, ...rows: EditorNode[]) => h.save(dayId(date), d => [...d, ...rows], { today: date, at: stamped(1) })
const taskOf = (id: string) => `editor-task:${id}`
/** Rewrites a page's document directly, for what no command makes: a row left on a template, a draft or a page gone. */
const setDocument = (h: World, pageId: string, edit: (nodes: EditorNode[]) => EditorNode[]) => {
  h.ws = { ...h.ws, pages: h.ws.pages.map(p => (p.id === pageId ? { ...p, document: JSON.stringify(edit(structuredClone(pageNodes(p)))) } : p)) }
}
const rowOf = (ws: Workspace, taskId: string, pageId: string) => {
  const page = ws.pages.find(p => p.id === pageId)!
  const node = flatNodes(pageNodes(page)).find(n => rowTaskId(n) === taskId)
  if (!node) throw new Error(`no row of ${taskId} on ${pageId}`)
  return node
}
/** A to-do carried to each next day by that day's draft (as tests/carried.test.ts does it): its id. */
const carriedWorld = (start: string, days: number) => {
  const h = harness()
  h.day(start)
  h.run({ type: 'add-task', pageId: dayId(start), title: 'A carried to-do', plannedOn: start })
  const id = h.ws.tasks[0]!.id
  for (let n = 1; n <= days; n++) carryIn(h, addDays(start, n), id)
  return { h, id }
}
const carryIn = (h: World, date: string, taskId: string) => {
  h.day(date)
  const anchor = pageNodes(h.page(dayId(date)))[0]!.id
  h.run({ type: 'set-draft', pageId: dayId(date), status: 'ready', moreOpen: [], allowedTaskIds: [taskId], items: [{ id: 'i0', anchor, place: 'after', taskId, source: 'model', state: 'open' }] } as never)
  h.run({ type: 'apply-draft', pageId: dayId(date), itemIds: ['i0'], today: date } as never)
}

// rows/marks.json: one row of a day page and what it draws.
{
  const cases: unknown[] = []
  const marksCase = (name: string, h: World, pageId: string, blockId: string, wanted: Partial<RowMarks>) => {
    const ws = forBrowser(h.ws)
    const node = flatNodes(pageNodes(ws.pages.find(p => p.id === pageId)!)).find(n => n.id === blockId)
    if (!node) throw new Error(`rows/marks ${name}: no block ${blockId} on ${pageId}`)
    const taskId = String(node.props?.taskId), role = rowRole(node), planDate = String(node.props?.planDate ?? '')
    const planned = Object.fromEntries(ws.tasks.map(t => [t.id, plannedOn(ws, t.id)]))
    const marks = rowMarks(ws, ws.tasks.find(t => t.id === taskId), { role, planDate, today: TODAY, planned: plannedOn(ws, taskId) })
    for (const [key, value] of Object.entries(wanted)) expect(`rows/marks ${name}: ${key}`, marks[key as keyof RowMarks], value)
    cases.push({ name, workspace: ws, pageId, blockId, today: TODAY, planned, marks })
  }
  const todayPage = dayId(TODAY)

  // Each shape of the date tag, on rows of today's page.
  {
    const shapes: [string, string | null, string | null, string | null][] = [
      ['due today', '2026-11-26', null, 'Due today'], ['due tomorrow', '2026-11-27', null, 'Due tomorrow'], ['due Sunday', '2026-11-29', null, 'Due Sun'],
      ['due six days ahead', '2026-12-02', null, 'Due Wed 12/2'], ['start tomorrow', null, '2026-11-27', 'Start tomorrow'], ['start passed', null, '2026-11-20', null],
      ['start and due the same far day', '2026-12-05', '2026-12-05', 'Start Sat 12/5 · Due Sat 12/5'], ['start and due tomorrow', '2026-11-27', '2026-11-27', 'Due tomorrow · Start tomorrow'],
      ['start Monday, due far Sunday', '2026-12-06', '2026-11-30', 'Start Mon · Due Sun 12/6'], ['start today, due Sunday', '2026-11-29', '2026-11-26', 'Start today · Due Sun'],
    ]
    const h = rowsWorld()
    saveRows(h, TODAY, ...shapes.map(([name], i) => plan(`d${i}`, name)))
    shapes.forEach(([, deadlineOn, attentionOn], i) => h.run({ type: 'set-task-dates', taskId: taskOf(`d${i}`), deadlineOn, attentionOn }))
    shapes.forEach(([name, , , words], i) => marksCase(`date tag: ${name}`, h, todayPage, `d${i}`, { dateTag: words ? { text: words, warn: false } : null }))
  }
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('p1', 'Pay the invoice'))
    h.run({ type: 'set-task-dates', taskId: taskOf('p1'), deadlineOn: '2026-11-23' })
    marksCase('a passed Due date', h, todayPage, 'p1', { dateTag: { text: 'Was due Mon', warn: true } })
  }

  // Carried: Since from seven days, nothing at six.
  for (const [name, start, since] of [['carried seven days', '2026-11-19', 'Since Nov 19'], ['carried six days', '2026-11-20', null]] as const) {
    const { h, id } = carriedWorld(start, daysBetween(start, TODAY))
    marksCase(name, h, todayPage, rowOf(forBrowser(h.ws), id, todayPage).id, { since })
  }

  // A repeat's current to-do, and the done one.
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('w1', 'Water the plants'))
    h.run({ type: 'set-todo-repeat', taskId: taskOf('w1'), repeat: { every: 'week', interval: 1, from: 'schedule' }, today: TODAY, at: stamped(2) })
    marksCase("a repeat's current to-do", h, todayPage, 'w1', { repeat: 'Repeats every week' })
    h.run({ type: 'task-status', taskId: taskOf('w1'), status: 'done', today: TODAY })
    marksCase('a repeating to-do that is done', h, todayPage, 'w1', { repeat: null, dateTag: null })
  }

  // Blocked by one and by two.
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('a', 'Write the report'), plan('b', 'Get the numbers'), plan('c', 'Book the room'))
    h.run({ type: 'link-tasks', taskId: taskOf('a'), add: [taskOf('b')], remove: [], at: stamped(2) })
    marksCase('blocked by one', h, todayPage, 'a', { blockedBy: 'Blocked by Get the numbers' })
    h.run({ type: 'link-tasks', taskId: taskOf('a'), add: [taskOf('c')], remove: [], at: stamped(3) })
    marksCase('blocked by two', h, todayPage, 'a', { blockedBy: 'Blocked by 2' })
  }

  // Cancelled, done, reference rows.
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('x1', 'Cancelled one'), plan('x2', 'Done one'), plan('x3', 'Open one'), plan('x4', 'Another done one'), plan('x5', 'Another cancelled one'), plan('x6', 'Due one'))
    h.run({ type: 'set-task-dates', taskId: taskOf('x6'), deadlineOn: '2026-11-23' })
    h.run({ type: 'task-status', taskId: taskOf('x1'), status: 'cancelled', today: TODAY })
    h.run({ type: 'task-status', taskId: taskOf('x2'), status: 'done', today: TODAY })
    h.run({ type: 'task-status', taskId: taskOf('x4'), status: 'done', today: TODAY })
    h.run({ type: 'task-status', taskId: taskOf('x5'), status: 'cancelled', today: TODAY })
    h.run({ type: 'plan-task', taskId: taskOf('x3'), date: '2026-11-27', from: TODAY, today: TODAY })
    h.run({ type: 'plan-task', taskId: taskOf('x6'), date: '2026-11-27', from: TODAY, today: TODAY })
    saveRows(h, TODAY, reference('f3', taskOf('x3'), 'Open one'), reference('f4', taskOf('x4'), 'Another done one'), reference('f5', taskOf('x5'), 'Another cancelled one'), reference('f6', taskOf('x6'), 'Due one'))
    marksCase('a cancelled plan row', h, todayPage, 'x1', { cancelled: 'Cancelled', reference: null, planForToday: null })
    marksCase('a done plan row', h, todayPage, 'x2', { cancelled: null, reference: null, dateTag: null, since: null, repeat: null, movedTo: null })
    marksCase('an open reference row', h, todayPage, 'f3', { reference: 'Reference', planForToday: 'active' })
    marksCase('a done reference row', h, todayPage, 'f4', { reference: 'Reference', planForToday: 'hidden', cancelled: null })
    marksCase('a cancelled reference row', h, todayPage, 'f5', { reference: 'Reference', planForToday: 'hidden', cancelled: 'Cancelled' })
    marksCase('a reference row worded against today', h, todayPage, 'f6', { dateTag: { text: 'Was due Mon', warn: true } })
  }
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('y1', 'Planned for today and referenced'))
    h.day('2026-11-30')
    saveRows(h, '2026-11-30', reference('g1', taskOf('y1'), 'Planned for today and referenced'))
    marksCase('a reference row planned today', h, dayId('2026-11-30'), 'g1', { reference: 'Reference', planForToday: 'active' })
  }

  // A history row: the plan moved on to a later day and the row stays as the record.
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('m1', 'Moved on'))
    h.run({ type: 'plan-task', taskId: taskOf('m1'), date: '2026-11-27', today: TODAY })
    marksCase('a history row', h, todayPage, 'm1', { movedTo: 'Moved to Fri 11/27' })
  }
  // A row whose to-do the workspace does not hold.
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('k1', 'Anchor'))
    setDocument(h, todayPage, d => [...d, plan('k2', 'A to-do that is gone')].map(n => (n.id === 'k2' ? { ...n, props: { ...n.props, taskId: 'editor-task:gone' } } : n)))
    marksCase("a row whose to-do the workspace doesn't hold", h, todayPage, 'k2', { cancelled: null, reference: null, movedTo: null, dateTag: null, since: null, repeat: null, blockedBy: null, planForToday: null })
  }
  put('rows/marks.json', cases)
}

// carried/cases.json: every scenario of tests/carried.test.ts.
{
  const start = '2026-11-03', day = (n: number) => addDays(start, n)
  const cases: unknown[] = []
  const carriedCase = (name: string, h: World, taskId: string, today: string, wanted: string | null) => {
    const ws = forBrowser(h.ws)
    const since = carriedSince(ws, ws.tasks.find(t => t.id === taskId)!, today)
    expect(`carried ${name}`, since, wanted)
    cases.push({ name, workspace: ws, taskId, today, since, label: since ? `Since ${sinceLabel(since, today)}` : null })
  }
  { const { h, id } = carriedWorld(start, 7); carriedCase('carried by the draft for 7 days reads since the day it was typed', h, id, day(7), start) }
  { const { h, id } = carriedWorld(start, 6); carriedCase('carried by the draft for 6 days reads nothing', h, id, day(6), null) }
  {
    const { h, id } = carriedWorld(start, 7)
    h.run({ type: 'plan-task', taskId: id, date: day(8), from: day(7), today: day(7) })
    for (let n = 9; n <= 14; n++) carryIn(h, day(n), id)
    carriedCase('a move starts the clock again: six days after it, nothing', h, id, day(14), null)
    carryIn(h, day(15), id)
    carriedCase('a move starts the clock again: seven days after it, since the day it moved to', h, id, day(15), day(8))
  }
  { const { h, id } = carriedWorld(start, 8); h.run({ type: 'task-status', taskId: id, status: 'done', today: day(8) }); carriedCase('a done to-do reads nothing', h, id, day(8), null) }
  { const { h, id } = carriedWorld(start, 8); h.run({ type: 'not-today', taskId: id, date: day(8) }); carriedCase('a paused to-do reads nothing', h, id, day(8), null) }
  { const { h, id } = carriedWorld(start, 8); h.run({ type: 'plan-task', taskId: id, date: day(12), from: day(8), today: day(8) }); carriedCase('a to-do planned for a later day reads nothing', h, id, day(8), null) }
  { const { h, id } = carriedWorld(start, 8); carriedCase("another day than the to-do's plan reads nothing", h, id, day(9), null) }
  {
    const { h, id } = carriedWorld(start, 3)
    h.run({ type: 'not-today', taskId: id, date: day(3) })
    h.run({ type: 'plan-task', taskId: id, date: day(5), today: day(5) })
    for (let n = 6; n <= 12; n++) carryIn(h, day(n), id)
    carriedCase('resumed after Not today counts from the day it was planned again', h, id, day(12), day(5))
  }
  put('carried/cases.json', cases)
}

// repeats/words.json
{
  const rules: TodoRepeatRule[] = [
    { every: 'day', interval: 1, from: 'schedule' }, { every: 'day', interval: 3, from: 'schedule' }, { every: 'week', interval: 1, from: 'schedule' },
    { every: 'week', interval: 2, weekdays: [1, 4], from: 'schedule' }, { every: 'month', interval: 1, from: 'schedule' }, { every: 'year', interval: 1, from: 'schedule' },
    { every: 'day', interval: 5, from: 'done' }, { every: 'week', interval: 1, from: 'schedule', until: '2026-12-31' },
  ]
  const cases = rules.map(rule => ({ rule, words: repeatWords(rule), markName: repeatMarkName(rule) }))
  expect('repeats/words', cases.map(c => c.words), ['every day', 'every 3 days', 'every week', 'every 2 weeks on Mon, Thu', 'every month', 'every year', "every 5 days, from when it's done", 'every week'])
  expect('repeats/words: the mark names the rule', cases[2]!.markName, 'Repeats every week')
  put('repeats/words.json', cases)
}

// blockers/cases.json: `blocked` maps each blocked to-do to its blockers in link order; `words` to what is drawn.
{
  const cases: unknown[] = []
  const blockersCase = (name: string, h: World, wanted: Record<string, string[]>) => {
    const ws = forBrowser(h.ws)
    const found = blockedIn(ws)
    const blocked = Object.fromEntries([...found].map(([id, b]) => [id, b.by.map(t => t.id)]))
    const words = Object.fromEntries([...found].map(([id, b]) => [id, blockedByWords(b)]))
    expect(`blockers ${name}`, blocked, wanted)
    cases.push({ name, workspace: ws, blocked, words })
  }
  const a = taskOf('a'), b = taskOf('b'), c = taskOf('c')
  const linked = () => {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('a', 'Write the report'), plan('b', 'Get the numbers'), plan('c', 'Book the room'))
    h.run({ type: 'link-tasks', taskId: a, add: [b], remove: [], at: stamped(2) })
    return h
  }
  blockersCase('one in force', linked(), { [a]: [b] })
  { const h = linked(); h.run({ type: 'task-status', taskId: b, status: 'done', today: TODAY }); blockersCase('the blocker done', h, {}) }
  { const h = linked(); h.run({ type: 'task-status', taskId: b, status: 'cancelled', today: TODAY }); blockersCase('the blocker cancelled', h, {}) }
  {
    // Paused still holds. Not today takes the row off the day, so the blocker keeps a line on another page to stay live.
    const h = linked()
    h.day('2026-11-30')
    saveRows(h, '2026-11-30', reference('r', b, 'Get the numbers'))
    h.run({ type: 'not-today', taskId: b, date: TODAY })
    if (!h.ws.tasks.find(t => t.id === b)!.paused) throw new Error('blockers: the blocker must be paused')
    blockersCase('the blocker paused still holds', h, { [a]: [b] })
  }
  { const h = linked(); h.run({ type: 'task-status', taskId: a, status: 'done', today: TODAY }); blockersCase('the blocked to-do done', h, {}) }
  {
    const h = rowsWorld()
    h.run({ type: 'create-document', title: 'Notes', body: '', pageId: 'doc-n' }, 'make-notes')
    saveRows(h, TODAY, plan('a', 'Write the report'))
    h.save('doc-n', d => [...d, todo('b', 'Get the numbers', 'plan', '')], { today: TODAY, at: stamped(1) })
    h.run({ type: 'link-tasks', taskId: a, add: [b], remove: [], at: stamped(2) })
    h.run({ type: 'delete-page', pageId: 'doc-n', at: stamped(3) })
    blockersCase("an end whose only row is in Trash", h, {})
  }
  {
    const h = linked()
    h.run({ type: 'create-template', title: 'A template', pageId: 'tpl-1' }, 'make-template')
    const row = rowOf(h.ws, b, dayId(TODAY))
    setDocument(h, dayId(TODAY), d => d.filter(n => n.id !== row.id))
    setDocument(h, 'tpl-1', d => [...d, row])
    blockersCase('an end whose only row is on a template', h, {})
  }
  {
    const h = linked()
    const anchor = pageNodes(h.page(dayId(TODAY)))[0]!.id
    h.run({ type: 'set-draft', pageId: dayId(TODAY), status: 'ready', moreOpen: [], allowedTaskIds: [c], items: [{ id: 'i0', anchor, place: 'after', taskId: c, source: 'model', state: 'open' }] } as never)
    const row = rowOf(h.ws, b, dayId(TODAY))
    const draft = h.ws.pages.find(p => p.type === 'draft')
    if (!draft) throw new Error('blockers: the day must have a draft page')
    setDocument(h, dayId(TODAY), d => d.filter(n => n.id !== row.id))
    setDocument(h, draft.id, d => [...d, row])
    blockersCase("an end whose only row is on a day's draft", h, {})
  }
  {
    const h = linked()
    h.run({ type: 'link-tasks', taskId: a, add: [c], remove: [], at: stamped(3) })
    blockersCase('two blockers', h, { [a]: [b, c] })
    expect('blockers: two blockers read as a count', (cases.at(-1) as { words: Record<string, string> }).words[a], 'Blocked by 2')
  }
  expect('blockers: one blocker reads as its title', (cases[0] as { words: Record<string, string> }).words[a], 'Blocked by Get the numbers')
  put('blockers/cases.json', cases)
}

// notices/cases.json
{
  const cases: unknown[] = []
  const noticeCase = (name: string, intent: RowIntent, task: Task, day: string, today: string, receipt: { message: string; nextTodos?: { taskId: string; on: string }[] }, plannedAfter: string | null, wanted: string) => {
    const text = rowNoticeText(intent, { task, day, today, receipt, plannedAfter })
    expect(`notices ${name}`, text, wanted)
    cases.push({ name, intent, task, day, today, receipt, plannedAfter, text })
  }
  const plain = aTask(), due = aTask({ deadlineOn: '2026-11-27' })
  const made = (on: string) => ({ taskId: 'next', on })
  noticeCase('a move to tomorrow', { kind: 'move', date: '2026-11-27' }, plain, TODAY, TODAY, { message: 'Task moved' }, '2026-11-27', 'Moved to Fri, Nov 27')
  noticeCase('a move to a day next year', { kind: 'move', date: '2027-01-04' }, plain, TODAY, TODAY, { message: 'Task moved' }, '2027-01-04', 'Moved to Mon, Jan 4')
  noticeCase('a move to today by Pick date', { kind: 'move', date: TODAY }, plain, '2026-11-27', TODAY, { message: 'Task moved' }, TODAY, 'Moved to Thu, Nov 26')
  noticeCase('bring to today', { kind: 'bring-today' }, plain, '2026-11-20', TODAY, { message: 'Task moved' }, TODAY, 'On today')
  noticeCase("not today on today's page", { kind: 'not-today' }, plain, TODAY, TODAY, { message: 'Task set aside' }, null, 'Not today — won’t carry over')
  noticeCase("not today on today's page with a Due date", { kind: 'not-today' }, due, TODAY, TODAY, { message: 'Task set aside' }, null, 'Not today — won’t carry over · due Fri still tracked')
  noticeCase('not today on another day', { kind: 'not-today' }, plain, '2026-11-27', TODAY, { message: 'Task set aside' }, null, 'Not on Fri 11/27')
  noticeCase('not today on another day with a Due date', { kind: 'not-today' }, due, '2026-11-27', TODAY, { message: 'Task set aside' }, null, 'Not on Fri 11/27 · due Fri still tracked')
  noticeCase('a stale row', { kind: 'not-today' }, plain, '2026-11-27', TODAY, { message: 'Removed from the day' }, '2026-11-30', 'Removed from Fri · still planned for Mon')
  noticeCase('cancel with one next to-do this year', { kind: 'cancel' }, plain, TODAY, TODAY, { message: 'Task cancelled', nextTodos: [made('2026-12-07')] }, TODAY, 'Cancelled · Next Mon, Dec 7')
  noticeCase('cancel with one next to-do next year', { kind: 'cancel' }, plain, TODAY, TODAY, { message: 'Task cancelled', nextTodos: [made('2027-11-24')] }, TODAY, 'Cancelled · Next Wed, Nov 24, 2027')
  noticeCase('cancel with no next to-do', { kind: 'cancel' }, plain, TODAY, TODAY, { message: 'Task cancelled' }, TODAY, 'Cancelled')
  noticeCase('cancel with two next to-dos', { kind: 'cancel' }, plain, TODAY, TODAY, { message: 'Task cancelled', nextTodos: [made('2026-12-07'), made('2026-12-14')] }, TODAY, 'Cancelled')
  noticeCase('restore', { kind: 'restore' }, plain, TODAY, TODAY, { message: 'Task reopened' }, TODAY, 'Restored')
  put('notices/cases.json', cases)
  // The row's fixed words, which no case above reaches (a refused action, Undo's own notices).
  for (const [key, words] of Object.entries(rowNotices)) if (!words.trim()) throw new Error(`notices/fixed: ${key} is empty`)
  put('notices/fixed.json', rowNotices)
}

// actions/<name>.json: a row's command as the server takes or refuses it.
// `{ before, intent, taskId, day, today, action, receipt, after, plannedAfter, notice }`: `action` is rowAction's, applied as is;
// `after` is as the browser gets it, so it holds the Undo marker `{ operationId: "cmd-<name>", revision }`.
{
  const undoRefusal = 'Cannot undo after later changes; current values kept'
  const actionWorld = () => { const h = rowsWorld(); saveRows(h, TODAY, plan('r1', 'Write the report'), plan('r2', 'Call the dentist')); return h }
  const id1 = taskOf('r1')
  const takenAction = (name: string, h: World, intent: RowIntent | null, taskId: string, day: string | null, action: Action, noticeOf: (receipt: Parameters<typeof rowNoticeText>[1]['receipt'], plannedAfter: string | null, task: Task) => string) => {
    const before = forBrowser(h.ws)
    const task = before.tasks.find(t => t.id === taskId)!
    const result = applyCommand(h.ws, { operationId: `cmd-${name}`, expectedRevision: h.ws.revision, action })
    h.ws = result.workspace
    const after = forBrowser(result.workspace)
    // An Undo takes the slot's copy back and leaves nothing to undo; every other answer leaves its own.
    if (action.type === 'undo' ? after.undo !== undefined : after.undo?.operationId !== `cmd-${name}`) throw new Error(`actions ${name}: the Undo marker is not what the command leaves`)
    const plannedAfter = plannedOn(after, taskId)
    put(`actions/${name}.json`, { before, intent, taskId, day, today: TODAY, action, receipt: result.receipt, after, plannedAfter, notice: noticeOf(result.receipt, plannedAfter, task) })
    return { before, after, receipt: result.receipt, task: after.tasks.find(t => t.id === taskId)! }
  }
  const rowTaken = (name: string, h: World, intent: RowIntent, taskId: string, day: string) =>
    takenAction(name, h, intent, taskId, day, rowAction(intent, taskId, day, TODAY), (receipt, plannedAfter, task) => rowNoticeText(intent, { task, day, today: TODAY, receipt, plannedAfter }))
  const notice = (name: string) => (JSON.parse(files.get(`actions/${name}.json`)!) as { notice: string }).notice
  const refusedAction = (name: string, h: World, action: Action, message: string) => {
    const before = forBrowser(h.ws)
    try { applyCommand(h.ws, { operationId: `cmd-${name}`, expectedRevision: h.ws.revision, action }) } catch (e) {
      if (!(e instanceof DomainError) || e.message !== message) throw new Error(`actions ${name}: expected the refusal "${message}", got ${e instanceof Error ? e.message : e}`)
      put(`actions/${name}.json`, { before, operationId: `cmd-${name}`, today: TODAY, action, refused: message, notice: rowNotices.cantUndo })
      return
    }
    throw new Error(`actions ${name}: the command was not refused`)
  }
  const rowsOn = (ws: Workspace, date: string) => flatNodes(pageNodes(ws.pages.find(p => p.id === dayId(date))!)).map(n => rowTaskId(n)).filter(Boolean)

  { // move-to-a-day-with-a-page
    const h = actionWorld(); h.day('2026-11-27')
    const r = rowTaken('move-to-a-day-with-a-page', h, { kind: 'move', date: '2026-11-27' }, id1, TODAY)
    expect('actions move-to-a-day-with-a-page', [plannedOn(r.after, id1), notice('move-to-a-day-with-a-page')], ['2026-11-27', 'Moved to Fri, Nov 27'])
  }
  { // move-to-a-day-without-a-page
    const h = actionWorld()
    if (h.ws.pages.some(p => p.id === dayId('2026-12-02'))) throw new Error('actions move-to-a-day-without-a-page: the day must have no page')
    const r = rowTaken('move-to-a-day-without-a-page', h, { kind: 'move', date: '2026-12-02' }, id1, TODAY)
    if (!r.after.pages.some(p => p.id === dayId('2026-12-02'))) throw new Error('actions move-to-a-day-without-a-page: the new day page must be in `after`')
    expect('actions move-to-a-day-without-a-page', [plannedOn(r.after, id1), notice('move-to-a-day-without-a-page')], ['2026-12-02', 'Moved to Wed, Dec 2'])
  }
  { // bring-to-today-from-a-past-day
    const h = rowsWorld(); h.day('2026-11-20')
    saveRows(h, '2026-11-20', plan('r1', 'Write the report', '2026-11-20'))
    const r = rowTaken('bring-to-today-from-a-past-day', h, { kind: 'bring-today' }, id1, '2026-11-20')
    expect('actions bring-to-today-from-a-past-day', [plannedOn(r.after, id1), rowsOn(r.after, '2026-11-20').includes(id1), notice('bring-to-today-from-a-past-day')], [TODAY, true, 'On today'])
  }
  { // plan-for-today-from-a-reference-row: the button's command is bring-to-today's, and its notice is the button's own words.
    const h = rowsWorld(); h.day('2026-11-30')
    saveRows(h, '2026-11-30', plan('r1', 'Write the report', '2026-11-30'))
    saveRows(h, TODAY, reference('f1', id1, 'Write the report'))
    const action = { type: 'plan-task', taskId: id1, date: TODAY, today: TODAY } as const
    const intent: RowIntent = { kind: 'bring-today' }
    expect('actions plan-for-today-from-a-reference-row: the button sends bring-today\'s command', rowAction(intent, id1, TODAY, TODAY), action)
    const r = takenAction('plan-for-today-from-a-reference-row', h, intent, id1, TODAY, action, () => rowNotices.plannedForToday)
    expect('actions plan-for-today-from-a-reference-row', [plannedOn(r.after, id1), notice('plan-for-today-from-a-reference-row')], [TODAY, 'Planned for today'])
  }
  { // not-today-sets-aside
    const h = actionWorld()
    const r = rowTaken('not-today-sets-aside', h, { kind: 'not-today' }, id1, TODAY)
    expect('actions not-today-sets-aside', [r.task.paused, rowsOn(r.after, TODAY).includes(id1), notice('not-today-sets-aside')], [true, false, 'Not today — won’t carry over'])
  }
  { // not-today-on-a-later-day
    const h = rowsWorld(); h.day('2026-11-27')
    saveRows(h, '2026-11-27', plan('r1', 'Write the report', '2026-11-27'))
    const r = rowTaken('not-today-on-a-later-day', h, { kind: 'not-today' }, id1, '2026-11-27')
    expect('actions not-today-on-a-later-day', [r.task.paused, notice('not-today-on-a-later-day')], [true, 'Not on Fri 11/27'])
  }
  { // not-today-on-a-stale-row
    const h = actionWorld()
    h.run({ type: 'plan-task', taskId: id1, date: '2026-11-30', today: TODAY })
    const r = rowTaken('not-today-on-a-stale-row', h, { kind: 'not-today' }, id1, TODAY)
    expect('actions not-today-on-a-stale-row', [r.receipt.message, r.task.paused, plannedOn(r.after, id1), notice('not-today-on-a-stale-row')], ['Removed from the day', false, '2026-11-30', 'Removed from Thu · still planned for Mon'])
  }
  { // cancel-a-repeating-to-do
    const h = actionWorld()
    h.run({ type: 'set-todo-repeat', taskId: id1, repeat: { every: 'day', interval: 1, from: 'schedule' }, today: TODAY, at: stamped(2) })
    const r = rowTaken('cancel-a-repeating-to-do', h, { kind: 'cancel' }, id1, TODAY)
    expect('actions cancel-a-repeating-to-do', [r.task.status, r.receipt.nextTodos?.length, notice('cancel-a-repeating-to-do')], ['cancelled', 1, 'Cancelled · Next Fri, Nov 27'])
  }
  { // restore
    const h = actionWorld()
    h.run({ type: 'task-status', taskId: id1, status: 'cancelled', today: TODAY })
    const r = rowTaken('restore', h, { kind: 'restore' }, id1, TODAY)
    expect('actions restore', [r.task.status, notice('restore')], ['open', 'Restored'])
  }
  { // undo, of cmd-move made in `before`
    const h = actionWorld()
    h.run({ type: 'plan-task', taskId: id1, date: '2026-11-27', from: TODAY, today: TODAY }, 'cmd-move')
    const r = takenAction('undo', h, null, id1, null, { type: 'undo', targetOperationId: 'cmd-move' }, () => rowNotices.undone)
    expect('actions undo', [plannedOn(r.after, id1), notice('undo')], [TODAY, 'Undone'])
  }
  { // undo-after-a-later-change
    const h = actionWorld()
    h.run({ type: 'plan-task', taskId: id1, date: '2026-11-27', from: TODAY, today: TODAY }, 'cmd-move')
    h.run({ type: 'task-status', taskId: taskOf('r2'), status: 'done', today: TODAY })
    refusedAction('undo-after-a-later-change', h, { type: 'undo', targetOperationId: 'cmd-move' }, undoRefusal)
  }
  { // undo-after-ensure-day
    const h = actionWorld()
    h.run({ type: 'plan-task', taskId: id1, date: '2026-11-27', from: TODAY, today: TODAY }, 'cmd-move')
    h.run({ type: 'ensure-day', date: '2026-11-28' })
    refusedAction('undo-after-ensure-day', h, { type: 'undo', targetOperationId: 'cmd-move' }, undoRefusal)
  }
}

// ---- the morning -------------------------------------------------------------------------------------------------------
// What the strip above a day's page says and does (docs/design/native-phase-1.md §12), made by running the web's own
// functions (src/components) and the server's own commands. Today is Thu 2026-11-26.
const YESTERDAY = '2026-11-25'
const eventsUnder = (h: World, date: string, ...lines: EditorNode[]) => h.save(dayId(date), d => underHeading(d, 'Events', ...lines), { today: TODAY, at: stamped(1) })
const errands = (h: World) => h.run({ type: 'create-document', title: 'Errands', body: '', pageId: 'errands' }, 'make-errands')
/** To-do rows on the Errands page: no plan day, so nothing is planned by them. */
const errandRows = (h: World, ...rows: [id: string, title: string][]) => h.save('errands', d => [...d, ...rows.map(([id, title]) => todo(id, title, 'plan', ''))], { today: TODAY, at: stamped(2) })
const datesOf = (h: World, id: string, dates: { deadlineOn?: string; attentionOn?: string }) => h.run({ type: 'set-task-dates', taskId: taskOf(id), ...dates })
const setAside = (h: World, taskId: string) => h.run({ type: 'not-today', taskId, date: TODAY })
const factsOf = (ws: Workspace, date: string, today = TODAY) => dayFacts(getDayView(ws, date), ws, date, today)

// events/cases.json: the events of a day as dayEvents reads them from the pages.
{
  const cases: unknown[] = []
  const eventsCase = (name: string, h: World, wanted: [title: string, lineId: string][], extra: { unreadablePageId?: string } = {}) => {
    const ws = forBrowser(h.ws)
    const events = dayEvents(ws, TODAY).map(e => ({ id: e.id, title: e.title, date: e.date, time: e.time, line: { pageId: e.line!.pageId, lineId: e.line!.lineId } }))
    expect(`events ${name}`, events.map(e => [e.title, e.line.lineId]), wanted)
    cases.push({ name, workspace: ws, day: TODAY, events, ...extra })
  }
  const line = (id: string, ...content: unknown[]) => bullet(id, ...content)
  const docPage = (h: World, pageId: string, title: string, ...lines: EditorNode[]) => {
    h.run({ type: 'create-document', title, body: '', pageId }, `make-${pageId}`)
    if (lines.length) h.save(pageId, d => [...d, ...lines], { today: TODAY, at: stamped(3) })
  }

  { const h = rowsWorld(); eventsUnder(h, TODAY, line('l1', text('Standup with Lu '), chip('e1', TODAY, '10:30'))); eventsCase('one chip in a line', h, [['Standup with Lu', 'l1']]) }
  {
    const h = rowsWorld()
    h.run({ type: 'create-template', title: 'My day', pageId: 'tpl-1' }, 'make-template')
    setDocument(h, 'tpl-1', d => [...d, line('t1', text('Standup '), chip('e1', TODAY, '10:30'))])
    eventsCase('a chip on the day template', h, [])
  }
  {
    const h = rowsWorld()
    docPage(h, 'doc-t', 'Old notes', line('t1', text('Standup '), chip('e1', TODAY, '10:30')))
    h.run({ type: 'delete-page', pageId: 'doc-t', at: stamped(4) }, 'trash-doc-t')
    eventsCase('a chip on a page in Trash', h, [])
  }
  {
    const h = rowsWorld()
    saveRows(h, TODAY, plan('r1', 'Write the report'))
    const anchor = pageNodes(h.page(dayId(TODAY)))[0]!.id
    h.run({ type: 'set-draft', pageId: dayId(TODAY), status: 'ready', moreOpen: [], allowedTaskIds: [taskOf('r1')], items: [{ id: 'i0', anchor, place: 'after', taskId: taskOf('r1'), source: 'model', state: 'open' }] } as never)
    const draft = h.ws.pages.find(p => p.type === 'draft')
    if (!draft) throw new Error('events: the day must have a draft page')
    setDocument(h, draft.id, d => [...d, line('t1', text('Standup '), chip('e1', TODAY, '10:30'))])
    eventsCase("a chip on a day's draft page", h, [])
  }
  // In these the chosen line is on a later page than the line met first, so "the first holder met wins" fails them.
  const chosenLaterThanFirstMet = (name: string, eventId: string) => {
    const c = cases.at(-1) as { workspace: Workspace; events: { id: string; line: { pageId: string } }[] }
    const holders = c.workspace.pages.filter(p => flatNodes(pageNodes(p)).some(n => JSON.stringify(n.content ?? []).includes(`"eventId":"${eventId}"`)))
    const order = c.workspace.pages.map(p => p.id)
    const chosen = c.events.find(e => e.id === eventId)!.line.pageId
    if (holders.length < 2 || holders[0]!.id === chosen || order.indexOf(chosen) < order.indexOf(holders[0]!.id)) throw new Error(`events ${name}: the chosen line must be on a later page than the line met first`)
  }
  {
    const h = harness(); h.day(YESTERDAY); h.day(TODAY)
    eventsUnder(h, YESTERDAY, line('y1', text('Yesterday’s words '), chip('same', TODAY)))
    eventsUnder(h, TODAY, line('t1', text('Today’s words '), chip('same', TODAY)))
    eventsCase('one eventId in two lines on two day pages', h, [['Today’s words', 't1']])
    chosenLaterThanFirstMet('one eventId in two lines on two day pages', 'same')
  }
  {
    const h = harness()
    docPage(h, 'doc-a', 'Trip notes', line('a1', text('From the document '), chip('same', TODAY)))
    h.day(TODAY)
    eventsUnder(h, TODAY, line('t1', text('From the day '), chip('same', TODAY)))
    eventsCase('one eventId on a day page and a document page', h, [['From the day', 't1']])
    chosenLaterThanFirstMet('one eventId on a day page and a document page', 'same')
  }
  { // Yesterday's page, then a document, then today's page: `same` is met first on yesterday's and chosen from today's,
    // after `other`'s page; at one time the two keep the order their ids were first met.
    const h = harness(); h.day(YESTERDAY)
    docPage(h, 'doc-a', 'Between')
    h.day(TODAY)
    eventsUnder(h, YESTERDAY, line('y1', text('Planning, as first written '), chip('same', TODAY, '09:00')))
    h.save('doc-a', d => [...d, line('a1', text('Coffee with Ana '), chip('other', TODAY, '09:00'))], { today: TODAY, at: stamped(3) })
    eventsUnder(h, TODAY, line('t1', text('Planning '), chip('same', TODAY, '09:00')))
    const name = 'ties keep the order ids were first met, not where the chosen line is'
    eventsCase(name, h, [['Planning', 't1'], ['Coffee with Ana', 'a1']])
    chosenLaterThanFirstMet(name, 'same')
    const c = cases.at(-1) as { workspace: Workspace; events: { line: { pageId: string } }[] }
    const order = c.workspace.pages.map(p => p.id)
    if (order.indexOf(c.events[0]!.line.pageId) < order.indexOf(c.events[1]!.line.pageId)) throw new Error(`events ${name}: the first event's chosen line must be on a later page than the second's`)
  }
  {
    const h = rowsWorld()
    docPage(h, 'doc-a', 'First', line('a1', text('From the first '), chip('same', TODAY)))
    docPage(h, 'doc-b', 'Second', line('b1', text('From the second '), chip('same', TODAY)))
    eventsCase('one eventId on two document pages', h, [['From the first', 'a1']])
  }
  {
    const h = rowsWorld()
    eventsUnder(h, TODAY, line('l1', text('Dentist '), chip('e1', TODAY, '15:00')), line('l2', text('Lunch with Kathy '), chip('e2', TODAY)), line('l3', text('Standup with Lu '), chip('e3', TODAY, '10:30')))
    eventsCase('three on one day', h, [['Lunch with Kathy', 'l2'], ['Standup with Lu', 'l3'], ['Dentist', 'l1']])
  }
  {
    const h = rowsWorld()
    docPage(h, 'doc-a', 'First', line('a1', text('Met first '), chip('e1', TODAY, '09:00')))
    docPage(h, 'doc-b', 'Second', line('b1', text('Met second '), chip('e2', TODAY, '09:00')))
    eventsCase('two at the same time on two pages', h, [['Met first', 'a1'], ['Met second', 'b1']])
  }
  {
    const h = rowsWorld()
    docPage(h, 'doc-live', 'Reading list')
    docPage(h, 'doc-trashed', 'Old plans')
    h.run({ type: 'delete-page', pageId: 'doc-trashed', at: stamped(4) }, 'trash-old-plans')
    const nestedLink = { type: 'link', href: 'https://example.com/plan', content: [text('the plan'), chip('nested', TODAY, '08:00')] }
    eventsUnder(h, TODAY,
      line('w1', text('Meet '), chip('e1', TODAY), text(' Sam')),
      line('w2', text('Read '), pageRef('doc-live', 'ref-1'), chip('e2', TODAY)),
      line('w3', text('Look at '), pageRef('doc-trashed', 'ref-2'), chip('e3', TODAY)),
      line('w4', text('See '), pageRef('doc-gone', 'ref-3'), chip('e4', TODAY)),
      line('w5', text('Read '), nestedLink, text(' today'), chip('e5', TODAY)),
      line('w6', text('  a\t　b﻿ c '), chip('e6', TODAY)),
      line('w7', text('a\u0085b​c'), chip('e7', TODAY)),
    )
    eventsCase('titles', h, [['Meet Sam', 'w1'], ['Read Reading list', 'w2'], ['Look at Old plans', 'w3'], ['See', 'w4'], ['Read the plan today', 'w5'], ['a b c', 'w6'], ['a\u0085b​c', 'w7']])
  }
  {
    const h = rowsWorld()
    eventsUnder(h, TODAY, line('l1', text('Swim'), { type: 'dateMention', props: { eventId: '', date: TODAY, time: '' } }, text('lesson'), chip('e1', TODAY)))
    eventsCase('a chip with no eventId beside a good one', h, [['Swim lesson', 'l1']])
  }
  {
    const h = rowsWorld()
    eventsUnder(h, TODAY, { ...line('l1', text('Trip')), children: [line('l2', text('Flight '), chip('e1', TODAY, '07:45'))] })
    eventsCase('a chip on a nested line', h, [['Flight', 'l2']])
  }
  {
    const h = rowsWorld()
    docPage(h, 'doc-odd', 'Odd page')
    setDocument(h, 'doc-odd', () => [{ id: 'odd', type: 'paragraph', props: 5, content: [text('Odd')], children: [] } as unknown as EditorNode, line('l1', text('Call Mum '), chip('e1', TODAY))])
    eventsCase('a page with a node the app cannot read', h, [['Call Mum', 'l1']], { unreadablePageId: 'doc-odd' })
    const odd = JSON.parse((cases.at(-1) as { workspace: Workspace }).workspace.pages.find(p => p.id === 'doc-odd')!.document) as { props?: unknown }[]
    if (!odd.some(n => typeof n.props !== 'object' || n.props === null)) throw new Error('events: the unreadable page must hold a node whose props are not an object')
  }
  put('events/cases.json', cases)
}

// events/times.json, events/lines.json, events/headings.json
{
  const times = ['00:00', '00:15', '01:05', '09:30', '11:59', '12:00', '12:01', '13:00', '15:00', '23:59'].map(time => ({ time, text: shortTime(time) }))
  expect('events/times', times.map(t => t.text), ['12 AM', '12:15 AM', '1:05 AM', '9:30 AM', '11:59 AM', '12 PM', '12:01 PM', '1 PM', '3 PM', '11:59 PM'])
  put('events/times.json', times)

  const ev = (i: number, title: string, time: string | null = null) => ({ id: `e${i}`, title, date: TODAY, time, line: { pageId: dayId(TODAY), lineId: `l${i}` } })
  const lineCase = (name: string, events: ReturnType<typeof ev>[], wanted: ReturnType<typeof eventsLine>) => {
    const line = eventsLine(events)
    expect(`events/lines ${name}`, line, wanted)
    return { name, events, line }
  }
  put('events/lines.json', [
    lineCase('none', [], null),
    lineCase('one with no time', [ev(1, 'Lunch with Kathy')], { text: 'Lunch with Kathy · All day', more: null }),
    lineCase('one at 10:30', [ev(1, 'Standup with Lu', '10:30')], { text: '10:30 AM Standup with Lu', more: null }),
    lineCase('one untitled with no time', [ev(1, '')], { text: 'Untitled event · All day', more: null }),
    lineCase('two with no time', [ev(1, 'Lunch with Kathy'), ev(2, 'Pick up the kids')], { text: 'Lunch with Kathy · Pick up the kids', more: null }),
    lineCase('two timed', [ev(1, 'Standup with Lu', '10:30'), ev(2, 'Dentist', '15:00')], { text: '10:30 AM Standup with Lu · 3 PM Dentist', more: null }),
    lineCase('three', [ev(1, 'Lunch with Kathy'), ev(2, 'Standup with Lu', '10:30'), ev(3, 'Dentist', '15:00')], { text: 'Lunch with Kathy · 10:30 AM Standup with Lu', more: '+1 more' }),
    lineCase('five', [ev(1, 'Lunch with Kathy'), ev(2, 'Standup with Lu', '10:30'), ev(3, 'Dentist', '15:00'), ev(4, 'Gym', '18:00'), ev(5, 'Call Mum', '20:30')], { text: 'Lunch with Kathy · 10:30 AM Standup with Lu', more: '+3 more' }),
  ])

  const head = (id: string, ...content: unknown[]): EditorNode => ({ id, type: 'heading', props: { level: 2 }, content, children: [] })
  const headingCase = (name: string, nodes: EditorNode[], wanted: string | null) => {
    const document = JSON.stringify(nodes)
    const headingId = eventsHeading(JSON.parse(document))?.id ?? null
    expect(`events/headings ${name}`, headingId, wanted)
    return { name, document, headingId }
  }
  const before = para('p1', text('A line before'))
  put('events/headings.json', [
    headingCase('Events', [before, heading('h1', 'Events')], 'h1'),
    headingCase('lower case with spaces', [before, heading('h1', ' events ')], 'h1'),
    headingCase('upper case', [before, heading('h1', 'EVENTS')], 'h1'),
    headingCase('no-break spaces, which trim takes off', [before, heading('h1', ' Events ')], 'h1'),
    headingCase('a next-line character, which trim keeps', [before, heading('h1', 'Events\u0085')], null),
    headingCase('a colon', [before, heading('h1', 'Events:')], null),
    headingCase('a paragraph', [before, para('h1', text('Events'))], null),
    headingCase('a heading nested under a bullet', [before, { ...bullet('b1', text('A bullet')), children: [heading('h1', 'Events')] }], null),
    headingCase('two headings', [before, heading('h1', 'Events'), para('p2', text('Between')), heading('h2', 'Events')], 'h1'),
    headingCase('a heading holding Events and a chip', [before, head('h1', text('Events '), chip('e1', TODAY))], null),
  ])
}

// facts/cases.json: what dayFacts gives, from the workspace as the app holds it.
{
  const cases: unknown[] = []
  const factsCase = (name: string, h: World, date: string, check: (facts: ReturnType<typeof factsOf>, ws: Workspace) => void) => {
    const ws = forBrowser(h.ws)
    const facts = factsOf(ws, date)
    check(facts, ws)
    cases.push({ name, workspace: ws, date, today: TODAY, facts })
  }
  const tags = (rows: { words: string; tag: string }[] | undefined) => rows?.map(r => [r.words, r.tag])
  const eventsHeadingId = (ws: Workspace) => eventsHeading(pageNodes(ws.pages.find(p => p.id === dayId(TODAY))!))!.id

  { // today with all three parts
    const h = rowsWorld(); h.day(YESTERDAY)
    eventsUnder(h, TODAY, bullet('ev1', text('Standup with Lu '), chip('e-standup', TODAY, '10:30')), bullet('ev2', text('Dentist '), chip('e-dentist', TODAY, '15:00')))
    eventsUnder(h, YESTERDAY, bullet('ev3', text('Lunch with Kathy '), chip('e-lunch', TODAY)))
    errands(h)
    errandRows(h, ['taxes', 'File the taxes'], ['invoice', 'Send the invoice'], ['report', 'Start the report'], ['bike', 'Fix the bike'], ['tomorrow', 'Order the paint'], ['done', 'Book the flights'], ['cancelled', 'Renew the lease'])
    datesOf(h, 'taxes', { deadlineOn: TODAY }); datesOf(h, 'invoice', { deadlineOn: '2026-11-23' }); datesOf(h, 'report', { attentionOn: TODAY })
    datesOf(h, 'bike', { deadlineOn: TODAY }); setAside(h, taskOf('bike'))
    datesOf(h, 'tomorrow', { deadlineOn: '2026-11-27' })
    datesOf(h, 'done', { deadlineOn: TODAY }); h.run({ type: 'task-status', taskId: taskOf('done'), status: 'done', today: TODAY })
    datesOf(h, 'cancelled', { deadlineOn: TODAY }); h.run({ type: 'task-status', taskId: taskOf('cancelled'), status: 'cancelled', today: TODAY })
    h.day('2026-11-20')
    h.run({ type: 'add-task', pageId: dayId('2026-11-20'), title: 'Sort the shed', plannedOn: '2026-11-20', attentionOn: '2026-11-20' }, 'add-shed')
    setAside(h, h.task('Sort the shed').id)
    errandRows(h, ['fence', 'Mend the fence'])
    setAside(h, taskOf('fence'))
    h.run({ type: 'add-task', pageId: dayId(TODAY), title: 'Pay the rent', plannedOn: TODAY, deadlineOn: TODAY }, 'add-rent')
    h.run({ type: 'add-task', pageId: dayId(YESTERDAY), title: '　 ', plannedOn: YESTERDAY, deadlineOn: TODAY }, 'add-blank')
    factsCase('today with all three parts', h, TODAY, (f, ws) => {
      expect('facts today with all three parts: events', f!.events, { text: 'Lunch with Kathy · 10:30 AM Standup with Lu', more: '+1 more', headingId: eventsHeadingId(ws) })
      expect('facts today with all three parts: Due soon', tags(f!.dueSoon), [['File the taxes', 'Due today'], ['Send the invoice', 'Was due Mon'], ['Start the report', 'Start today'], ['Fix the bike', 'Not today · Due today'], ['Sort the shed', 'Not today']])
      expect('facts today with all three parts: set aside in Due soon', f!.dueSoon.map(r => r.setAside), [false, false, false, true, true])
      expect('facts today with all three parts: Not today', [f!.notToday?.title, tags(f!.notToday?.rows)], ['Not today · 3', [['Fix the bike', 'Due today'], ['Sort the shed', ''], ['Mend the fence', 'Unscheduled']]])
    })
  }
  { // the order is the workspace's
    const h = rowsWorld(); errands(h)
    errandRows(h, ['bank', 'Call the bank'], ['books', 'Return the books'])
    datesOf(h, 'bank', { deadlineOn: TODAY }); datesOf(h, 'books', { deadlineOn: '2026-11-24' })
    factsCase("the order is the workspace's", h, TODAY, f => expect("facts the order is the workspace's", tags(f!.dueSoon), [['Call the bank', 'Due today'], ['Return the books', 'Was due Tue']]))
  }
  { // a past day's page
    const h = rowsWorld(); h.day('2026-11-20'); errands(h)
    eventsUnder(h, '2026-11-20', bullet('ev1', text('Standup '), chip('e1', '2026-11-20', '10:30')))
    errandRows(h, ['before', 'Send the forms'], ['that-day', 'Pay the plumber'], ['started', 'Clean the gutters'], ['aside', 'Fix the bike'])
    datesOf(h, 'before', { deadlineOn: '2026-11-19' }); datesOf(h, 'that-day', { deadlineOn: '2026-11-20' }); datesOf(h, 'started', { attentionOn: '2026-11-20' })
    setAside(h, taskOf('aside'))
    factsCase("a past day's page", h, '2026-11-20', f => {
      expect("facts a past day's page", [f!.events, tags(f!.dueSoon), f!.notToday], [null, [['Send the forms', 'Was due Thu'], ['Pay the plumber', 'Due that day'], ['Clean the gutters', 'Unscheduled']], null])
    })
  }
  { // a later day's page
    const h = rowsWorld(); h.day('2026-12-03'); errands(h)
    errandRows(h, ['that-day', 'Pay the plumber'], ['today', 'File the taxes'])
    datesOf(h, 'that-day', { deadlineOn: '2026-12-03' }); datesOf(h, 'today', { deadlineOn: TODAY })
    factsCase("a later day's page", h, '2026-12-03', f => expect("facts a later day's page", [f!.events, tags(f!.dueSoon), f!.notToday], [null, [['Pay the plumber', 'Due that day'], ['File the taxes', 'Due today']], null]))
  }
  { // a past day without a page
    const h = rowsWorld(); errands(h)
    errandRows(h, ['that-day', 'Pay the plumber'], ['before', 'Send the forms'])
    datesOf(h, 'that-day', { deadlineOn: '2026-11-24' }); datesOf(h, 'before', { deadlineOn: '2026-11-23' })
    if (h.ws.pages.some(p => p.type === 'daily' && p.date === '2026-11-24')) throw new Error('facts a past day without a page: the day must have no page')
    factsCase('a past day without a page', h, '2026-11-24', f => expect('facts a past day without a page', tags(f!.dueSoon), [['Pay the plumber', 'Due that day'], ['Send the forms', 'Was due Mon']]))
  }
  { // a later day without a page
    const h = rowsWorld(); errands(h)
    errandRows(h, ['later', 'Pay the plumber'])
    datesOf(h, 'later', { deadlineOn: '2026-12-04' })
    factsCase('a later day without a page', h, '2026-12-04', f => expect('facts a later day without a page', f, null))
  }
  { // today in Trash: the chip of yesterday's page is still today's event; the to-do whose row was on today's page is still due
    const h = rowsWorld(); h.day(YESTERDAY); errands(h)
    eventsUnder(h, YESTERDAY, bullet('ev1', text('Lunch with Kathy '), chip('e-lunch', TODAY)))
    eventsUnder(h, TODAY, bullet('ev2', text('Standup with Lu '), chip('e-standup', TODAY, '10:30')))
    errandRows(h, ['taxes', 'File the taxes'], ['aside', 'Fix the bike'])
    datesOf(h, 'taxes', { deadlineOn: TODAY }); setAside(h, taskOf('aside'))
    h.run({ type: 'add-task', pageId: dayId(TODAY), title: 'Pay the rent', plannedOn: TODAY, deadlineOn: TODAY }, 'add-rent')
    h.run({ type: 'delete-page', pageId: dayId(TODAY), at: stamped(5) }, 'trash-today')
    factsCase('today in Trash', h, TODAY, (f, ws) => {
      if (ws.pages.some(p => p.type === 'daily' && p.date === TODAY && !p.trashedAt)) throw new Error('facts today in Trash: today must have no live page')
      expect('facts today in Trash', [f!.events, tags(f!.dueSoon), f!.notToday?.title], [{ text: 'Lunch with Kathy · All day', more: null, headingId: null }, [['File the taxes', 'Due today'], ['Pay the rent', 'Due today']], 'Not today · 1'])
    })
  }
  { // today with events and no Events heading
    const h = rowsWorld()
    h.save(dayId(TODAY), d => [...d.filter(n => !(n.type === 'heading' && inlineText(n.content).trim() === 'Events')), para('ev1', text('Standup with Lu '), chip('e1', TODAY, '10:30'))], { today: TODAY, at: stamped(1) })
    factsCase('today with events and no Events heading', h, TODAY, f => expect('facts today with events and no Events heading', f!.events, { text: '10:30 AM Standup with Lu', more: null, headingId: null }))
  }
  { // nothing to show
    const h = rowsWorld()
    factsCase('nothing to show', h, TODAY, f => expect('facts nothing to show', f, { events: null, dueSoon: [], notToday: null }))
  }
  put('facts/cases.json', cases)
}

// notices/strip.json
{
  const cases = [TODAY, '2026-11-27', '2026-11-28', '2026-11-30', '2027-01-04'].map(date => ({ date, today: TODAY, text: planOnNotice(date, TODAY) }))
  expect('notices/strip', cases.map(c => c.text), ['On today', 'Moved to Fri 11/27', 'Moved to Sat 11/28', 'Moved to Mon 11/30', 'Moved to Mon 1/4'])
  put('notices/strip.json', cases)
}

// facts-actions/<name>.json: the strip's Bring back and Another day as the server takes them.
// `{ before, taskId, date, today, action, receipt, after, notice }`: `action` is planOnAction's, applied as is; `after` is
// as the browser gets it, so it holds the Undo marker `{ operationId: "cmd-<name>", revision }`.
{
  const asideWorld = () => { const h = rowsWorld(); errands(h); errandRows(h, ['bike', 'Fix the bike']); setAside(h, taskOf('bike')); return h }
  const id = taskOf('bike')
  const inNotToday = (ws: Workspace) => factsOf(ws, TODAY)?.notToday?.rows.some(r => r.taskId === id) ?? false
  const factsAction = (name: string, h: World, date: string) => {
    const before = forBrowser(h.ws)
    const action = planOnAction(id, date, TODAY)
    const result = applyCommand(h.ws, { operationId: `cmd-${name}`, expectedRevision: h.ws.revision, action })
    h.ws = result.workspace
    const after = forBrowser(result.workspace)
    if (after.undo?.operationId !== `cmd-${name}`) throw new Error(`facts-actions ${name}: the Undo marker is not what the command leaves`)
    if (!inNotToday(before) || inNotToday(after)) throw new Error(`facts-actions ${name}: the to-do must leave Not today`)
    expect(`facts-actions ${name}: planned`, plannedOn(after, id), date)
    put(`facts-actions/${name}.json`, { before, taskId: id, date, today: TODAY, action, receipt: result.receipt, after, notice: planOnNotice(date, TODAY) })
    return { before, after }
  }
  const planRowOn = (ws: Workspace, date: string) => flatNodes(pageNodes(ws.pages.find(p => p.id === dayId(date))!)).find(n => rowTaskId(n) === id && rowRole(n) === 'plan')

  {
    const h = asideWorld()
    // A plan row already under TODO, so the new row's place says it goes after the heading's plan rows.
    h.run({ type: 'add-task', pageId: dayId(TODAY), title: 'Water the plants', plannedOn: TODAY }, 'add-water')
    const water = h.task('Water the plants').id
    const { before, after } = factsAction('bring-back-a-to-do-set-aside', h, TODAY)
    if (flatNodes(pageNodes(before.pages.find(p => p.id === dayId(TODAY))!)).some(n => rowTaskId(n) === id)) throw new Error('facts-actions bring-back-a-to-do-set-aside: no row on today\'s page before')
    expect('facts-actions bring-back-a-to-do-set-aside', [after.tasks.find(t => t.id === id)!.paused, Boolean(planRowOn(after, TODAY))], [false, true])
    // Today's insert place: right after the TODO heading's plan rows and before its empty slot.
    const top = pageNodes(after.pages.find(p => p.id === dayId(TODAY))!).slice(0, 4).map(n => n.type === 'heading' ? `heading ${inlineText(n.content)}` : `${n.type} ${rowRole(n) ?? ''} ${rowTaskId(n) ?? ''} ${inlineText(n.content)}`)
    expect('facts-actions bring-back-a-to-do-set-aside: the new plan row\'s place', top, ['heading TODO', `task plan ${water} Water the plants`, `task plan ${id} Fix the bike`, `task plan ${taskOf(`${dayId(TODAY)}:r0`)} `])
  }
  {
    const h = asideWorld()
    saveRows(h, TODAY, reference('f1', id, 'Fix the bike'))
    if (!flatNodes(pageNodes(h.page(dayId(TODAY)))).some(n => n.id === 'f1' && rowRole(n) === 'reference')) throw new Error('facts-actions bring-back-with-a-reference-row-on-today: the reference row must be on today\'s page')
    const { after } = factsAction('bring-back-with-a-reference-row-on-today', h, TODAY)
    expect('facts-actions bring-back-with-a-reference-row-on-today: the plan row keeps the block id', planRowOn(after, TODAY)?.id, 'f1')
  }
  {
    const h = asideWorld(); h.day('2026-11-28')
    factsAction('another-day-to-a-day-with-a-page', h, '2026-11-28')
  }
  {
    const h = asideWorld()
    if (h.ws.pages.some(p => p.id === dayId('2026-11-30'))) throw new Error('facts-actions another-day-to-a-day-without-a-page: the day must have no page')
    const { after } = factsAction('another-day-to-a-day-without-a-page', h, '2026-11-30')
    if (!after.pages.some(p => p.id === dayId('2026-11-30'))) throw new Error('facts-actions another-day-to-a-day-without-a-page: the new day page must be in `after`')
  }
}

// ---- the day draft -----------------------------------------------------------------------------------------------------
// The day's draft (docs/design/native-phase-1.md §13): its document, the planning part of a page, what a page shows of it,
// the line above the page, its notices and its commands, made by running the web's own functions (src/domain,
// src/components, the server's carry in src/server/model) and the server's own commands. A case that mirrors a web test
// names it as `test` and builds its world as that test does, on that test's days (its today is Thu 2026-10-22); the
// others are on Thu 2026-11-26. Every save states its `at`, so no page's edit time is the clock's.
{
  const todayPage = dayId(TODAY)
  const when = (date: string, hm = '09:00') => `${date}T${hm}:00.000Z`
  const lineBlock = (id: string, type: string, words: string): EditorNode => ({ id, type, props: {}, content: [text(words)], children: [] })
  const draftItem = (id: string, extra: Partial<DraftItem>): DraftItem => ({ id, anchor: '', place: 'after', source: 'model', state: 'open', ...extra })
  const setDraft = (h: World, pageId: string, status: 'preparing' | 'ready' | 'failed', items: DraftItem[], extra: { recipe?: number; moreOpen?: string[]; allowedTaskIds?: string[] } = {}) =>
    h.run({ type: 'set-draft', pageId, status, moreOpen: extra.moreOpen ?? [], allowedTaskIds: extra.allowedTaskIds ?? [], items, ...(extra.recipe ? { recipe: extra.recipe } : {}) })
  /** For what no command makes: a draft page's stored string as an older build or a hand edit left it. */
  const setRaw = (h: World, pageId: string, edit: (p: Page) => Page) => { h.ws = { ...h.ws, pages: h.ws.pages.map(p => (p.id === pageId ? edit(p) : p)) } }

  /** Every test name of the web's tests, a template literal's `${a ? 'x' : 'y'}` read both ways. */
  const webTestNames = (() => {
    const names = new Set<string>()
    const expand = (s: string): string[] => { const m = /\$\{[^}]*\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\}/.exec(s); return m ? [...expand(s.replace(m[0], m[1]!)), ...expand(s.replace(m[0], m[2]!))] : [s] }
    for (const file of readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.ts'))) {
      const source = readFileSync(join(root, 'tests', file), 'utf8')
      for (const m of source.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) for (const name of expand(m[2]!)) names.add(name.replace(/\\(.)/g, '$1'))
    }
    return names
  })()
  const knownTest = (where: string, name: string) => { if (!webTestNames.has(name)) throw new Error(`${where}: no web test is named "${name}"`) }

  put('draft/recipe.json', { recipe: DRAFT_RECIPE })

  // draft/documents.json: a draft page's stored string as draftOf reads it. Those a command makes are the server's own.
  {
    const cases: unknown[] = []
    const docCase = (name: string, document: string, wanted: { parses: boolean; settled?: boolean; stale?: boolean }) => {
      const ws = { pages: [{ id: draftPageId(todayPage), type: 'draft', date: null, title: '', parentId: todayPage, document }] } as unknown as Workspace
      const draft = draftOf(ws, todayPage)
      const read = draft ? { settled: draftSettled(draft), stale: draftStale(draft) } : {}
      expect(`draft/documents ${name}`, { parses: draft !== null, ...read }, wanted)
      cases.push({ name, document, draft, ...read })
    }
    const stored = (steps: (h: World, heading: string) => void) => {
      const h = rowsWorld()
      steps(h, pageNodes(h.page(todayPage))[0]!.id)
      return h.ws.pages.find(p => p.id === draftPageId(todayPage))!.document
    }
    const two = (anchor: string) => [draftItem('i1', { anchor, block: lineBlock('b1', 'bulletListItem', 'Stretch') }), draftItem('i2', { anchor, block: lineBlock('b2', 'task', 'Call the vet') })]
    docCase('ready with items', stored((h, a) => setDraft(h, todayPage, 'ready', two(a), { recipe: DRAFT_RECIPE })), { parses: true, settled: true, stale: false })
    docCase('failed with every item open', stored((h, a) => setDraft(h, todayPage, 'failed', two(a), { recipe: DRAFT_RECIPE })), { parses: true, settled: false, stale: false })
    docCase('failed with one skipped', stored((h, a) => { setDraft(h, todayPage, 'failed', two(a), { recipe: DRAFT_RECIPE }); h.run({ type: 'skip-draft', pageId: todayPage, itemIds: ['i1'] }) }), { parses: true, settled: true, stale: false })
    docCase('preparing', stored(h => setDraft(h, todayPage, 'preparing', [], { recipe: DRAFT_RECIPE })), { parses: true, settled: false, stale: false })
    docCase('ready with no recipe (recipe 1)', stored((h, a) => setDraft(h, todayPage, 'ready', two(a))), { parses: true, settled: true, stale: true })
    docCase('recipe 4 ready', stored((h, a) => setDraft(h, todayPage, 'ready', two(a), { recipe: 4 })), { parses: true, settled: true, stale: true })
    docCase('recipe 4 failed, all open: it stands', stored((h, a) => setDraft(h, todayPage, 'failed', two(a), { recipe: 4 })), { parses: true, settled: false, stale: false })
    docCase('recipe 5 ready', stored((h, a) => setDraft(h, todayPage, 'ready', two(a), { recipe: 5 })), { parses: true, settled: true, stale: false })
    // No command stores these: the shapes an older build or a hand edit may leave.
    docCase('an item with no state is not open, so the draft is settled', JSON.stringify({ status: 'failed', items: [{ id: 'i1', anchor: '', place: 'after', source: 'model' }], moreOpen: [], recipe: DRAFT_RECIPE }), { parses: true, settled: true, stale: false })
    docCase('ready with no items', '{"status":"ready"}', { parses: true, settled: true, stale: true })
    docCase('not json', 'not json', { parses: false })
    docCase('the written-days draft: ready, no items, moreOpen empty', JSON.stringify({ status: 'ready', items: [], moreOpen: [] }), { parses: true, settled: true, stale: true })
    put('draft/documents.json', cases)
  }

  // draft/planning.json: the planning part of a page, where a band with no anchor goes, and where "N more open" goes.
  {
    const cases: unknown[] = []
    const moreOpenTest = 'draft: "more open" goes at the end of the planning part, before a closing divider, never under the heading'
    const planningCase = (name: string, nodes: EditorNode[], tasks: string[], wanted: [start: number, end: number, planningEnd: number, moreOpenAfter: number], test?: string) => {
      if (test) knownTest(`draft/planning ${name}`, test)
      const document = JSON.stringify(nodes), doc = JSON.parse(document) as EditorNode[]
      const range = planningRange(doc), planningEnd = planningEndIndex(doc, new Set(tasks)), moreOpenAfter = moreOpenAfterIndex(doc, planningEnd)
      expect(`draft/planning ${name}`, [range.start, range.end, planningEnd, moreOpenAfter], wanted)
      cases.push({ name, ...(test ? { test } : {}), document, tasks, range, planningEnd, moreOpenAfter })
    }
    const level = (n: EditorNode, l: number): EditorNode => ({ ...n, props: { level: l } })
    const quote = (id: string, words: string): EditorNode => ({ id, type: 'quote', props: {}, content: [text(words)], children: [] })
    const divider = (id: string): EditorNode => ({ id, type: 'divider', props: {}, children: [] })
    // tests/day-draft.test.ts's template: his newest one's shape, a planning section with sub-sections, then a reflection.
    const template = (): EditorNode[] => [
      heading('m', 'Morning'), level(heading('ev', 'Events'), 3), bullet('eb'),
      level(heading('t3', 'Top 3'), 3), quote('q', 'Finishable today.'), todo('s1', '', 'reference', ''), todo('s2', '', 'reference', ''), todo('s3', '', 'reference', ''),
      level(heading('o', 'Other'), 3), todo('s4', '', 'reference', ''),
      heading('r', 'Reflection'), level(heading('pr', 'Progress'), 4), para('pp', text('What went well?')), para('blank'),
    ]
    planningCase('his template: planning ends at the reflection', template(), [], [0, 10, 1, 9], 'draft: the planning part is the outermost section holding the first to-do row, never the reflection')
    {
      const h = rowsWorld()
      planningCase('the built-in template', pageNodes(h.page(todayPage)), h.ws.tasks.map(t => t.id), [0, 2, 1, 1])
    }
    planningCase('the built-in day as the test has it', [heading('t', 'TODO'), todo('slot', '', 'reference', ''), heading('e', 'Events'), bullet('b')], [], [0, 2, 1, 1], moreOpenTest)
    planningCase('a first to-do row under a level-2 heading under a level-1', [level(heading('a', 'Plan'), 1), heading('b', 'Today'), todo('c', 'Write the report'), level(heading('d', 'Notes'), 1), para('e', text('words'))], [], [0, 3, 1, 2])
    planningCase('a to-do row nested under a bullet', [heading('a', 'Plan'), { ...bullet('b', text('Errands')), children: [todo('c', 'Post the parcel')] }, heading('d', 'Notes'), para('e', text('words'))], [], [0, 2, 1, 1])
    planningCase('no to-do row: the first section', [para('a', text('Before')), heading('b', 'One'), para('c', text('words')), heading('d', 'Two'), para('e', text('more'))], [], [1, 3, 2, 2])
    planningCase('no heading, to-do rows: the whole page, more open after the last row', [todo('a', 'One', 'plan'), bullet('b', text('note')), todo('c', 'Two', 'plan'), para('n', text('long notes'))], [], [0, 4, 0, 2], moreOpenTest)
    planningCase('no heading, no to-do row', [para('n', text('notes')), bullet('b', text('more'))], [], [0, 2, 0, -1], moreOpenTest)
    planningCase('a planning part that is only its heading', [heading('p', 'Plan'), heading('n', 'Notes'), para('x', text('words'))], [], [0, 1, 1, 0], moreOpenTest)
    planningCase('one closing divider', [...template().slice(0, 10), level(heading('d', 'Drop'), 3), para('dl'), divider('hr'), ...template().slice(10)], [], [0, 13, 1, 11], moreOpenTest)
    planningCase('two closing dividers', [...template().slice(0, 10), level(heading('d', 'Drop'), 3), para('dl'), divider('hr1'), divider('hr2'), ...template().slice(10)], [], [0, 14, 1, 11], moreOpenTest)
    planningCase('plan rows of a known and of an unknown task directly under the heading', [heading('a', 'Plan'), todo('k', 'Known'), todo('u', 'Unknown'), para('p', text('words')), heading('n', 'Notes')], [taskOf('k')], [0, 4, 2, 3])
    planningCase('a heading with no level reads as level 1', [{ id: 'a', type: 'heading', props: {}, content: [text('Plan')], children: [] }, todo('b', 'Write'), heading('c', 'Notes'), para('d', text('words'))], [], [0, 4, 1, 3])
    put('draft/planning.json', cases)
  }

  // draft/same-words.json: the words two lines are compared by.
  {
    const texts = ['Call Mom.', '  call   mom  ', 'CALL MOM!', 'Call mom。', 'Call mom！', 'Done. . ', '...', '', 'a b', 'a　b', 'a\u0085b', 'a​b', 'İstanbul', 'ΟΔΟΣ', 'Straße']
    const cases = texts.map(t => ({ text: t, words: sameWords(t) }))
    // Every output is held, the case-folding ones too, so another ICU fails here rather than quietly changing the file.
    expect('draft/same-words', cases.map(c => c.words), ['call mom', 'call mom', 'call mom', 'call mom', 'call mom', 'done', '', '', 'a b', 'a b', 'a\u0085b', 'a​b', 'i̇stanbul', 'οδος','straße'])
    put('draft/same-words.json', cases)
  }

  // draft/views.json: what a day page shows of its draft (draftView), from the workspace as the app holds it.
  {
    const cases: unknown[] = []
    const viewCase = (name: string, test: string | null, h: World, pageId: string, check: (view: ReturnType<typeof draftView>) => void) => {
      if (test) knownTest(`draft/views ${name}`, test)
      const ws = forBrowser(h.ws)
      const view = draftView(ws, ws.pages.find(p => p.id === pageId)!)
      expect(`draft/views ${name}: the same as from the server's workspace`, view, draftView(h.ws, h.page(pageId)))
      check(view)
      cases.push({ name, ...(test ? { test } : {}), workspace: ws, pageId, view })
    }
    const ids = (view: ReturnType<typeof draftView>) => view?.items.map(i => i.id)
    const tomorrowPage = dayId(webTomorrow)

    // tests/day-draft.test.ts: yesterday (Oct 22) with two open to-dos; Oct 23 made from his template.
    const level = (n: EditorNode, l: number): EditorNode => ({ ...n, props: { level: l } })
    const quote = (id: string, words: string): EditorNode => ({ id, type: 'quote', props: {}, content: [text(words)], children: [] })
    const template = (): EditorNode[] => [
      heading('m', 'Morning'), level(heading('ev', 'Events'), 3), bullet('eb'),
      level(heading('t3', 'Top 3'), 3), quote('q', 'Finishable today.'), todo('s1', '', 'reference', ''), todo('s2', '', 'reference', ''), todo('s3', '', 'reference', ''),
      level(heading('o', 'Other'), 3), todo('s4', '', 'reference', ''),
      heading('r', 'Reflection'), level(heading('pr', 'Progress'), 4), para('pp', text('What went well?')), para('blank'),
    ]
    const templateSetup = (build: () => EditorNode[] = template) => {
      const h = harness()
      h.day(webToday)
      h.save(dayId(webToday), d => underHeading(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')), { at: when(webToday) })
      h.run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
      h.save('tpl', () => build(), { at: when(webToday, '09:01') })
      const slots = pageNodes(h.day(webTomorrow)).map(n => n.id)
      const book = h.task('Book the flights').id, dog = h.task('Buy a dog bed').id
      const draft = (items: Partial<DraftItem>[], moreOpen: string[] = []) =>
        setDraft(h, tomorrowPage, 'ready', items.map((x, i) => draftItem(`i${i}`, { anchor: slots[5]!, place: 'fill', ...x })), { moreOpen, allowedTaskIds: [book, dog] })
      return { h, ids: slots, book, dog, draft }
    }
    {
      const { h, ids: slot, book, dog, draft } = templateSetup()
      draft([{ taskId: book, anchor: slot[5]! }, { taskId: dog, anchor: slot[6]! }], [])
      h.task('Book the flights').title = 'Book the flights to Lisbon'
      viewCase('a renamed to-do shows under its current title', 'draft: the view shows each open item where it goes, with the task under its current title', h, tomorrowPage,
        v => expect('draft/views renamed', v!.items.map(i => [i.kind, i.anchorId, inlineText(i.block.content)]), [['fill', slot[5], 'Book the flights to Lisbon'], ['fill', slot[6], 'Buy a dog bed']]))
    }
    {
      const { h, ids: slot, book, dog, draft } = templateSetup()
      draft([{ taskId: book, anchor: slot[5]! }, { taskId: dog, anchor: slot[6]! }])
      h.run({ type: 'task-status', taskId: book, status: 'done', today: webTomorrow })
      h.task('Buy a dog bed').title = 'Buy a big dog bed'
      viewCase('a to-do done elsewhere drops out; a renamed one stays', 'draft: a to-do done, cancelled or set aside elsewhere drops out; a renamed one stays and keeps its new title', h, tomorrowPage,
        v => expect('draft/views done elsewhere', v!.items.map(i => [i.taskId, inlineText(i.block.content)]), [[dog, 'Buy a big dog bed']]))
    }
    {
      const { h, ids: slot, book, dog, draft } = templateSetup()
      draft([{ taskId: book, anchor: slot[5]! }, { taskId: dog, anchor: 'gone' }])
      h.save(tomorrowPage, d => d.map(n => (n.id === slot[5] ? { ...n, content: [text('Write the intro')] } : n)), { at: when(webTomorrow) })
      viewCase('a written-in slot and a gone anchor', 'draft: a fill whose slot he already wrote in goes after it; a gone anchor goes to the planning end', h, tomorrowPage,
        v => expect('draft/views written-in slot', v!.items.map(i => [i.kind, i.anchorId]), [['after', slot[5]], ['after', slot[0]]]))
    }
    {
      const { h, book, dog, draft } = templateSetup()
      draft([], [book, dog])
      h.run({ type: 'task-status', taskId: dog, status: 'cancelled' })
      viewCase('"more open" without a closed to-do', 'draft: "more open" lists the open to-dos it holds, minus any now on the page or closed', h, tomorrowPage,
        v => expect('draft/views more open', v!.moreOpen.map(m => m.title), ['Book the flights']))
    }
    {
      const { h, ids: slot, book, dog, draft } = templateSetup()
      draft([{ taskId: book, anchor: slot[5]! }, { taskId: dog, anchor: slot[5]!, place: 'after' }])
      h.run({ type: 'apply-draft', pageId: tomorrowPage, itemIds: ['i0'], today: webTomorrow })
      viewCase('after a fill, a band on that slot follows the filled row', 'draft: after a fill, the bands anchored on that slot stay right after the filled row', h, tomorrowPage,
        v => expect('draft/views after a fill', v!.items.map(i => [i.taskId, i.kind, i.anchorId]), [[dog, 'after', slot[5]]]))
    }
    {
      const { h, ids: slot, book, draft } = templateSetup()
      draft([{ taskId: book, anchor: slot[12]! }])
      viewCase('an anchor outside the planning part', 'draft: a carried to-do whose anchor left the planning part goes to the planning end, never lost', h, tomorrowPage,
        v => expect('draft/views anchor outside', v!.items.map(i => [i.taskId, i.kind, i.anchorId]), [[book, 'after', slot[0]]]))
    }
    {
      const { h, ids: slot, book, dog, draft } = templateSetup()
      draft([{ taskId: book, anchor: slot[5]! }, { taskId: dog, anchor: slot[6]! }])
      h.run({ type: 'apply-draft', pageId: tomorrowPage, itemIds: ['i0'], today: webTomorrow })
      viewCase('after a partial apply', 'draft: partial Apply then Apply all never applies an item twice', h, tomorrowPage, v => expect('draft/views partial apply', ids(v), ['i1']))
    }
    {
      // The test compares two worlds; here the one with database views in the template, given a draft.
      const view: EditorNode = { id: 'v1', type: 'database', props: { pageId: 'list', view: '' }, children: [] }
      const withView = () => {
        const out = template()
        out.splice(out.findIndex(n => n.id === 'ev') + 1, 0, view)
        out.splice(out.findIndex(n => n.id === 'pr') + 1, 0, { ...view, id: 'v2' })
        return out
      }
      const drafted = (build: () => EditorNode[]) => {
        const { h, book, draft } = templateSetup(build)
        const slot = pageNodes(h.page(tomorrowPage)).find(n => n.type === 'task' && !inlineText(n.content))!.id
        draft([{ taskId: book, anchor: slot }])
        return h
      }
      const plain = drafted(template), viewed = drafted(withView)
      const shape = (h: World) => draftView(h.ws, h.page(tomorrowPage))!.items.map(i => [i.kind, i.taskId, inlineText(i.block.content)])
      expect('draft/views database view: the same bands as without it', shape(viewed), shape(plain))
      viewCase('a database view in the template', 'R2-6: a database view in the template changes nothing about the draft', viewed, tomorrowPage, v => expect('draft/views database view', v!.items.map(i => i.kind), ['fill']))
    }

    // tests/draft-apply-order.test.ts: four suggestions share the spot right after the planning heading.
    const orderSetup = () => {
      const h = harness()
      h.day(webToday)
      h.save(dayId(webToday), d => underHeading(d, 'TODO', todo('r1', 'Book the flights'), todo('r2', 'Buy a dog bed')), { at: when(webToday) })
      h.day(webTomorrow)
      h.save(tomorrowPage, () => [heading('m', 'Morning'), bullet('eb', text('Own line')), heading('r', 'Reflection')], { at: when(webTomorrow) })
      const book = h.task('Book the flights').id, dog = h.task('Buy a dog bed').id
      setDraft(h, tomorrowPage, 'ready', [
        draftItem('i0', { anchor: 'm', taskId: book }),
        draftItem('i1', { anchor: 'm', block: lineBlock('b1', 'task', 'Pack the bags') }),
        draftItem('i2', { anchor: 'm', block: lineBlock('b2', 'bulletListItem', 'Read the lease') }),
        draftItem('i3', { anchor: 'm', taskId: dog }),
      ], { allowedTaskIds: [book, dog] })
      const apply = (...itemIds: string[]) => h.run({ type: 'apply-draft', pageId: tomorrowPage, itemIds, today: webToday })
      const rowOf = (id: string) => draftOf(h.ws, tomorrowPage)!.items.find(i => i.id === id)!.row!
      const lines = () => pageNodes(h.page(tomorrowPage)).map(n => inlineText(n.content).trim())
      return { h, apply, rowOf, lines }
    }
    let saves = 0
    const resave = (h: World, edit: (d: EditorNode[]) => EditorNode[]) => h.save(tomorrowPage, edit, { at: when(webTomorrow, `10:${String(++saves).padStart(2, '0')}`) })
    {
      const s = orderSetup()
      s.apply('i2')
      viewCase('the bands still waiting around an applied row', 'B102: the suggestions still waiting are shown in their offered places around the rows applied', s.h, tomorrowPage,
        v => expect('draft/views waiting around', v!.items.map(i => [i.id, i.anchorId]), [['i0', 'm'], ['i1', 'm'], ['i3', s.rowOf('i2')]]))
    }
    {
      const s = orderSetup()
      s.apply('i0'); s.apply('i1')
      const pack = s.rowOf('i1')
      resave(s.h, d => d.filter(n => n.id !== pack))
      viewCase('an applied row he deleted', 'B102: a row he deleted or moved away no longer counts; the next lands after the nearest earlier one still there (Jazz)', s.h, tomorrowPage,
        v => expect('draft/views deleted row', v!.items.map(i => [i.id, i.anchorId]), [['i2', s.rowOf('i0')], ['i3', s.rowOf('i0')]]))
      const m = orderSetup()
      m.apply('i0')
      const book = m.rowOf('i0')
      resave(m.h, d => { const row = d.find(n => n.id === book)!; const rest = d.filter(n => n.id !== book); return [...rest.slice(0, 2), row, ...rest.slice(2)] })
      expect('draft/views moved row: the page', m.lines(), ['Morning', 'Own line', 'Book the flights', 'Reflection'])
      viewCase('an applied row he moved away', 'B102: a row he deleted or moved away no longer counts; the next lands after the nearest earlier one still there (Jazz)', m.h, tomorrowPage,
        v => expect('draft/views moved row', v!.items.map(i => [i.id, i.anchorId]), [['i1', 'm'], ['i2', 'm'], ['i3', 'm']]))
    }
    {
      const s = orderSetup()
      s.apply('i0')
      const book = s.rowOf('i0')
      resave(s.h, d => d.flatMap(n => (n.id === book ? [n, bullet('typed', text('Typed by him'))] : [n])))
      viewCase('a line he typed below an applied row', 'B102: a line he typed right below an applied row stays below the rows that follow it', s.h, tomorrowPage,
        v => expect('draft/views typed below', v!.items.map(i => [i.id, i.anchorId]), [['i1', book], ['i2', book], ['i3', book]]))
    }
    {
      const s = orderSetup()
      s.apply('i0'); s.apply('i2')
      // As a build from before B102 left them: applied, with no row.
      setRaw(s.h, draftPageId(tomorrowPage), p => { const d = JSON.parse(p.document) as { items: DraftItem[] }; for (const i of d.items) delete i.row; return { ...p, document: JSON.stringify(d) } })
      const rows = pageNodes(s.h.page(tomorrowPage))
      viewCase('rows applied before rows were kept', 'B102: rows applied before rows were kept are still found: a to-do by its row, a line by its words', s.h, tomorrowPage,
        v => expect('draft/views no rows kept', v!.items.map(i => [i.id, i.anchorId]), [['i1', rows[1]!.id], ['i3', rows[2]!.id]]))
    }
    for (const mode of ['fill', 'missing'] as const) {
      const h = harness()
      h.day(webTomorrow)
      h.save(tomorrowPage, () => [heading('m', 'Morning'), { id: 'slot', type: 'task', props: { taskId: 'editor-task:slot' }, content: [], children: [] }, heading('r', 'Reflection')], { at: when(webTomorrow) })
      setDraft(h, tomorrowPage, 'ready', ['Alpha', 'Beta', 'Gamma'].map((w, i) => draftItem(`i${i}`, { anchor: mode === 'fill' ? 'slot' : 'gone', place: mode === 'fill' ? 'fill' : 'after', block: lineBlock(`b${i}`, 'task', w) })))
      h.run({ type: 'apply-draft', pageId: tomorrowPage, itemIds: ['i2'], today: webToday })
      const gamma = draftOf(h.ws, tomorrowPage)!.items.find(i => i.id === 'i2')!.row!
      const doc = pageNodes(h.page(tomorrowPage)), above = doc[doc.findIndex(n => n.id === gamma) - 1]!.id
      const where = mode === 'fill' ? 'an empty slot' : 'a missing anchor'
      viewCase(`bands waiting at ${where}`, `B102: with ${where}, the bands still waiting sit where their rows will land`, h, tomorrowPage,
        v => expect(`draft/views ${where}`, v!.items.map(i => [i.id, i.anchorId]), [['i0', above], ['i1', above]]))
    }
    {
      const lineFirst = (taps: string[][]) => {
        const h = harness()
        h.day(webTomorrow)
        h.save(tomorrowPage, () => [heading('m', 'Morning'), { id: 'slot', type: 'task', props: { taskId: 'editor-task:slot' }, content: [], children: [] }, heading('r', 'Reflection')], { at: when(webTomorrow) })
        setDraft(h, tomorrowPage, 'ready', [
          draftItem('i0', { anchor: 'slot', place: 'fill', block: lineBlock('b0', 'bulletListItem', 'Alpha') }),
          draftItem('i1', { anchor: 'slot', place: 'fill', block: lineBlock('b1', 'task', 'Beta') }),
        ])
        for (const itemIds of taps) h.run({ type: 'apply-draft', pageId: tomorrowPage, itemIds, today: webToday })
        return h
      }
      const test = 'B102: a line that can\'t fill the slot, offered before a to-do that can: Apply all and every tap order read line, to-do (Ratchet 0297bd0e)'
      viewCase('a line that can\'t fill the slot, before a to-do that can', test, lineFirst([]), tomorrowPage,
        v => expect('draft/views line before to-do', v!.items.map(i => [i.id, i.kind, i.anchorId]), [['i0', 'after', 'slot'], ['i1', 'fill', 'slot']]))
      const after = lineFirst([['i1']])
      viewCase('the line still waiting after the to-do filled the slot', test, after, tomorrowPage,
        v => expect('draft/views line after to-do', v!.items.map(i => [i.id, i.kind, i.anchorId]), [['i0', 'after', 'm']]))
    }
    {
      const s = orderSetup()
      s.apply('i0'); s.apply('i2')
      s.h.run({ type: 'undo', targetOperationId: s.h.ws.undo!.operationId })
      viewCase('after Undo of a single apply', 'B102: Undo of a single apply puts it back, and applying it again lands in its place', s.h, tomorrowPage,
        v => expect('draft/views after undo', v!.items.map(i => [i.id, i.anchorId]), [['i1', s.rowOf('i0')], ['i2', s.rowOf('i0')], ['i3', s.rowOf('i0')]]))
    }

    // tests/day-draft-skipped.test.ts: two days ago he wrote "Pack the bags" for the next day; yesterday he never used.
    const planOn = (h: World, date: string) => {
      h.day(date)
      h.save(dayId(date), d => [...d, heading('h', 'Next day'), bullet('b1', text('Pack the bags')), bullet('b2', text('Call the bank'))], { at: `${date}T21:00:00.000Z` })
    }
    const packItem = (id: string, from?: string) => draftItem(id, { ...(from ? { from } : {}), block: lineBlock(`${id}-b`, 'task', 'Pack the bags') })
    const twoDrafts = (recipe: { yesterday?: number; today?: number; todayFrom?: string } = {}) => {
      const h = harness()
      planOn(h, webTwoDaysAgo)
      h.day(webYesterday)
      h.day(webToday)
      setDraft(h, dayId(webYesterday), 'ready', [packItem('y1', recipe.yesterday ? 'b1' : undefined)], { recipe: recipe.yesterday ?? 2 })
      setDraft(h, dayId(webToday), 'ready', [packItem('t1', recipe.todayFrom ?? 'b1')], { recipe: recipe.today ?? 3 })
      return h
    }
    {
      const h = twoDrafts()
      h.run({ type: 'apply-draft', pageId: dayId(webToday), itemIds: ['t1'], today: webToday })
      viewCase('the skipped day\'s draft after today\'s applied the line', 'B101: applied today, the old draft for the skipped day no longer offers it, and can\'t apply it', h, dayId(webYesterday), v => expect('draft/views B101 applied today', ids(v), []))
    }
    {
      const test = 'B101: applied on the old draft first, today\'s draft no longer offers it; skipped today, the old one doesn\'t either'
      const a = twoDrafts()
      a.run({ type: 'apply-draft', pageId: dayId(webYesterday), itemIds: ['y1'], today: webToday })
      viewCase('today\'s draft after the old one applied the line', test, a, dayId(webToday), v => expect('draft/views B101 applied old', ids(v), []))
      const b = twoDrafts()
      b.run({ type: 'skip-draft', pageId: dayId(webToday), itemIds: ['t1'] })
      viewCase('the old draft after today\'s skipped the line', test, b, dayId(webYesterday), v => expect('draft/views B101 skipped today', ids(v), []))
    }
    {
      const test = 'B101: between two new drafts the line is known by where it came from, so the same words written again aren\'t taken for it'
      const same = twoDrafts({ yesterday: DRAFT_RECIPE })
      same.run({ type: 'apply-draft', pageId: dayId(webToday), itemIds: ['t1'], today: webToday })
      viewCase('two new drafts, the same line', test, same, dayId(webYesterday), v => expect('draft/views B101 same line', ids(v), []))
      const again = twoDrafts({ yesterday: DRAFT_RECIPE, todayFrom: 'written-again' })
      again.run({ type: 'apply-draft', pageId: dayId(webToday), itemIds: ['t1'], today: webToday })
      viewCase('two new drafts, the same words from another line', test, again, dayId(webYesterday), v => expect('draft/views B101 written again', ids(v), ['y1']))
    }
    {
      const h = harness()
      planOn(h, webTwoDaysAgo)
      h.day(webYesterday)
      h.day(webToday)
      setDraft(h, dayId(webYesterday), 'ready', [packItem('y1')], { recipe: 2 })
      h.run({ type: 'skip-draft', pageId: dayId(webYesterday), itemIds: ['y1'] })
      setDraft(h, dayId(webYesterday), 'ready', [], { recipe: DRAFT_RECIPE })
      setDraft(h, dayId(webToday), 'ready', [packItem('t1', 'b1')], { recipe: DRAFT_RECIPE })
      viewCase('a decision a remake kept', 'B101: a decision a remake kept from an older draft still counts by its words (Ratchet 5dd205a3)', h, dayId(webToday), v => expect('draft/views B101 remake kept', ids(v), []))
    }
    {
      const h = harness()
      h.day(webTwoDaysAgo)
      h.day(webToday)
      setDraft(h, dayId(webTwoDaysAgo), 'ready', [packItem('o1')], { recipe: 2 })
      h.run({ type: 'apply-draft', pageId: dayId(webTwoDaysAgo), itemIds: ['o1'], today: webTwoDaysAgo })
      planOn(h, webYesterday)
      setDraft(h, dayId(webToday), 'ready', [packItem('t1', 'b1')], { recipe: DRAFT_RECIPE })
      viewCase('the same words written again on a later page', 'B101: the same words written again on a later page aren\'t taken for an old draft\'s line', h, dayId(webToday), v => expect('draft/views B101 later page', ids(v), ['t1']))
    }

    // tests/day-draft-carry.test.ts: yesterday's draft, never acted on, holds two plan lines as to-dos and a plain line.
    for (const [recipe, withFrom] of [[DRAFT_RECIPE, true], [3, true], [2, false]] as const) {
      const h = harness()
      h.day(webTwoDaysAgo)
      h.save(dayId(webTwoDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text('Pack the bags')), bullet('b2', text('Call the bank')), bullet('b3', text('Nice view'))], { at: `${webTwoDaysAgo}T21:00:00.000Z` })
      h.day(webYesterday)
      setDraft(h, dayId(webYesterday), 'ready', [
        draftItem('y1', { ...(withFrom ? { from: 'b1' } : {}), block: lineBlock('yb1', 'task', 'Pack the bags') }),
        draftItem('y2', { ...(withFrom ? { from: 'b2' } : {}), block: lineBlock('yb2', 'task', 'Call the bank') }),
        draftItem('y3', { ...(withFrom ? { from: 'b3' } : {}), block: lineBlock('yb3', 'bulletListItem', 'Nice view') }),
      ], { recipe })
      h.day(webToday)
      const req = buildDayDraftRequest(h.ws, h.page(dayId(webToday)), 'UTC')
      let n = 0
      const { items } = withSkippedPlan(h.ws, h.page(dayId(webToday)), req, [], () => `n${++n}`)
      setDraft(h, dayId(webToday), 'failed', items, { recipe: DRAFT_RECIPE })
      viewCase(`the skipped day's draft once today's is stored (its recipe ${recipe})`, 'carry: once today\'s draft is stored, the skipped day\'s draft hands its to-do lines on; its plain line stays (Lead 312046f4)', h, dayId(webYesterday),
        v => expect(`draft/views carry recipe ${recipe}`, ids(v), ['y3']))
    }

    // tests/draft-not-twice-sweep.test.ts: "Pack the bags" sits open in yesterday's recipe 2 draft.
    {
      const h = harness()
      h.day(webTwoDaysAgo)
      h.save(dayId(webTwoDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text('Pack the bags'))], { at: `${webTwoDaysAgo}T21:00:00.000Z` })
      h.day(webYesterday)
      setDraft(h, dayId(webYesterday), 'ready', [draftItem('old', { block: lineBlock('ob', 'task', 'Pack the bags') })], { recipe: 2 })
      h.day(webToday)
      const req = buildDayDraftRequest(h.ws, h.page(dayId(webToday)), 'UTC')
      let n = 0
      const items = withSkippedPlan(h.ws, h.page(dayId(webToday)), req, [], () => `${webToday}-${++n}`).items.filter(() => false)
      setDraft(h, dayId(webToday), 'ready', items, { recipe: DRAFT_RECIPE })
      const test = 'not twice: a stored draft that doesn\'t hold the line takes nothing over; the old draft keeps offering it (Lead 7969b862)'
      viewCase('the old draft keeps offering the line', test, h, dayId(webYesterday), v => expect('draft/views not twice old', ids(v), ['old']))
      viewCase('the stored draft that doesn\'t hold it', test, h, dayId(webToday), v => expect('draft/views not twice new', ids(v), []))
    }

    // tests/draft-typed-anew.test.ts: three days ago two plan lines; two days ago a recipe 2 draft holds them, unused;
    // yesterday's draft carried both, and he applied the first and crossed out the second.
    {
      const threeDaysAgo = addDays(webToday, -3), LINES = ['Pack the bags', 'Call the bank'] as const
      type Kind = 'line_todo' | 'line' | 'new_todo' | 'new_line'
      const words = (i: { block?: EditorNode }) => (i.block ? inlineText(i.block.content).trim() : '')
      const make = (h: World, date: string, answer: (lineId: (w: string) => string) => Partial<ModelSuggestion>[]) => {
        if (!h.ws.pages.some(p => p.id === dayId(date))) h.day(date)
        const page = h.page(dayId(date)), req = buildDayDraftRequest(h.ws, page, 'UTC')
        const anchor = [...req.blocks.keys()][0]!
        const lineId = (w: string) => [...req.lines].find(([, x]) => inlineText(x.content).trim() === w)?.[0] ?? 'L-none'
        let n = 0
        const newId = () => `${date}-${DRAFT_RECIPE}-${++n}`
        const sugs = answer(lineId).map(x => ({ anchor, place: 'after', kind: 'line_todo', taskId: '', lineId: '', text: '', why: '', ...x }) as ModelSuggestion)
        const items = withSkippedPlan(h.ws, page, req, itemsFromModel(req, sugs, newId, {}), newId).items
        setDraft(h, dayId(date), 'ready', items, { recipe: DRAFT_RECIPE, allowedTaskIds: [...req.tasks.values()].map(t => t.id) })
      }
      const scene = (tick: boolean) => {
        const h = harness()
        h.day(threeDaysAgo)
        h.save(dayId(threeDaysAgo), d => [...d, heading('h', 'Next day'), bullet('b1', text(LINES[0])), bullet('b2', text(LINES[1]))], { at: `${threeDaysAgo}T21:00:00.000Z` })
        h.day(webTwoDaysAgo)
        setDraft(h, dayId(webTwoDaysAgo), 'ready', [draftItem('o1', { block: lineBlock('ob1', 'task', LINES[0]) }), draftItem('o2', { block: lineBlock('ob2', 'task', LINES[1]) })], { recipe: 2 })
        make(h, webYesterday, lineId => LINES.map(w => ({ lineId: lineId(w) })))
        const y = draftOf(h.ws, dayId(webYesterday))!.items
        h.run({ type: 'apply-draft', pageId: dayId(webYesterday), itemIds: [y.find(i => words(i) === LINES[0])!.id], today: webYesterday })
        h.run({ type: 'skip-draft', pageId: dayId(webYesterday), itemIds: [y.find(i => words(i) === LINES[1])!.id] })
        if (tick) h.run({ type: 'task-status', taskId: h.task(LINES[0]).id, status: 'done', today: webYesterday })
        return h
      }
      for (const tick of [true, false]) for (const kind of ['line_todo', 'line', 'new_todo', 'new_line'] as Kind[]) {
        const h = scene(tick)
        make(h, webToday, lineId => LINES.map(w => (kind === 'line_todo' || kind === 'line' ? { kind, lineId: lineId(w) } : { kind, text: w })))
        const label = `${tick ? 'applied and ticked' : 'applied, left open'}, ${kind}`
        viewCase(`a line decided yesterday, today's answer ${label}`, 'B106: a line he decided yesterday is never offered again today, carried by its id or typed anew, as a to-do or a line', h, dayId(webToday), v => {
          const shown = v!.items.filter(i => LINES.includes(inlineText(i.block.content).trim() as typeof LINES[number]))
          if (shown.some(i => inlineText(i.block.content).trim() === LINES[1])) throw new Error(`draft/views B106 ${label}: the crossed-out line is offered`)
          if (tick ? shown.length : shown.some(i => i.taskId !== h.task(LINES[0]).id) || shown.length > 1) throw new Error(`draft/views B106 ${label}: the applied line is offered as a copy`)
        })
      }
    }

    // tests/draft-skipped-days.test.ts: the days on a carried to-do's band.
    {
      const thu = '2026-10-15', sat = '2026-10-17', sun = '2026-10-18', mon = '2026-10-19'
      const h = harness()
      h.day(thu)
      h.save(dayId(thu), d => underHeading(d, 'TODO', todo('r1', 'Kathy app', 'plan', thu), todo('r2', 'Lenny reply', 'plan', thu)), { at: when(thu) })
      const kathy = h.task('Kathy app').id, lenny = h.task('Lenny reply').id
      const draft = (date: string) => { h.day(date); setDraft(h, dayId(date), 'ready', [draftItem('k', { taskId: kathy }), draftItem('l', { taskId: lenny }), draftItem('n', { block: lineBlock(`nb-${date}`, 'task', 'Kathy app') })], { recipe: 5, allowedTaskIds: [kathy, lenny] }) }
      draft(sat); h.run({ type: 'skip-draft', pageId: dayId(sat), itemIds: ['k'] })
      draft(sun); h.run({ type: 'skip-draft', pageId: dayId(sun), itemIds: draftOf(h.ws, dayId(sun))!.items.filter(i => i.state === 'open').map(i => i.id) })
      draft(mon)
      viewCase('skipped on two days', 'skipped days: ✕ and Dismiss both count, by the drafts’ own days, oldest first', h, dayId(mon),
        v => expect('draft/views skipped days', v!.items.map(i => [i.id, i.skipped ?? []]), [['k', [sat, sun]], ['l', [sun]], ['n', []]]))
    }

    // Drafts as the web leaves them, on Thu 2026-11-26: a to-do carried from yesterday and today's built-in page.
    {
      const odd = () => {
        const h = harness()
        h.day(YESTERDAY)
        saveRows(h, YESTERDAY, plan('y1', 'Book the flights', YESTERDAY))
        h.day(TODAY)
        return h
      }
      const flights = taskOf('y1'), headingId = `${todayPage}:h0`
      const items = () => [draftItem('i1', { anchor: headingId, taskId: flights }), draftItem('i2', { anchor: headingId, block: lineBlock('b2', 'bulletListItem', 'Stretch') })]
      const store = (h: World, status: 'preparing' | 'ready' | 'failed', list = items()) => setDraft(h, todayPage, status, list, { recipe: DRAFT_RECIPE, allowedTaskIds: [flights] })
      {
        const h = odd(); store(h, 'ready')
        setRaw(h, draftPageId(todayPage), p => ({ ...p, document: 'not json' }))
        viewCase('a draft whose document does not parse', null, h, todayPage, v => expect('draft/views not json', v, null))
      }
      { const h = odd(); store(h, 'failed'); viewCase('failed, every item open', null, h, todayPage, v => expect('draft/views failed', [v!.status, ids(v)], ['failed', ['i1', 'i2']])) }
      {
        const h = odd(); store(h, 'failed')
        h.run({ type: 'skip-draft', pageId: todayPage, itemIds: ['i2'] })
        viewCase('failed with one skipped', null, h, todayPage, v => expect('draft/views failed, one skipped', [v!.status, ids(v)], ['ready', ['i1']]))
      }
      { const h = odd(); store(h, 'preparing'); viewCase('preparing', null, h, todayPage, v => expect('draft/views preparing', [v!.status, ids(v)], ['preparing', ['i1', 'i2']])) }
      {
        const h = odd(); store(h, 'ready')
        // Written by hand: no command puts a draft page in Trash on its own (delete-page refuses a draft page).
        setRaw(h, draftPageId(todayPage), p => ({ ...p, trashedAt: stamped(5) }))
        viewCase('the draft in Trash', null, h, todayPage, v => expect('draft/views draft in Trash', v, null))
      }
      {
        const h = odd(); store(h, 'ready')
        h.run({ type: 'delete-page', pageId: todayPage, at: stamped(5) }, 'trash-today')
        h.day(TODAY)
        const fresh = `${todayPage}:2`
        if (!h.ws.pages.some(p => p.id === fresh && !p.trashedAt)) throw new Error(`draft/views: today's new page must be ${fresh}`)
        viewCase('today\'s page in Trash, and a new page with no draft of its own', null, h, fresh, v => expect('draft/views new page', v, null))
      }
      {
        const h = odd(); store(h, 'ready')
        // Written by hand: every command gives a to-do its createdOn; a task from older data may have none.
        h.ws = { ...h.ws, tasks: h.ws.tasks.map(t => { if (t.id !== flights) return t; const { createdOn: _createdOn, ...rest } = t; return rest as Task }) }
        viewCase('a carried to-do with no createdOn has no since', null, h, todayPage, v => expect('draft/views no createdOn', v!.items.map(i => [i.id, i.since ?? null]), [['i1', null], ['i2', null]]))
      }
      {
        const h = odd(); store(h, 'ready', [draftItem('i1', { anchor: headingId, taskId: flights }), draftItem('i2', { anchor: headingId, since: '2026-11-24', block: lineBlock('b2', 'bulletListItem', 'Stretch') })])
        viewCase('a line item with since', null, h, todayPage, v => expect('draft/views since', v!.items.map(i => [i.id, i.since ?? null]), [['i1', h.task('Book the flights').createdOn], ['i2', '2026-11-24']]))
      }
      { const h = odd(); store(h, 'ready'); viewCase('two items on one anchor', null, h, todayPage, v => expect('draft/views two on one anchor', v!.items.map(i => [i.id, i.kind, i.anchorId]), [['i1', 'after', headingId], ['i2', 'after', headingId]])) }
      {
        const h = odd()
        h.save(todayPage, d => underHeading(d, 'TODO', { ...bullet('p1', text('Errands')), children: [bullet('p2', text('Post office'))] }), { today: TODAY, at: stamped(2) })
        store(h, 'ready', [draftItem('i1', { anchor: 'p2', taskId: flights })])
        viewCase('an anchor that is a nested block\'s id goes to the planning end', null, h, todayPage, v => expect('draft/views nested anchor', v!.items.map(i => [i.id, i.anchorId]), [['i1', headingId]]))
      }
      // A carried to-do the draft no longer offers for a reason other than done, beside one it still offers (Water the plants).
      const withControl = (h: World) => {
        saveRows(h, YESTERDAY, plan('y2', 'Water the plants', YESTERDAY))
        const water = taskOf('y2')
        setDraft(h, todayPage, 'ready', [draftItem('i1', { anchor: headingId, taskId: flights }), draftItem('i3', { anchor: headingId, taskId: water })], { recipe: DRAFT_RECIPE, moreOpen: [flights, water], allowedTaskIds: [flights, water] })
        return water
      }
      const hidden = (name: string, water: string) => (v: ReturnType<typeof draftView>) => {
        expect(`draft/views ${name}: the suggestions`, ids(v), ['i3'])
        expect(`draft/views ${name}: more open`, v!.moreOpen.map(m => m.taskId), [water])
      }
      {
        const h = odd(), water = withControl(h)
        h.run({ type: 'plan-task', taskId: flights, date: '2026-11-27', today: TODAY })
        viewCase('a carried to-do planned on a later day drops out, and from "more open"', null, h, todayPage, hidden('planned later', water))
      }
      {
        const h = odd(), water = withControl(h)
        h.run({ type: 'task-status', taskId: flights, status: 'cancelled', today: TODAY })
        viewCase('a carried to-do cancelled elsewhere drops out, and from "more open"', null, h, todayPage, hidden('cancelled', water))
      }
      {
        const h = odd(), water = withControl(h)
        setAside(h, flights)
        viewCase('a carried to-do set aside drops out, and from "more open"', null, h, todayPage, hidden('set aside', water))
      }
      {
        // Lines of drafts made before lines kept where they came from (recipe 2) are known by their words, as sameWords reads them.
        const h = odd()
        setDraft(h, dayId(YESTERDAY), 'ready', [draftItem('y1', { anchor: `${dayId(YESTERDAY)}:h0`, block: lineBlock('yb1', 'task', 'pack the bags.') })], { recipe: 2 })
        h.run({ type: 'skip-draft', pageId: dayId(YESTERDAY), itemIds: ['y1'] })
        setDraft(h, todayPage, 'ready', [draftItem('i1', { anchor: headingId, block: lineBlock('b1', 'task', 'Pack the  bags') }), draftItem('i2', { anchor: headingId, block: lineBlock('b2', 'task', 'Call the bank') })], { recipe: 2 })
        expect('draft/views same words: they read the same', sameWords('pack the bags.'), sameWords('Pack the  bags'))
        viewCase('a line decided on another day in other case, spacing and stop is not offered', null, h, todayPage, v => expect('draft/views same words', ids(v), ['i2']))
      }
    }
    put('draft/views.json', cases)
  }

  // draft/skipped.json: skippedDays, as tests/draft-skipped-days.test.ts builds each world.
  {
    const cases: unknown[] = []
    const thu = '2026-10-15', sat = '2026-10-17', sun = '2026-10-18', mon = '2026-10-19', tue = '2026-10-20', fri = '2026-10-23'
    let saves = 0
    const scene = () => {
      const h = harness()
      h.day(thu)
      h.save(dayId(thu), d => underHeading(d, 'TODO', todo('r1', 'Kathy app', 'plan', thu), todo('r2', 'Lenny reply', 'plan', thu)), { at: when(thu) })
      const kathy = h.task('Kathy app').id, lenny = h.task('Lenny reply').id
      const draft = (date: string) => { h.day(date); setDraft(h, dayId(date), 'ready', [draftItem('k', { taskId: kathy }), draftItem('l', { taskId: lenny }), draftItem('n', { block: lineBlock(`nb-${date}`, 'task', 'Kathy app') })], { recipe: 5, allowedTaskIds: [kathy, lenny] }) }
      const cross = (date: string, ...itemIds: string[]) => h.run({ type: 'skip-draft', pageId: dayId(date), itemIds })
      const dismiss = (date: string) => cross(date, ...draftOf(h.ws, dayId(date))!.items.filter(i => i.state === 'open').map(i => i.id))
      return { h, kathy, lenny, draft, cross, dismiss }
    }
    const skippedCase = (name: string, test: string, s: ReturnType<typeof scene>, day: string, wanted: [who: 'kathy' | 'lenny', days: string[]][]) => {
      knownTest(`draft/skipped ${name}`, test)
      const ws = forBrowser(s.h.ws)
      const skipped = [...skippedDays(ws, day)]
      expect(`draft/skipped ${name}`, skipped, wanted.map(([who, days]) => [who === 'kathy' ? s.kathy : s.lenny, days]))
      cases.push({ name, test, workspace: ws, day, skipped })
    }
    { const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun); s.dismiss(sun); s.draft(mon)
      skippedCase('✕ and Dismiss', 'skipped days: ✕ and Dismiss both count, by the drafts’ own days, oldest first', s, mon, [['kathy', [sat, sun]], ['lenny', [sun]]]) }
    { const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun); s.draft(mon)
      skippedCase('a day left open', 'skipped days: a day he didn’t decide on is not a skip, nor a draft he never opened', s, mon, [['kathy', [sat]]]) }
    {
      const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun)
      const skip = s.cross(sun, 'k')
      s.h.run({ type: 'undo', targetOperationId: skip.receipt.operationId })
      const again = s.cross(sun, 'l')
      s.h.run({ type: 'reopen-draft', pageId: dayId(sun), itemIds: ['l'], skippedBy: again.receipt.operationId, seen: { l: plannedOn(s.h.ws, s.lenny) } })
      s.draft(mon)
      skippedCase('skips undone', 'skipped days: a skip he undid doesn’t count, by Undo or by the notice’s second Undo', s, mon, [['kathy', [sat]]])
    }
    { const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun); s.h.run({ type: 'apply-draft', pageId: dayId(sun), itemIds: ['k'], today: sun }); s.draft(mon); s.cross(mon, 'k'); s.draft(tue)
      skippedCase('applied, then skipped again', 'skipped days: applying it starts the list again', s, tue, [['kathy', [mon]]]) }
    { const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.h.run({ type: 'plan-task', taskId: s.kathy, date: sun, today: sun }); s.draft(mon)
      skippedCase('planned another way', 'skipped days: planning it on a day another way (a plan row on that day’s page) starts the list again', s, mon, []) }
    for (const how of ['notice', 'row'] as const) {
      const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun)
      if (how === 'notice') {
        const seen = { k: plannedOn(s.h.ws, s.kathy) }
        const skip = s.cross(sun, 'k')
        s.h.run({ type: 'snooze-draft', pageId: dayId(sun), itemIds: ['k'], date: mon, today: sun, skippedBy: skip.receipt.operationId, seen })
      } else s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: mon, today: sun })
      s.h.day(mon)
      s.draft(tue); s.cross(tue, 'k')
      s.h.day(fri)
      skippedCase(`moved from the ${how}`, 'skipped days: moving it from the notice or from the row starts the list again', s, fri, [['kathy', [tue]]])
    }
    {
      const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun); s.h.run({ type: 'move-draft', pageId: dayId(sun), itemId: 'k', date: mon, today: sun })
      s.h.save(dayId(mon), d => d.filter(n => n.props?.taskId !== s.kathy), { today: sun, at: when(sun, `10:${String(++saves).padStart(2, '0')}`) })
      s.draft(tue); s.cross(tue, 'k')
      s.h.day(fri)
      skippedCase('moved, and its plan row taken off that day', 'skipped days: a move from a draft starts the list again even after its plan row is gone from that day', s, fri, [['kathy', [tue]]])
    }
    { const s = scene(); s.draft(sat); s.cross(sat, 'k'); s.draft(sun); s.draft(mon); s.cross(mon, 'k')
      skippedCase('a past day\'s draft', 'skipped days: a past day’s draft lists only the skips before that day', s, sun, [['kathy', [sat]]]) }
    { const s = scene(); s.draft(sat); s.cross(sat, 'k', 'n'); s.draft(sun)
      skippedCase('a to-do the model wrote', 'skipped days: a to-do the model wrote has no list, even in the words of one skipped before', s, sun, [['kathy', [sat]]]) }
    put('draft/skipped.json', cases)
  }

  // draft/skipped-labels.json: a band's skipped days in words.
  {
    const on = TODAY
    const labelCase = (days: string[], wanted: [text: string, full: string], at = on) => {
      const { text: words, full } = skippedLabel(days, at)
      expect(`draft/skipped-labels ${days.join(',')} on ${at}`, [words, full], wanted)
      return { days, on: at, text: words, full }
    }
    put('draft/skipped-labels.json', [
      labelCase(['2026-11-25'], ['skipped Wed', 'skipped Wed 11/25']),
      labelCase(['2026-11-21', '2026-11-22'], ['skipped Sat, Sun', 'skipped Sat 11/21, Sun 11/22']),
      labelCase(['2026-11-21', '2026-11-22', '2026-11-24'], ['skipped Sat, Sun, Tue', 'skipped Sat 11/21, Sun 11/22, Tue 11/24']),
      labelCase(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-24'], ['skipped 4 times', 'skipped Fri 11/20, Sat 11/21, Sun 11/22, Tue 11/24']),
      labelCase(['2026-11-19'], ['skipped 11/19', 'skipped Thu 11/19']),
      labelCase(['2026-11-20'], ['skipped Fri', 'skipped Fri 11/20']),
      labelCase(['2026-12-20', '2026-12-31'], ['skipped 12/20, Thu', 'skipped Sun 12/20, Thu 12/31'], '2027-01-02'),
    ])
  }

  // draft/line.json: the line's state (draftLineState) and words (draftLineWords), with `shown` the view's item count.
  {
    const viewOf = (v: { status: 'preparing' | 'ready' | 'failed'; items: number } | null) => v && { status: v.status, items: Array.from({ length: v.items }, (_, i): DraftItemView => ({ id: `i${i}`, kind: 'after', anchorId: null, block: lineBlock(`b${i}`, 'paragraph', '') })) }
    const lineCase = (name: string, view: { status: 'preparing' | 'ready' | 'failed'; items: number } | null, ask: DraftAskSummary, offline: boolean, held: boolean, wanted: [state: string, words: unknown]) => {
      const state = draftLineState(viewOf(view), ask, offline), words = draftLineWords(state, view?.items ?? 0, held)
      expect(`draft/line ${name}`, [state, words], wanted)
      return { name, view, ask, offline, held, state, words }
    }
    const segs = (count: string | null, failed = false, offline = false) => ({ kind: 'segments', count, failed, offline })
    put('draft/line.json', [
      lineCase('nothing: no draft stored and never asked', null, null, false, false, ['none', null]),
      lineCase('nothing: asked, and the answer stored nothing', null, 'done', false, false, ['none', null]),
      lineCase('nothing: a ready draft with no open suggestion', { status: 'ready', items: 0 }, 'done', false, false, ['ready', null]),
      lineCase('preparing: an ask in flight, nothing stored', null, 'in-flight', false, false, ['preparing', { kind: 'preparing' }]),
      lineCase('preparing: an older draft with nothing to show while it is asked for again', { status: 'ready', items: 0 }, 'in-flight', false, false, ['preparing', { kind: 'preparing' }]),
      lineCase('held: suggestions arrived while he was typing', { status: 'ready', items: 3 }, 'done', false, true, ['ready', { kind: 'held' }]),
      lineCase('open: three suggestions', { status: 'ready', items: 3 }, 'done', false, false, ['ready', segs('3 suggestions')]),
      lineCase('open: one suggestion', { status: 'ready', items: 1 }, null, false, false, ['ready', segs('1 suggestion')]),
      lineCase('open: in flight with suggestions already shown', { status: 'ready', items: 2 }, 'in-flight', false, false, ['ready', segs('2 suggestions')]),
      lineCase('failed: the ask failed, nothing stored', null, 'failed', false, false, ['failed', segs(null, true)]),
      lineCase('failed: the ask was lost, nothing stored', null, 'lost', false, false, ['failed', segs(null, true)]),
      lineCase('failed: a stored draft marked failed, none decided, with suggestions', { status: 'failed', items: 2 }, 'done', false, false, ['failed', segs('2 suggestions', true)]),
      lineCase('failed: a stored draft marked failed with no suggestion shown', { status: 'failed', items: 0 }, null, false, false, ['failed', segs(null, true)]),
      lineCase('the ask failed but a ready draft is stored: the draft\'s state', { status: 'ready', items: 1 }, 'failed', false, false, ['ready', segs('1 suggestion')]),
      lineCase('offline: no draft stored', null, null, true, false, ['offline', segs(null, false, true)]),
      lineCase('offline: an ask in flight and nothing stored', null, 'in-flight', true, false, ['offline', segs(null, false, true)]),
      lineCase('offline with a stored draft: the draft\'s state', { status: 'ready', items: 2 }, null, true, false, ['ready', segs('2 suggestions')]),
      lineCase('a stored draft still preparing reads as ready', { status: 'preparing', items: 1 }, null, false, false, ['ready', segs('1 suggestion')]),
    ])
  }

  // draft/notices.json
  {
    const notices = { applied: [1, 2].map(n => [n, appliedNotice(n)]), skipped: [1, 3].map(n => [n, skippedNotice(n)]), notApplied: draftWords.notApplied, notSkipped: draftWords.notSkipped, cantUndo: draftWords.cantUndo }
    expect('draft/notices', notices, { applied: [[1, 'Applied'], [2, 'Applied 2']], skipped: [[1, 'Skipped'], [3, 'Skipped 3']], notApplied: 'Not applied · changed elsewhere', notSkipped: 'Not skipped · changed elsewhere', cantUndo: "Can't undo · edited since" })
    put('draft/notices.json', notices)
  }

  // draft/actions/<name>.json: the draft's commands as the server takes or refuses them.
  // `{ before, pageId, itemIds, today, action, receipt, refusal, after, ticket }`: `action` is the web's builder's, applied as
  // is; `after` is as the browser gets it, with the Undo marker `{ operationId: "cmd-<name>", revision }` (`after` is
  // `before` when refused); `ticket` is draftTicket's for a skip, read from `after`.
  {
    const flights = taskOf('y1'), bed = taskOf('bed'), headingId = `${todayPage}:h0`, slotId = `${todayPage}:r0`
    /** Yesterday's plan row of "Book the flights" (planned Wed 11/25); "Buy a dog bed" on Errands, not planned. */
    const actionWorld = (items: DraftItem[]) => {
      const h = harness()
      h.day(YESTERDAY)
      saveRows(h, YESTERDAY, plan('y1', 'Book the flights', YESTERDAY))
      errands(h); errandRows(h, ['bed', 'Buy a dog bed'])
      h.day(TODAY)
      setDraft(h, todayPage, 'ready', items, { recipe: DRAFT_RECIPE, allowedTaskIds: [flights, bed] })
      return h
    }
    const carried = (id: string, taskId: string, extra: Partial<DraftItem> = {}) => draftItem(id, { anchor: headingId, taskId, ...extra })
    const line = (id: string, words: string, type = 'bulletListItem') => draftItem(id, { anchor: headingId, block: lineBlock(`b-${id}`, type, words) })
    const mix = () => [carried('i1', flights), carried('i2', bed), line('i3', 'Stretch')]
    const itemOf = (ws: Workspace, id: string) => draftOf(ws, todayPage)!.items.find(i => i.id === id)!
    const todayRows = (ws: Workspace) => pageNodes(ws.pages.find(p => p.id === todayPage)!)
    const actionCase = (name: string, h: World, itemIds: string[], action: Action, skip: boolean) => {
      const before = forBrowser(h.ws)
      let receipt: unknown = null, refusal: string | null = null, after = before
      try {
        const result = applyCommand(h.ws, { operationId: `cmd-${name}`, expectedRevision: h.ws.revision, action })
        h.ws = result.workspace
        after = forBrowser(result.workspace)
        receipt = result.receipt
        if (action.type === 'undo' ? after.undo !== undefined : after.undo?.operationId !== `cmd-${name}`) throw new Error(`draft/actions ${name}: the Undo marker is not what the command leaves`)
      } catch (e) {
        if (!(e instanceof DomainError)) throw e
        refusal = e.message
      }
      const ticket: DraftTicket | null = skip && !refusal ? draftTicket(after, todayPage, itemIds, `cmd-${name}`) : null
      put(`draft/actions/${name}.json`, { before, pageId: todayPage, itemIds, today: TODAY, action, receipt, refusal, after, ticket })
      return { before, after, receipt: receipt as { message: string } | null, refusal, ticket }
    }
    const apply = (name: string, h: World, itemIds: string[]) => actionCase(name, h, itemIds, applyDraftAction(todayPage, itemIds, TODAY), false)
    const skip = (name: string, h: World, itemIds: string[]) => actionCase(name, h, itemIds, skipDraftAction(todayPage, itemIds), true)

    {
      const h = actionWorld([carried('i1', flights)])
      const r = apply('apply-a-carried-to-do-after-its-anchor', h, ['i1'])
      const rows = todayRows(r.after)
      expect('draft/actions apply-a-carried-to-do-after-its-anchor', [r.receipt?.message, rows[0]!.id, rowTaskId(rows[1]!), rowRole(rows[1]!), plannedOn(r.after, flights), itemOf(r.after, 'i1').state], ['Applied', headingId, flights, 'plan', TODAY, 'applied'])
      // undo-an-apply: its `before` is the apply's `after`.
      const u = actionCase('undo-an-apply', h, ['i1'], { type: 'undo', targetOperationId: 'cmd-apply-a-carried-to-do-after-its-anchor' }, false)
      expect('draft/actions undo-an-apply', [itemOf(u.after, 'i1').state, todayRows(u.after).some(n => rowTaskId(n) === flights), plannedOn(u.after, flights)], ['open', false, YESTERDAY])
    }
    {
      const h = actionWorld([carried('i1', flights, { anchor: slotId, place: 'fill' })])
      const r = apply('apply-fills-an-empty-slot', h, ['i1'])
      const row = todayRows(r.after).find(n => rowTaskId(n) === flights)
      if (row?.id !== slotId) throw new Error(`draft/actions apply-fills-an-empty-slot: the row must keep the slot's id ${slotId}, has ${row?.id}`)
      expect('draft/actions apply-fills-an-empty-slot', itemOf(r.after, 'i1').row, slotId)
    }
    {
      const h = actionWorld([line('i1', 'Call the vet', 'task')])
      const r = apply('apply-a-new-to-do', h, ['i1'])
      const task = r.after.tasks.find(t => t.title === 'Call the vet')
      expect('draft/actions apply-a-new-to-do', [r.before.tasks.some(t => t.title === 'Call the vet'), task?.createdOn, task && plannedOn(r.after, task.id)], [false, TODAY, TODAY])
    }
    {
      const h = actionWorld([line('i1', 'Stretch')])
      const r = apply('apply-a-line', h, ['i1'])
      const row = todayRows(r.after).find(n => inlineText(n.content) === 'Stretch')
      if (!row?.id.startsWith('brought:') || itemOf(r.after, 'i1').row !== row.id) throw new Error(`draft/actions apply-a-line: the line must be a brought: row the item names, is ${row?.id}`)
    }
    {
      const h = actionWorld(mix())
      h.run({ type: 'task-status', taskId: bed, status: 'done', today: TODAY })
      const r = apply('apply-all-partly', h, ['i1', 'i2', 'i3'])
      const applied = draftOf(r.after, todayPage)!.items.filter(i => i.state === 'applied').map(i => i.id)
      if (applied.length !== 2) throw new Error(`draft/actions apply-all-partly: exactly two must be applied, got ${applied}`)
      expect('draft/actions apply-all-partly', [r.receipt?.message, applied], ['Applied 2', ['i1', 'i3']])
    }
    {
      const h = actionWorld([carried('i1', flights)])
      h.run(applyDraftAction(todayPage, ['i1'], TODAY))
      expect('draft/actions apply-nothing', apply('apply-nothing', h, ['i1']).refusal, 'Nothing to apply')
    }
    {
      const h = actionWorld([carried('i1', flights)])
      const r = skip('skip-one', h, ['i1'])
      expect('draft/actions skip-one', [r.receipt?.message, r.ticket], ['Skipped', { itemIds: ['i1'], skippedBy: 'cmd-skip-one', seen: { i1: YESTERDAY } }])
    }
    {
      const h = actionWorld(mix())
      const r = skip('dismiss-a-mix', h, ['i1', 'i2', 'i3'])
      expect('draft/actions dismiss-a-mix', [r.receipt?.message, r.ticket], ['Skipped 3', { itemIds: ['i1', 'i2', 'i3'], skippedBy: 'cmd-dismiss-a-mix', seen: { i1: YESTERDAY, i2: null } }])
      // reopen-after-a-skip: its `before` is dismiss-a-mix's `after`.
      const o = actionCase('reopen-after-a-skip', h, r.ticket!.itemIds, reopenDraftAction(todayPage, r.ticket!), false)
      expect('draft/actions reopen-after-a-skip', o.receipt?.message, 'Brought back 3')
      for (const id of ['i1', 'i2', 'i3']) { const i = itemOf(o.after, id); if (i.state !== 'open' || 'by' in i) throw new Error(`draft/actions reopen-after-a-skip: ${id} must be open, without by`) }
    }
    {
      const h = actionWorld([carried('i1', flights)])
      h.run(applyDraftAction(todayPage, ['i1'], TODAY))
      expect('draft/actions skip-nothing', skip('skip-nothing', h, ['i1']).refusal, 'Nothing to skip')
    }
    {
      // Skipped, its Undo taken, then applied: the notice's second Undo finds nothing that skip left.
      const h = actionWorld([carried('i1', flights)])
      h.run(skipDraftAction(todayPage, ['i1']), 'skip-1')
      const ticket = draftTicket(h.ws, todayPage, ['i1'], 'skip-1')
      h.run({ type: 'undo', targetOperationId: 'skip-1' })
      h.run(applyDraftAction(todayPage, ['i1'], TODAY))
      const r = actionCase('reopen-after-a-later-change', h, ['i1'], reopenDraftAction(todayPage, ticket), false)
      expect('draft/actions reopen-after-a-later-change', r.refusal, 'Cannot undo after later changes; current values kept')
    }
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

The to-do row. The script runs in a fixed time zone and never reads the clock; every case states its \`today\`, which is Thu 2026-11-26 unless it says otherwise.

- \`dates/words.json\`: \`{ date, today, daysBetween, weekday, shortLabel, longLabel, near, sinceLabel, nextDayLabel }\`, a date worded the web's ways.
- \`dates/tags.json\`: \`{ name, deadlineOn, attentionOn, today, pageDate, planned, text, passed }\`, \`taskDateTag\` and \`deadlinePassed\` for each shape of a to-do's dates on today's page, a past page and a future page, planned and not.
- \`rows/menus.json\`: \`{ name, status, role, planned, pageDate, today, menu }\`, what \`rowMenu\` offers (\`null\` for nothing).
- \`rows/another-day.json\`: \`{ today, options }\`, \`anotherDayOptions\` for a week of days.
- \`rows/marks.json\`: \`{ name, workspace, pageId, blockId, today, planned, marks }\`, what \`rowMarks\` says of one row (its role and plan day are the block's props); \`planned\` is the \`plannedOn\` of every to-do of the workspace.
- \`carried/cases.json\`: \`{ name, workspace, taskId, today, since, label }\`, \`carriedSince\` and its \`Since\` words (\`null\` for none).
- \`repeats/words.json\`: \`{ rule, words, markName }\`, a repeat rule in words and as the mark's name.
- \`blockers/cases.json\`: \`{ name, workspace, blocked, words }\`, each blocked to-do's blockers in link order and the words drawn.
- \`notices/cases.json\`: \`{ name, intent, task, day, today, receipt, plannedAfter, text }\`, the notice \`rowNoticeText\` gives a row action.
- \`notices/fixed.json\`: \`{ plannedForToday, notDone, undone, cantUndo, couldntUndo }\`, the row's five fixed notices (\`rowNotices\`).
- \`actions/\`: one file per row command. \`{ before, intent, taskId, day, today, action, receipt, after, plannedAfter, notice }\` for one the server takes (\`action\` is the web's \`rowAction\`, \`after\` holds the Undo marker \`{ operationId: "cmd-<name>", revision }\`; \`undo\` has no intent and \`plan-for-today-from-a-reference-row\` the button's own notice), \`{ before, operationId, today, action, refused, notice }\` for one it refuses.

The morning: the strip above a day's page. Today is Thu 2026-11-26 here too.

- \`events/cases.json\`: \`{ name, workspace, day, events, unreadablePageId? }\`, the day's events as \`dayEvents\` reads them from the pages (\`[{ id, title, date, time, line: { pageId, lineId } }]\`). \`unreadablePageId\` names a page holding a node whose \`props\` is not an object: the web reads that page's chips, the app reads nothing of it.
- \`events/times.json\`: \`{ time, text }\`, \`shortTime\`, the strip's time.
- \`events/lines.json\`: \`{ name, events, line }\`, the strip's events line (\`eventsLine\`: \`{ text, more }\`, \`null\` for no events).
- \`events/headings.json\`: \`{ name, document, headingId }\`, the page's top-level heading titled Events (\`eventsHeading\`; \`null\` for none).
- \`facts/cases.json\`: \`{ name, workspace, date, today, facts }\`, what \`dayFacts\` says of a day (\`null\`: no strip): \`{ events, dueSoon, notToday }\`, each row \`{ taskId, words, tag, setAside }\` with \`tag\` \`""\` for none.
- \`notices/strip.json\`: \`{ date, today, text }\`, the notice \`planOnNotice\` gives Bring back and Another day.
- \`facts-actions/\`: one file per strip command. \`{ before, taskId, date, today, action, receipt, after, notice }\`: \`action\` is the web's \`planOnAction\`, \`after\` holds the Undo marker \`{ operationId: "cmd-<name>", revision }\`, \`notice\` is \`planOnNotice\`'s.

The day draft. A case that mirrors a web test names it as \`test\` and is built on that test's days (its today is Thu 2026-10-22); the others are on Thu 2026-11-26. Every input is made by the server's commands except these, written by hand because no command makes them: in \`documents.json\`, "an item with no state is not open, so the draft is settled", "ready with no items", "not json" and "the written-days draft: ready, no items, moreOpen empty"; in \`views.json\`, "a draft whose document does not parse", "rows applied before rows were kept" (its items' \`row\` removed), "the draft in Trash" and "a carried to-do with no createdOn has no since".

- \`draft/recipe.json\`: \`{ recipe }\`, the web's \`DRAFT_RECIPE\`: how drafts are made now.
- \`draft/documents.json\`: \`{ name, document, draft, settled, stale }\`, a draft page's stored string as \`draftOf\` reads it (\`null\` when it does not parse, and then no \`settled\` or \`stale\`), with \`draftSettled\` and \`draftStale\`.
- \`draft/planning.json\`: \`{ name, test?, document, tasks, range: { start, end }, planningEnd, moreOpenAfter }\`, \`planningRange\`, \`planningEndIndex\` with \`tasks\` the known task ids, and \`moreOpenAfterIndex\` (\`-1\` for none).
- \`draft/same-words.json\`: \`{ text, words }\`, \`sameWords\`, the words two lines are compared by (lowercased as JavaScript does in English).
- \`draft/views.json\`: \`{ name, test?, workspace, pageId, view }\`, what \`draftView\` shows of the page's draft (\`null\` for none).
- \`draft/skipped.json\`: \`{ name, test, workspace, day, skipped }\`, \`skippedDays\` as \`[taskId, [days]]\` in its order.
- \`draft/skipped-labels.json\`: \`{ days, on, text, full }\`, \`skippedLabel\`, a band's skipped days in words.
- \`draft/line.json\`: \`{ name, view, ask, offline, held, state, words }\`, the line's state (\`draftLineState\`, \`view\` as \`{ status, items: <count> }\` or \`null\`, \`ask\` one of \`in-flight\`, \`lost\`, \`failed\`, \`done\` or \`null\`) and its words (\`draftLineWords\`, with the view's count shown).
- \`draft/notices.json\`: \`{ applied, skipped, notApplied, notSkipped, cantUndo }\`, the notices' words (\`appliedNotice\`, \`skippedNotice\` as \`[n, text]\`, and \`draftWords\`).
- \`draft/actions/\`: one file per draft command. \`{ before, pageId, itemIds, today, action, receipt, refusal, after, ticket }\`: \`action\` is the web's builder's (\`applyDraftAction\`, \`skipDraftAction\`, \`reopenDraftAction\`, or an \`undo\`); \`receipt\` is \`null\` and \`refusal\` the server's message when it is refused, and \`after\` is then \`before\`; otherwise \`after\` holds the Undo marker \`{ operationId: "cmd-<name>", revision }\`. \`ticket\` is \`draftTicket\`'s for a skip, read from \`after\`, else \`null\`.

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
