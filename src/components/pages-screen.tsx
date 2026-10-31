import { useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { AccountRow } from './account-row'
import { ContinuousPage } from './continuous-page'
import { displayPageTitle, PageTitleField } from './page-title'
import { childPages, isTrashed, pagesInDays, parentOf, visiblePages } from '../domain/page-tree'
import type { Page, Workspace } from '../domain/types'
import { LinkedFrom, PageHeaderRow, PageLink, pageLabel, Subpages, useToday } from './page-tree'
import { ChevronRightIcon, PageKindIcon, PlusIcon } from './icons'
import { LinkUrlRow } from './link-url-row'
import { PagesTrashRow, TrashedPage, TrashScreen } from './trash'
import { useWorkspace } from './use-day'
import { RowMenu } from './row-menu'
import { flushEditor } from './editor-flush'
import { dayPagesTarget, daySubpagesTarget, dayTemplateTitle, defaultTemplate, isTemplate, templates, templateTarget, topLevelTarget } from '../domain/day-template'

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
  if (p && isTemplate(p)) return <TemplateScreen key={p.id} page={p} workspace={workspace} today={today} autoFocusTitle={search.focus === 'title'} onDeleted={() => void navigate({ to: '/pages', search: { view: 'templates' } })} />
  if (search.view === 'templates' && !p) return <TemplatesScreen workspace={workspace} today={today} onOpen={(page, focus) => void navigate({ to: '/pages', search: { page, ...(focus ? { focus } : {}) } })} />
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

/** "Default for day pages", "Default for pages in Recipes · in Trash", or nothing (states §1, §4). */
function targetLabel(workspace: Workspace, t: Page, today: string): string {
  const target = templateTarget(t)
  if (!target) return ''
  if (target === dayPagesTarget) return 'Default for day pages'
  if (target === topLevelTarget) return 'Default for top-level pages'
  if (target === daySubpagesTarget) return 'Default for pages inside days'
  const on = workspace.pages.find(p => p.id === target)
  return on ? `Default for pages in ${pageLabel(on, today)}${isTrashed(on) ? ' · in Trash' : ''}` : ''
}

/** B70 (states §1): the Templates list, with "+" for a new, blank template. */
function TemplatesScreen({ workspace, today, onOpen }: { workspace: Workspace; today: string; onOpen: (id: string, focus?: 'title') => void }) {
  const { run } = useWorkspace()
  const list = templates(workspace)
  // Single-flight (Ratchet f0e1b4fd): a second click while the first is on its way does nothing, and a retry after a
  // failure reuses the same page id, so Edit never makes two "Day" templates and "+" never two blank ones.
  const pending = useRef<Record<'day' | 'blank', { pageId: string; busy: boolean } | undefined>>({ day: undefined, blank: undefined })
  const [opening, setOpening] = useState(false)
  const make = async (dayPage: boolean) => {
    const kind = dayPage ? 'day' : 'blank'
    if (pending.current[kind]?.busy) return
    const pageId = pending.current[kind]?.pageId ?? crypto.randomUUID()
    pending.current[kind] = { pageId, busy: true }
    if (dayPage) setOpening(true)
    const receipt = await run({ type: 'create-template', title: dayPage ? dayTemplateTitle : '', pageId, ...(dayPage ? { dayPage: true as const } : {}) })
    // A made template frees the slot for the next one; a failed one keeps its id for the retry.
    pending.current[kind] = receipt ? undefined : { pageId, busy: false }
    if (dayPage) setOpening(false)
    if (receipt) onOpen(receipt.entityId ?? pageId, dayPage ? undefined : 'title')
  }
  return (
    <div className="list-screen">
      <div className="title-row">
        <h1 className="large-title">Templates</h1>
        <button type="button" className="round-add" aria-label="New template" onClick={() => void make(false)}><PlusIcon /></button>
      </div>
      {/* Whenever day pages have no default, say what they start with, even after "+" made another template. A second
          "Day" from Edit is no longer stuck now that templates can be deleted. */}
      {!defaultTemplate(workspace, dayPagesTarget) && (
        <p className="quiet">Day pages start with TODO, Events, Good Stuffs and Notes. · <button type="button" className="link" disabled={opening} onClick={() => void make(true)}>{opening ? 'Opening…' : 'Edit'}</button></p>
      )}
      {list.length > 0 && (
        <ul className="plain card-list two-line">
          {list.map(t => (
            <li key={t.id}>
              <button type="button" className="card-row" onClick={() => onOpen(t.id)}>
                <span className="card-row-icon"><PageKindIcon url={null} /></span>
                <span className="card-row-text">
                  <span className={`card-row-title ${t.title ? '' : 'untitled'}`}>{displayPageTitle(t)}</span>
                  {targetLabel(workspace, t, today) && <span className="card-row-detail">{targetLabel(workspace, t, today)}</span>}
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

/** B70 (states §2): a template, edited like a document page, with what it is the default for and Delete. */
function TemplateScreen({ page, workspace, today, autoFocusTitle, onDeleted }: { page: Page; workspace: Workspace; today: string; autoFocusTitle: boolean; onDeleted: () => void }) {
  const { run } = useWorkspace()
  const target = templateTarget(page)
  // "Pages in…": documents, as Move to… offers them, plus the current target if it's a day or in the trash.
  const documents = visiblePages(workspace).filter(p => p.type === 'document')
  const current = target && ![dayPagesTarget, topLevelTarget, daySubpagesTarget].includes(target) ? workspace.pages.find(p => p.id === target) : undefined
  const pagesIn = current && !documents.includes(current) ? [current, ...documents] : documents
  // Every document page, nested and link pages included (Brian 57deaed7); nested ones name their parent, as titles repeat.
  // The closed menu shows only the option's text, so each one says "Pages in …" itself; a nested page reads as its path.
  const inLabel = (p: Page) => { const parent = parentOf(workspace, p); return `Pages in ${parent ? `${pageLabel(parent, today)} › ` : ''}${pageLabel(p, today)}` }
  const holder = (value: string) => { const h = defaultTemplate(workspace, value); return h && h.id !== page.id ? ` · now ${displayPageTitle(h)}` : '' }
  const setTarget = (next: string) => {
    const value = next || null
    if (value === target) return
    void run({ type: 'set-template-target', pageId: page.id, target: value }, r => ({ text: r.message, undoOperationId: r.operationId }))
  }
  const remove = async () => {
    // His latest words go first, as on a document page's Delete: a save that fails stops the delete (Ratchet).
    if (!(await flushEditor(page.id))) return
    if (await run({ type: 'delete-template', pageId: page.id }, r => ({ text: r.message, undoOperationId: r.operationId }))) onDeleted()
  }
  return (
    <div className="doc-screen template-screen">
      {/* The way back to the list, set like a document page's "Pages" crumb: the Home Screen app has no Back button. */}
      <div className="crumbs">
        <nav className="crumbs-path folded" aria-label="Page location"><PageLink className="crumb" href="/pages?view=templates">Templates</PageLink></nav>
        {/* Delete sits in the ⋯ where a document page has it (Jazz dbb8b038). */}
        <RowMenu label="Template actions" triggerClass="page-more" groups={[{ items: [{ label: 'Delete', danger: true, onSelect: () => void remove() }] }]} />
      </div>
      <div className="page-head">
        <PageTitleField key={page.id} page={page} autoFocus={autoFocusTitle} />
        <p className="template-note">
          <label>Default for:{' '}
            <select className="template-target" value={target ?? ''} onChange={e => setTarget(e.target.value)}>
              <option value="">None</option>
              <option value={dayPagesTarget}>Day pages{holder(dayPagesTarget)}</option>
              <option value={topLevelTarget}>Top-level pages{holder(topLevelTarget)}</option>
              <option value={daySubpagesTarget}>Pages inside any day{holder(daySubpagesTarget)}</option>
              {pagesIn.length > 0 && (
                <optgroup label="Pages in…">
                  {pagesIn.map(p => <option key={p.id} value={p.id}>{inLabel(p)}{isTrashed(p) ? ' · in Trash' : ''}{holder(p.id)}</option>)}
                </optgroup>
              )}
            </select>
          </label>
        </p>
        <p className="template-note">New pages start from this template. To-dos are copied empty.</p>
      </div>
      <ContinuousPage page={page} workspace={workspace} />
    </div>
  )
}
