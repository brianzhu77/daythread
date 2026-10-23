import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { closeHistory, isHistoryTransaction, undo as historyUndo, redo as historyRedo } from '@tiptap/pm/history'
import { BlockNoteSchema, blockToNode, defaultBlockSpecs, defaultInlineContentSpecs, docToBlocks, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { toast } from '@heroui/react'
import { BasicTextStyleButton, BlockTypeSelect, CreateLinkButton, createReactBlockSpec, createReactInlineContentSpec, FormattingToolbar, FormattingToolbarController, getDefaultReactSlashMenuItems, SideMenu, SuggestionMenuController, SideMenuController, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useExtensionState } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { offset } from '@floating-ui/react'
import '@blocknote/shadcn/style.css'
import type { Action, Page, Receipt, Task, Workspace } from '../domain/types'
import { editorSeed, inlineText, needsTemplateRows, pageContentKey, sectionRange, templateKind, type EditorNode } from '../domain/editor-document'
import { mergeDraft } from '../domain/draft-merge'
import { applyCommand, bornHere, deletesWithLine, pasteRecords } from '../domain/workspace'
import { pagePreview } from '../domain/page-tree'
import { defaultLinkTitle, isHttpUrl, urlKey } from '../domain/url-key'
import { cardsPresent, urlLine, type UndoCard } from '../domain/link-paste'
import { recentPages, visiblePages, parentOf } from '../domain/page-tree'
import { lineRefView, pageRefView, whereLabel as placeLabel } from './line-text'
import { lineClipboardType, lineLinkPath, parseLineClipboard, parseLineUrl } from '../domain/line-link'
import type { LineTarget } from '../domain/page-refs'
import { pageHref, pageLabel } from './page-tree'
import { jumpInPage, jumpToBlock, lookupFailed, registerEditor, visibleArea } from './line-jump'
import { resolveLineLink } from '../server/functions'
import { newOperationId, useWorkspace } from './use-day'
import { debugClient } from '../lib/debug'
import { DateTag } from './date-tag'
import { CheckboxIcon, ChevronRightIcon, ExternalIcon, GlobeIcon, GripIcon, IndentIcon, OutdentIcon, PagesIcon, PlusIcon, RedoIcon, UndoIcon } from './icons'
import { useNavigate } from '@tanstack/react-router'
import { displayPageTitle, focusAtEnd } from './page-title'
import { addDays, fromIso, longLabel, todayIso, weekday } from './dates'
import { notTodayText } from './task-row'
import { tagDecorations } from './tag-decorations'
import { endOfLineAbove, rowArrows } from './row-arrows'
import { isOwnLeaveSave, registerEditorFlush, rememberLeaveSave } from './editor-flush'
import { RowMenu } from './row-menu'
import { RowActionsContext, menuGroups, noticeDate, rowMenu, useRowActions, type RowActions, type RowIntent } from './row-actions'

const task = createReactBlockSpec({ type: 'task', propSchema: { taskId: { default: '' }, role: { default: 'reference' }, planDate: { default: '' } }, content: 'inline' }, {
  toExternalHTML: ({ contentRef }) => <p ref={contentRef} />,
  render: ({ block, contentRef }) => <EditorTask blockId={block.id} taskId={block.props.taskId} role={block.props.role} planDate={block.props.planDate} contentRef={contentRef} />,
})()
const sourceChecklist = createReactBlockSpec({ type: 'sourceChecklist', propSchema: { checked: { default: false } }, content: 'inline' }, {
  render: ({ block, contentRef, editor }) => <div className="editor-source-checklist"><input contentEditable={false} type="checkbox" aria-label="Check imported item" checked={block.props.checked} onChange={() => editor.updateBlock(block, { props: { checked: !block.props.checked } })} /><span ref={contentRef} /></div>,
  toExternalHTML: ({ block, contentRef }) => <p><span>{block.props.checked ? '☑ ' : '☐ '}</span><span ref={contentRef} /></p>,
})()
// pages-delta N-2 / Jazz f69dd341-era spec: a page card is one quiet row (icon, title, ›) that drags, deletes and
// undoes as a single block. It only points at the page; removing it never removes the page.
// A2: a link card also carries its URL and the kind of line it replaced, so a paste the server never confirmed can be
// retried as that paste (never as an empty page), and Undo can put the same line back.
const pageLink = createReactBlockSpec({ type: 'pageLink', propSchema: { pageId: { default: '' }, url: { default: '' }, line: { default: '' } }, content: 'none' }, {
  render: ({ block }) => <PageCard pageId={block.props.pageId} cardId={block.id} url={block.props.url} line={block.props.line} />,
  toExternalHTML: ({ block }) => <p><a href={`/pages?page=${encodeURIComponent(block.props.pageId)}`}>Page</a></p>,
})()
// A9a (Jazz page-links-states §1): a `[[` link is one inline unit, icon + the page's current title on a quiet chip.
// Backspace removes it whole (it has no content of its own). It reads its title live, so nothing is stored as text.
// A11: with `lineId` it's a link to one line on that page (`taskId` when the line is a task row), drawn as a line chip.
const pageRef = createReactInlineContentSpec({ type: 'pageRef', propSchema: { pageId: { default: '' }, refId: { default: '' }, newTitle: { default: '' }, lineId: { default: '' }, taskId: { default: '' } }, content: 'none' }, {
  render: ({ inlineContent: { props } }) => props.lineId
    ? <LineRefChip target={{ pageId: props.pageId, lineId: props.lineId, ...(props.taskId ? { taskId: props.taskId } : {}) }} />
    : <PageRefChip pageId={props.pageId} refId={props.refId} newTitle={props.newTitle} />,
  toExternalHTML: ({ inlineContent: { props } }) => props.lineId
    ? <a href={lineLinkPath({ pageId: props.pageId, lineId: props.lineId, ...(props.taskId ? { taskId: props.taskId } : {}) })}>Line</a>
    : <a href={`/pages?page=${encodeURIComponent(props.pageId)}`}>{props.newTitle || 'Page'}</a>,
})
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, task, sourceChecklist, pageLink }, inlineContentSpecs: { ...defaultInlineContentSpecs, pageRef } })
/** Lines a `[[` link can live in (plan §1): never a task row. */
const linkableLines = new Set(['paragraph', 'bulletListItem', 'numberedListItem', 'heading', 'quote'])
const clipboardType = 'application/x-daythread-blocks'
const cutTokens = new Set<string>()
const deepNodes = (nodes: readonly EditorNode[]): EditorNode[] => nodes.flatMap(n => [n, ...deepNodes(n.children ?? [])])
const checklistIds = (nodes: readonly EditorNode[]): string[] => deepNodes(nodes).filter(n => n.type === 'sourceChecklist' && n.props?.checked !== true).map(n => n.id)
function EditorTask({ blockId, taskId, role, planDate, contentRef }: { blockId: string; taskId: string; role: string; planDate: string; contentRef: (node: HTMLElement | null) => void }) {
  const { workspace, run } = useWorkspace()
  const rows = useRowActions()
  const t = workspace?.tasks.find(t => t.id === taskId)
  // A12: the row's actions, on a ⋯ at the end of the row (Jazz §2). Done and draft rows have none.
  const model = t && rows ? rowMenu(t, role, rows.sectionOf(blockId), rows.pageDate, rows.today) : null
  // A11: last, under a divider, after the task's own actions (Jazz line-links-states §1).
  const copy = model ? rows!.copyLink(blockId) : null
  // data-status: the task's real state, for checks such as scripts/check-alignment.mjs (Lead a2428bb1). Display only.
  return <div className="editor-task" data-role={role} data-draft={t ? undefined : true} data-status={t?.status ?? 'draft'}>
    <input contentEditable={false} type="checkbox" aria-label={t ? `Complete ${t.title}` : taskId.startsWith('editor-task:') ? 'New task' : 'Missing task'} checked={t?.status === 'done'} disabled={(!t && !taskId.startsWith('editor-task:')) || t?.status === 'cancelled'} onChange={() => t && void run({ type: 'task-status', taskId, status: t.status === 'done' ? 'open' : 'done', today: todayIso() }, r => ({ text: t.status === 'done' ? 'Task reopened' : 'Task completed', undoOperationId: r.operationId }))} />
    <span ref={contentRef} className={`editor-task-title ${t?.status === 'done' ? 'task-done' : t?.status === 'cancelled' ? 'task-cancelled' : ''}`} data-placeholder="To do" />
    {/* Jazz f58abeaf: done rows are grey and struck through too, so the label is what says Cancelled. */}
    {t?.status === 'cancelled' && <span contentEditable={false} className="editor-cancelled-tag">Cancelled</span>}
    {role === 'reference' && <span contentEditable={false} className="editor-reference-tag">Reference</span>}
    {/* A done or cancelled task keeps the button's space, hidden, so a long title doesn't reflow when it's ticked (#9). */}
    {role === 'reference' && t && <button className="editor-plan-action" contentEditable={false} {...(t.status === 'open' ? { onClick: () => void run({ type: 'plan-task', taskId, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }, r => ({ text: 'Planned for today', undoOperationId: r.operationId })) } : { disabled: true, tabIndex: -1, 'aria-hidden': true, style: { visibility: 'hidden' as const } })}>Plan for today</button>}
    {model && <span contentEditable={false} className="editor-row-menu" onKeyDown={e => e.stopPropagation()}><RowMenu label={`Actions for ${t!.title}`} triggerClass="editor-row-more" groups={[...menuGroups(model, rows!.today, intent => rows!.act(blockId, t!, intent)), ...(copy ? [{ items: [{ label: 'Copy link to line', onSelect: copy }] }] : [])]} onEscape={() => rows!.focusRow(blockId)} /></span>}
    {t && t.status === 'open' && hasDateFacts(t) && <span contentEditable={false} className="editor-date-tag"><DateTag task={t} today={todayIso()} pageDate={planDate || todayIso()} /></span>}
  </div>
}

/**
 * Marks the card in this page's own history entry, so the browser's Back lands on it (scrolled to and tinted
 * by the jump-to-block path) instead of the top of a long page.
 */
function rememberCard(cardId: string) {
  const url = new URL(window.location.href); url.searchParams.set('block', cardId)
  window.history.replaceState(window.history.state, '', url)
}
/**
 * Pages whose `/page` create hasn't been confirmed yet, by page id. Browser-only state: the card is saved like any
 * block, and the page id is fixed, so retrying (by us or from the card) can only ever confirm that one page.
 */
type PendingPage = { state: 'creating' | 'failed'; parentId: string; retry: () => void }
const pendingPages = new Map<string, PendingPage>()
const pendingListeners = new Set<() => void>()
let pendingVersion = 0
function setPending(pageId: string, value: PendingPage | null) {
  if (value) pendingPages.set(pageId, value); else pendingPages.delete(pageId)
  pendingVersion++; pendingListeners.forEach(l => l())
}
function usePendingVersion() {
  return useSyncExternalStore(l => { pendingListeners.add(l); return () => pendingListeners.delete(l) }, () => pendingVersion, () => 0)
}
function PageCard({ pageId, cardId, url = '', line = '' }: { pageId: string; cardId: string; url?: string; line?: string }) {
  const { workspace, run } = useWorkspace()
  const navigate = useNavigate()
  usePendingVersion()
  const target = workspace?.pages.find(p => p.id === pageId)
  const link = target?.url || url
  // A saved card whose page never got created (e.g. the tab closed during a failed create) can still be retried:
  // its parent is the page the card is saved on, and the id is the card's own. A link card retries its paste.
  const savedOn = target || pendingPages.has(pageId) ? undefined : workspace?.pages.find(p => p.sections.some(s => s.blocks.some(b => b.id === cardId)))
  const retrySaved = (on: Page) => link
    ? run({ type: 'paste-links', pageId: on.id, today: todayIso(), items: [{ url: link, pageId, cardBlockId: cardId, lineType: (['paragraph', 'bulletListItem', 'numberedListItem'].includes(line) ? line : 'paragraph') as 'paragraph' }] })
    : run({ type: 'create-document', title: '', body: '', pageId, parentId: on.id })
  const pending: PendingPage | undefined = target ? undefined : pendingPages.get(pageId)
    ?? (savedOn ? { state: 'failed', parentId: savedOn.id, retry: () => void retrySaved(savedOn) } : undefined)
  // A4: a card to a trashed page stays in the text, muted with "In trash", and opens the trashed page (layout §2).
  const trashed = Boolean(target?.trashedAt)
  // Jazz §2: the domain only once the title isn't the default one, compared at render time (no stored flag).
  const domain = link && target && target.title !== defaultLinkTitle(link) ? hostLabel(link) : ''
  const title = target ? displayPageTitle(target) : pending ? (link ? defaultLinkTitle(link) : 'Untitled') : 'Page not found'
  // The first lines written on the page, as in Craft's card (v0.3 §6.2 "title, short preview").
  // A trashed page keeps its contents out of other pages (Ratchet).
  const preview = target && !trashed ? pagePreview(target) : ''
  return <span className={`editor-page-card-row ${link ? 'is-link' : ''}`} contentEditable={false}>
    <button type="button" className={`editor-page-card ${trashed ? 'in-trash' : ''}`} disabled={pending?.state === 'creating'}
      onClick={() => { if (pending) { if (pending.state === 'failed') pending.retry(); return } rememberCard(cardId); void navigate({ to: '/pages', search: { page: pageId } }) }}>
      <span className="editor-page-card-icon">{link ? <GlobeIcon /> : <PagesIcon />}</span>
      <span className="editor-page-card-text">
        <span className={`editor-page-card-title ${target?.title || link ? '' : 'untitled'}`}>{title}</span>
        {/* Link cards stay one line (A2): they show the domain instead. */}
        {target && !link && preview && <span className="editor-page-card-preview">{preview}</span>}
      </span>
      {domain && <span className="editor-page-card-domain">{domain}</span>}
      {pending?.state === 'creating' ? <span className="editor-page-card-spinner" aria-label="Creating page" />
        : pending?.state === 'failed' ? <span className="editor-page-card-failed">Not created · Retry</span>
        : <>{trashed && <span className="in-trash-tag">In trash</span>}{!link && <ChevronRightIcon />}</>}
    </button>
    {link && <a className="editor-page-card-open" href={link} target="_blank" rel="noreferrer" aria-label="Open website" title={link}><ExternalIcon /></a>}
  </span>
}
/**
 * A9a: the `[[` link in the editor, with the page card's states (Jazz §1): live, in trash (opens the trashed page),
 * "Page not found", being created, and "Not created · Retry", which re-runs the same create, also after a reload.
 */
function PageRefChip({ pageId, refId, newTitle }: { pageId: string; refId: string; newTitle: string }) {
  const { workspace, run } = useWorkspace()
  const navigate = useNavigate()
  usePendingVersion()
  const view = pageRefView(workspace, pageId, newTitle || undefined)
  const pending = view.target ? undefined : pendingPages.get(pageId)
  // Saved with its page never confirmed (the tab closed, or every try failed): Retry from the line it's saved on.
  const holder = !view.target && !pending && newTitle ? workspace?.pages.find(p => p.sections.some(s => s.blocks.some(b => b.refs?.some(r => r.refId === refId)))) : undefined
  const state = pending ? pending.state : holder ? 'failed' : view.state
  const retry = () => { if (pending) pending.retry(); else if (holder) void run({ type: 'create-document', title: newTitle, body: '', pageId, parentId: holder.id }) }
  return <span className={`page-ref is-${state}`} contentEditable={false} role={state === 'live' || state === 'trashed' || state === 'failed' ? 'link' : undefined}
    onMouseDown={e => e.preventDefault()}
    onClick={() => { if (state === 'failed') retry(); else if (view.target) void navigate({ to: '/pages', search: { page: pageId } }) }}>
    <span className="page-ref-icon">{view.icon}</span>
    <span className="page-ref-title">{state === 'failed' ? (newTitle || 'Untitled') : view.label}</span>
    {state === 'creating' && <span className="page-ref-spinner" aria-label="Creating page" />}
    {state === 'failed' && <span className="page-ref-failed">Not created · Retry</span>}
  </span>
}
/**
 * ⌘/ on a line without a ⋯: the row menu's look, with its one item, under the line's box at its text start; above it
 * when there's no room below; never partly off the visible area (Jazz states §1). Esc or a click away closes it.
 */
