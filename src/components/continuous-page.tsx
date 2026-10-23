import { lazy, Suspense, useEffect, useState } from 'react'
import type { Page, Workspace } from '../domain/types'
import { keptSaveFor } from './draft-recovery'
import { doneEditorMounting, noteEditorMounting } from './editor-flush'
const Editor = lazy(() => import('./page-editor').then(m => ({ default: m.PageEditor })))
export function ContinuousPage({ page, workspace }: { page: Page; workspace: Workspace }) {
  const [mounted, setMounted] = useState(false)
  // B40 (Roadbuster condition 5): a background save of this page's kept draft is on its way; the editor opens once it
  // lands, on the saved page, instead of reading the draft and saving it a second time from the old version.
  const [waiting, setWaiting] = useState(() => Boolean(keptSaveFor(page.id)))
  useEffect(() => {
    setMounted(true)
    const pending = keptSaveFor(page.id)
    if (!pending) { setWaiting(false); return }
    let live = true
    void pending.then(() => { if (live) setWaiting(false) })
    return () => { live = false }
  }, [page.id])
  // While the editor's code loads, the page already counts as opening: no background save starts on it.
  useEffect(() => { if (waiting) return; noteEditorMounting(page.id); return () => doneEditorMounting(page.id) }, [page.id, waiting])
  return mounted && !waiting ? <Suspense fallback={<p className="loading">Opening your page…</p>}><Editor key={page.id} page={page} workspace={workspace} /></Suspense> : <p className="loading">Opening your page…</p>
}
