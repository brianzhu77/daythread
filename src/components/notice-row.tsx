import type { ReactNode } from 'react'

/**
 * A notice's second row (B100, Jazz 7fd3eaa9): a short label and small buttons across the notice's full width, under
 * its line of text, Undo and ✕. When the label and buttons don't fit on one line (Move 3 to-dos to, at 390), the
 * buttons go under the label as a group, their text lined up with it. Pass it as the toast's `description`; the app's notice (app-shell.tsx) puts it there.
 */
export function NoticeRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="toast-row" role="group" aria-label={label}><span className="toast-row-label" aria-hidden="true">{label}</span><span className="toast-row-buttons">{children}</span></div>
}
