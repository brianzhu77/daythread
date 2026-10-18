import { useState } from 'react'
import { ContinuousPage } from './continuous-page'
import { useWorkspace } from './use-day'
import { TagList } from './tags-view'
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
  const [selected, setSelected] = useState<string | null>(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('page'))
  const p = workspace?.pages.find(p => p.id === selected)
  if (!workspace) return <p>Loading pages…</p>
  if (p) return <div className="list-screen"><button className="secondary" onClick={() => setSelected(null)}>‹ Pages</button><h1 className="large-title">{p.title}</h1><ContinuousPage page={p} workspace={workspace} /></div>
  return <div className="list-screen"><h1 className="large-title">Pages</h1><div className="document-pages">{workspace.pages.filter(p => p.type === 'document').map(p => <button className="secondary" key={p.id} onClick={() => setSelected(p.id)}>{p.title}</button>)}</div><button className="secondary" onClick={async () => { const id = await createPage(); if (id) setSelected(id) }}>＋ New page</button><TagList workspace={workspace} /></div>
}
