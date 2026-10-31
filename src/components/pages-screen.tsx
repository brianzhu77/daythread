import { useNavigate, useSearch } from '@tanstack/react-router'
import { AccountRow } from './account-row'
import { ContinuousPage } from './continuous-page'
import { displayPageTitle, PageTitleField } from './page-title'
import { childPages, isTrashed, pagesInDays, parentOf } from '../domain/page-tree'
import type { Page, Workspace } from '../domain/types'
import { LinkedFrom, PageHeaderRow, PageLink, pageLabel, Subpages, useToday } from './page-tree'
import { ChevronRightIcon, PageKindIcon, PlusIcon } from './icons'
import { LinkUrlRow } from './link-url-row'
import { PagesTrashRow, TrashedPage, TrashScreen } from './trash'
import { useWorkspace } from './use-day'
import { dayPagesTarget, dayTemplateTitle, defaultTemplate, isTemplate, templates, templateTarget } from '../domain/day-template'

/** Asks for a title and creates a document page; resolves to its id, or null if cancelled. */
export function useCreatePage() {
  const { run } = useWorkspace()
  return async () => {
    const title = window.prompt('Page title')?.trim()
    if (!title) return null
    const receipt = await run({ type: 'create-document', title, body: '' })
    return receipt?.entityId ?? null
  }
}

export function PagesScreen() {
  const { workspace } = useWorkspace()
  const createPage = useCreatePage()
  const search = useSearch({ from: '/pages' })
  const navigate = useNavigate()
  const today = useToday()
  const setSelected = (page: string | null) => void navigate({ to: '/pages', search: page ? { page } : {} })
  const p = workspace?.pages.find(p => p.id === search.page)
  if (search.view === 'trash' && !p) return <TrashScreen />
  if (!workspace) return <p>Loading pages…</p>
  if (p && isTemplate(p)) return <TemplateScreen key={p.id} page={p} workspace={workspace} />
  if (search.view === 'templates' && !p) return <TemplatesScreen workspace={workspace} onOpen={setSelected} />
  if (p && isTrashed(p)) return <TrashedPage key={p.id} page={p} workspace={workspace} />
  if (p) return <div className="doc-screen"><PageHeaderRow page={p} workspace={workspace} />
    <div className="page-head">
      {p.type === 'document' ? <PageTitleField key={p.id} page={p} autoFocus={search.focus === 'title'} /> : <h1 className="large-title">{p.title}</h1>}
      <LinkUrlRow page={p} />
      <LinkedFrom page={p} workspace={workspace} />
    </div>
    <ContinuousPage page={p} workspace={workspace} />
    <Subpages page={p} workspace={workspace} /></div>
  // Top-level pages, then pages made inside day pages by day (Lead 02cbc559); deeper pages are reached through each
  // page's Subpages list (layout §6).
  const documents = childPages(workspace, null)
  const inDays = pagesInDays(workspace)
  return (
    <div className="list-screen">
      <div className="title-row">
        <h1 className="large-title">Pages</h1>
        <button type="button" className="round-add" aria-label="New page" onClick={async () => { const id = await createPage(); if (id) setSelected(id) }}><PlusIcon /></button>
      </div>
      {/* Pages lists only pages (Brian 77423ea0); Tags is a navigation destination of its own. */}
      {documents.length === 0 && inDays.length === 0 && <p className="quiet">No pages yet. Use + to start one.</p>}
      {documents.length > 0 && <PageRows pages={documents} workspace={workspace} onOpen={setSelected} />}
      {inDays.length > 0 && (
        <section className="pages-in-days" aria-label="In your days">
          <h2 className="list-header">In your days</h2>
          {/* One list, the title first and its day as a quiet second line (Jazz 41ff03b §8, Bumblebee). */}
          <PageRows pages={inDays.flatMap(g => g.pages)} workspace={workspace} onOpen={setSelected} detail={p => pageLabel(parentOf(workspace, p)!, today)} />
        </section>
      )}
      <PagesTrashRow workspace={workspace} />
      <AccountRow className="account-row-phone" />
    </div>
  )
}

