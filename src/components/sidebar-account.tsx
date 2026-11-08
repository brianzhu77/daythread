import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDownIcon } from './icons'
import { DeleteAccount, useAccount } from './account-row'
import { useReminders } from './reminders'
import { holdsFiles } from '../domain/database'

/**
 * The sidebar's last row (Brian, Nov 8): the address, or "Account" with sign-in off, with a chevron. It
 * opens a menu above it holding what the account row used to spell out as links: Templates, Export, reminders, the
 * time zone, the week start, Sign out and Delete account. Delete account asks for the password under the row.
 */
export function SidebarAccount() {
  const { account, workspace, exporting, exportAll, signOut, pickZone, zones, weekStart, pickWeekStart, deleting, setDeleting } = useAccount()
  const reminders = useReminders()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    // The menu-button pattern: focus moves into the menu, so ↑↓ and Enter work from the keyboard.
    ref.current?.querySelector<HTMLElement>('[role^=menuitem]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!account) return null
  const email = account.email
  const pick = (f: () => void) => { setOpen(false); f() }
  const item = (label: string, onSelect: () => void, extra: { danger?: boolean; disabled?: boolean } = {}) => (
    <button type="button" role="menuitem" className={extra.danger ? 'danger' : undefined} disabled={extra.disabled} onClick={() => pick(onSelect)}>{label}</button>
  )
  const note = (text: string) => <p className="menu-note">{text}</p>
  const exportLabel = exporting === 'busy' ? 'Exporting…' : exporting === 'idle' ? 'Export' : 'Try again'
  const remindersShown = reminders.state !== 'loading' && reminders.state !== 'hidden'

  return (
    <div className="side-account" ref={ref}>
      <button type="button" className="side-row side-account-row" aria-label={email ? `Account, ${email}` : 'Account'} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        <span className="side-account-text">{email ?? 'Account'}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="app-menu side-account-menu" role="menu" id={id} onKeyDown={e => {
          // A focused select keeps its arrows: they change its value.
          if ((document.activeElement as HTMLElement | null)?.tagName === 'SELECT') return
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^=menuitem], select')]
          const at = items.indexOf(document.activeElement as HTMLElement)
          const to = e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
          if (to < 0) return
          e.preventDefault(); items[to]?.focus()
        }}>
          <div className="menu-group" role="group">
            {/* B70: Templates, then Export (templates-states §1). */}
            {item('Templates', () => void navigate({ to: '/pages', search: { view: 'templates' } }))}
            {exporting === 'failed' && note('Couldn’t export')}
            {exporting === 'unsaved' && note('Not exported · latest text not saved yet')}
            {item(exportLabel, () => void exportAll(), { disabled: exporting === 'busy' })}
          </div>
          {remindersShown && (
            <div className="menu-group" role="group">
              {reminders.state === 'off' && item('Turn on reminders', () => void reminders.turnOn())}
              {reminders.state === 'busy' && note('Reminders…')}
              {reminders.state === 'on' && <>{note('Reminders on')}{item('Turn off reminders', () => void reminders.turnOff())}</>}
              {reminders.state === 'denied' && note('Reminders blocked in the browser’s settings')}
              {reminders.state === 'failed' && <>{note('Couldn’t turn on reminders')}{item('Try again', () => void reminders.turnOn())}</>}
              {reminders.state === 'home-screen' && note('Reminders: add Daythread to the Home Screen first')}
            </div>
          )}
          <div className="menu-group" role="group">
            {email && account.timezone && (
              <label className="menu-pick">
                <span>Time zone</span>
                <span className="menu-pick-value">{account.timezone.replace(/_/g, ' ')}</span>
                <select aria-label="Time zone" value={account.timezone} onChange={e => { const zone = e.target.value; setOpen(false); void pickZone(zone) }}>
                  {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                </select>
              </label>
            )}
            {workspace && (
              <label className="menu-pick">
                <span>Week starts</span>
                <span className="menu-pick-value">{weekStart === 1 ? 'Monday' : 'Sunday'}</span>
                <select aria-label="Week starts on" value={weekStart} onChange={e => { const v = Number(e.target.value) as 0 | 1; setOpen(false); pickWeekStart(v) }}>
                  <option value={0}>Sunday</option><option value={1}>Monday</option>
                </select>
              </label>
            )}
          </div>
          {email && (
            <div className="menu-group" role="group">
              {item('Sign out', () => void signOut())}
              {item('Delete account…', () => setDeleting(true), { danger: true })}
            </div>
          )}
        </div>
      )}
      {email && deleting && <DeleteAccount onCancel={() => setDeleting(false)} filesGo={Boolean(workspace && holdsFiles(workspace))} />}
    </div>
  )
}
