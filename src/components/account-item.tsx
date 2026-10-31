import type { ReactNode } from 'react'

/**
 * One item of the account row with its "·" after it, kept on the same line (Lead b77446cf): a browser may break between
 * a button and the text after it, so the item and its separator share one nowrap box, and the line breaks only at the
 * space after the "·". Longer text inside an item goes in `.account-text`, which wraps. The last item drops its separator; an item that renders
 * nothing leaves no box, so it never leaves a stray "·".
 */
export function AccountItem({ children }: { children: ReactNode }) {
  return <><span className="account-item"><span>{children}</span><span className="account-sep" aria-hidden="true">{' ·'}</span></span>{' '}</>
}