function LineMenu({ anchor, onClose, onCopy }: { anchor: { top: number; bottom: number; left: number }; onClose: (refocus: boolean) => void; onCopy: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose); close.current = onClose
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const menu = ref.current?.getBoundingClientRect()
    if (!menu) return
    const { top, bottom } = visibleArea(), gap = 4, edge = 8
    const below = anchor.bottom + gap, above = anchor.top - gap - menu.height
    const y = below + menu.height <= bottom - edge ? below : above >= top + edge ? above : Math.max(top + edge, Math.min(below, bottom - edge - menu.height))
    setAt({ top: y, left: Math.max(edge, Math.min(anchor.left, window.innerWidth - menu.width - edge)) })
  }, [anchor])
  // Focus once it's placed: a hidden element can't take focus.
  const placed = at !== null
  useEffect(() => { if (placed) ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true }) }, [placed])
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close.current(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [])
  return createPortal(<div ref={ref} className="app-menu line-menu" role="menu" aria-label="Line actions" style={{ position: 'fixed', top: at?.top ?? anchor.bottom + 4, left: at?.left ?? anchor.left, visibility: at ? 'visible' : 'hidden' }}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true) } }}>
    <button type="button" role="menuitem" onClick={onCopy}>Copy link to line</button>
  </div>, document.body)
}
/**
 * A11 (Jazz line-links-states §3-§5): a link to one line. It shows the line's current words and where it is now, from
 * the same resolver as the URL and Linked from. Tap: jump in place when that page is open, else open it at the line;
 * a line that's gone opens its page at the top with "Couldn't find that line"; a page that's gone does nothing.
 */
function LineRefChip({ target }: { target: LineTarget }) {
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const view = lineRefView(workspace, target), r = view.resolved
  const open = () => {
    const page = r && workspace?.pages.find(p => p.id === r.pageId)
    if (!r || !page) return
    if (r.state === 'line-not-found' || !r.blockId) {
      toast("Couldn't find that line", { timeout: 4000 })
      if (new URLSearchParams(window.location.search).get('page') === page.id || window.location.pathname === `/day/${page.date}`) window.scrollTo({ top: 0 })
      else void navigate({ href: pageHref(page) })
      return
    }
    // Nothing stays focused after a jump, so a phone keyboard goes down (Jazz §4).
    if (!page.trashedAt && jumpInPage(page.id, r.blockId)) { (document.activeElement as HTMLElement | null)?.blur(); return }
    void navigate({ href: pageHref(page, r.blockId), resetScroll: false })
  }
  const live = view.state !== 'page-not-found'
  return <span className={`page-ref line-ref is-${view.state}`} contentEditable={false} title={view.full} role={live ? 'link' : undefined} tabIndex={live ? -1 : undefined}
    onMouseDown={e => e.preventDefault()} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open() } }}>
    <span className="page-ref-icon">{view.icon}</span>
    <span className="line-ref-words">{view.words}</span>
    {view.where && <span className="line-ref-where">{`\u00a0· ${view.where}`}</span>}
  </span>
}
/** The host without `www.`, for the card's quiet domain. */
function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
/** A2 §3: the pasted text when it's only web links, one per line (blank lines allowed); otherwise null. */
function pastedUrls(text: string): string[] | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  return lines.length && lines.length <= 50 && lines.every(isHttpUrl) ? lines : null
}
/**
 * A link copied as text from a page (Bumblebee ede057e9, Lead aa5d532f): the HTML is exactly one `<a href>` to an
 * http(s) URL and nothing else, and the plain text is its text. That text becomes the default title. HTML with a link
 * inside a sentence, or with more than one link, is a normal paste.
 */
function copiedLink(html: string, plain: string): { url: string; text: string } | null {
  if (!html) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const anchors = [...doc.body.querySelectorAll('a[href]')]
  if (anchors.length !== 1) return null
  const rest = doc.body.cloneNode(true) as HTMLElement
  rest.querySelectorAll('a[href]').forEach(a => a.remove())
  const url = anchors[0]!.getAttribute('href')?.trim() ?? '', text = anchors[0]!.textContent?.trim() ?? ''
  // Nothing else that is content, inside or around the link: an image or other media is not "a link alone" (Ratchet
  // 2aea0960), even though it has no text. Wrappers, <meta>, <style> and <br> are what clipboards add around a link.
  const media = 'img, picture, svg, video, audio, iframe, canvas, object, embed, input, textarea, select, table, hr'
  if (rest.textContent?.trim() || rest.querySelector(media) || anchors[0]!.querySelector(media)) return null
  if (!isHttpUrl(url) || (plain.trim() && plain.trim() !== text)) return null
  return { url, text }
}
/** "Today", "Mon, Oct 19": the app's day format, for "Saved before · {day}". */
function dayLabel(day: string): string {
  return day === todayIso() ? 'Today' : longLabel(day)
}

// Inside a document only real dates earn a chip; "Unscheduled" is list-screen vocabulary and would be noise here.
function hasDateFacts(task: Task): boolean {
  return Boolean(task.deadlineOn || task.attentionOn)
}

const touchHandleSize = 44
// Viewport y of the middle of a block's first line of text. Works for empty blocks and wrapped text alike,
// since it reads the line box of the inline content rather than the rendered glyphs.
function firstLineCenter(block: HTMLElement): number {
  const inline = block.querySelector<HTMLElement>('.bn-inline-content, .editor-page-card-title') ?? block
  const style = getComputedStyle(inline)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
  return inline.getBoundingClientRect().top + lineHeight / 2
}

