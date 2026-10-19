import { useNavigate, useSearch } from '@tanstack/react-router'
import { ContinuousPage } from './continuous-page'
import { displayPageTitle, PageTitleField } from './page-title'
import { longLabel, todayIso } from './dates'
import type { Page, Workspace } from '../domain/types'
import { ChevronRightIcon, PagesIcon, PlusIcon } from './icons'
import { useWorkspace } from './use-day'

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
  const setSelected = (page: string | null) => void navigate({ to: '/pages', search: page ? { page } : {} })
  const p = workspace?.pages.find(p => p.id === search.page)
  if (!workspace) return <p>Loading pages…</p>
  if (p) return <div className="doc-screen"><BackToParent page={p} workspace={workspace} />
    {p.type === 'document' ? <PageTitleField key={p.id} page={p} autoFocus={search.focus === 'title'} /> : <h1 className="large-title">{p.title}</h1>}
    <ContinuousPage page={p} workspace={workspace} /></div>
  const documents = workspace.pages.filter(p => p.type === 'document')
  return (
    <div className="list-screen">
      <div className="title-row">
        <h1 className="large-title">Pages</h1>
        <button type="button" className="round-add" aria-label="New page" onClick={async () => { const id = await createPage(); if (id) setSelected(id) }}><PlusIcon /></button>
      </div>
      {/* Pages lists only pages, flat (Brian 77423ea0); Tags is a navigation destination of its own. */}
      {documents.length === 0 ? <p className="quiet">No pages yet. Tap + to start one.</p> : (
        <ul className="plain card-list">
          {documents.map(p => <li key={p.id}><button type="button" className="card-row" onClick={() => setSelected(p.id)}><span className="card-row-icon"><PagesIcon /></span><span className={`card-row-title ${p.title ? '' : 'untitled'}`}>{displayPageTitle(p)}</span><ChevronRightIcon /></button></li>)}
        </ul>
      )}
    </div>
  )
}

/**
 * A subpage's way back is its parent, opened at the card that leads here ("‹ Today", "‹ Sun, Oct 18", "‹ Trip
 * ideas"); on the phone this is often the only Back there is (Bumblebee, Jazz). Other pages go back to Pages.
 */
function BackToParent({ page, workspace }: { page: Page; workspace: Workspace }) {
  const navigate = useNavigate()
  const parent = page.parentId ? workspace.pages.find(p => p.id === page.parentId) : undefined
  if (!parent) return <a href="/pages" className="back-link" onClick={e => { e.preventDefault(); void navigate({ to: '/pages', search: {} }) }}>‹ Pages</a>
  const card = parent.sections.flatMap(s => s.blocks).find(b => b.kind === 'reference' && b.targetPageId === page.id)
  const at = card ? `?block=${encodeURIComponent(card.id)}` : ''
  const href = parent.type === 'daily' && parent.date ? `/day/${parent.date}${at}` : `/pages?page=${encodeURIComponent(parent.id)}${card ? `&block=${encodeURIComponent(card.id)}` : ''}`
  const label = parent.type === 'daily' && parent.date ? (parent.date === todayIso() ? 'Today' : longLabel(parent.date)) : displayPageTitle(parent)
  return <a href={href} className="back-link" onClick={e => { e.preventDefault(); void navigate({ href, resetScroll: false }) }}>‹ {label}</a>
}
