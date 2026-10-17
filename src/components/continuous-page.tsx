import { lazy, Suspense, useEffect, useState } from 'react'
import type { Page, Workspace } from '../domain/types'
const Editor = lazy(() => import('./page-editor').then(m => ({ default: m.PageEditor })))
export function ContinuousPage({ page, workspace }: { page: Page; workspace: Workspace }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <Suspense fallback={<p className="loading">Opening your page…</p>}><Editor key={page.id} page={page} workspace={workspace} /></Suspense> : <p className="loading">Opening your page…</p>
}
