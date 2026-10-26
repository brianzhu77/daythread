/**
 * The Daythread mark, "three days, one thread" (Brian, Oct 26, variant B of the logo canvas): yesterday, today and
 * tomorrow as three dots on one line, today filled in the app's one blue. Drawn on a 48 px grid; the strokes take
 * the current text colour, so it follows dark mode on its own. Below 24 px use the heavier cut (`small`), the same
 * spacing with a 5 px stroke, as the favicon does. The line is two segments between the dots, so the mark needs no
 * background colour and sits on anything.
 */
export function Mark({ size = 18, small = size < 24, label }: { size?: number; small?: boolean; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return small ? (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" fill="none" {...a11y}>
      <path d="M13 24H19M29 24H35" stroke="currentColor" strokeWidth="5" />
      <circle cx="8" cy="24" r="4.5" stroke="currentColor" strokeWidth="5" />
      <circle cx="40" cy="24" r="4.5" stroke="currentColor" strokeWidth="5" />
      <circle cx="24" cy="24" r="7" fill="var(--blue-9, #0090ff)" />
    </svg>
  ) : (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" fill="none" {...a11y}>
      <path d="M11 24H19M29 24H37" stroke="currentColor" strokeWidth="3" />
      <circle cx="7" cy="24" r="4" stroke="currentColor" strokeWidth="3" />
      <circle cx="41" cy="24" r="4" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="24" r="5.5" fill="var(--blue-9, #0090ff)" />
    </svg>
  )
}
