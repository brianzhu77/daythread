import { useEffect, useState } from 'react'
import { getAccount } from '../server/functions'

/**
 * "{email} · Export · Sign out" in --ink-3 (empty-start-states.md §2, Jazz f10f8de5): the sidebar's last row on
 * desktop, the end of the Pages list on the phone. Sign out asks nothing; drafts stay on the device. With sign-in off
 * there's no email, and the row is just "Export".
 */
export function AccountRow({ className }: { className: string }) {
  const [account, setAccount] = useState<{ email: string | null } | null>(null)
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'failed'>('idle')
  useEffect(() => { void getAccount().then(setAccount).catch(() => undefined) }, [])
  if (!account) return null
  const email = account.email
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/sign-in')
  }
  // The browser's own download is the feedback; only a failure says anything (Jazz).
  async function exportAll() {
    if (exporting === 'busy') return
    setExporting('busy')
    try {
      const response = await fetch('/api/export', { cache: 'no-store' })
      if (!response.ok) throw new Error(`export ${response.status}`)
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'daythread-export.zip'
      const url = URL.createObjectURL(await response.blob())
      const a = document.createElement('a')
      a.href = url; a.download = name; document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setExporting('idle')
    } catch {
      setExporting('failed')
    }
  }
  const exportLink = exporting === 'failed'
    ? <>Couldn’t export · <button type="button" className="link retry" onClick={() => void exportAll()}>Try again</button></>
    : <button type="button" className="link" disabled={exporting === 'busy'} onClick={() => void exportAll()}>{exporting === 'busy' ? 'Exporting…' : 'Export'}</button>
  return (
    <p className={`account-row ${className}`}>
      {email && <>{email} · </>}{exportLink}{email && <> · <button type="button" className="link" onClick={() => void signOut()}>Sign out</button></>}
    </p>
  )
}
