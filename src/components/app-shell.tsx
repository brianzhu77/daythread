import { Toast } from '@heroui/react'
import { type ReactNode, useEffect, useState } from 'react'
import { Notices } from './notices'
import { Navigation } from './navigation'
import { WorkspaceProvider, isConflict, useWorkspace, type SimOutcome } from './use-day'

/** App frame (craft-v1 §3): sidebar on laptop, bottom tabs and + on phone, dev banner, undo notices. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <div className="app">
        <Navigation />
        <div className="app-content">
          <SampleBanner />
          <main className="app-main">{children}</main>
        </div>
        {/* One bottom dock so the editor's selection bar and every undo notice stack instead of overlapping. */}
        <div className="bottom-dock">
          <div id="editor-dock" className="editor-dock" />
          <Notices />
        </div>
        <EditToasts />
      </div>
    </WorkspaceProvider>
  )
}

/** Editor notices with Undo (HeroUI Toast): top on phones, where the keyboard covers the bottom; bottom on desktop. */
function EditToasts() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 599px)')
    const update = () => setPhone(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return <Toast.Provider placement={phone ? 'top' : 'bottom'} />
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

/** Per-page save state (01 §8): quiet while saving, persistent when it fails. Never a toast. */
export function SaveIndicator() {
  const { saveState, saveError, retry } = useWorkspace()
  if (saveState === 'idle') return <span className="save-state" aria-live="polite" />
  if (saveState === 'failed')
    return (
      <span className="save-state failed" role="alert">
        {saveError?.startsWith('Cannot undo')
          ? 'Can’t undo — changed since'
          : isConflict(saveError)
            ? 'Changed elsewhere — now showing the latest. Your edit wasn’t saved'
            : 'Not saved — your changes are still here'}{' '}
        ·{' '}
        <button type="button" className="app-link" onClick={retry}>
          Retry
        </button>
      </span>
    )
  return (
    <span className="save-state" aria-live="polite">
      {saveState === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  )
}
