import { useEffect, useState, type FormEvent } from 'react'
import { getAccount } from '../server/functions'
import { saveKeptDrafts } from './draft-recovery'
import { flushAllEditors, openEditorPages } from './editor-flush'
import { useWorkspace } from './use-day'

type Account = { email: string | null; timezone: string | null; timezones: string[] }

/**
 * "{email} · {time zone} · Export · Sign out · Delete account" in --ink-3 (empty-start-states.md §2, Jazz f10f8de5):
 * the sidebar's last row on desktop, the end of the Pages list on the phone. Sign out asks nothing; drafts stay on the
 * device. With sign-in off there's no email, and the row is just "Export". Shot 2: the time zone is the account's,
 * picked here; Delete account asks for the password and removes everything.
 */
export function AccountRow({ className }: { className: string }) {
  const { refresh, run } = useWorkspace()
  const [account, setAccount] = useState<Account | null>(null)
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'failed' | 'unsaved'>('idle')
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { void getAccount().then(setAccount).catch(() => undefined) }, [])
  if (!account) return null
  const email = account.email
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/sign-in')
  }
  async function pickZone(timezone: string) {
    if (!account || timezone === account.timezone) return
    const before = account
    setAccount({ ...account, timezone })
    if (!(await run({ type: 'set-timezone', timezone }, { text: `Time zone: ${timezone.replace(/_/g, ' ')}` }))) setAccount(before)
  }
  // The browser's own download is the feedback; only a failure says anything (Jazz).
  async function exportAll() {
    if (exporting === 'busy') return
    setExporting('busy')
    try {
      // What he just typed is part of the export: open editors save first, and an export that can't include it fails
      // rather than quietly leaving it out (Ratchet 8b6615ff), saying first that no zip came (Jazz 8c4c749b).
      // Drafts kept from a failed save (this tab's closed editor or reload, or a tab that's gone) are saved here too, as
      // opening their page would, so Try again works without hunting for the page (Bumblebee option 1, Lead ff82e7c8).
      if (!(await flushAllEditors()) || !(await saveKeptDrafts(refresh, run, openEditorPages()))) { setExporting('unsaved'); return }
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
  const retry = <button type="button" className="link retry" onClick={() => void exportAll()}>Try again</button>
  const exportLink = exporting === 'failed' ? <>Couldn’t export · {retry}</>
    : exporting === 'unsaved' ? <>Not exported · latest text not saved yet · {retry}</>
    : <button type="button" className="link" disabled={exporting === 'busy'} onClick={() => void exportAll()}>{exporting === 'busy' ? 'Exporting…' : 'Export'}</button>
  return (
    <div className={`account-row ${className}`}>
      <p>
        {email && <>{email} · </>}
        {email && account.timezone && (
          <>
            <select className="account-zone" aria-label="Time zone" value={account.timezone} onChange={e => void pickZone(e.target.value)}>
              {(account.timezones.includes(account.timezone) ? account.timezones : [account.timezone, ...account.timezones]).map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
            {' · '}
          </>
        )}
        {exportLink}
        {email && <> · <button type="button" className="link" onClick={() => void signOut()}>Sign out</button></>}
        {email && !deleting && <> · <button type="button" className="link" onClick={() => setDeleting(true)}>Delete account</button></>}
      </p>
      {email && deleting && <DeleteAccount onCancel={() => setDeleting(false)} />}
    </div>
  )
}

/** The password again, then everything goes: pages, tasks, sessions. Export first is the way to keep a copy. */
function DeleteAccount({ onCancel }: { onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !password) return
    setBusy(true); setError(null)
    let r: { ok?: boolean; error?: string; retryAfter?: number }
    try {
      const response = await fetch('/api/auth/delete-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
      r = await response.json().catch(() => ({ error: 'unavailable' }))
    } catch { r = { error: 'unavailable' } }
    if (r.ok) return window.location.assign('/sign-in')
    setBusy(false)
    setError(r.error === 'wrong' ? "That didn't work · Check the password" : r.error === 'too-many' ? `Too many tries · Try again in ${Math.ceil((r.retryAfter ?? 60) / 60)} min` : "Couldn't delete the account · Try again")
  }
  return (
    <form className="account-delete" onSubmit={submit}>
      <p>Delete the account and everything in it? Export first to keep a copy. Type the password to confirm.</p>
      <input type="password" autoComplete="current-password" aria-label="Password" value={password} onChange={e => setPassword(e.target.value)} readOnly={busy} />
      {error && <p className="sign-in-error" role="alert">{error}</p>}
      <p>
        <button type="submit" className="link danger" disabled={busy || !password}>{busy ? 'Deleting…' : 'Delete everything'}</button>
        {' · '}
        <button type="button" className="link" onClick={onCancel} disabled={busy}>Cancel</button>
      </p>
    </form>
  )
}
