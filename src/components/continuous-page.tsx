import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { Page, Workspace } from '../domain/types'

/**
 * B41: the editor's code is a separate download (it's most of the app). It's fetched once the app is idle
 * (`preloadEditor`, from the app shell), so opening a page later needs no network. If it still can't be fetched
 * (offline before it ever loaded), the page says so in the app, never a browser error page. Once the connection is
 * back it reloads: browsers keep a failed module import, so asking again in place would fail again, and online a
 * reload is safe (unsaved text elsewhere is in its stored draft and comes back).
 */
let editorModule: Promise<typeof import('./page-editor')> | null = null
export function preloadEditor(): Promise<typeof import('./page-editor')> {
  editorModule ??= import('./page-editor').catch(error => { editorModule = null; throw error })
  return editorModule
}
const Editor = lazy(() => preloadEditor().then(m => ({ default: m.PageEditor })))

export function ContinuousPage({ page, workspace }: { page: Page; workspace: Workspace }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <p className="loading">Opening your page…</p>
  return (
    <EditorLoadBoundary>
      <Suspense fallback={<p className="loading">Opening your page…</p>}>
        <Editor key={page.id} page={page} workspace={workspace} />
      </Suspense>
    </EditorLoadBoundary>
  )
}

/** Shows "Offline · this page needs a connection" when the editor's code can't be fetched; reloads once online. */
class EditorLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  private retry = () => { if (navigator.onLine !== false) window.location.reload() }
  // Caught on the first render as often as later, so the listener goes on here rather than in componentDidUpdate.
  componentDidCatch() { window.addEventListener('online', this.retry, { once: true }) }
  componentWillUnmount() { window.removeEventListener('online', this.retry) }
  render() {
    if (!this.state.failed) return this.props.children
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    return (
      <p className="loading" role="status">
        {offline ? 'Offline · this page needs a connection' : "Couldn't open this page"}
        {' · '}<button type="button" className="link" onClick={this.retry}>Try again</button>
      </p>
    )
  }
}
