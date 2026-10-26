import { Toast } from '@heroui/react'
import { useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'
import { Navigation } from './navigation'
import { KeptDrafts } from './kept-drafts'
import { WorkspaceProvider, isConflict, useWorkspace } from './use-day'

/** App frame (craft-v1 §3): sidebar on laptop, bottom tabs and + on phone, dev banner, undo notices. */
export function AppShell({ children }: { children: ReactNode }) {
  useVisibleTop()
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
          <KeptDrafts />
        </div>
        <Toasts />
        <div className="safe-top" aria-hidden="true" />
      </div>
    </WorkspaceProvider>
  )
}

/**
 * Every notice with Undo, editor or not, is one HeroUI Toast style: text, one action on the same line, and ✕.
 * A second action sits under the text. Top on phones, where the keyboard covers the bottom; bottom on desktop.
 */
function Toasts() {
  const [phone, setPhone] = useState(false)
  const path = useRouterState({ select: r => r.location.pathname })
  useEffect(() => {
    const media = window.matchMedia('(max-width: 599px)')
    const update = () => setPhone(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return (
    // The review lives on today's page now; phone notices sit at the top on every screen.
    // on Done hit the notice, or its Undo.
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
  const { workspace, loadError, reload, addSampleData } = useWorkspace()
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
      <summary>{import.meta.env.VITE_TRIAL_BANNER ?? 'Local only'}</summary>
      <span>Saved on this Mac.</span>
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

/**
 * B52: `--vv-top` is where the visible part of the page starts, for fixed things that belong at its top (the
 * status-bar strip, phone notices). iOS scrolls the visible part by `visualViewport.offsetTop` while the keyboard is
 * up, and a fixed `top: 0` would then sit above the screen.
 */
function useVisibleTop() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => document.documentElement.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
}
