import { Toast } from '@heroui/react'
import { type ReactNode, useEffect, useState } from 'react'
import { Navigation } from './navigation'
import { preloadEditor } from './continuous-page'
import { WorkspaceProvider, isConflict, useWorkspace, type SimOutcome } from './use-day'

/** App frame (craft-v1 §3): sidebar on laptop, bottom tabs and + on phone, dev banner, undo notices. */
export function AppShell({ children }: { children: ReactNode }) {
  usePreloadEditor()
  return (
    <WorkspaceProvider>
      <div className="app">
        <Navigation />
        <div className="app-content">
          <SampleBanner />
          <SaveIndicator />
          <main className="app-main">{children}</main>
        </div>
        <div className="bottom-dock">
          <div id="editor-dock" className="editor-dock" />
        </div>
        <Toasts />
      </div>
    </WorkspaceProvider>
  )
}

/**
 * B41: every screen's code comes with the app (route code splitting is off in vite.config.ts); the editor, the one
 * large separate download, is fetched once the app is idle, so moving between screens offline needs no network.
 */
function usePreloadEditor() {
  useEffect(() => {
    const load = () => { void preloadEditor().catch(() => undefined) }
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const handle = idle ? idle(load, { timeout: 3000 }) : window.setTimeout(load, 1500)
    // Offline at start: fetch it as soon as the connection is back.
    window.addEventListener('online', load)
    return () => { window.removeEventListener('online', load); if (!idle) clearTimeout(handle) }
  }, [])
}

/**
 * Every notice with Undo, editor or not, is one HeroUI Toast style: text, one action on the same line, and ✕.
 * A second action sits under the text. Top on phones, where the keyboard covers the bottom; bottom on desktop.
 */
function Toasts() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 599px)')
    const update = () => setPhone(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return (
    <Toast.Provider placement={phone ? 'top' : 'bottom'} className="app-toasts">
      {({ toast: t }) => (
        <Toast toast={t}>
          <Toast.Content>
            <Toast.Title>{t.content.title}</Toast.Title>
            {t.content.description && <Toast.Description>{t.content.description}</Toast.Description>}
          </Toast.Content>
          {t.content.actionProps?.children && <Toast.ActionButton {...t.content.actionProps} />}
          <Toast.CloseButton />
        </Toast>
      )}
    </Toast.Provider>
  )
}

function SampleBanner() {
  const { workspace, loadError, reload, simOutcome, setSimOutcome, addSampleData } = useWorkspace()
  if (loadError)
    return (
      <p className="banner error" role="alert">
        Couldn’t load your workspace · <button type="button" className="app-link" onClick={reload}>Retry</button>
      </p>
    )
  // Developer controls. Hidden in normal builds so a real workspace can't pick up simulated outcomes or sample data;
  // trial copies keep the banner so the "not your real workspace" line stays visible.
  if (import.meta.env.VITE_DEV_MENU !== '1' && !import.meta.env.VITE_TRIAL_BANNER) return null
  return (
    <details className="banner" role="note">
      <summary>{import.meta.env.VITE_TRIAL_BANNER ?? 'Local only · AI simulated'}</summary>
      <span>Saved on this Mac. Organizing and suggestions are simulated; no model is called.</span>
      <label className="sim-control">
        Next AI result
        <select value={simOutcome} onChange={e => setSimOutcome(e.target.value as SimOutcome)}>
          <option value="success">Works</option>
          <option value="failure">Model error</option>
          <option value="context">Too much linked material</option>
          <option value="budget">Daily budget used up</option>
        </select>
      </label>
      {import.meta.env.DEV && workspace && (
        <button type="button" className="app-link" onClick={() => void addSampleData()}>
          Add sample data
        </button>
      )}
    </details>
  )
}

/**
 * Save failures (01 §8), mounted once above every screen: persistent until Retry or the next successful save. Never a toast.
 * Saving and saved stay silent here. Editor saves have their own "Retry saving / Copy draft" line, which owns that retry.
 */
function SaveIndicator() {
  const { saveState, saveError, failedAction, retry } = useWorkspace()
  if (saveState !== 'failed' || failedAction === 'save-editor') return null
  return (
    <p className="banner save-failed" role="alert">
      {failedAction === 'ensure-day'
        ? 'Couldn’t create the page'
        : saveError?.startsWith('Cannot undo')
          ? 'Can’t undo — changed since'
          : isConflict(saveError)
            ? 'Changed elsewhere — now showing the latest. Your edit wasn’t saved'
            : 'Not saved — your changes are still here'}{' '}
      ·{' '}
      <button type="button" className="app-link" onClick={retry}>
        Retry
      </button>
    </p>
  )
}
