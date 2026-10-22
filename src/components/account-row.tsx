import { useEffect, useState } from 'react'
import { getAccount } from '../server/functions'

/**
 * "{email} · Sign out" in --ink-3 (empty-start-states.md §2): the sidebar's last row on desktop, the end of the Pages
 * list on the phone. Sign out asks nothing; drafts stay on the device.
 */
export function AccountRow({ className }: { className: string }) {
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => { void getAccount().then(a => setEmail(a.email)).catch(() => undefined) }, [])
  if (!email) return null
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/sign-in')
  }
  return (
    <p className={`account-row ${className}`}>
      {email} · <button type="button" className="link" onClick={() => void signOut()}>Sign out</button>
    </p>
  )
}
