import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'
import { editorSeed, inlineText, type EditorNode } from '../domain/editor-document'
import { cardTo, isTrashed, parentOf, subtreeIds, trashBatch, trashBatches, trashedChildPages } from '../domain/page-tree'
import type { Action, Page, Receipt, Workspace } from '../domain/types'
import { databaseOfRow, isDatabase } from '../domain/database'
import { longLabel, toIso } from './dates'
import { flushEditor } from './editor-flush'
import { jumpToBlock, lookupFailed } from './line-jump'
import { resolveLineLink } from '../server/functions'
import { toast } from '@heroui/react'
import { CalendarIcon, ChevronRightIcon, PageKindIcon, TrashIcon } from './icons'
import { LinkUrlRow } from './link-url-row'
import { InlineWithRefs } from './line-text'
import { displayPageTitle } from './page-title'
import { PageLink, pageHref, pageLabel, useToday } from './page-tree'
import { useWorkspace, type NoticeArg } from './use-day'

// A4 trash and restore, laid out per Jazz docs/design/pages-trash-layout.md (2956eea). Data: docs/design/a4-trash-data.md.

/** Where the old parent is, for "From …" and "was in …": a page title, a day label, or "Pages" for top level. */
function oldParentLabel(ws: Workspace, p: Page, today: string): string {
  if (p.type === 'daily') return 'Days'
  const parent = p.parentId ? ws.pages.find(x => x.id === p.parentId) : undefined
  return parent ? pageLabel(parent, today) : 'Pages'
}

/**
 * ⋯ → Delete (layout §1–§2): no confirm; "Moved to trash · {n} subpages · Undo". Typing on any page in the subtree is
 * saved first, and nothing happens if that fails. When the open page goes with it, you land on the deleted page's
 * parent at its card, or on Pages for a top-level page.
 */
export function useDeletePage() {
  const { workspace, run } = useWorkspace()
  const navigate = useNavigate()
  return async (page: Page, openPageId: string | null, backTo?: string) => {
    if (!workspace) return
    const subtree = subtreeIds(workspace, page.id)
    for (const id of subtree) if (!(await flushEditor(id))) return
    const parent = parentOf(workspace, page)
    const card = (parent ? cardTo(parent, page.id) : undefined)
    const receipt = await run({ type: 'delete-page', pageId: page.id, at: new Date().toISOString() },
      r => ({ text: r.message, undoOperationId: r.operationId }))
    // A day stays on its date, which now says its page is in Trash (B16).
    if (receipt && openPageId && subtree.has(openPageId)) void navigate({ href: backTo ?? (parent ? pageHref(parent, card?.id) : page.type === 'daily' ? `/day/${page.date}` : '/pages'), resetScroll: !card })
  }
}

/** Layout §5: "Restored to {parent}", or to Pages with the reason when the old parent is in the trash or gone. */
function restoredText(ws: Workspace, page: Page, comingBack: Set<string>, today: string): string {
  const db = databaseOfRow(ws, page)
  if (db && isTrashed(db) && !comingBack.has(db.id)) return `Restored with ${displayPageTitle(db)}`
  if (!page.parentId) return 'Restored to Pages'
  const parent = ws.pages.find(x => x.id === page.parentId)
  if (parent && (!isTrashed(parent) || comingBack.has(parent.id))) return `Restored to ${pageLabel(parent, today)}`
  return `Restored ${displayPageTitle(page)} to Pages · ${parent ? `${pageLabel(parent, today)} is in trash` : 'its page was deleted'}`
}

/**
 * A command from a button with no editor line under it to show a failure: if another tab moved the workspace on, it's sent
 * again once, on the fresh copy, so the button never just looks dead; if it still can't go, it says so.
 */
export function useRunFromButton() {
  const { run } = useWorkspace()
  return async (action: Action, notice: NoticeArg | undefined, failed: string): Promise<Receipt | null> => {
    let stale = false
    const said = () => toast(failed, { timeout: 6000 })
    const first = await run(action, notice, undefined, { inlineRefusal: /Saved elsewhere/, onRefused: () => { stale = true }, quiet: true, onFailure: said })
    return first ?? (stale ? run(action, notice, undefined, { quiet: true, onFailure: said }) : null)
  }
}

