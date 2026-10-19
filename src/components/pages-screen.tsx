import { useNavigate, useSearch } from '@tanstack/react-router'
import { ContinuousPage } from './continuous-page'
import { displayPageTitle, PageTitleField } from './page-title'
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
  if (p) return <div className="list-screen"><button className="secondary" onClick={() => setSelected(null)}>‹ Pages</button>
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
