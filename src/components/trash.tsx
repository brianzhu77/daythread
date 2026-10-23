import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'
import { editorSeed, inlineText, type EditorNode } from '../domain/editor-document'
import { isTrashed, parentOf, subtreeIds, trashBatch, trashBatches, trashedChildPages } from '../domain/page-tree'
import type { Page, Receipt, Workspace } from '../domain/types'
import { longLabel, toIso } from './dates'
import { flushEditor } from './editor-flush'
import { jumpToBlock, lookupFailed } from './line-jump'
import { resolveLineLink } from '../server/functions'
import { toast } from '@heroui/react'
import { ChevronRightIcon, PageKindIcon, TrashIcon } from './icons'
import { LinkUrlRow } from './link-url-row'
import { InlineWithRefs } from './line-text'
import { displayPageTitle } from './page-title'
import { PageLink, pageHref, pageLabel, useToday } from './page-tree'
import { useWorkspace } from './use-day'

// A4 trash and restore, laid out per Jazz docs/design/pages-trash-layout.md (2956eea). Data: docs/design/a4-trash-data.md.

/** Where the old parent is, for "From …" and "was in …": a page title, a day label, or "Pages" for top level. */
function oldParentLabel(ws: Workspace, p: Page, today: string): string {
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
  return async (page: Page, openPageId: string | null) => {
    if (!workspace) return
    const subtree = subtreeIds(workspace, page.id)
    for (const id of subtree) if (!(await flushEditor(id))) return
    const parent = parentOf(workspace, page)
    const card = parent?.sections.flatMap(s => s.blocks).find(b => b.kind === 'reference' && b.targetPageId === page.id)
    const receipt = await run({ type: 'delete-page', pageId: page.id, at: new Date().toISOString() },
      r => ({ text: r.message, undoOperationId: r.operationId }))
    if (receipt && openPageId && subtree.has(openPageId)) void navigate({ href: parent ? pageHref(parent, card?.id) : '/pages', resetScroll: !card })
  }
}

/** Layout §5: "Restored to {parent}", or to Pages with the reason when the old parent is in the trash or gone. */
function restoredText(ws: Workspace, page: Page, comingBack: Set<string>, today: string): string {
  if (!page.parentId) return 'Restored to Pages'
  const parent = ws.pages.find(x => x.id === page.parentId)
  if (parent && (!isTrashed(parent) || comingBack.has(parent.id))) return `Restored to ${pageLabel(parent, today)}`
  return `Restored ${displayPageTitle(page)} to Pages · ${parent ? `${pageLabel(parent, today)} is in trash` : 'its page was deleted'}`
}

function useRestore() {
  const { workspace, run } = useWorkspace()
  const navigate = useNavigate()
  const today = useToday()
  /** `whole`: what's left of the page's delete (Trash row, top page's banner); otherwise the page and its own subtree. */
  return (page: Page, { whole, withOpen }: { whole: boolean; withOpen: boolean }) => {
    if (!workspace || !page.trashId) return Promise.resolve(null)
    const members = whole ? trashBatch(workspace, page.trashId)?.members ?? [] : [page, ...descendantsInBatch(workspace, page)]
    const top = whole ? trashBatch(workspace, page.trashId)?.top ?? page : page
    const text = restoredText(workspace, top, new Set(members.map(m => m.id)), today)
    return run(whole ? { type: 'restore-batch', trashId: page.trashId } : { type: 'restore-page', pageId: page.id },
      (r: Receipt) => ({ text, ...(withOpen ? { extra: { label: 'Open', run: () => void navigate({ href: pageHref({ ...top, id: r.entityId ?? top.id }) }) } } : {}) }))
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
        <p className="trash-intro">Deleted pages stay here until you restore them. Tasks inside them keep working.</p>
        <ul className="plain card-list two-line">
          {batches.map(b => {
            const n = b.members.length - 1
            return (
              <li key={b.trashId} className="trash-row">
                <PageLink className="card-row" href={pageHref(b.top)}>
                  <span className="card-row-icon"><PageKindIcon url={b.top.url} /></span>
                  <span className="card-row-text">
                    <span className={`card-row-title ${b.top.title ? '' : 'untitled'}`}>{displayPageTitle(b.top)}</span>
                    <span className="card-row-detail">{[`From ${oldParentLabel(workspace, b.top, today)}`, n > 0 && `with ${n} subpage${n === 1 ? '' : 's'}`, when(b.trashedAt, today)].filter(Boolean).join(' · ')}</span>
                  </span>
                </PageLink>
                <button type="button" className="restore-button" onClick={() => void restore(b.top, { whole: true, withOpen: true })}>Restore</button>
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
      <div className="page-head"><h1 className={`large-title ${page.title ? '' : 'untitled'}`}>{displayPageTitle(page)}</h1><LinkUrlRow page={page} /></div>
      <ReadOnlyBody page={page} workspace={workspace} />
      {children.length > 0 && (
        <section className="subpages" aria-label="Subpages">
          <h2 className="subpages-title">Subpages <span>{children.length}</span></h2>
          <ul className="plain">
            {children.map(c => (
              <li key={c.id}><PageLink className="subpage-row" href={pageHref(c)} title={displayPageTitle(c)}>
                <PageKindIcon url={c.url} /><span className={`subpage-title ${c.title ? '' : 'untitled'}`}>{displayPageTitle(c)}</span><ChevronRightIcon />
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
      const target = latest.current.pages.find(p => p.id === r.pageId)
      if (r.blockId && target && target.id !== page.id) { void navigate({ href: pageHref(target, r.blockId), replace: true, resetScroll: false }); return }
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