function PageRows({ pages, workspace, onOpen, detail }: { pages: Page[]; workspace: Workspace; onOpen: (id: string) => void; detail?: (p: Page) => string }) {
  return (
    <ul className={`plain card-list ${detail ? 'two-line' : ''}`}>
      {pages.map(p => {
        const n = childPages(workspace, p.id).length
        return (
          <li key={p.id}>
            <button type="button" className="card-row" onClick={() => onOpen(p.id)}>
              <span className="card-row-icon"><PageKindIcon url={p.url} /></span>
              <span className="card-row-text">
                <span className={`card-row-title ${p.title ? '' : 'untitled'}`}>{displayPageTitle(p)}</span>
                {detail && <span className="card-row-detail">{detail(p)}</span>}
              </span>
              {n > 0 && <span className="subpage-count">{n}</span>}
              <ChevronRightIcon />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** B70 (states §1): the Templates list. Part 1 has one target, day pages; "+" and Delete come with subpage defaults. */
function TemplatesScreen({ workspace, onOpen }: { workspace: Workspace; onOpen: (id: string) => void }) {
  const { run } = useWorkspace()
  const list = templates(workspace)
  const edit = async () => {
    const pageId = crypto.randomUUID()
    if (await run({ type: 'create-template', title: dayTemplateTitle, pageId, dayPage: true })) onOpen(pageId)
  }
  return (
    <div className="list-screen">
      <div className="title-row"><h1 className="large-title">Templates</h1></div>
      {/* Only before any template exists: with "Day" in the list (default or not), Edit would make a second one. */}
      {list.length === 0 && !defaultTemplate(workspace, dayPagesTarget) && (
        <p className="quiet">Day pages start with TODO, Events, Good Stuffs and Notes. · <button type="button" className="link" onClick={() => void edit()}>Edit</button></p>
      )}
      {list.length > 0 && (
        <ul className="plain card-list two-line">
          {list.map(t => (
            <li key={t.id}>
              <button type="button" className="card-row" onClick={() => onOpen(t.id)}>
                <span className="card-row-icon"><PageKindIcon url={null} /></span>
                <span className="card-row-text">
                  <span className={`card-row-title ${t.title ? '' : 'untitled'}`}>{displayPageTitle(t)}</span>
                  {templateTarget(t) === dayPagesTarget && <span className="card-row-detail">Default for day pages</span>}
                </span>
                <ChevronRightIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AccountRow className="account-row-phone" />
    </div>
  )
}

/** B70 (states §2): a template, edited like a document page, with what it is the default for. */
function TemplateScreen({ page, workspace }: { page: Page; workspace: Workspace }) {
  const { run } = useWorkspace()
  const target = templateTarget(page)
  const holder = defaultTemplate(workspace, dayPagesTarget)
  const setTarget = (next: string) => {
    const value = next === dayPagesTarget ? dayPagesTarget : null
    if (value === target) return
    void run({ type: 'set-template-target', pageId: page.id, target: value }, r => ({ text: value ? 'Now the default for day pages' : 'No longer a default', undoOperationId: r.operationId }))
  }
  return (
    <div className="doc-screen template-screen">
      {/* The way back to the list, set like a document page's "Pages" crumb: the Home Screen app has no Back button. */}
      <div className="crumbs">
        <nav className="crumbs-path folded" aria-label="Page location"><PageLink className="crumb" href="/pages?view=templates">Templates</PageLink></nav>
      </div>
      <div className="page-head">
        <PageTitleField key={page.id} page={page} />
        <p className="template-note">
          <label>Default for:{' '}
            <select className="template-target" value={target ?? ''} onChange={e => setTarget(e.target.value)}>
              <option value="">None</option>
              <option value={dayPagesTarget}>Day pages{holder && holder.id !== page.id ? ` · now ${displayPageTitle(holder)}` : ''}</option>
            </select>
          </label>
        </p>
        <p className="template-note">New pages start from this template. To-dos are copied empty.</p>
      </div>
      <ContinuousPage page={page} workspace={workspace} />
    </div>
  )
}
