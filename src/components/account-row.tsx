import { ChevronDownIcon } from './icons'
import { holdsFiles } from '../domain/database'
import { useEffect, useState, type FormEvent } from 'react'
import { AccountItem } from './account-item'
import { useNavigate } from '@tanstack/react-router'
import { getAccount } from '../server/functions'
import { saveKeptDrafts } from './draft-recovery'
import { flushAllEditors, openEditorPages } from './editor-flush'
import { useWorkspace } from './use-day'
import { Reminders } from './reminders'
import { HomeScreenHint } from './home-screen-hint'
import { clearOfflineData } from './offline-copy'

type Account = { email: string | null; timezone: string | null; timezones: string[] }
export type ExportState = 'idle' | 'busy' | 'failed' | 'unsaved'

/**
 * The account's facts and actions, shared by the phone's account row (below) and the laptop sidebar's account menu
 * (`sidebar-account.tsx`). Sign out asks nothing; drafts stay on the device. With sign-in off there's no email, and
 * the actions are Templates, the week start and Export. Shot 2: the time zone is the account's, picked here; Delete
 * account asks for the password and removes everything.
 */
export function useAccount() {
  const { refresh, run, workspace } = useWorkspace()
  const [account, setAccount] = useState<Account | null>(null)
  const [exporting, setExporting] = useState<ExportState>('idle')
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { void getAccount().then(setAccount).catch(() => undefined) }, [])
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined)
    await clearOfflineData()
    window.location.assign('/sign-in')
  }
  async function pickZone(timezone: string) {
    if (!account || timezone === account.timezone) return
    const before = account
    setAccount({ ...account, timezone })
    if (!(await run({ type: 'set-timezone', timezone }, { text: `Time zone: ${timezone.replace(/_/g, ' ')}` }))) setAccount(before)
  }
  // R3-20: moves the date pickers and database views together.
  function pickWeekStart(weekStart: 0 | 1) { void run({ type: 'set-week-start', weekStart }, r => ({ text: r.message })) }
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
  // The account's zone leads when the list doesn't hold it, so the select always shows the current one.
  const zones = account?.timezone ? (account.timezones.includes(account.timezone) ? account.timezones : [account.timezone, ...account.timezones]) : []
  const weekStart = (workspace?.weekStart ?? 0) as 0 | 1
  return { account, workspace, exporting, exportAll, signOut, pickZone, zones, weekStart, pickWeekStart, deleting, setDeleting }
}

/**
 * "{email} · {time zone} · Export · Sign out · Delete account" in --ink-3 (empty-start-states.md §2, Jazz f10f8de5):
 * the end of the Pages list on the phone. The laptop sidebar holds the same actions in its account menu.
 */
export function AccountRow({ className }: { className: string }) {
  const { account, workspace, exporting, exportAll, signOut, pickZone, zones, weekStart, pickWeekStart, deleting, setDeleting } = useAccount()
  const navigate = useNavigate()
  if (!account) return null
  const email = account.email
  const retry = <button type="button" className="link retry" onClick={() => void exportAll()}>Try again</button>
  // A failure and its retry are two items, so the row's own "·" sits between them and either can start a line.
  const exportItems = exporting === 'failed' ? <><AccountItem><span className="account-text">Couldn’t export</span></AccountItem><AccountItem>{retry}</AccountItem></>
    : exporting === 'unsaved' ? <><AccountItem><span className="account-text">Not exported · latest text not saved yet</span></AccountItem><AccountItem>{retry}</AccountItem></>
    : <AccountItem><button type="button" className="link" disabled={exporting === 'busy'} onClick={() => void exportAll()}>{exporting === 'busy' ? 'Exporting…' : 'Export'}</button></AccountItem>
  return (
    <div className={`account-row ${className}`}>
      <p><span className="account-items">
        {email && <AccountItem><span className="account-text account-email">{email}</span></AccountItem>}
        {email && account.timezone && (
          <AccountItem>
            <span className="account-select">
              <span className="account-select-text">{account.timezone.replace(/_/g, ' ')}<ChevronDownIcon /></span>
              <select className="account-zone" aria-label="Time zone" value={account.timezone} onChange={e => void pickZone(e.target.value)}>
                {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
              </select>
            </span>
          </AccountItem>
        )}
        {workspace && (
          <AccountItem>
            <span className="account-select">
              <span className="account-select-text">Week starts {weekStart === 1 ? 'Monday' : 'Sunday'}<ChevronDownIcon /></span>
            <select className="account-zone" aria-label="Week starts on" value={weekStart} onChange={e => pickWeekStart(Number(e.target.value) as 0 | 1)}>
              <option value={0}>Week starts Sunday</option><option value={1}>Week starts Monday</option>
            </select>
            </span>
          </AccountItem>
        )}
        {/* B70: Templates, between the time zone and Export (templates-states §1). */}
        <AccountItem><button type="button" className="link" onClick={() => void navigate({ to: '/pages', search: { view: 'templates' } })}>Templates</button></AccountItem>
        {exportItems}
        <Reminders />
        <HomeScreenHint />
        {email && <AccountItem><button type="button" className="link" onClick={() => void signOut()}>Sign out</button></AccountItem>}
        {email && !deleting && <AccountItem><button type="button" className="link" onClick={() => setDeleting(true)}>Delete account</button></AccountItem>}
      </span></p>
      {email && deleting && <DeleteAccount onCancel={() => setDeleting(false)} filesGo={Boolean(workspace && holdsFiles(workspace))} />}
    </div>
  )
}

/** The password again, then everything goes: pages, tasks, sessions. Export first is the way to keep a copy. */
export function DeleteAccount({ onCancel, filesGo }: { onCancel: () => void; filesGo: boolean }) {
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
    if (r.ok) { await clearOfflineData(); return window.location.assign('/sign-in') }
    setBusy(false)
    setError(r.error === 'wrong' ? "That didn't work · Check the password" : r.error === 'too-many' ? `Too many tries · Try again in ${Math.ceil((r.retryAfter ?? 60) / 60)} min` : "Couldn't delete the account · Try again")
  }
  return (
    <form className="account-delete" onSubmit={submit}>
      <p>Delete the account and everything in it? Export first to keep a copy.{filesGo && ' Your files aren\'t in the export, so download any you want to keep: they go for good.'} Type the password to confirm.</p>
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
