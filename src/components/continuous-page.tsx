import { useEffect, useState } from 'react'
import type { Page, Workspace } from '../domain/types'
import { keptSaveFor } from './draft-recovery'
import { doneEditorMounting, noteEditorMounting } from './editor-flush'
import { PageEditor } from './page-editor'

/**
 * B41: the editor comes with the app rather than as a separate download. As a separate download it was fetched on the
 * first page opened; offline that fetch failed, and browsers keep a failed module import, so the page couldn't open
 * until a reload (WebKit not even then). It's most of the app's code either way, so the first load costs about the
 * same. It still renders only in the browser (after mount).
 */
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
  // From the first render the page counts as opening: no background save starts on it.
  useEffect(() => { if (waiting) return; noteEditorMounting(page.id); return () => doneEditorMounting(page.id) }, [page.id, waiting])
  // B9: the day screen has already said "Loading your day…", so a second message for the moment the editor mounts read as
  // a second load. The page's space is kept, quietly; words show only if it takes a while (a kept draft still saving).
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (mounted && !waiting) return
    const timer = setTimeout(() => setSlow(true), 1000)
    return () => clearTimeout(timer)
  }, [mounted, waiting])
  if (mounted && !waiting) return <PageEditor key={page.id} page={page} workspace={workspace} />
  return <div className="page-opening" aria-busy="true">{slow && <p className="loading">Opening your page…</p>}</div>
}
