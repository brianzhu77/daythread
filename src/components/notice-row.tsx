import type { ReactNode } from 'react'

/**
 * A notice's second row (B100, Jazz 7fd3eaa9): a short label and small buttons across the notice's full width, under
 * its line of text, Undo and ✕. Pass it as the toast's `description`; the app's notice (app-shell.tsx) puts it there.
 */
export function NoticeRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="toast-row" role="group" aria-label={label}><span className="toast-row-label" aria-hidden="true">{label}</span>{children}</div>
}