export function useRestore() {
  const { workspace } = useWorkspace()
  const runFromButton = useRunFromButton()
  const navigate = useNavigate()
  const today = useToday()
  /** `whole`: what's left of the page's delete (Trash row, top page's banner); otherwise the page and its own subtree. */
  return async (page: Page, { whole, withOpen }: { whole: boolean; withOpen: boolean }) => {
    if (!workspace || !page.trashId) return null
    // A date's new page may join this one (B16): its latest words go first, and nothing happens if that fails.
    const newer = page.type === 'daily' ? workspace.pages.find(p => p.type === 'daily' && p.date === page.date && !p.trashedAt) : undefined
    if (newer && !(await flushEditor(newer.id))) return null
    const members = whole ? trashBatch(workspace, page.trashId)?.members ?? [] : [page, ...descendantsInBatch(workspace, page)]
    const top = whole ? trashBatch(workspace, page.trashId)?.top ?? page : page
    const text = restoredText(workspace, top, new Set(members.map(m => m.id)), today)
    return runFromButton(whole ? { type: 'restore-batch', trashId: page.trashId } : { type: 'restore-page', pageId: page.id },
      // Joining changes a page he wrote on, so like any change that can lose his lines it can be undone (Bumblebee).
      (r: Receipt) => ({ text: top.type === 'daily' ? r.message : text, ...(newer ? { undoOperationId: r.operationId } : {}), ...(withOpen ? { extra: { label: 'Open', run: () => void navigate({ href: pageHref({ ...top, id: r.entityId ?? top.id, trashedAt: null }) }) } } : {}) }),
      "Couldn't restore · try again")
  }
}
function descendantsInBatch(ws: Workspace, page: Page): Page[] {
  const children = trashedChildPages(ws, page)
  return children.flatMap(c => [c, ...descendantsInBatch(ws, c)])
}

/** "Trash {n}" under "＋ New page" in the sidebar (layout §3); only when the trash isn't empty. */
export function SidebarTrashRow({ current }: { current: boolean }) {
  const { workspace } = useWorkspace()
  const n = workspace ? trashBatches(workspace).length : 0
  if (n === 0) return null
  return <PageLink className="side-row small trash-entry" href="/pages?view=trash" current={current}><TrashIcon />Trash <span className="trash-count">{n}</span></PageLink>
}

/** The phone's quiet row at the end of Pages (layout §3, P1). */
export function PagesTrashRow({ workspace }: { workspace: Workspace }) {
  const n = trashBatches(workspace).length
  if (n === 0) return null
  return <PageLink className="pages-trash-row" href="/pages?view=trash"><TrashIcon /><span>Trash · {n}</span><ChevronRightIcon /></PageLink>
}

function when(iso: string, today: string): string {
  const d = new Date(iso), day = toIso(d)
  return day === today ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : longLabel(day)
}

/** Layout §3: one row per delete, newest first; Restore puts back what's left of it. */
export function TrashScreen() {
  const { workspace } = useWorkspace()
  const today = useToday()
  const restore = useRestore()
  if (!workspace) return <p>Loading trash…</p>
  const batches = trashBatches(workspace)
  return (
    <div className="list-screen trash-screen">
      <PageLink className="trash-back" href="/pages"><ChevronRightIcon />Pages</PageLink>
      <div className="title-row"><h1 className="large-title">Trash</h1></div>
      {batches.length === 0 ? <p className="quiet">Trash is empty</p> : <>
        <ul className="plain card-list two-line">
          {batches.map(b => {
            // A database's rows are its rows, not subpages; a row whose database is also in the trash brings it back (§12).
            const isDb = isDatabase(b.top), rowOf = databaseOfRow(workspace, b.top)
            const n = b.members.filter(m => isDb || m === b.top || !databaseOfRow(workspace, m)).length - 1
            return (
              <li key={b.trashId} className="trash-row">
                <PageLink className="card-row" href={pageHref(b.top)}>
                  <span className="card-row-icon">{b.top.type === 'daily' ? <CalendarIcon /> : <PageKindIcon url={b.top.url} database={isDb} icon={b.top.icon} />}</span>
                  <span className="card-row-text">
                    <span className={`card-row-title ${b.top.title ? '' : 'untitled'}`}>{pageLabel(b.top, today)}</span>
                    <span className="card-row-detail">{[`From ${oldParentLabel(workspace, b.top, today)}`, n > 0 && (isDb ? `with ${n} row${n === 1 ? '' : 's'}` : `with ${n} subpage${n === 1 ? '' : 's'}`), when(b.trashedAt, today)].filter(Boolean).join(' · ')}</span>
                  </span>
                </PageLink>
                <span className="restore-cell">
                  <button type="button" className="restore-button" onClick={() => void restore(b.top, { whole: true, withOpen: true })}>Restore</button>
                  {rowOf && isTrashed(rowOf) && <span className="restore-note">Restores {displayPageTitle(rowOf)} too</span>}
                </span>
              </li>
            )
          })}
        </ul>
      </>}
    </div>
  )
}

