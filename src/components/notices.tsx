import { useWorkspace } from './use-day'

/** Undo notices. Bottom of the screen, above the capture bar on iPhone. Never a modal. */
export function Notices() {
  const { notices, run, dismiss, workspace } = useWorkspace()
  // The domain keeps one undo slot: only the latest change can be undone.
  const undoable = workspace?.undo?.operationId
  if (!notices.length) return null
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map(n => (
        <div key={n.id} className="notice">
          <span>{n.text}</span>
          {n.undoOperationId && n.undoOperationId === undoable && (
            <button
              type="button"
              onClick={() => {
                dismiss(n.id)
                void run({ type: 'undo', targetOperationId: n.undoOperationId! }, { text: 'Undone' })
              }}
            >
              Undo
            </button>
          )}
          {n.extra && (!n.undoOperationId || n.undoOperationId === undoable) && (
            <button
              type="button"
              onClick={() => {
                dismiss(n.id)
                n.extra!.run()
              }}
            >
              {n.extra.label}
            </button>
          )}
          <button type="button" className="quiet" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
