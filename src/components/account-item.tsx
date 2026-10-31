import type { ReactNode } from 'react'

/**
 * One item of the account row. Its "·" comes before it, drawn by CSS inside the same nowrap box, and the row clips the
 * one that lands at the start of a line (styles.css `.account-items`). So a "·" only ever sits between two items on the
 * same line: none ends a line or starts one (Lead ebd5ee52, Brian 1ac6784b). Longer text inside an item goes in
 * `.account-text`, which wraps. An item that renders nothing leaves no box, so it never leaves a stray "·".
 */
export function AccountItem({ children }: { children: ReactNode }) {
  return <><span className="account-item">{children}</span>{' '}</>
}
