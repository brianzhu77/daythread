import { useState } from 'react'
import { ContinuousPage } from './continuous-page'
import { useWorkspace } from './use-day'
import { TagList } from './tags-view'
export function PagesScreen() {
  const { workspace, run } = useWorkspace()
  const [selected, setSelected] = useState<string | null>(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('page'))
  const p = workspace?.pages.find(p => p.id === selected)
  if (!workspace) return <p>Loading pages…</p>
  if (p) return <div className="list-screen"><button className="secondary" onClick={() => setSelected(null)}>‹ Pages</button><h1 className="large-title">{p.title}</h1><ContinuousPage page={p} workspace={workspace} /></div>
  return <div className="list-screen"><h1 className="large-title">Pages</h1><div className="document-pages">{workspace.pages.filter(p => p.type === 'document').map(p => <button className="secondary" key={p.id} onClick={() => setSelected(p.id)}>{p.title}</button>)}</div><button className="secondary" onClick={async () => { const title = window.prompt('Page title'); if (title?.trim()) { const receipt = await run({ type: 'create-document', title: title.trim(), body: '' }); if (receipt?.entityId) setSelected(receipt.entityId) } }}>＋ New page</button><p className="quiet">Page tree and nesting are not connected yet.</p><TagList workspace={workspace} /></div>
}