/** Layout §4: read-only, "Trash" as the breadcrumb, a banner with Restore, and its subpages from the same delete. */
export function TrashedPage({ page, workspace }: { page: Page; workspace: Workspace }) {
  const today = useToday()
  const restore = useRestore()
  const batch = page.trashId ? trashBatch(workspace, page.trashId) : null
  const isTop = !batch || batch.top.id === page.id
  const children = trashedChildPages(workspace, page)
  return (
    <div className="doc-screen trashed-page">
      <div className="crumbs"><nav className="crumbs-path" aria-label="Page location"><PageLink className="crumb crumb-last" href="/pages?view=trash">Trash</PageLink></nav></div>
      <div className="trash-banner" role="status">
        <TrashIcon />
        <span>In trash · {isTop ? `was in ${oldParentLabel(workspace, page, today)}` : `deleted with ${displayPageTitle(batch!.top)}`}</span>
        <button type="button" className="restore-button" onClick={() => void restore(page, { whole: isTop, withOpen: false })}>Restore</button>
      </div>
      <div className="page-head"><h1 className={`large-title ${page.title ? '' : 'untitled'}`}>{pageLabel(page, today)}</h1><LinkUrlRow page={page} /></div>
      <ReadOnlyBody page={page} workspace={workspace} />
      {children.length > 0 && (
        <section className="subpages" aria-label="Subpages">
          <h2 className="subpages-title">Subpages <span>{children.length}</span></h2>
          <ul className="plain">
            {children.map(c => (
              <li key={c.id}><PageLink className="subpage-row" href={pageHref(c)} title={displayPageTitle(c)}>
                <PageKindIcon url={c.url} icon={c.icon} /><span className={`subpage-title ${c.title ? '' : 'untitled'}`}>{displayPageTitle(c)}</span><ChevronRightIcon />
              </PageLink></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}


/** The body as saved, without an editor: a trashed page can't change until it's restored. */
function ReadOnlyBody({ page, workspace }: { page: Page; workspace: Workspace }) {
  const nodes = editorSeed(page, workspace)
  const body = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const latest = useRef(workspace); latest.current = workspace
  // A11 (Jazz line-links-states §5): a link to a line on a trashed page opens it scrolled to the line. As everywhere
  // (§4), the URL is resolved on the server first: a task row here may be followed to its plan day (Ratchet #146).
  useEffect(() => {
    const url = new URL(window.location.href), id = url.searchParams.get('block'), taskId = url.searchParams.get('task')
    if (!id) return
    let cancelled = false, cleanup: (() => void) | undefined
    const dropParams = () => { for (const k of ['block', 'task', 'from']) url.searchParams.delete(k); window.history.replaceState(window.history.state, '', url) }
    const jumpHere = (blockId: string) => {
      const el = body.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(blockId)}"]`)
      dropParams()
      if (el) cleanup = jumpToBlock(el)
      else { window.scrollTo({ top: 0 }); toast("Couldn't find that line", { timeout: 4000 }) }
    }
    const attempt = () => void resolveLineLink({ data: { pageId: page.id, lineId: id, ...(taskId ? { taskId } : {}) } }).then(r => {
      if (cancelled) return
      // The server's address; a page this browser's copy doesn't have yet gets a full load (Ratchet #146, Lead).
      if (r.blockId && r.href && r.pageId !== page.id) {
        if (latest.current.pages.some(p => p.id === r.pageId)) void navigate({ href: r.href, replace: true, resetScroll: false })
        else window.location.replace(r.href)
        return
      }
      jumpHere(r.blockId ?? id)
    }, () => { if (!cancelled) lookupFailed(attempt) })
    attempt()
    return () => { cancelled = true; cleanup?.() }
  }, [page.id, navigate])
  const render = (n: EditorNode): ReactNode => {
    const children = n.children?.length ? <div className="ro-children">{n.children.map(render)}</div> : null
    if (n.type === 'heading') return <div key={n.id} data-id={n.id}><h2 className={`ro-heading level-${n.props?.level ?? 2}`}><InlineWithRefs content={n.content} workspace={workspace} /></h2>{children}</div>
    if (n.type === 'pageLink') {
      const target = workspace.pages.find(p => p.id === n.props?.pageId)
      return <div key={n.id} data-id={n.id}>{target
        ? <PageLink className={`editor-page-card ${isTrashed(target) ? 'in-trash' : ''}`} href={pageHref(target)}><span className="editor-page-card-icon"><PageKindIcon url={target.url} /></span><span className="editor-page-card-title">{displayPageTitle(target)}</span>{isTrashed(target) && <span className="in-trash-tag">In trash</span>}<ChevronRightIcon /></PageLink>
        : <p className="ro-line quiet">Page not found</p>}{children}</div>
    }
    if (!inlineText(n.content) && !children) return null
    if (n.type === 'task') {
      const done = workspace.tasks.find(t => t.id === n.props?.taskId)?.status === 'done'
      return <div key={n.id} data-id={n.id}><p className={`ro-line ro-task ${done ? 'done' : ''}`}><span className="ro-box" aria-hidden="true">{done ? '☑' : '☐'}</span><InlineWithRefs content={n.content} workspace={workspace} /></p>{children}</div>
    }
    const marker = n.type === 'bulletListItem' ? '•' : n.type === 'numberedListItem' ? '–' : n.type === 'checkListItem' ? (n.props?.checked ? '☑' : '☐') : null
    return <div key={n.id} data-id={n.id}><p className="ro-line">{marker && <span className="ro-box" aria-hidden="true">{marker}</span>}<InlineWithRefs content={n.content} workspace={workspace} /></p>{children}</div>
  }
  return <div className="ro-body" ref={body}>{nodes.map(render)}</div>
}
