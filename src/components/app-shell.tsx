import type { ReactNode } from 'react'
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
      </div>
    </WorkspaceProvider>
  )
}

function SampleBanner() {
  const { workspace, loadError, reload, simOutcome, setSimOutcome, addSampleData } = useWorkspace()
  if (loadError)
    return (
      <p className="banner error" role="alert">
        Couldn’t load your workspace · <button type="button" className="link" onClick={reload}>Retry</button>
      </p>
    )
  return (
    <details className="banner" role="note">
      <summary>Local only · AI simulated</summary>
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
        <button type="button" className="link" onClick={() => void addSampleData()}>
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
        <button type="button" className="link" onClick={retry}>
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