export function PageEditor({ page, workspace }: { page: Page; workspace: Workspace }) {
  const { run, refresh, latest } = useWorkspace()
  const runRef = useRef(run); runRef.current = run
  const navigate = useNavigate()
  const key = `daythread:editor:${page.id}`
  const initial = useRef<{ nodes: EditorNode[]; base: string; recovered: boolean; cutTaskIds: string[] } | null>(null)
  if (!initial.current) {
    const base = pageContentKey(page)
    let nodes = editorSeed(page, workspace, { templateRows: needsTemplateRows(page, todayIso()) }), recovered = false, savedBase = base, cutTaskIds: string[] = []
    // A recovered draft brings back its cuts too (Ratchet 067be3eb): a cut row in it is a move, never a delete.
    try { const stored = JSON.parse(localStorage.getItem(key) ?? 'null'); if (stored?.document) { nodes = JSON.parse(stored.document); savedBase = stored.base; recovered = true; cutTaskIds = Array.isArray(stored.cutTaskIds) ? stored.cutTaskIds.filter((x: unknown) => typeof x === 'string') : [] } } catch { /* fresh document */ }
    initial.current = { nodes, base: savedBase, recovered, cutTaskIds }
  }
  const [pastedChecklistIds, setPastedChecklistIds] = useState<string[]>(() => checklistIds(initial.current!.nodes))
  // The blocks the handle press picked; the drop handler moves exactly these.
  const pickedIds = useRef<string[]>([])
  const extendedIds = useRef<string[]>([])
  const latestPage = useRef(page); latestPage.current = page
  // Event and link rows keep their own kind on the page; the tag index reads only paragraph and task text.
  const tagCounts = useCallback((id: string) => { const kind = latestPage.current.sections.flatMap(s => s.blocks).find(b => b.id === id)?.kind; return !kind || kind === 'paragraph' || kind === 'task' }, [])
  // No gap cursor (Brian 967fd04b): BlockNote's custom blocks are `isolating`, so ProseMirror found a gap at every
  // task row's edge, stopped ↑/↓ there and drew its gap cursor, a blinking 20 px line beside the row. rowArrows moves
  // the caret between task rows instead. The page has no tables or other blocks that need a gap cursor.
  const editor = useCreateBlockNote({ schema, disableExtensions: ['gapCursor'], extensions: [tagDecorations(tagCounts), rowArrows()], dropCursor: { color: 'var(--bn-brand)', width: 3 }, placeholders: { default: 'Write…', emptyDocument: 'Write…', bulletListItem: '' }, pasteHandler: ({ event, editor, defaultPasteHandler }) => {
    const data = event.clipboardData
    // A9a §3: `[[` that arrives by paste doesn't open the list; only typing does.
    pastingNow.current = true; setTimeout(() => { pastingNow.current = false }, 0)
    if (!data) return defaultPasteHandler()
    const insert = (blocks: EditorNode[]) => {
      // ProseMirror fits a block slice at the actual selection, preserving both sides of a split paragraph.
      // Building the nodes directly also keeps each new Task's block ID and derived Task ID together.
      const view = editor.prosemirrorView
      const content = Fragment.fromArray(blocks.map(block => blockToNode(block as never, view.state.schema)))
      view.dispatch(closeHistory(view.state.tr).replaceSelection(new Slice(content, 0, 0)).scrollIntoView())
    }
    // A11 §4: a link to a line (the app's type, or this app's own line URL as text) is checked first, so an in-app URL
    // never becomes a link card. Other hosts, unknown params and malformed URLs paste as before.
    const line = parseLineClipboard(data.getData(lineClipboardType)) ?? parseLineUrl(data.getData('text/plain'), window.location.origin)
    // A link to a page that no longer exists has nothing to point at: it pastes as its text.
    if (line && !data.getData(clipboardType) && lineRefView(latestWorkspace.current, line).state !== 'page-not-found') {
      const at = editor.getTextCursorPosition().block
      // A task title holds no links (A9a): the line's words, as text.
      if (at.type === 'task') {
        const words = lineRefView(latestWorkspace.current, line).resolved?.words.trim()
        if (!words) return defaultPasteHandler()
        editor.insertInlineContent(words)
        return true
      }
      if (!linkableLines.has(at.type)) return defaultPasteHandler()
      const view = editor.prosemirrorView, { from, to } = view.state.selection
      const node = view.state.schema.nodes.pageRef!.create({ pageId: line.pageId, refId: crypto.randomUUID(), newTitle: '', lineId: line.lineId, taskId: line.taskId ?? '' })
      // A space follows the chip unless one is there already, as after a `[[` link.
      const next = view.state.doc.textBetween(to, Math.min(to + 1, view.state.selection.$to.end()), undefined, '\ufffc')
      const tr = closeHistory(view.state.tr).replaceWith(from, to, next && /\s/.test(next) ? node : [node, view.state.schema.text(' ')])
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + node.nodeSize + (next && /\s/.test(next) ? 0 : 1))).scrollIntoView())
      return true
    }
    const internal = data.getData(clipboardType)
    if (internal) {
      try {
        const payload = JSON.parse(internal)
        if (!Array.isArray(payload.blocks)) return defaultPasteHandler()
        const moving = payload.cut && (cutTokens.has(payload.token) || localStorage.getItem(`daythread:cut:${payload.token}`) === JSON.stringify(payload.blocks))
        // A9a §1: a pasted copy's `[[` links are new references (new refIds); a cut-and-paste move keeps them. A task row
        // can't hold a link, so there it becomes the page's title as text.
        const freshContent = (node: EditorNode): unknown => !Array.isArray(node.content) ? node.content : (node.content as { type?: string; props?: Record<string, string> }[]).map(c => c?.type !== 'pageRef' ? c
          : node.type === 'task' ? { type: 'text', text: c.props?.lineId ? lineRefView(latestWorkspace.current, { pageId: c.props.pageId ?? '', lineId: c.props.lineId, ...(c.props.taskId ? { taskId: c.props.taskId } : {}) }).resolved?.words ?? '' : pageRefView(latestWorkspace.current, c.props?.pageId ?? '', c.props?.newTitle || undefined).label, styles: {} }
          : moving ? c : { ...c, props: { ...c.props, refId: crypto.randomUUID() } })
        const fresh = (node: EditorNode): EditorNode => {
          const id = crypto.randomUUID()
          return { ...node, id, content: freshContent(node), ...(node.type === 'task' ? { props: moving && latestWorkspace.current.tasks.some(t => t.id === node.props?.taskId) ? node.props : { taskId: `editor-task:${id}`, role: 'reference', planDate: '' } } : {}), ...(node.children ? { children: node.children.map(fresh) } : {}) }
        }
        insert(payload.blocks.map(fresh))
        if (payload.cut) { cutTokens.delete(payload.token); localStorage.removeItem(`daythread:cut:${payload.token}`) }
        return true
      } catch { setStatus('Could not paste these blocks · clipboard kept'); return true }
    }
    // A2 §3: only web links, one per line, onto an empty text, bullet or numbered line → a link page per URL. Checked
    // before the HTML branch, since a link copied from a page carries text/html too.
    const copied = copiedLink(data.getData('text/html'), data.getData('text/plain'))
    const urls = pastedUrls(data.getData('text/plain')) ?? pastedUrls(data.getData('text/uri-list').split(/\r?\n/).filter(l => !l.startsWith('#')).join('\n')) ?? (copied ? [copied.url] : null)
    const at = editor.getTextCursorPosition().block
    if (urls && editor.prosemirrorState.selection.empty && ['paragraph', 'bulletListItem', 'numberedListItem'].includes(at.type) && !inlineText(at.content).trim() && !at.children.length) {
      void pasteLinkLines(at.id, at.type, urls, copied && urls.length === 1 && urls[0] === copied.url ? copied.text : undefined)
      return true
    }
    const html = data.getData('text/html')
    const text = data.getData('text/markdown') || data.getData('text/plain')
    // Parse external checklists before the normal typed-[] conversion can create Tasks.
    if (html || /^\s*(?:[-*+]\s+)?\[[ xX]\]/m.test(text)) {
      const blocks = (html ? editor.tryParseHTMLToBlocks(html) : editor.tryParseMarkdownToBlocks(text.replace(/^(\s*)(\[[ xX]\])/gm, '$1- $2'))) as unknown as EditorNode[]
      const ids: string[] = []
      let hasChecklist = false
      const protect = (node: EditorNode): EditorNode => {
        const id = crypto.randomUUID()
        if (node.type === 'checkListItem') { hasChecklist = true; if (!node.props?.checked) ids.push(id); return { ...node, id, type: 'sourceChecklist', props: { checked: Boolean(node.props?.checked) }, children: node.children?.map(protect) } }
        if (node.type === 'task') return { id, type: 'paragraph', content: node.content, children: node.children?.map(protect) }
        return { ...node, id, children: node.children?.map(protect) }
      }
      const safe = blocks.map(protect)
      if (hasChecklist) {
        insert(safe)
        setPastedChecklistIds(ids)
        return true
      }
    }
    return defaultPasteHandler()
  }, initialContent: (initial.current.nodes.length ? initial.current.nodes : [{ type: 'paragraph' }]) as never })
  const base = useRef(initial.current.base)
  const latestWorkspace = useRef(workspace); latestWorkspace.current = workspace
  const dirty = useRef(initial.current.recovered)
  const sending = useRef(false)
  const historyPending = useRef(false)
  const historyGuardBypass = useRef(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const lastSent = useRef('')
  // The document the server last accepted from this editor, so leaving knows whether anything is still unsaved.
  const lastSaved = useRef<string | null>(null)
  const left = useRef(false)
  // Settles once the save on its way has finished and set its new starting point; leaving waits for it (Ratchet #99).
  const inflight = useRef<Promise<void>>(Promise.resolve())
  const undoingPaste = useRef(false)
  // A9a §3: where the last `[[` list opened (so the same characters don't open it twice), and whether text is being pasted.
  const lastTrigger = useRef(-1)
  const pastingNow = useRef(false)
  const knownSemantic = useRef(new Set<string>())
  const expectedTaskVersions = useRef(new Map(workspace.tasks.map(t => [t.id, t.version])))
  const invalidHistoryTasks = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppress = useRef(false)
  const semanticDeletes = useRef(new Set<string>())
  // B33: tasks whose rows were cut (a move): the next save says so, so the task isn't deleted with its line.
  const cutTasks = useRef(new Set<string>(initial.current.cutTaskIds))
  const composing = useRef(false)
  const selected = useRef<string[]>([])
  const dragging = useRef<EditorNode[]>([])
  const [status, setStatus] = useState(initial.current.recovered ? 'Recovered unsaved draft' : '')
  const [failed, setFailed] = useState(initial.current.recovered)
  const [drop, setDrop] = useState<{ id: string; end: boolean; top: number } | null>(null)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  // Opened at a line (?block=id, from a tag or a line link): bring that block into view a third from the top and tint
  // it briefly (line-jump.ts). Nothing is focused, so a phone keyboard stays down. The parameter is dropped once shown,
  // so a refresh doesn't replay it; until then a remount (the page loading under the editor) still finds it.
  const [jumpTo] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('block'))
  const blockElement = useCallback((id: string) => editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"]`) ?? null, [editor])
  const jumpCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => jumpCleanup.current?.(), [])
  const jumpWithin = useCallback((id: string) => {
    const el = blockElement(id)
    if (!el) return false
    jumpCleanup.current?.(); jumpCleanup.current = jumpToBlock(el)
    return true
  }, [blockElement])
  // A11 §5: a line link to this page jumps here without navigating, a second time too.
  useEffect(() => registerEditor(page.id, jumpWithin), [page.id, jumpWithin])
  useEffect(() => {
    const id = jumpTo
    if (!id) return
    let frame = 0, tries = 0, cancelled = false
    const dropParam = () => { const url = new URL(window.location.href); for (const k of ['block', 'task', 'from']) url.searchParams.delete(k); window.history.replaceState(window.history.state, '', url) }
    const search = new URLSearchParams(window.location.search)
    const isLineUrl = window.location.pathname === '/pages' && search.get('page') === page.id
    // From the Tags list: the line on the page the list names; only a row that's gone follows its task (Bumblebee
    // 54096b19). Anything else opened at a line (a day page's tag) just finds it here.
    const fromTags = isLineUrl && search.get('from') === 'tags'
    const find = (blockId: string) => {
      if (cancelled) return
      if (!jumpWithin(blockId)) { if (++tries < 120) frame = requestAnimationFrame(() => find(blockId)); return }
      dropParam()
    }
    if (!isLineUrl) { frame = requestAnimationFrame(() => find(id)); return () => { cancelled = true; cancelAnimationFrame(frame) } }
    if (fromTags && editor.getBlock(id)) { frame = requestAnimationFrame(() => find(id)); return () => { cancelled = true; cancelAnimationFrame(frame) } }
    // A11 §4: a line URL (`/pages?page=…&block=…[&task=…]`) is always resolved on the server first, so it lands where
    // the chip does, even when the block is still on the URL's page (a task's history row on a past day).
    const attempt = () => void resolveLineLink({ data: { pageId: page.id, lineId: id, ...(search.get('task') ? { taskId: search.get('task')! } : {}) } }).then(r => {
      if (cancelled) return
      // Go to the server's address. A page this browser's copy doesn't have yet (made since it loaded, e.g. the day a
      // task was just moved to) gets a full load, so the route reads fresh data before jumping (Ratchet #146, Lead).
      const go = (href: string) => { if (latestWorkspace.current.pages.some(p => p.id === r.pageId)) void navigate({ href, replace: true, resetScroll: false }); else window.location.replace(href) }
      const elsewhere = r.pageId !== page.id || page.type === 'daily'
      if (r.state === 'line-not-found' || r.state === 'page-not-found' || !r.blockId) {
        dropParam(); window.scrollTo({ top: 0 }); toast("Couldn't find that line", { timeout: 4000 })
        if (r.href && elsewhere) go(r.href)
        return
      }
      // Somewhere else now (a task's plan day), or a day page opened by its id: go to its own address.
      if (r.href && elsewhere) { go(r.href); return }
      find(r.blockId)
    }, () => { if (!cancelled) lookupFailed(attempt) })
    attempt()
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [editor, jumpTo, jumpWithin, page.id, navigate])
  useEffect(() => { const media = window.matchMedia('(max-width: 899px)'); const update = () => setCompact(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  const [touchHandle, setTouchHandle] = useState<{ id: string; top: number } | null>(null)
  const [touchDragging, setTouchDragging] = useState(false)
  const dropRef = useRef<typeof drop>(null)
  // Edit notices ("Deleted 'Notes' · Undo") are HeroUI toasts. Undo only applies while the document is still the
  // one the notice describes; any later edit retires the notice.
  const notice = useRef<{ key: string; fingerprint: string } | null>(null)
  const closeNotice = () => { if (notice.current) toast.close(notice.current.key); notice.current = null }
  const setNotice = ({ text, fingerprint }: { text: string; fingerprint: string }) => {
    closeNotice()
    const key = toast(text, {
      timeout: 8000,
      actionProps: { children: 'Undo', onPress: () => { if (notice.current?.key === key && fingerprint === JSON.stringify(editor.document)) void performHistory('undo'); closeNotice() } },
      onClose: () => { if (notice.current?.key === key) notice.current = null },
    })
    notice.current = { key, fingerprint }
  }
  const [selectionLabel, setSelectionLabel] = useState('')

  // B19 (Lead a2edc0a7): on a past day, the rows that were empty when the page opened (template bullets he never used)
  // are hidden on screen only, never deleted. A row shows again once the cursor is in it, and new lines are never hidden.
  const [hiddenEmpty, setHiddenEmpty] = useState<ReadonlySet<string>>(() => {
    if (page.type !== 'daily' || !page.date || page.date >= todayIso()) return new Set()
    return new Set(deepNodes(initial.current!.nodes).filter(n => ['paragraph', 'bulletListItem', 'numberedListItem', 'task'].includes(n.type) && !inlineText(n.content).trim() && !(Array.isArray(n.content) && n.content.some((c: { type?: string }) => c.type && c.type !== 'text')) && !n.children?.length).map(n => n.id))
  })
  useEffect(() => editor.onSelectionChange(() => {
    const block = editor.getTextCursorPosition().block
    // On a heading, its section's hidden rows show too, so ↓ lands in them instead of renaming the next heading (Lead).
    const shown = new Set(block.type === 'heading' ? deepNodes(sectionRange(editor.document as unknown as EditorNode[], block.id)).map(n => n.id) : [block.id])
    setHiddenEmpty(ids => [...ids].some(x => shown.has(x)) ? new Set([...ids].filter(x => !shown.has(x))) : ids)
  }), [editor])
  /**
   * A section heading with a role (Top 3, Other, Events, Good Stuffs, Notes) isn't dissolved by one key: Delete at the
   * end of the line before it, or Backspace at its start, does nothing (Brian's Delete bug, Lead). Selecting across it
   * and deleting still works, and ⌘Z brings it back with its role. Headings he adds himself edit as usual.
   */
  function joinsRoleHeading(key: 'Delete' | 'Backspace'): boolean {
    const { selection, doc } = editor.prosemirrorState
    if (!selection.empty) return false
    const $from = selection.$from
    const isRoleHeading = ($pos: typeof $from) => $pos.parent.type.name === 'heading'
      && page.sections.some(s => s.id === $pos.node($pos.depth - 1).attrs.id && s.kind !== 'custom')
    if (key === 'Backspace') return $from.parentOffset === 0 && isRoleHeading($from)
    if ($from.parentOffset !== $from.parent.content.size) return false
    const next = Selection.findFrom(doc.resolve($from.after()), 1, true)
    return !!next && isRoleHeading(next.$from)
  }
  const selectionFocus = useRef<HTMLDivElement>(null)
  // Browser selection can survive React node-view replacement while ProseMirror's selection moves elsewhere.
  // Keep stable block IDs and inline offsets instead of positions tied to the replaced document.
  function browserSelection() {
    const dom = window.getSelection(), view = editor.prosemirrorView
    if (!dom) return null
    const point = (node: Node | null, offset: number) => {
      if (!node || !view.dom.contains(node)) return null
      const el = node instanceof Element ? node : node.parentElement
      const inline = el?.closest('.bn-inline-content, .editor-task-title')
      const id = el?.closest('[data-node-type="blockContainer"]')?.getAttribute('data-id')
      if (!inline || !id || el?.closest('[contenteditable="false"]')) return null
      const range = document.createRange(); range.selectNodeContents(inline); range.setEnd(node, offset)
      return { id, offset: range.toString().length }
    }
    const anchor = point(dom.anchorNode, dom.anchorOffset), head = point(dom.focusNode, dom.focusOffset)
    return anchor && head ? { anchor, head } : null
  }
  function restoreBrowserSelection(saved: ReturnType<typeof browserSelection>) {
    if (!saved) return
    const view = editor.prosemirrorView
    const position = (point: { id: string; offset: number }) => {
      let result: number | null = null
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'blockContainer' && node.attrs.id === point.id && node.firstChild?.inlineContent) result = pos + 2 + Math.min(point.offset, node.firstChild.content.size)
      })
      return result
    }
    const anchor = position(saved.anchor), head = position(saved.head)
    if (anchor === null || head === null || view.state.selection.anchor === anchor && view.state.selection.head === head) return
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
  }
  const nodes = () => editor.document as unknown as EditorNode[]
  const insertionRole = (blockId: string) => {
    const preceding = nodes().slice(0, nodes().findIndex(n => n.id === blockId) + 1).reverse().find(n => n.type === 'heading')
    const section = latestPage.current.sections.find(s => s.id === preceding?.id)
    return latestPage.current.date && (section?.kind === 'top3' || section?.kind === 'other') ? 'plan' : 'reference'
  }
  const stash = () => { try { localStorage.setItem(key, JSON.stringify({ base: base.current, document: JSON.stringify(nodes()), ...(cutTasks.current.size ? { cutTaskIds: [...cutTasks.current] } : {}) })) } catch { setStatus('Draft stays in this tab; browser recovery storage unavailable') } }
  const flushRef = useRef<() => Promise<void>>(async () => {})
  const pendingSave = useRef<{ fingerprint: string; operationId: string } | null>(null)
  const flush = useCallback(async () => {
    // A2 §4: while a paste's Undo is out, nothing is sent; typing collects and goes once the reply is applied.
    if (left.current || !dirty.current || sending.current || undoingPaste.current) return
    // The page moved on only by his own save from when he last left it: start from that.
    if (isOwnLeaveSave(page.id, latestPage.current.editorJSON)) base.current = pageContentKey(latestPage.current)
    sending.current = true
    const document = JSON.stringify(editor.document)
    const deletions = [...semanticDeletes.current], cutIds = [...cutTasks.current]
    lastSent.current = document
    setStatus('Saving…')
    const action = { type: 'save-editor' as const, pageId: page.id, expectedContent: base.current, document, singleDeleteIds: deletions, ...(cutIds.length ? { cutTaskIds: cutIds } : {}), today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }
    const fingerprint=JSON.stringify(action)
    if (pendingSave.current?.fingerprint !== fingerprint) pendingSave.current={fingerprint,operationId:newOperationId()}
    const operationId=pendingSave.current!.operationId
    debugClient('editor.save.start',{operationId,pageId:page.id,beforeRevision:latestWorkspace.current.revision})
    const source = latestWorkspace.current
    let preview: Workspace
    try { preview = applyCommand(source, { operationId, expectedRevision: source.revision, action }).workspace }
    catch (error) { debugClient('editor.save.rejected',{operationId,pageId:page.id,result:'conflict',error:error instanceof Error?error.name:'UnknownError'}); sending.current = false; setFailed(true); setStatus(error instanceof Error ? error.message : 'Cannot save; draft kept'); return }
    let settled!: () => void
    inflight.current = new Promise<void>(resolve => { settled = resolve })
    try {
      const result = await run(action,undefined,operationId)
      sending.current = false
      if (!result) { debugClient('editor.save.finish',{operationId,pageId:page.id,result:'error'}); setFailed(true); setStatus("Couldn't save · draft kept"); return }
      pendingSave.current=null; lastSaved.current = document
      debugClient('editor.save.finish',{operationId,pageId:page.id,afterRevision:preview.revision,result:'saved'})
      for (const t of source.tasks) if (expectedTaskVersions.current.get(t.id) !== t.version) invalidHistoryTasks.current.add(t.id)
      for (const t of preview.tasks) if (source.tasks.find(old => old.id === t.id)?.version !== t.version) expectedTaskVersions.current.set(t.id, t.version)
      const savedPage = preview.pages.find(p => p.id === page.id)!
      base.current = pageContentKey(savedPage)
      // The editor has closed meanwhile: leaving takes it from here (it needs only the new starting point).
      if (left.current) return
      deletions.forEach(id => { semanticDeletes.current.delete(id); knownSemantic.current.add(id) })
      cutIds.forEach(id => cutTasks.current.delete(id))
      dirty.current = JSON.stringify(editor.document) !== document
      // "Saved" only when every card on this page points at a page that exists (Jazz): a card still waiting doesn't count.
      const waiting = [...pendingPages.values()].some(x => x.parentId === page.id)
      setFailed(false); setStatus(dirty.current ? 'Saving…' : waiting ? 'Saved · page not created yet' : 'Saved')
      if (dirty.current) { stash(); timer.current = setTimeout(() => void flushRef.current(), 300) }
      else localStorage.removeItem(key)
    } finally { settled() }
  }, [editor, key, page.id, run])
  flushRef.current = flush
  useEffect(() => registerEditorFlush(page.id, async () => {
    clearTimeout(timer.current)
    for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (dirty.current) await flushRef.current()
    for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
    return !dirty.current
  }), [page.id])
  useEffect(() => editor.onBeforeChange(({ getChanges, tr }) => {
    if (historyGuardBypass.current || !isHistoryTransaction(tr)) return
    const changes = getChanges()
    if (!changes.some(c => c.source.type === 'undo' || c.source.type === 'redo')) return
    for (const c of changes) {
      if (c.block.type !== 'task') continue
      const taskId = String(c.block.props.taskId)
      const target = latestWorkspace.current.tasks.find(t => t.id === taskId)
      if (target && (invalidHistoryTasks.current.has(taskId) || expectedTaskVersions.current.get(taskId) !== target.version)) {
        debugClient('editor.undo.rejected',{operationId:newOperationId(),pageId:page.id,taskId,result:'version-conflict'}); setStatus(`Can't undo: '${target.title}' changed since`); return false
      }
    }
    for (const [blockId, effect] of Object.entries(latestPage.current.editorDeletions ?? {})) {
      if (!changes.some(c => c.type === 'insert' && c.block.id === blockId)) continue
      const target = latestWorkspace.current.tasks.find(t => t.id === effect.task.id)
      if (!target || target.version !== effect.afterVersion) { debugClient('editor.undo.rejected',{operationId:newOperationId(),pageId:page.id,taskId:effect.task.id,result:'version-conflict'}); setStatus(`Can't undo: '${target?.title ?? effect.task.title}' changed since`); return false }
    }
    if (changes.some(c => c.source.type === 'redo')) {
      for (const c of changes) if (c.type === 'delete' && knownSemantic.current.has(c.block.id)) semanticDeletes.current.add(c.block.id)
    }
  }), [editor])
  useEffect(() => editor.onChange(() => {
    if (suppress.current) return
    if (notice.current && notice.current.fingerprint !== JSON.stringify(editor.document)) closeNotice()
    setPastedChecklistIds(checklistIds(nodes()))
    const checklist = editor.document.find(b => b.type === 'checkListItem')
    if (checklist && !composing.current) editor.transact(tr => {
      editor.updateBlock(checklist.id, { type: 'task', props: { taskId: `editor-task:${checklist.id}`, role: insertionRole(checklist.id), planDate: insertionRole(checklist.id) === 'plan' ? page.date ?? '' : '' }, content: checklist.content } as never)
      tr.setMeta('addToHistory', false)
    })
    dirty.current = true; setFailed(false); setStatus('Unsaved changes')
    queueMicrotask(maybeOpenLinkList)
    stash(); clearTimeout(timer.current)
    if (!composing.current) timer.current = setTimeout(() => void flushRef.current(), 450)
  }), [editor])
  useEffect(() => {
    if (historyPending.current || undoingPaste.current) return
    const next = pageContentKey(page)
    if (next === base.current) return
    // Our own save echoes back with the same document and sections projected from it. Anything else (Put back,
    // Keep from the morning hand-off, another tab) rewrote the page under us and the open editor must follow.
    if (page.editorJSON === lastSent.current && page.editorSections === JSON.stringify(page.sections)) return
    // His own save from when he left this page landed after he came back: carry on from it, it isn't a conflict.
    if (dirty.current && isOwnLeaveSave(page.id, page.editorJSON)) { base.current = next; setFailed(false); clearTimeout(timer.current); timer.current = setTimeout(() => void flushRef.current(), 0); return }
    if (dirty.current) { debugClient('editor.external-refresh',{operationId:newOperationId(),triggerOperationId:pendingSave.current?.operationId,pageId:page.id,result:'conflict'}); setFailed(true); setStatus('Page changed elsewhere · draft kept; copy it before reloading'); return }
    // Deferred: replacing blocks synchronously inside React's commit triggers a flushSync warning from BlockNote's views.
    queueMicrotask(() => {
      if (dirty.current || base.current === next) return
      debugClient('editor.external-refresh',{operationId:newOperationId(),pageId:page.id,afterRevision:workspace.revision,result:'applied'})
      applyServerPage(page, workspace)
    })
  }, [page, editor, workspace])
  /**
   * The server rewrote the open page (Put back, the hand-off, a row action, another tab): show its version. Kept out
   * of editor history (A12 §3), so ⌘Z never reverses a server change locally for the next save to write back; the
   * change's own notice offers its Undo.
   */
  function applyServerPage(p: Page, ws: Workspace) {
    const selection = browserSelection()
    suppress.current = true
    editor.transact(tr => {
      editor.replaceBlocks(editor.document, editorSeed(p, ws, { templateRows: needsTemplateRows(p, todayIso()) }) as never)
      tr.setMeta('addToHistory', false)
    })
    restoreBrowserSelection(selection)
    suppress.current = false
    base.current = pageContentKey(p)
  }
  /**
   * B23 (save-conflict-states §2): the page changed elsewhere since he started. Load the latest page, then put his
   * changes below their lines as one editor edit (so Undo takes exactly those lines out again). His changes are
   * measured against the page he started from; the draft this browser kept for recovery is replaced by the merged
   * page, so a reload doesn't bring the conflict back.
   */
  async function loadLatest() {
    // The page may have changed again since the conflict showed (Ratchet #97): load it now, and hold typing meanwhile
    // so nothing typed during the load is left out of the merge.
    if (historyPending.current) return
    editor.isEditable = false; setStatus('Loading latest…')
    let ws: Workspace
    try { ws = await refresh() } catch { editor.isEditable = true; setStatus("Couldn't load the latest · draft kept"); return }
    editor.isEditable = true
    const latestNow = ws.pages.find(p => p.id === page.id)
    if (!latestNow) { setStatus("Couldn't load the latest · draft kept"); return }
    const [baseSections, baseJSON] = JSON.parse(base.current) as [Page['sections'], string | null]
    const started = { ...latestNow, sections: baseSections, editorJSON: baseJSON ?? undefined, editorSections: JSON.stringify(baseSections) } as Page
    const seed = (p: Page) => editorSeed(p, ws, { templateRows: needsTemplateRows(p, todayIso()) }) as EditorNode[]
    const merged = mergeDraft(seed(started), nodes(), seed(latestNow), new Set(ws.tasks.map(t => t.id)))
    clearTimeout(timer.current)
    semanticDeletes.current.clear(); pendingSave.current = null
    applyServerPage(latestNow, ws)
    dirty.current = false; setFailed(false); localStorage.removeItem(key)
    if (!merged.inserted.length) { setStatus('Latest loaded'); return }
    editor.transact(tr => { closeHistory(tr); editor.replaceBlocks(editor.document, merged.document as never) })
    editor.setTextCursorPosition(merged.inserted[0]!, 'end'); editor.focus()
    editor.domElement?.querySelector(`[data-id="${CSS.escape(merged.inserted[0]!)}"]`)?.scrollIntoView({ block: 'center' })
    setNotice({ text: 'Latest loaded · your changes are below their lines', fingerprint: JSON.stringify(editor.document) })
  }
  // A draft stashed in this browser from the page exactly as it is now (left unsaved by an earlier version, or a closed
  // tab) is saved on opening, instead of waiting for Retry. One made from an older page stays for Load latest (B23).
  useEffect(() => {
    if (initial.current?.recovered && initial.current.base === pageContentKey(page)) timer.current = setTimeout(() => void flushRef.current(), 0)
  }, [])
  useEffect(() => {
    left.current = false // a remount (React's strict check) is open again
    const before = (e: BeforeUnloadEvent) => { if (dirty.current) { stash(); e.preventDefault() } }
    window.addEventListener('beforeunload', before)
    return () => {
      clearTimeout(timer.current); window.removeEventListener('beforeunload', before)
      left.current = true
      if (!dirty.current) return
      // Leaving the page inside the app (another page, another screen) used to only stash the draft here, so an edit
      // made just before switching stayed unsaved until this page was opened again: a cut line stayed on both pages.
      // Now the draft is stashed as before and then saved. If that save is refused or fails, the stash stays and
      // this page shows it on return ("Recovered unsaved draft", or Load latest after a conflict).
      stash()
      const document = JSON.stringify(editor.document), deletions = [...semanticDeletes.current], cutIds = [...cutTasks.current]
      void (async () => {
        // A save already on its way finishes first, so this one starts from the page it produced.
        await inflight.current
        if (document !== lastSaved.current) {
          const action = { type: 'save-editor' as const, pageId: page.id, expectedContent: base.current, document, singleDeleteIds: deletions, ...(cutIds.length ? { cutTaskIds: cutIds } : {}), today: todayIso() }
          debugClient('editor.save.leave',{pageId:page.id})
          const result = await runRef.current(action, undefined, newOperationId(), { inlineRefusal: /changed elsewhere|changed since/i, onRefused: () => {} })
          if (!result) return
          rememberLeaveSave(page.id, document)
        }
        // Clear the stash only if it's still this draft: he may already be back on the page and typing.
        try { if (JSON.parse(localStorage.getItem(key) ?? 'null')?.document === document) localStorage.removeItem(key) } catch { /* keep it */ }
      })()
    }
  }, [])

  // Read from the browser's caret, not editor state: ProseMirror picks up caret moves (Home, arrows) a moment later.
  function caretAtDocumentStart(): boolean {
    const sel = window.getSelection()
    if (!sel?.isCollapsed || !sel.anchorNode) return false
    const first = editor.domElement?.querySelector('[data-node-type="blockContainer"] .bn-inline-content')
    if (!first || (first !== sel.anchorNode && !first.contains(sel.anchorNode))) return false
    const range = document.createRange(); range.selectNodeContents(first); range.setEnd(sel.anchorNode, sel.anchorOffset)
    return range.toString().length === 0
  }
  /**
   * `/page`: the card goes in at once with a page id chosen here, then the page is created under that id. A failed or
   * lost reply never removes the card: the same id is retried (a page the server already made is just confirmed),
   * and after that the card offers Retry (Ratchet #64, Jazz). The new page opens only once card and page both exist.
   */
  async function createSubpage() {
    const pageId = crypto.randomUUID()
    // Card and the empty line after it go in as one transaction, so a single Undo takes the card back out while the
    // page is still being created (Ratchet #64); insertOrUpdateBlockForSlashMenu made those two separate steps.
    let cardId: string | undefined
    editor.transact(() => {
      const current = editor.getTextCursorPosition().block
      const card = { type: 'pageLink', props: { pageId } } as never
      const [inserted] = inlineText(current.content).trim() ? editor.insertBlocks([card], current, 'after') : editor.replaceBlocks([current], [card]).insertedBlocks
      cardId = inserted!.id
      const [line] = editor.insertBlocks([{ type: 'paragraph' } as never], inserted!, 'after')
      editor.setTextCursorPosition(line!, 'start')
    })
    await confirmSubpage(pageId, cardId, true)
  }
  async function confirmSubpage(pageId: string, cardId: string | undefined, open: boolean) {
    const retry = () => void confirmSubpage(pageId, cardId, false)
    setPending(pageId, { state: 'creating', parentId: page.id, retry })
    let created = false
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      if (cardId && !editor.getBlock(cardId)) { setPending(pageId, null); return } // card undone: abandon
      created = Boolean(await run({ type: 'create-document', title: '', body: '', pageId, parentId: page.id }))
        || latestWorkspace.current.pages.some(p => p.id === pageId)
    }
    if (!created) { setPending(pageId, { state: 'failed', parentId: page.id, retry }); setStatus('Page not created · card kept, tap it to retry'); return }
    setPending(pageId, null)
    clearTimeout(timer.current)
    for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (dirty.current) await flushRef.current()
    if (!open || !cardId || !editor.getBlock(cardId)) return
    if (dirty.current) { setStatus('Page created · card not saved yet; it opens from the card once saved'); return }
    rememberCard(cardId)
    void navigate({ to: '/pages', search: { page: pageId, focus: 'title' } })
  }
  /**
   * A2 §3: the cards go in at once (one editor step), each pointing at the page the browser already knows for that key
   * or at a new id; then one paste-links for all of them, retried like `/page` (3 tries, then "Not created · Retry").
   */
  async function pasteLinkLines(blockId: string, lineType: string, urls: string[], linkText?: string) {
    const operationId = newOperationId()
    const preceding = nodes().slice(0, nodes().findIndex(n => n.id === blockId) + 1).reverse().find(n => n.type === 'heading')
    const items = urls.map(url => {
      const known = latestWorkspace.current.pages.find(p => p.url && urlKey(p.url) === urlKey(url))
      return { url, pageId: known?.id ?? crypto.randomUUID(), cardBlockId: crypto.randomUUID(), lineType: lineType as 'paragraph', ...(linkText ? { title: linkText } : {}) }
    })
    editor.transact(() => {
      const cards = items.map(it => ({ id: it.cardBlockId, type: 'pageLink', props: { pageId: it.pageId, url: it.url, line: lineType } }))
      const { insertedBlocks } = editor.replaceBlocks([blockId], cards as never)
      const [next] = editor.insertBlocks([{ type: lineType } as never], insertedBlocks.at(-1)!, 'after')
      editor.setTextCursorPosition(next!, 'start')
    })
    const action = { type: 'paste-links' as const, pageId: page.id, ...(preceding ? { sectionId: preceding.id } : {}), today: todayIso(), items }
    const fresh = items.filter(it => !latestWorkspace.current.pages.some(p => p.id === it.pageId))
    const retry = () => void confirmLinks(action, operationId, fresh.map(it => it.pageId))
    for (const it of fresh) setPending(it.pageId, { state: 'creating', parentId: page.id, retry })
    await confirmLinks(action, operationId, fresh.map(it => it.pageId))
  }
  async function confirmLinks(action: Extract<Parameters<typeof run>[0], { type: 'paste-links' }>, operationId: string, freshIds: string[]) {
    const retry = () => void confirmLinks(action, operationId, freshIds)
    for (const id of freshIds) setPending(id, { state: 'creating', parentId: page.id, retry })
    let preview: Workspace | null = null
    for (let attempt = 0; attempt < 3 && !preview; attempt++) {
      if (!action.items.some(it => editor.getBlock(it.cardBlockId))) { freshIds.forEach(id => setPending(id, null)); return } // undone: abandon
      const source = latestWorkspace.current
      let candidate: Workspace
      try { candidate = applyCommand(source, { operationId, expectedRevision: source.revision, action }).workspace }
      catch (error) { setStatus(error instanceof Error ? error.message : 'Link not saved'); break }
      if (await run(action, null, operationId)) preview = candidate
    }
    if (!preview) { for (const id of freshIds) setPending(id, { state: 'failed', parentId: page.id, retry }); setStatus('Page not created · card kept, tap it to retry'); return }
    freshIds.forEach(id => setPending(id, null))
    // The card save below projects page titles from the workspace, so it starts from the server's, not from a render
    // that hasn't happened yet.
    try { preview = await refresh(operationId) } catch { /* offline again: the local preview of the same command */ }
    latestWorkspace.current = preview; latestPage.current = preview.pages.find(p => p.id === page.id)!
    const records = pasteRecords(preview.pages.find(p => p.id === page.id)!, operationId)
    // Another device made the page first: the card points at that one (not part of his history).
    const moved = records.filter(r => { const b = editor.getBlock(r.cardBlockId); return b && (b.props as { pageId: string }).pageId !== r.pageId })
    if (moved.length) editor.transact(tr => { for (const r of moved) editor.updateBlock(r.cardBlockId, { props: { pageId: r.pageId } } as never); tr.setMeta('addToHistory', false) })
    showLinkNotice(preview, operationId, records)
    // As `/page`: once the pages exist, the cards are saved now, not at his next edit (e.g. after a Retry).
    if (dirty.current && !sending.current) { clearTimeout(timer.current); void flushRef.current() }
  }
  /** Jazz §4: one notice for the paste, with Undo. Unlike edit notices, typing elsewhere doesn't retire it. */
  const linkNotice = useRef<{ key: string; operationId: string; fingerprint: string } | null>(null)
  // Its Undo belongs to this editor: leaving the page retires it.
  useEffect(() => () => { if (linkNotice.current) toast.close(linkNotice.current.key) }, [])
  function showLinkNotice(ws: Workspace, operationId: string, records: ReturnType<typeof pasteRecords>) {
    const pages = new Set(records.map(r => r.pageId)), made = records.filter(r => r.outcome === 'made').length
    const reused = records.filter(r => r.outcome === 'reused' && !records.some(o => o.outcome === 'made' && o.pageId === r.pageId))
    const restored = records.filter(r => r.outcome === 'restored')
    const firstMade = (pageId: string) => ws.pages.flatMap(p => Object.values(p.editorBlockMetadata ?? {})).map(b => b.linkPaste).filter(r => r?.outcome === 'made' && r.pageId === pageId).map(r => r!.on).sort()[0]
    let text: string
    if (pages.size === 1 && restored.length) {
      const p = ws.pages.find(x => x.id === restored[0]!.pageId)!, before = restored[0]!.restored?.find(e => e.pageId === p.id)
      const parent = before?.parentBefore && !p.parentId ? ws.pages.find(x => x.id === before.parentBefore) : undefined
      text = parent ? `Restored to Pages · ${displayPageTitle(parent)} is in trash` : 'Restored from trash'
    } else if (pages.size === 1 && !made) {
      const on = firstMade(records[0]!.pageId)
      text = on ? `Saved before · ${dayLabel(on)}` : 'Saved before'
    } else if (!reused.length && !restored.length) text = made === 1 ? 'Made a page' : `Made ${made} pages`
    else text = [made && `Made ${made} ${made === 1 ? 'page' : 'pages'}`, reused.length && `${reused.length} saved before`, restored.length && `${restored.length} restored from trash`].filter(Boolean).join(' · ')
    if (linkNotice.current) toast.close(linkNotice.current.key)
    const key = toast(text, {
      timeout: 8000,
      actionProps: { children: 'Undo', onPress: () => void undoLinkPaste(operationId) },
      onClose: () => { if (linkNotice.current?.key === key) linkNotice.current = null },
    })
    linkNotice.current = { key, operationId, fingerprint: JSON.stringify(editor.document) }
  }
  /**
   * A2 §4, the targeted merge (Ratchet df3285ef / 9c42d967, Lead): save what he typed, send Undo with autosave held,
   * and on success apply the same `undoCards` change to the editor's current document, so typing during the request
   * stays. The server's page must equal that change applied to the flushed document; otherwise nothing is merged and
   * the normal refresh (or "Page changed elsewhere · draft kept") takes over.
   */
  async function undoLinkPaste(operationId: string) {
    // A refusal is a notice too: the status line is replaced as soon as he types.
    const refuse = (text: string) => { setStatus(text); toast(text, { timeout: 6000 }) }
    if (linkNotice.current?.operationId === operationId) { toast.close(linkNotice.current.key); linkNotice.current = null }
    clearTimeout(timer.current)
    for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (dirty.current) await flushRef.current()
    for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (dirty.current || sending.current) { refuse("Couldn't undo · card kept"); return }
    const action = { type: 'undo-paste-links' as const, pageId: page.id, operationId, today: todayIso() }
    const undoOperationId = newOperationId()
    // The server's page must be exactly what this editor last saved (Ratchet 9c42d967); if another device changed it,
    // nothing is undone and the normal refresh, or "Page changed elsewhere · draft kept", takes over.
    let source: Workspace
    try { source = await refresh(undoOperationId) } catch { refuse("Couldn't undo · card kept"); return }
    const onServer = source.pages.find(p => p.id === page.id)
    if (!onServer || pageContentKey(onServer) !== base.current) { refuse("Couldn't undo · page changed elsewhere"); return }
    latestWorkspace.current = source
    let preview: Workspace
    try { preview = applyCommand(source, { operationId: undoOperationId, expectedRevision: source.revision, action }).workspace }
    catch (error) { refuse(error instanceof Error ? error.message : "Couldn't undo · card kept"); return }
    const before = source.pages.find(p => p.id === page.id)!
    const cards: UndoCard[] = pasteRecords(before, operationId).filter(r => !r.undone).map(r => ({ blockId: r.cardBlockId, pageId: r.pageId, url: r.url, lineType: r.lineType }))
    const expected = preview.pages.find(p => p.id === page.id)!
    undoingPaste.current = true
    try {
      const receipt = await run(action, r => (r.message === 'Paste undone' ? null : { text: r.message }), undoOperationId, { inlineRefusal: /Page changed · nothing was undone|Nothing to undo|Saved elsewhere/, onRefused: () => refuse("Couldn't undo · card kept") })
      if (!receipt) return
      suppress.current = true
      editor.transact(tr => {
        for (const c of cardsPresent(nodes(), cards)) { const line = urlLine(c); editor.updateBlock(c.blockId, { type: line.type, props: {}, content: line.content } as never) }
        tr.setMeta('addToHistory', false)
      })
      suppress.current = false
      latestWorkspace.current = preview; latestPage.current = expected
      base.current = pageContentKey(expected); lastSent.current = expected.editorJSON ?? ''
      pendingSave.current = null
      dirty.current = JSON.stringify(editor.document) !== expected.editorJSON
      if (!dirty.current) { localStorage.removeItem(key); setStatus('Saved') }
    } finally {
      undoingPaste.current = false
      if (dirty.current) { stash(); timer.current = setTimeout(() => void flushRef.current(), 0) }
    }
  }
  /**
   * A9a §3: `[[` or `【【` just before the cursor, typed (not pasted), in a line that can hold a link, opens the list over
   * those characters. Never while an input method is composing; the `input` a browser sends again after
   * `compositionend` finds the list already open (or the position already used), so it opens once. Esc leaves exactly
   * what was typed, since the characters were never removed.
   */
  function maybeOpenLinkList() {
    if (composing.current || pastingNow.current) return
    const menu = editor.getExtension(SuggestionMenu)
    if (!menu || menu.shown()) return
    const { selection } = editor.prosemirrorState
    if (!selection.empty || !linkableLines.has(editor.getTextCursorPosition().block.type)) return
    const $from = selection.$from
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset, undefined, '\ufffc')
    const trigger = before === '[[' ? '[[' : before === '【【' ? '【【' : null
    if (!trigger) { lastTrigger.current = -1; return }
    if (lastTrigger.current === selection.from) return
    lastTrigger.current = selection.from
    menu.openSuggestionMenu(trigger, { deleteTriggerCharacter: false })
  }
  /** §3: where a page lives, for the list's second line. */
  function whereLabel(p: Page): string {
    if (p.url) { try { return new URL(p.url).hostname.replace(/^www\./, '') } catch { return p.url } }
    const parent = parentOf(latestWorkspace.current, p)
    // A day needs no second line: its calendar icon already says it (Jazz 2ff83a4e).
    return parent ? `in ${pageLabel(parent)}` : p.type === 'daily' ? '' : 'in Pages'
  }
  /** §3: the list. Empty: recent pages; typed: titles (and day labels) containing it, start of title first, max 8. */
  function linkItems(query: string, trigger: string) {
    const menu = editor.getExtension(SuggestionMenu)
    // `]]` with nothing chosen leaves plain text.
    if (/(\]\]|】】)$/.test(query)) { queueMicrotask(() => menu?.closeMenu()); return [] }
    const ws = latestWorkspace.current, q = query.trim().toLowerCase()
    const recent = recentPages(ws, page.id)
    const rank = new Map(recent.map((p, i) => [p.id, i]))
    const keys = (p: Page) => [pageLabel(p), p.title, ...(p.date ? [p.date, longLabel(p.date), longLabel(p.date).replace(/^\w+,\s*/, '')] : [])].map(k => k.toLowerCase())
    const pages = q
      ? visiblePages(ws).filter(p => p.id !== page.id && keys(p).some(k => k.includes(q)))
        .sort((a, b) => Number(!keys(a).some(k => k.startsWith(q))) - Number(!keys(b).some(k => k.startsWith(q))) || (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)).slice(0, 8)
      : recent.slice(0, 6)
    const items = pages.map(p => ({ title: pageLabel(p), subtext: whereLabel(p), icon: pageRefView(ws, p.id).icon, onItemClick: () => chooseLink(trigger, query, p.id) }))
    if (q) items.push({ title: `New page "${query.trim()}"`, subtext: pages.length ? '' : `No page called ${query.trim()}`, icon: <PlusIcon />, onItemClick: () => chooseLink(trigger, query, crypto.randomUUID(), query.trim()) })
    return items
  }
  /** §4: `[[query` becomes the link, as one editor step. A new page is made under this one, like `/page`. */
  function chooseLink(trigger: string, query: string, pageId: string, newTitle?: string) {
    editor.getExtension(SuggestionMenu)?.closeMenu()
    // BlockNote's menu has usually cleared `[[query` already (closeMenu + clearQuery run before the item); take away
    // whatever of it is still before the cursor, and nothing else.
    const { $from } = editor.prosemirrorState.selection, to = $from.pos
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
    const from = to - (before.endsWith(trigger + query) ? trigger.length + query.length : before.endsWith(trigger) ? trigger.length : 0)
    // One step: `[[query` is replaced by the link node itself, and the cursor goes after it.
    // A space follows the link unless one is already there: a line ending in a non-editable node has no text position
    // after it, so a click or End couldn't put the cursor there to keep writing or to Backspace it (as Notion does).
    const view = editor.prosemirrorView, node = view.state.schema.nodes.pageRef!.create({ pageId, refId: crypto.randomUUID(), newTitle: newTitle ?? '' })
    const next = view.state.doc.textBetween(to, Math.min(to + 1, view.state.selection.$from.end()), undefined, '\ufffc')
    const tr = view.state.tr.replaceWith(from, to, next && /\s/.test(next) ? node : [node, view.state.schema.text(' ')])
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + node.nodeSize + (next && /\s/.test(next) ? 0 : 1))).scrollIntoView())
    lastTrigger.current = -1
    if (newTitle) void createLinkedPage(pageId, newTitle)
  }
  /** §4: `/page`'s confirm loop for a page made from `[[`: 3 tries, then "Not created · Retry" on the link. No notice. */
  async function createLinkedPage(pageId: string, title: string) {
    const retry = () => void createLinkedPage(pageId, title)
    const linked = () => JSON.stringify(editor.document).includes(`"pageId":"${pageId}"`)
    setPending(pageId, { state: 'creating', parentId: page.id, retry })
    let created = false
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      if (!linked()) { setPending(pageId, null); return } // undone before it was made: abandon
      created = Boolean(await run({ type: 'create-document', title, body: '', pageId, parentId: page.id }, null)) || latestWorkspace.current.pages.some(p => p.id === pageId)
    }
    if (!created) { setPending(pageId, { state: 'failed', parentId: page.id, retry }); setStatus('Page not created · link kept, tap it to retry'); return }
    setPending(pageId, null)
    if (dirty.current && !sending.current) { clearTimeout(timer.current); void flushRef.current() }
  }
  async function performHistory(direction: 'undo' | 'redo') {
    if (historyPending.current) return
    const historyOperationId=newOperationId()
    debugClient('editor.history.start',{operationId:historyOperationId,pageId:page.id,command:direction})
    let candidate: Transaction | null = null
    const command = direction === 'undo' ? historyUndo : historyRedo
    command(editor.prosemirrorState, tr => { candidate = tr })
    if (!candidate) { debugClient('editor.history.rejected',{operationId:historyOperationId,pageId:page.id,result:'unavailable'}); return }
    const transaction = candidate as Transaction
    const affected = new Set<string>()
    const collect = (doc: Transaction['doc'], from: number, to: number) => {
      doc.nodesBetween(Math.max(0, Math.min(from, doc.content.size)), Math.max(0, Math.min(to, doc.content.size)), node => {
        if (node.type.name === 'task' && node.attrs.taskId) affected.add(String(node.attrs.taskId))
      })
    }
    for (const step of transaction.steps) step.getMap().forEach((from, to, nextFrom, nextTo) => { collect(transaction.before, from, to); collect(transaction.doc, nextFrom, nextTo) })
    const nextDocument = docToBlocks(transaction.doc) as unknown as EditorNode[]
    const oldNodes = deepNodes(nodes()), nextNodes = deepNodes(nextDocument)
    const oldById = new Map(oldNodes.map(n => [n.id, n])), nextById = new Map(nextNodes.map(n => [n.id, n]))
    const semantic = [...affected].some(taskId => {
      const old = oldNodes.find(n => n.type === 'task' && n.props?.taskId === taskId)
      const next = nextNodes.find(n => n.type === 'task' && n.props?.taskId === taskId)
      return !latestWorkspace.current.tasks.some(t => t.id === taskId) && [old, next].some(n => n?.props?.taskId === `editor-task:${n?.id}`)
        || old && next && inlineText(old.content) !== inlineText(next.content)
        || Object.entries(latestPage.current.editorDeletions ?? {}).some(([id, effect]) => effect.task.id === taskId && nextById.has(id) && !oldById.has(id))
        || direction === 'redo' && [...knownSemantic.current].some(id => oldById.get(id)?.props?.taskId === taskId && !nextById.has(id))
        || Object.entries(latestPage.current.editorCreations ?? {}).some(([id, createdTask]) => createdTask === taskId && (oldById.get(id)?.type === 'task') !== (nextById.get(id)?.type === 'task'))
    })
    if (!semantic) { historyGuardBypass.current = true; editor.prosemirrorView.dispatch(transaction); historyGuardBypass.current = false; debugClient('editor.history.finish',{operationId:historyOperationId,pageId:page.id,result:'local'}); return }
    historyPending.current = true; setHistoryBusy(true); editor.isEditable = false
    clearTimeout(timer.current)
    try {
      if (sending.current) {
        for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
        if (sending.current) throw new Error('Still saving · try Undo again shortly')
      }
      if (dirty.current) await flushRef.current()
      if (dirty.current) throw new Error('Reconnect and save before undoing a task change · text kept')
      const current = await refresh(historyOperationId)
      latestWorkspace.current = current
      const p = current.pages.find(p => p.id === page.id)!
      latestPage.current = p
      const document = JSON.stringify(docToBlocks(transaction.doc))
      const candidateNodes = JSON.parse(document) as EditorNode[]
      const remaining = new Set(deepNodes(candidateNodes).map(n => n.id))
      const deleted = direction === 'redo' ? deepNodes(nodes()).filter(n => knownSemantic.current.has(n.id) && !remaining.has(n.id)).map(n => n.id) : []
      const historyTaskVersions = Object.fromEntries([...affected].map(id => [id, current.tasks.some(t => t.id === id) ? expectedTaskVersions.current.get(id) ?? -1 : 0]))
      const action = { type: 'save-editor' as const, pageId: page.id, expectedContent: base.current, document, singleDeleteIds: deleted, historyTaskVersions, history: true, today: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }) }
      const preview = applyCommand(current, { operationId: historyOperationId, expectedRevision: current.revision, action }).workspace
      const receipt = await run(action,undefined,historyOperationId)
      if (!receipt) throw new Error("Can't undo: the page or task changed since · nothing restored")
      const saved = preview.pages.find(p => p.id === page.id)!
      latestPage.current = saved; latestWorkspace.current = preview; base.current = pageContentKey(saved)
      for (const task of preview.tasks) if (current.tasks.find(t => t.id === task.id)?.version !== task.version) expectedTaskVersions.current.set(task.id, task.version)
      lastSent.current = document
      suppress.current = true; historyGuardBypass.current = true
      editor.prosemirrorView.dispatch(transaction)
      setPastedChecklistIds(checklistIds(nextDocument))
      historyGuardBypass.current = false; suppress.current = false
      dirty.current = false; localStorage.removeItem(key); setFailed(false); setStatus('Saved')
      debugClient('editor.history.finish',{operationId:historyOperationId,pageId:page.id,afterRevision:preview.revision,result:'saved'})
    } catch (error) {
      debugClient('editor.history.rejected',{operationId:historyOperationId,pageId:page.id,result:'error',error:error instanceof Error?error.name:'UnknownError'})
      setStatus(error instanceof Error ? error.message : 'Cannot verify task history · nothing restored')
    } finally {
      historyPending.current = false; setHistoryBusy(false); editor.isEditable = true; editor.focus()
    }
  }
  function select(id: string, ids?: readonly string[]) {
    const range = ids?.length ? nodes().filter(n => ids.includes(n.id)) : sectionRange(nodes(), id)
    selected.current = range.map(n => n.id)
    setSelectionLabel(range[0]?.type === 'heading' ? `'${inlineText(range[0].content)}' section selected` : range.length > 1 ? `${range.length} blocks selected` : 'Block selected')
    if (range.length > 1) editor.setSelection(range[0]!.id, range.at(-1)!.id)
    else if (range[0]) {
      let pos = -1
      editor.prosemirrorState.doc.descendants((node, position) => { if (node.type.name === 'blockContainer' && node.attrs.id === range[0]!.id) pos = position })
      if (pos >= 0) editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.setSelection(NodeSelection.create(editor.prosemirrorState.doc, pos)))
    }
    // Keyboard focus waits outside the editable text, and the browser's text selection is cleared (the editor keeps
    // its own), so neither typing nor an input method has anywhere to replace the selected blocks.
    selectionFocus.current?.focus()
    window.getSelection()?.removeAllRanges()
  }
  /** B33: the save's own decision (deletesWithLine), on the document as it is after the delete. */
  const goesWithLine = (taskId: unknown, after: readonly EditorNode[]) => typeof taskId === 'string'
    && deletesWithLine(latestWorkspace.current, latestPage.current, taskId, new Set(deepNodes(after).filter(n => n.type === 'task').map(n => String(n.props?.taskId))))
  /**
   * A new to-do that stays because another page still has a line of it (Ratchet 164): the notice says where, not "To-do
   * deleted" and not "Not today", which he didn't choose (Jazz 57dd5a4e).
   */
  const stillElsewhere = (taskId: unknown, after: readonly EditorNode[]) => {
    const ws = latestWorkspace.current, here = latestPage.current, t = ws.tasks.find(x => x.id === taskId)
    if (!t || !bornHere(ws, t, here) || deepNodes(after).some(n => n.type === 'task' && n.props?.taskId === t.id)) return null
    const other = ws.pages.find(o => o.id !== here.id && o.sections.some(s => s.blocks.some(b => b.taskId === t.id)))
    if (!other) return null
    const from = here.type === 'daily' && here.date === todayIso() ? 'today' : here.type === 'daily' ? placeLabel(here) : 'this page'
    return `Removed from ${from} · ${other.type === 'daily' ? `still on ${placeLabel(other)}` : `still in ${placeLabel(other)}`}`
  }
  function deleteSelected() {
    const before = nodes()
    const ids = selected.current; selected.current = []
    const first = before.find(n => n.id === ids[0])
    const above = before[before.findIndex(n => n.id === ids[0]) - 1]
    // B33: a task born on this page goes with its line, so only tasks with history "stay" (Jazz: no notice for the rest).
    const removedIds = new Set(deepNodes(before.filter(n => ids.includes(n.id))).map(n => n.id))
    const after = before.filter(n => !ids.includes(n.id))
    const kept = (n: EditorNode) => latestWorkspace.current.tasks.some(t => t.id === n.props?.taskId) && !goesWithLine(n.props?.taskId, after)
    const plannedCount = before.filter(n => ids.includes(n.id) && n.type === 'task' && n.props?.role === 'plan' && kept(n)).length
    // To-dos that go with their lines (B33): the notice says so, with its Undo (Jazz 416bbf34).
    const removed = deepNodes(before).filter(n => removedIds.has(n.id))
    const deletedCount = new Set(removed.filter(n => n.type === 'task' && goesWithLine(n.props?.taskId, after)).map(n => n.props?.taskId)).size
    if (ids.length === 1 && nodes().find(n => n.id === ids[0])?.type === 'task') semanticDeletes.current.add(ids[0]!)
    editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorState.tr))
    editor.removeBlocks(ids)
    if (above && editor.getBlock(above.id)) editor.setTextCursorPosition(above.id, 'end')
    else if (editor.document[0]) editor.setTextCursorPosition(editor.document[0].id, 'start')
    editor.focus()
    setSelectionLabel(''); setStatus('Content removed')
    // One copy of a task whose other line stays on this page: nothing happened to the task, so no notice (Lead 2fd18667).
    if (ids.length === 1 && first?.type === 'task' && deepNodes(after).some(n => n.type === 'task' && n.props?.taskId === first.props?.taskId)) return
    setNotice({ text: first?.type === 'heading' ? `Deleted '${inlineText(first.content)}'${plannedCount ? ` · ${plannedCount === 1 ? '1 planned task stays' : `${plannedCount} planned tasks stay`} planned` : ''}` : ids.length === 1 && first?.type === 'task' && stillElsewhere(first.props?.taskId, after) ? stillElsewhere(first.props?.taskId, after)! : ids.length === 1 && first?.type === 'task' && first.props?.role === 'plan' && kept(first) && !deepNodes(after).some(n => n.type === 'task' && n.props?.taskId === first.props?.taskId) ? 'Not today · deadline kept' : deletedCount ? (deletedCount === 1 ? 'To-do deleted' : `${deletedCount} to-dos deleted`) : 'Content removed · tasks unchanged', fingerprint: JSON.stringify(editor.document) })
  }
  // BlockNote places its 30px side menu at the top of the block; our headings and task rows are taller than its
  // defaults (up to 6.5px off when measured). Keep its positioning, nudged level with the hovered block's first line.
  const sideMenuPosition = useMemo(() => ({
    useFloatingOptions: {
      middleware: [offset(({ elements }) => {
        const blockId = editor.getExtension(SideMenuExtension)?.store.state?.block?.id
        const block = blockId ? editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(blockId)}"]`) : null
        return block ? { mainAxis: 4, crossAxis: firstLineCenter(block) - elements.reference.getBoundingClientRect().top - elements.floating.offsetHeight / 2 } : 4
      })],
    },
  }), [editor])
  // Press-tint cleanup lives here, not in the side menu: BlockNote unmounts the side menu while a drag is in flight.
  useEffect(() => {
    const clear = () => document.querySelectorAll('.is-picked').forEach(el => el.classList.remove('is-picked'))
    // ProseMirror doesn't redraw the browser selection while the editor is unfocused after a drop, so collapse both.
    // The picked ids survive the drop event itself: the editor's drop handler below reads them after this capture.
    const settle = () => { clear(); requestAnimationFrame(() => { const { state } = editor.prosemirrorView; if (!state.selection.empty) editor.prosemirrorView.dispatch(state.tr.setSelection(TextSelection.near(state.selection.$to, -1))); const dom = window.getSelection(); if (dom && !dom.isCollapsed && editor.prosemirrorView.dom.contains(dom.focusNode)) dom.collapseToEnd() }) }
    // A press without a drag (a click) ends with pointerup; a drag ends with dragend. Either way the pick is spent.
    const release = () => { clear(); pickedIds.current = [] }
    // BlockNote clears its drop line on dragend at the editor, but the handle that started the drag lives outside
    // it, so a cancelled drag (Escape, which the page never sees as a keydown) would leave the line. Clear it on any
    // dragend, and on the first pointer move after a drag in case the handle was unmounted and dragend never came.
    const dropLineGone = () => { if (document.querySelector('.prosemirror-dropcursor-block')) editor.prosemirrorView.dom.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null })) }
    // Delayed so a drop can first show the line where the blocks landed.
    const ended = () => { settle(); setTimeout(dropLineGone, 300); pickedIds.current = [] }
    document.addEventListener('pointerup', release)
    document.addEventListener('pointermove', dropLineGone)
    document.addEventListener('dragend', ended, true)
    document.addEventListener('drop', settle, true)
    return () => { document.removeEventListener('pointermove', dropLineGone); document.removeEventListener('pointerup', release); document.removeEventListener('dragend', ended, true); document.removeEventListener('drop', settle, true) }
  }, [editor])
  const handleActions = useRef({ select, selected: () => selected.current }); handleActions.current = { select, selected: () => selected.current }
  const Handle = useMemo(() => function StableHandle() { return <SectionSideMenu select={(id, ids) => handleActions.current.select(id, ids)} picked={pickedIds} extended={extendedIds} selectedIds={() => handleActions.current.selected()} /> }, [])
  function updateDrop(x: number, y: number) {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.bn-block[data-id]')
    const id = el?.dataset.id
    const doc = nodes(), target = doc.find(n => n.id === id), first = dragging.current[0]
    if (!first) return
    const lastElement = document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(doc.at(-1)?.id ?? '')}"]`)
    const atEnd = !el && !!lastElement && y >= lastElement.getBoundingClientRect().bottom || !!el && y > el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 && target?.id === doc.at(-1)?.id
    const valid = !dragging.current.some(n => n.id === id)
    const next = valid ? { id: id ?? '', end: atEnd, top: el ? (atEnd ? el.getBoundingClientRect().bottom : el.getBoundingClientRect().top) : y } : null
    dropRef.current = next; setDrop(next)
    if (y < 85) window.scrollBy(0, -20)
    else if (y > window.innerHeight - 120) window.scrollBy(0, 20)
    return valid
  }
  function commitDrag() {
    const target = dropRef.current
    if (target) {
      const moving = dragging.current, ids = new Set(moving.map(n => n.id))
      const rest = nodes().filter(n => !ids.has(n.id))
      const index = target.end ? rest.length : rest.findIndex(n => n.id === target.id)
      if (index >= 0) {
        editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorState.tr))
        editor.replaceBlocks(editor.document, [...rest.slice(0, index), ...moving, ...rest.slice(index)] as never)
        editor.setTextCursorPosition(moving[0]!.id, 'end'); editor.focus()
        setNotice({ text: `Moved '${inlineText(moving[0]!.content) || 'block'}'`, fingerprint: JSON.stringify(editor.document) })
      }
    }
    dragging.current = []; dropRef.current = null; setDrop(null); setTouchDragging(false)
  }
  const [dock, setDock] = useState<HTMLElement | null>(null)
  useEffect(() => setDock(document.getElementById('editor-dock')), [])
  useEffect(() => {
    const blocks = editor.document
    const firstHeading = blocks.findIndex(b => b.type === 'heading')
    const nextHeading = blocks.findIndex((b, i) => i > firstHeading && b.type === 'heading')
    const firstSection = blocks.slice(firstHeading + 1, nextHeading < 0 ? blocks.length : nextHeading)
    const target = firstSection.find(b => !inlineText(b.content)) ?? blocks[(nextHeading < 0 ? blocks.length : nextHeading) - 1] ?? blocks[0]
    // Desktop opens ready to type; on touch screens focusing would raise the keyboard over a page that is read as often as written.
    // Arriving at a block from a tag focuses nothing, so the view stays on that block.
    // A page just made with `/page` opens to name it: the title field has the cursor (Jazz f69dd341).
    const naming = new URLSearchParams(window.location.search).get('focus') === 'title'
    // A past day opens to be read, with no cursor: the cursor would show an empty row he never wrote (B19 hides them
    // until he clicks into a section; Jazz, Bumblebee, Lead).
    const past = page.type === 'daily' && !!page.date && page.date < todayIso()
    if (target && !jumpTo && !naming && !past && window.matchMedia('(pointer: fine)').matches) { editor.setTextCursorPosition(target.id, 'end'); editor.focus() }
  }, [editor, jumpTo])
  useEffect(() => {
    const update = () => {
      const block = editor.getTextCursorPosition().block
      const el = document.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"]`)
      if (el) { const top = firstLineCenter(el) - touchHandleSize / 2; setTouchHandle(previous => previous?.id === block.id && Math.abs(previous.top - top) < 0.5 ? previous : { id: block.id, top }) }
    }
    const off = editor.onSelectionChange(() => requestAnimationFrame(update))
    window.addEventListener('scroll', update, true)
    return () => { off(); window.removeEventListener('scroll', update, true) }
  }, [editor])
  // Toolbar taps must not take focus from the line: WebKit still sends mousedown after a prevented touch pointerdown,
  // which blurred the editor, hid the toolbar and dropped the click (B5 check, Playwright WebKit at 390).
  const keepCaret = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() }
  // A heading starts a section, so nothing nests into or under one: indenting a section's first line would move it out
  // of its section (a Top 3 task would silently leave Top 3). Tab and the phone toolbar both ask this.
  const canIndent = () => {
    const { block, prevBlock } = editor.getTextCursorPosition()
    return editor.canNestBlock() && block.type !== 'heading' && prevBlock?.type !== 'heading'
  }
  // Whether the phone toolbar's indent / outdent can act on the caret's line.
  const [nesting, setNesting] = useState({ in: false, out: false })
  useEffect(() => {
    const update = () => {
      const next = { in: canIndent(), out: editor.canUnnestBlock() }
      setNesting(previous => previous.in === next.in && previous.out === next.out ? previous : next)
    }
    const offSelection = editor.onSelectionChange(update)
    const offChange = editor.onChange(update)
    return () => { offSelection(); offChange() }
  }, [editor])
  function copyBlocks(e: React.ClipboardEvent, cut: boolean) {
    const selection = editor.prosemirrorState.selection
    if (!selected.current.length && (selection.empty || selection instanceof TextSelection && selection.$from.sameParent(selection.$to))) return
    const chosen = selected.current.length ? nodes().filter(n => selected.current.includes(n.id)) : null
    const snapshot = chosen ? null : editor.getSelectionCutBlocks()
    const blocks = chosen ?? snapshot!.blocks.map(block => {
      // Copying just part of a Task title copies text, not the identity or the rest of its title.
      return block.type === 'task' && (snapshot!.blockCutAtStart === block.id || snapshot!.blockCutAtEnd === block.id) ? { ...block, type: 'paragraph', props: {} } : block
    }) as unknown as EditorNode[]
    const token = crypto.randomUUID()
    e.clipboardData.setData(clipboardType, JSON.stringify({ blocks, cut, token }))
    e.clipboardData.setData('text/html', editor.blocksToHTMLLossy(blocks as never))
    e.clipboardData.setData('text/plain', blocks.map(n => inlineText(n.content)).join('\n'))
    e.preventDefault(); e.stopPropagation()
    if (cut) {
      cutTokens.add(token)
      try { localStorage.setItem(`daythread:cut:${token}`, JSON.stringify(blocks)) } catch { /* same-tab move remains available */ }
      // Tasks typed in the editor keep their `editor-task:` id as their real id, so check the workspace, not the prefix.
      for (const n of deepNodes(blocks)) if (n.type === 'task' && latestWorkspace.current.tasks.some(t => t.id === n.props?.taskId)) cutTasks.current.add(String(n.props!.taskId))
      editor.transact(tr => { closeHistory(tr); if (chosen) editor.removeBlocks(chosen.map(n => n.id)); else tr.deleteSelection() })
      selected.current = []; setSelectionLabel('')
    }
  }
  /**
   * A12 §3: a row action edits this page on the server. Save what he typed first and hold input while the command
   * runs, so no autosave races the server's rewrite; then show the server's page. A failure releases the editor with
   * the draft as it was (Ratchet 980d5695).
   */
  const rowNotice = useRef<{ key: string; operationId: string; fingerprint: string } | null>(null)
  const menuReturn = useRef<{ blockId: string; selection: ReturnType<Selection['toJSON']> } | null>(null)
  const closeRowNotice = () => { if (rowNotice.current) toast.close(rowNotice.current.key); rowNotice.current = null }
  useEffect(() => () => closeRowNotice(), [])
  async function onServer(action: Action, operationId: string, options?: { inlineRefusal: RegExp; onRefused: (m: string) => void }): Promise<Receipt | null> {
    if (historyPending.current) return null
    historyPending.current = true; setHistoryBusy(true); editor.isEditable = false
    clearTimeout(timer.current)
    try {
      for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
      if (dirty.current) await flushRef.current()
      for (let i = 0; sending.current && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 20))
      if (dirty.current || sending.current) return null
      const receipt = await run(action, null, operationId, options)
      const ws = latest()
      const p = ws?.pages.find(x => x.id === page.id)
      if (receipt && ws && p) { latestWorkspace.current = ws; latestPage.current = p; if (pageContentKey(p) !== base.current) applyServerPage(p, ws) }
      return receipt
    } finally {
      historyPending.current = false; setHistoryBusy(false); editor.isEditable = true
    }
  }
  const notDone = (text: string) => { setStatus(text); toast(text, { timeout: 6000 }) }
  async function rowAct(blockId: string, t: Task, intent: RowIntent) {
    const today = todayIso(), day = page.date
    if (!day) return
    if (intent.kind === 'section') { moveToSection(blockId, intent.to); return }
    const section = sectionOf(blockId)
    const action: Action =
      intent.kind === 'move' ? { type: 'plan-task', taskId: t.id, date: intent.date, section: section ?? undefined, from: day, today }
      : intent.kind === 'bring-today' ? { type: 'plan-task', taskId: t.id, date: today }
      : intent.kind === 'not-today' ? { type: 'not-today', taskId: t.id, date: day, onlyThisDay: true }
      : { type: 'task-status', taskId: t.id, status: intent.kind === 'cancel' ? 'cancelled' : 'open' }
    // The caret leaves a row that goes: to the end of the line above (Jazz §3).
    const index = nodes().findIndex(n => n.id === blockId)
    const above = index > 0 ? nodes()[index - 1]!.id : null
    const caretHere = editor.getTextCursorPosition().block.id === blockId
    closeRowNotice()
    const operationId = newOperationId()
    const receipt = await onServer(action, operationId)
    if (!receipt) { notDone('Not done · your text is kept'); return }
    // The menu took focus; give it back to the row (or the line above, if the row left) so ⌘Z and typing go on.
    const caretTo = editor.getBlock(blockId) ? blockId : above && editor.getBlock(above) ? above : null
    if (caretTo && (caretHere || document.activeElement === document.body || !editor.domElement?.contains(document.activeElement))) { editor.setTextCursorPosition(caretTo, 'end'); editor.focus() }
    const fallback = receipt.message.indexOf(' · Top 3 is full')
    const text =
      intent.kind === 'move' ? `Moved to ${noticeDate(intent.date)}${fallback >= 0 ? receipt.message.slice(fallback) : ''}`
      : intent.kind === 'bring-today' ? 'On today'
      : intent.kind === 'not-today' ? (receipt.message.startsWith('Removed from') ? `Removed from ${weekday(day)} · still planned for ${weekday(t.plannedOn ?? day)}` : notTodayText(t, day, today))
      : intent.kind === 'cancel' ? 'Cancelled' : 'Restored'
    const key: string = toast(text, {
      timeout: 8000,
      actionProps: { children: 'Undo', onPress: () => void undoRowAction(operationId) },
      onClose: () => { if (rowNotice.current?.key === key) rowNotice.current = null },
    })
    rowNotice.current = { key, operationId, fingerprint: JSON.stringify(editor.document) }
  }
  /** The notice's Undo, and ⌘Z while it shows: the server's undo of that action, run like the action itself. */
  async function undoRowAction(operationId: string) {
    closeRowNotice()
    let refused = ''
    const receipt = await onServer({ type: 'undo', targetOperationId: operationId }, newOperationId(), { inlineRefusal: /Cannot undo after later changes/, onRefused: m => { refused = m } })
    if (receipt) toast('Undone', { timeout: 4000 })
    else notDone(refused ? "Can't undo · changed since" : "Couldn't undo · your text is kept")
  }
  function sectionOf(blockId: string): 'top3' | 'other' | null {
    const list = nodes()
    const heading = list.slice(0, list.findIndex(n => n.id === blockId) + 1).reverse().find(n => n.type === 'heading')
    const kind = latestPage.current.sections.find(s => s.id === heading?.id)?.kind
    return kind === 'top3' || kind === 'other' ? kind : null
  }
  /** Move to Top 3 / Other (Jazz §3): a local edit like dragging the row, to the end of the other section; ⌘Z undoes it. */
  function moveToSection(blockId: string, to: 'top3' | 'other') {
    const heading = latestPage.current.sections.find(s => s.kind === to)
    const block = editor.getBlock(blockId)
    if (!heading || !block || !editor.getBlock(heading.id)) return
    editor.transact(() => {
      editor.removeBlocks([blockId])
      const range = sectionRange(nodes(), heading.id)
      const last = [...range].reverse().find(n => n.type !== 'heading' && (n.type !== 'paragraph' || inlineText(n.content).trim())) ?? range[0]!
      editor.insertBlocks([block as never], last.id, 'after')
    })
    editor.setTextCursorPosition(blockId, 'end'); editor.focus()
  }
  /**
   * A12 at 390 (Jazz §2): the handle selects one open task row, and the selection bar shows its actions instead of
   * "1 selected · Delete". Any other selection keeps the usual bar. Choosing an action ends the selection.
   */
  function phoneRowBar() {
    if (selected.current.length !== 1) return null
    const id = selected.current[0]!, block = editor.getBlock(id)
    if (block?.type !== 'task') return null
    const t = latestWorkspace.current.tasks.find(x => x.id === block.props.taskId)
    if (!t || t.status === 'done') return null
    const keepFocus = (e: { preventDefault(): void }) => e.preventDefault()
    // A cancelled row's only way back is Restore (Ratchet 5701d547, Jazz 1358f49b); at 390 the bar is where it lives.
    if (t.status === 'cancelled') return <div className="editor-selection-bar is-row-actions" onPointerDown={keepFocus}>
      <button type="button" onClick={() => { selected.current = []; setSelectionLabel(''); void rowAct(id, t, { kind: 'restore' }) }}>Restore</button>
      <button type="button" onClick={deleteSelected}>Delete line</button>
    </div>
    if (t.status !== 'open') return null
    const model = rowMenu(t, block.props.role, sectionOf(id), page.date ?? null, todayIso())
    if (!model) return null
    const choose = (intent: RowIntent) => { selected.current = []; setSelectionLabel(''); void rowAct(id, t, intent) }
    const keep = (e: { preventDefault(): void }) => e.preventDefault()
    const [tomorrow, ...rest] = model.primary[0]?.label === 'Tomorrow' ? model.primary : [null, ...model.primary]
    const more = [...menuGroups(model, todayIso(), choose).filter(g => g.title !== 'Another day').map(g => ({ ...g, items: g.items.filter(i => !model.primary.some(p => p.label === i.label) && !i.label.startsWith('Tomorrow')) })).filter(g => g.items.length), ...(lineLinkTarget(id) ? [{ items: [{ label: 'Copy link to line', onSelect: () => { selected.current = []; setSelectionLabel(''); copyLineLink(id) } }] }] : []), { items: [{ label: 'Delete line', danger: true, onSelect: deleteSelected }] }]
    return <div className="editor-selection-bar is-row-actions" onPointerDown={keep}>
      {tomorrow && <button type="button" onClick={() => choose(tomorrow.intent)}>{tomorrow.label}</button>}
      {model.anotherDay && <RowMenu label="Another day" triggerClass="editor-bar-button" trigger="Another day" groups={menuGroups({ ...model, groups: model.groups.filter(g => g.title === 'Another day') }, todayIso(), choose)} />}
      {rest.map(p => p && <button key={p.label} type="button" onClick={() => choose(p.intent)}>{p.label}</button>)}
      <RowMenu label="More actions" triggerClass="editor-bar-button" groups={more} />
    </div>
  }
  /** A11 §4 (Jazz §1): the line "Copy link to line" points at, or null where it isn't offered. */
  const lineLinkTarget = (blockId: string): LineTarget | null => {
    const block = editor.getBlock(blockId)
    if (!block || !['paragraph', 'bulletListItem', 'numberedListItem', 'checkListItem', 'heading', 'quote', 'task'].includes(block.type)) return null
    if (!inlineText(block.content as EditorNode['content']).trim()) return null
    // The day's role headings (Top 3, Other, Notes…) are structure; a heading he wrote is a target.
    const section = latestPage.current.sections.find(x => x.id === blockId)
    if (block.type === 'heading' && ((section && section.kind !== 'custom') || templateKind(latestPage.current, blockId))) return null
    const taskId = block.type === 'task' ? String(block.props.taskId ?? '') : ''
    return { pageId: page.id, lineId: blockId, ...(taskId && !taskId.startsWith('editor-task:') ? { taskId } : {}) }
  }
  /**
   * Writes the app's line type and the plain URL. A copy event carries both (the app type only reaches this app); where
   * that can't run, the URL alone, which pastes as a line link too. A failed write says so, never "copied".
   */
  const copyLineLink = (blockId: string) => {
    const target = lineLinkTarget(blockId)
    if (!target) return
    const url = `${window.location.origin}${lineLinkPath(target)}`
    let wrote = false
    const onCopy = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      e.preventDefault(); e.stopImmediatePropagation()
      e.clipboardData.setData(lineClipboardType, JSON.stringify(target)); e.clipboardData.setData('text/plain', url)
      wrote = true
    }
    document.addEventListener('copy', onCopy, true)
    try { document.execCommand('copy') } catch { /* not supported: the URL below */ } finally { document.removeEventListener('copy', onCopy, true) }
    const notice = (ok: boolean) => { toast(ok ? 'Link to line copied' : "Couldn't copy", { timeout: 4000 }); if (ok) void flush() }
    if (wrote) { notice(true); return }
    if (!navigator.clipboard?.writeText) { notice(false); return }
    navigator.clipboard.writeText(url).then(() => notice(true), () => notice(false))
  }
  /** ⌘/ on a line with no ⋯ (any line but an open task on a day page): a menu with Copy link to line (Jazz §1). */
  const [lineMenu, setLineMenu] = useState<{ blockId: string; anchor: { top: number; bottom: number; left: number } } | null>(null)
  const closeLineMenu = (refocus: boolean) => {
    const open = lineMenu
    setLineMenu(null)
    if (refocus && open) rowActions.focusRow(open.blockId)
  }
  const openLineMenu = (blockId: string) => {
    // The line's own box, at its text start (Jazz states §1), not the caret: a click on a bullet's dot can leave the
    // caret's reported position far from the line.
    const line = blockElement(blockId), content = line?.querySelector<HTMLElement>('.bn-block-content'), text = line?.querySelector<HTMLElement>('.bn-inline-content')
    if (!content) return false
    const box = content.getBoundingClientRect()
    setLineMenu({ blockId, anchor: { top: box.top, bottom: box.bottom, left: (text ?? content).getBoundingClientRect().left } })
    return true
  }
  const rowActions: RowActions = {
    pageDate: page.date ?? null, today: todayIso(), sectionOf, act: (id, t, intent) => void rowAct(id, t, intent),
    copyLink: id => lineLinkTarget(id) ? () => copyLineLink(id) : null,
    focusRow: id => {
      if (!editor.getBlock(id)) return
      const back = menuReturn.current; menuReturn.current = null
      const view = editor.prosemirrorView
      // Opened with ⌘/: back to where the caret was. Opened by pointer: the end of the row.
      if (back?.blockId === id) { try { view.dispatch(view.state.tr.setSelection(Selection.fromJSON(view.state.doc, back.selection))); editor.focus(); return } catch { /* the row changed meanwhile */ } }
      editor.setTextCursorPosition(id, 'end'); editor.focus()
    },
  }
  // B23 §1: a failed save is a conflict when he has unsaved typing and the page is no longer the one he started from.
  const conflict = failed && dirty.current && pageContentKey(page) !== base.current
  return <div className={`continuous-editor ${touchDragging ? 'is-touch-drag' : ''} ${selectionLabel ? 'has-selection' : ''}`} aria-label="Page editor" aria-busy={historyBusy}
    onCopyCapture={e => copyBlocks(e, false)} onCutCapture={e => copyBlocks(e, true)}
    onMouseDownCapture={e => { const target = e.target as Element; if (target.closest('.bn-editor') && !target.closest('.bn-side-menu')) { selected.current = []; extendedIds.current = []; setSelectionLabel('') } }}
    onMouseUpCapture={e => {
      const target = e.target instanceof Element ? e.target : null
      const view = editor.prosemirrorView
      // Only repair a plain click in editable text. Buttons, selection gestures, native drag and IME own their selections.
      if (e.button !== 0 || e.detail !== 1 || !target || !view.dom.contains(target) || target.closest('[contenteditable="false"]') || composing.current || view.composing || dragging.current.length || historyPending.current) return
      // Repair now: an immediate Enter can arrive before requestAnimationFrame.
      if (window.getSelection()?.isCollapsed) restoreBrowserSelection(browserSelection())
      const doc = view.state.doc
      requestAnimationFrame(() => {
        if (view.isDestroyed || view.state.doc !== doc || composing.current || view.composing || dragging.current.length || historyPending.current) return
        const dom = window.getSelection()
        if (!dom?.isCollapsed || !dom.anchorNode || !view.dom.contains(dom.anchorNode)) return
        const pos = view.posAtDOM(dom.anchorNode, dom.anchorOffset)
        // A DOM caret on a non-text boundary must not turn a block selection into an invalid text selection.
        if (!view.state.doc.resolve(pos).parent.inlineContent) return
        if (view.state.selection.empty && view.state.selection.from === pos) return
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
      })
    }}
    onCompositionStartCapture={() => { composing.current = true; clearTimeout(timer.current) }}
    // A9a §3: after the composition, once ProseMirror has finished it (its DOM and decorations are drawn again).
    onCompositionEndCapture={() => { composing.current = false; setTimeout(maybeOpenLinkList, 50); requestAnimationFrame(() => { stash(); clearTimeout(timer.current); timer.current = setTimeout(() => void flushRef.current(), 450) }) }}
    onDropCapture={e => {
      // Drops go to the row boundary under the pointer at release. BlockNote's line can lag the pointer when
      // dragover events stop arriving (Ratchet task #49: a long drag stayed put, the line stuck near the start),
      // and ProseMirror's own drop can land a block away from the line; the pointer is what Brian aims with, and
      // a line that has caught up shows the same boundary.
      const ids = pickedIds.current
      if (!ids.length || !editor.prosemirrorView.dragging) return
      e.preventDefault(); e.stopPropagation()
      pickedIds.current = []
      const y = e.clientY
      const rows = [...editor.prosemirrorView.dom.querySelectorAll<HTMLElement>(':scope > .bn-block-group > .bn-block-outer')]
      const next = rows.find(row => { const r = row.getBoundingClientRect(); return y < r.top + r.height / 2 })
      const after = next?.querySelector('[data-node-type="blockContainer"]')?.getAttribute('data-id') ?? null
      const last = rows.at(-1)?.querySelector('[data-node-type="blockContainer"]')?.getAttribute('data-id') ?? null
      const ref = after ? (ids.includes(after) ? null : { id: after, placement: 'before' as const }) : last && !ids.includes(last) ? { id: last, placement: 'after' as const } : null
      editor.prosemirrorView.dragging = null
      // Stopping the drop also stops BlockNote's own cleanup of the line; a dragleave out of the editor removes it.
      setTimeout(() => editor.prosemirrorView.dom.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null })), 300)
      if (!ref) return
      const blocks = ids.map(id => editor.getBlock(id)).filter(b => b !== undefined)
      editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorState.tr))
      editor.transact(() => { editor.removeBlocks(ids); editor.insertBlocks(blocks as never, ref.id, ref.placement) })
      // Show the line at the top of the moved blocks before it goes (Lead: the line is where it lands; a jump is fine).
      // Measured a frame later, once the moved blocks have been laid out.
      requestAnimationFrame(() => {
        const line = document.querySelector<HTMLElement>('.prosemirror-dropcursor-block-horizontal')
        const landed = editor.domElement?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(ids[0]!)}"]`)
        if (!line || !landed) return
        const parent = (line.offsetParent ?? document.body) as HTMLElement
        line.style.top = `${landed.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop - line.offsetHeight / 2}px`
      })
      // Editor spec: after a drop, a plain cursor at the end of the moved block's first line (a section's heading),
      // with focus back in the editor so ⌘Z undoes the move straight away.
      // The browser settles focus after the drop event, so place the caret once the drag has fully ended.
      setTimeout(() => { if (editor.getBlock(ids[0]!)) { editor.setTextCursorPosition(ids[0]!, 'end'); editor.focus() } }, 0)
    }}
    onKeyDownCapture={e => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      // Keys inside a row's ⋯ menu belong to the menu (Enter chooses, arrows move), never to the editor's row rules.
      if ((e.target as Element).closest?.('.editor-row-menu')) return
      // Line end/start in a task row: the browser's own move can step over the row's non-editable parts (⋯, tags)
      // into the next block, so typing would land in the next heading. Make the same line move here, synchronously,
      // and keep it in the row; ProseMirror reads the browser's selection back.
      if (((e.metaKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) || ((e.key === 'End' || e.key === 'Home') && !e.metaKey && !e.ctrlKey)) && !e.altKey) {
        const block = editor.getTextCursorPosition().block, sel = window.getSelection()
        if (block.type === 'task' && sel?.modify) {
          e.preventDefault()
          const toEnd = e.key === 'ArrowRight' || e.key === 'End'
          sel.modify(e.shiftKey ? 'extend' : 'move', toEnd ? 'forward' : 'backward', 'lineboundary')
          const title = editor.domElement?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"] .editor-task-title`)
          if (title && !title.contains(sel.focusNode)) {
            const range = document.createRange(); range.selectNodeContents(title); range.collapse(!toEnd)
            if (e.shiftKey) sel.extend(range.startContainer, range.startOffset)
            else { sel.removeAllRanges(); sel.addRange(range) }
          }
          return
        }
      }
      // Tab where nesting would leave the section does nothing (and keeps focus in the editor), as the toolbar's Indent.
      if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !canIndent()) { e.preventDefault(); e.stopPropagation(); return }
      // A12 keyboard path (Lead b8ec39d5): ⌘/ (Ctrl+/), as Notion's block menu, opens the caret row's ⋯ menu; the
      // context-menu key and Shift+F10 too. Tab keeps indenting.
      if (((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '/') || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const block = editor.getTextCursorPosition().block
        const more = editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(block.id)}"] .editor-row-more`)
        // Esc gives the caret back exactly where ⌘/ was pressed (Jazz check 8).
        if (more) { e.preventDefault(); e.stopPropagation(); menuReturn.current = { blockId: block.id, selection: editor.prosemirrorState.selection.toJSON() }; more.click(); return }
        // Any other line: a menu of its own, when the line can be linked (A11).
        if (lineLinkTarget(block.id)) { e.preventDefault(); e.stopPropagation(); menuReturn.current = { blockId: block.id, selection: editor.prosemirrorState.selection.toJSON() }; if (openLineMenu(block.id)) return }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.nativeEvent.isComposing) {
        e.preventDefault(); e.stopPropagation()
        // A2 §4: right after a paste (its notice still showing, nothing edited since), ⌘Z is the notice's Undo.
        const last = linkNotice.current
        if (!e.shiftKey && last && last.fingerprint === JSON.stringify(editor.document)) { void undoLinkPaste(last.operationId); return }
        // A12 §3: while a row action's notice shows and nothing was edited since, ⌘Z is that notice's Undo.
        const row = rowNotice.current
        if (!e.shiftKey && row && row.fingerprint === JSON.stringify(editor.document)) { void undoRowAction(row.operationId); return }
        void performHistory(e.shiftKey ? 'redo' : 'undo'); return
      }
      if (e.key === ' ' && !e.nativeEvent.isComposing && editor.getTextCursorPosition().block.type === 'task' && /^(?:#{1,3}|[-*>]|1\.|\[\])$/.test(editor.prosemirrorState.selection.$from.parent.textBetween(0, editor.prosemirrorState.selection.$from.parentOffset))) { e.preventDefault(); editor.insertInlineContent(' '); return }

      if (e.key === 'Enter' && !e.nativeEvent.isComposing && editor.getTextCursorPosition().block.type === 'task' && editor.prosemirrorState.selection.empty) {
        e.preventDefault(); e.stopPropagation()
        const block = editor.getTextCursorPosition().block
        const parent = editor.prosemirrorState.selection.$from.parent
        const offset = editor.prosemirrorState.selection.$from.parentOffset
        const left = parent.textBetween(0, offset), right = parent.textBetween(offset, parent.content.size)
        if (!parent.textContent) { editor.updateBlock(block.id, { type: 'paragraph', content: '' }); return }
        const id = crypto.randomUUID()
        editor.transact(() => {
          editor.updateBlock(block.id, { content: left } as never)
          editor.insertBlocks([{ id, type: 'task', props: { ...block.props, taskId: `editor-task:${id}` }, content: right } as never], block.id, 'after')
          editor.setTextCursorPosition(id, 'start')
        })
        return
      }
      // A handle selection is for moving and deleting, not typing (editor spec §1, design 4a45305): printable keys
      // do nothing, Enter goes into the heading's text, Escape lets go. Arrows, copy, cut and undo work as before.
      if (selected.current.length && !e.metaKey && !e.ctrlKey) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation()
          const first = selected.current[0]!
          selected.current = []; extendedIds.current = []; setSelectionLabel('')
          document.querySelectorAll('.is-picked').forEach(el => el.classList.remove('is-picked'))
          if (editor.getBlock(first)) editor.setTextCursorPosition(first, 'end')
          editor.focus()
          return
        }
        if (e.key.length === 1) { e.preventDefault(); e.stopPropagation(); return }
        if (e.key.startsWith('Arrow')) editor.focus()
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.current.length) {
        e.preventDefault(); e.stopPropagation()
        deleteSelected()
      } else if (e.key === 'Backspace' && !e.nativeEvent.isComposing && page.type === 'document' && caretAtDocumentStart()) {
        // Jazz's title spec: Backspace at the start of the first line goes up into the title, as in Notion.
        const title = document.querySelector<HTMLElement>('.page-title-field')
        if (title) { e.preventDefault(); e.stopPropagation(); focusAtEnd(title) }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.nativeEvent.isComposing && !e.altKey && !e.metaKey && !e.ctrlKey && joinsRoleHeading(e.key)) {
        // Silent, like any key that has nothing to do (Jazz).
        e.preventDefault(); e.stopPropagation()
      } else if (e.key === 'Backspace' && !e.nativeEvent.isComposing && editor.prosemirrorState.selection.empty && editor.getTextCursorPosition().block.type === 'task' && !inlineText(editor.getTextCursorPosition().block.content)) {
        // The caret goes to the end of the line above, as when any line is deleted (Brian 301105c0), not to the start of
        // the line that moves up. Everything above the removed row keeps its positions, so `above` holds after removal.
        e.preventDefault(); e.stopPropagation(); const id = editor.getTextCursorPosition().block.id
        const view = editor.prosemirrorView, above = endOfLineAbove(view, view.state.selection.$from.before())
        const taskId = (editor.getBlock(id)?.props as { taskId?: string } | undefined)?.taskId
        semanticDeletes.current.add(id); editor.removeBlocks([id])
        const deleting = goesWithLine(taskId, nodes())
        if (above !== null) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, above)).scrollIntoView())
        // The path that left his junk to-dos: say what happened, with Undo (Bumblebee e7026847, Jazz 416bbf34).
        const elsewhere = stillElsewhere(taskId, nodes())
        if (deleting || elsewhere) setNotice({ text: elsewhere ?? 'To-do deleted', fingerprint: JSON.stringify(editor.document) })
      } else if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key) && !((e.metaKey || e.ctrlKey) && ['c', 'x'].includes(e.key.toLowerCase()))) { selected.current = []; setSelectionLabel('') }
    }}
    >
    <div ref={selectionFocus} tabIndex={-1} className="sr-only" aria-label={selectionLabel || undefined} />
    {hiddenEmpty.size > 0 && <style>{[...hiddenEmpty].map(id => `.continuous-editor .bn-block-outer[data-id="${CSS.escape(id)}"]`).join(',')}{'{display:none}'}</style>}
    <div className={`editor-save-line${conflict ? ' is-conflict' : ''}`} role="status">{conflict ? 'Changed in another tab · draft kept' : status}{conflict ? <button onClick={() => void loadLatest()}>Load latest</button> : failed && <><button onClick={() => void flush()}>Retry saving</button><button onClick={async () => { await navigator.clipboard.writeText(await editor.blocksToMarkdownLossy()); setStatus('Draft copied · original kept here') }}>Copy draft</button></>}{selectionLabel && <span className="sr-only">{selectionLabel}</span>}</div>
    <RowActionsContext.Provider value={rowActions}>
    <BlockNoteView editor={editor} theme="light" formattingToolbar={false} sideMenu={false} slashMenu={false}>
      {/* Trimmed to what a day note uses (Jazz, #6): no alignment, indent or colour buttons. */}
      {!compact && !selectionLabel && <FormattingToolbarController formattingToolbar={() => <FormattingToolbar>
        <BlockTypeSelect key="blockTypeSelect" />
        <BasicTextStyleButton key="bold" basicTextStyle="bold" />
        <BasicTextStyleButton key="italic" basicTextStyle="italic" />
        <BasicTextStyleButton key="underline" basicTextStyle="underline" />
        <BasicTextStyleButton key="strike" basicTextStyle="strike" />
        <CreateLinkButton key="createLink" />
      </FormattingToolbar>} />}
      <SuggestionMenuController triggerCharacter="/" shouldOpen={() => !composing.current && editor.getTextCursorPosition().block.type !== 'task'} getItems={async query => {
        // Editor spec F13: heading hints in day-page terms; the items Brian uses most come first.
        const headingHints: Record<string, string> = { 'Heading 1': 'Larger than day sections', 'Heading 2': 'Section', 'Heading 3': 'Inside a section' }
        const suggested = ['Bullet List', 'Heading 2']
        const library = getDefaultReactSlashMenuItems(editor).filter(item => ['Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bullet List', 'Numbered List', 'Quote'].includes(item.title)).map(item => headingHints[item.title] ? { ...item, subtext: headingHints[item.title] } : item)
        const first = suggested.map(title => library.find(item => item.title === title)!).map(item => ({ ...item, group: 'Suggested' }))
        const rest = library.filter(item => !suggested.includes(item.title))
        const taskItem = { title: 'Task', subtext: 'Checkbox that becomes a task', icon: <CheckboxIcon />, aliases: ['todo', 'task', '任务'], group: 'Suggested', onItemClick: () => {
          const currentBlock = editor.getTextCursorPosition().block
          const currentId = currentBlock.id
          const replaceCurrent = !inlineText(currentBlock.content) || inlineText(currentBlock.content) === '/'
          const id = replaceCurrent ? currentId : crypto.randomUUID()
          const role = insertionRole(currentId)
          insertOrUpdateBlockForSlashMenu(editor, { ...(replaceCurrent ? {} : { id }), type: 'task', props: { taskId: `editor-task:${id}`, role, planDate: role === 'plan' ? page.date ?? '' : '' }, content: '' })
        } }
        const pageItem = { title: 'Page', subtext: 'New page inside this one', icon: <PagesIcon />, aliases: ['page', 'subpage', '页面'], group: 'Suggested', onItemClick: () => void createSubpage() }
        // A9a §3: the phone's way to `[[` (v0.3's toolbar button), through the same + menu.
        const linkItem = { title: 'Link to page', subtext: 'A link to a page, inside this line', icon: <PagesIcon />, aliases: ['link', '[[', '链接', '引用'], group: 'Suggested', onItemClick: () => {
          if (!linkableLines.has(editor.getTextCursorPosition().block.type)) return
          setTimeout(() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu('[[', { deleteTriggerCharacter: true }), 0)
        } }
        return filterSuggestionItems([taskItem, pageItem, linkItem, ...first, ...rest], query).slice(0, 9)
      }} />
      {/* BlockNote would open these by itself on typed `[[` and skip §3's rules (task rows, paste, composition); only
          maybeOpenLinkList opens them (programmatic opening doesn't consult shouldOpen). */}
      {['[[', '【【'].map(trigger => <SuggestionMenuController key={trigger} triggerCharacter={trigger} shouldOpen={() => false} getItems={async query => linkItems(query, trigger)} onItemClick={item => item.onItemClick()} />)}
      <SideMenuController sideMenu={Handle} floatingUIOptions={sideMenuPosition} />
    </BlockNoteView>
    </RowActionsContext.Provider>
    {touchHandle && <button className="editor-touch-handle" aria-label="Drag current section or block" style={{ top: touchHandle.top }}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = sectionRange(nodes(), touchHandle.id); setTouchDragging(true) }}
      onPointerMove={e => { if (dragging.current.length && e.buttons) updateDrop(e.clientX - 35, e.clientY) }}
      onPointerUp={e => { e.preventDefault(); if (!dropRef.current) { dragging.current = []; setTouchDragging(false); select(touchHandle.id) } else commitDrag() }}
      onPointerCancel={() => { dragging.current = []; setTouchDragging(false); setDrop(null) }}><GripIcon /></button>}
    {/* F16 order: + · outdent / indent · undo / redo. Indent and outdent are Tab and Shift+Tab (F11): a phone has no Tab key. */}
    <div className="editor-phone-toolbar" aria-label="Editor tools">
      <button {...keepCaret} onClick={() => { editor.focus(); editor.getExtension(SuggestionMenu)?.openSuggestionMenu('/') }} aria-label="Insert block"><PlusIcon /></button>
      <span className="editor-toolbar-gap" aria-hidden="true" />
      <button {...keepCaret} onClick={() => editor.unnestBlock()} disabled={!nesting.out} aria-label="Outdent"><OutdentIcon /></button>
      <button {...keepCaret} onClick={() => editor.nestBlock()} disabled={!nesting.in} aria-label="Indent"><IndentIcon /></button>
      <span className="editor-toolbar-gap" aria-hidden="true" />
      <button {...keepCaret} onClick={() => void performHistory('undo')} aria-label="Undo"><UndoIcon /></button>
      <button {...keepCaret} onClick={() => void performHistory('redo')} aria-label="Redo"><RedoIcon /></button>
    </div>
    {dock && createPortal(<>
      {selectionLabel && (phoneRowBar() ?? <div className="editor-selection-bar"><span>{selectionLabel}</span>{selected.current.length === 1 && lineLinkTarget(selected.current[0]!) && <button onPointerDown={e => e.preventDefault()} onClick={() => { const id = selected.current[0]!; selected.current = []; setSelectionLabel(''); copyLineLink(id) }}>Copy link</button>}<button onPointerDown={e => e.preventDefault()} onClick={deleteSelected}>Delete</button></div>)}
      {lineMenu && <LineMenu anchor={lineMenu.anchor} onClose={closeLineMenu} onCopy={() => { const id = lineMenu.blockId; closeLineMenu(true); copyLineLink(id) }} />}
    {pastedChecklistIds.length > 0 && <div className="editor-paste-notice" role="status">{pastedChecklistIds.length} checklist {pastedChecklistIds.length === 1 ? 'line' : 'lines'} · <button onClick={() => {
      let count = 0, planned = 0
      editor.transact(tr => {
        closeHistory(tr)
        for (const id of pastedChecklistIds) {
          const node = editor.getBlock(id)
          if (node?.type !== 'sourceChecklist' || node.props.checked) continue
          const role = insertionRole(id)
          editor.updateBlock(id, { type: 'task', props: { taskId: `editor-task:${id}`, role, planDate: role === 'plan' ? page.date ?? '' : '' }, content: node.content } as never)
          count++; if (role === 'plan') planned++
        }
      })
      const day = page.date === todayIso() ? 'today' : page.date === addDays(todayIso(), 1) ? 'tomorrow' : page.date ? fromIso(page.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
      if (count) setNotice({ text: `Made ${count} ${count === 1 ? 'task' : 'tasks'}${planned ? ` · ${planned < count ? `${planned} ` : ''}planned for ${day}` : ''}`, fingerprint: JSON.stringify(editor.document) })
      setPastedChecklistIds([]); editor.focus()
    }}>Turn into tasks</button></div>}
    </>, dock)}
    {drop && <div className="editor-drop-line" style={{ top: drop.top }} />}
  </div>
}
/**
 * BlockNote's side menu and native block drag, plus the one piece BlockNote lacks: pressing the handle selects the
 * whole flat section (heading up to the next heading of the same or higher level) and tints it, so the native drag
 * that follows moves and previews exactly what was tinted. A plain click selects the section for Delete instead of
 * opening BlockNote's block menu, whose Delete would bypass our planned-task rules.
 */
