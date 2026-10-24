import { useEffect, useState } from 'react'
import type { Page, Workspace } from '../domain/types'
import { PageEditor } from './page-editor'

/**
 * B41: the editor comes with the app rather than as a separate download. As a separate download it was fetched on the
 * first page opened; offline that fetch failed, and browsers keep a failed module import, so the page couldn't open
 * until a reload (WebKit not even then). It's most of the app's code either way, and was fetched as soon as the app
 * was idle, so the first load costs about the same. It still renders only in the browser (after mount).
 */
export function ContinuousPage({ page, workspace }: { page: Page; workspace: Workspace }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <PageEditor key={page.id} page={page} workspace={workspace} /> : <p className="loading">Opening your page…</p>
}