function SectionSideMenu({ select, picked, extended, selectedIds }: { select(id: string, ids?: readonly string[]): void; picked: { current: string[] }; extended: { current: string[] }; selectedIds(): string[] }) {
  const editor = useBlockNoteEditor()
  const Components = useComponentsContext()!
  const sideMenu = editor.getExtension(SideMenuExtension)!
  const block = useExtensionState(SideMenuExtension, { editor, selector: state => state?.block })
  const lastRange = useRef<string[]>([])
  if (!block) return null
  // Press: only set the editor selection the native drag reads, and tint it. React state changes here would
  // re-render the editor mid-gesture and cancel the drag, so the section label waits for the click.
  // Every press replaces the picked range with this block or section; Shift extends the previous one (Jazz).
  const pick = (e: React.PointerEvent) => {
    sideMenu.freezeMenu()
    const doc = editor.document as unknown as EditorNode[]
    let range = sectionRange(doc, block.id)
    // Shift-press extends what a click already selected. Browsers don't start a drag on a Shift-press, so the
    // extended range is kept: the next plain press inside it drags the whole range; a press outside starts over.
    const prior = picked.current.length ? picked.current : selectedIds()
    if (e.shiftKey && prior.length) {
      const indexes = [...prior, ...range.map(n => n.id)].map(id => doc.findIndex(n => n.id === id)).filter(i => i >= 0)
      range = doc.slice(Math.min(...indexes), Math.max(...indexes) + 1)
      extended.current = range.map(n => n.id)
    } else if (extended.current.includes(block.id)) range = doc.filter(n => extended.current.includes(n.id))
    else extended.current = []
    lastRange.current = range.map(n => n.id)
    picked.current = range.map(n => n.id)
    if (range.length > 1) editor.setSelection(range[0]!.id, range.at(-1)!.id)
    else {
      // A single block still needs its own selection, or the native drag carries the previous multi-block one.
      let pos = -1
      editor.prosemirrorState.doc.descendants((node, position) => { if (node.type.name === 'blockContainer' && node.attrs.id === block.id) pos = position })
      if (pos >= 0) editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.setSelection(NodeSelection.create(editor.prosemirrorState.doc, pos)))
    }
    document.querySelectorAll('.is-picked').forEach(el => el.classList.remove('is-picked'))
    for (const node of range)
      editor.domElement?.querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(node.id)}"]`)?.classList.add('is-picked')
  }
  return <SideMenu>
    <span className="editor-handle" onPointerDownCapture={pick}>
      <Components.SideMenu.Button
        label={block.type === 'heading' ? 'Select or drag section' : 'Select or drag block'}
        className="bn-button"
        draggable
        icon={<GripIcon />}
        onClick={() => { select(block.id, lastRange.current); sideMenu.unfreezeMenu() }}
        onDragStart={e => sideMenu.blockDragStart(e, block)}
        onDragEnd={() => { sideMenu.blockDragEnd(); sideMenu.unfreezeMenu() }}
      />
    </span>
  </SideMenu>
}
