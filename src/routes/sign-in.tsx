import { Button, Input, Label, TextField } from '@heroui/react'
import { Mark } from '../components/mark'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { safeNext } from '../lib/safe-next'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({ next: typeof search.next === 'string' ? search.next : undefined }),
  component: SignIn,
})

/** The browser's zone, for a first sign-in's workspace; the server falls back to UTC when it is not one it knows. */
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } }

/** One line on what Daythread is, under the title of the sign-in and sign-up screens. */
export const tagline = 'A page for each day, with the to-dos that carry over.'

/** "in 4 min", or "in 30 s" under a minute, rounded up (Jazz 235e692). */
const inWait = (seconds: number) => seconds < 60 ? `in ${Math.max(1, Math.ceil(seconds))} s` : `in ${Math.ceil(seconds / 60)} min`

/** What Supabase's emailed links put in the fragment when they land on the Site URL: a token and what it is for. */
function linkToken(): { accessToken: string; type: string } | null {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '')
  const params = new URLSearchParams(hash), accessToken = params.get('access_token'), type = params.get('type')
  return accessToken && type ? { accessToken, type } : null
}
const post = async (path: string, body: unknown): Promise<{ ok?: boolean; error?: string; message?: string; retryAfter?: number }> => {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return await response.json().catch(() => ({ error: 'unavailable' }))
  } catch { return { error: 'unavailable' } }
}

/**
 * empty-start-states.md §2, "Sign-in with a password": email and password with the autocomplete values that let
 * iOS and macOS offer the saved password, one line for every refusal. "Forgot password?" asks for the address and
 * says the same thing whatever it is. A recovery link lands here with its token in the fragment and turns the form
 * into "Choose a new password"; a confirmation link signs the person in on the spot.
 */
function SignIn() {
  const { next } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [mode, setMode] = useState<'sign-in' | 'forgot' | 'reset' | 'confirming'>('sign-in')
  const [token, setToken] = useState<string | null>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const link = linkToken()
    if (!link) return
    // The token is for this one visit: it leaves the address bar so a reload or a shared link doesn't carry it.
    history.replaceState(null, '', window.location.pathname + window.location.search)
    if (link.type === 'recovery') { setToken(link.accessToken); setMode('reset'); return }
    if (link.type === 'signup' || link.type === 'magiclink' || link.type === 'email') {
      setMode('confirming'); setBusy(true)
      void post('/api/auth/confirm', { accessToken: link.accessToken, timezone: browserZone() }).then(r => {
        if (r.ok) return window.location.assign('/')
        setBusy(false); setMode('sign-in')
        setNote(r.error === 'not-invited' ? "This address isn't on the invite list yet" : r.error === 'expired' ? 'That link has expired · Sign in, or ask for a new one' : "Couldn't confirm the address · Sign in to try again")
      })
    }
  }, [])

  async function forgot(event: FormEvent) {
    event.preventDefault()
    if (busy || !email.trim()) return
    setBusy(true); setError(null); setNote(null)
    const r = await post('/api/auth/recover', { email })
    setBusy(false)
    if (r.error === 'too-many') return setError(`Too many tries · Try again ${inWait(r.retryAfter ?? 60)}`)
    if (r.error === 'invalid') return setError('Check the email address')
    if (!r.ok) return setError("Couldn't send the email · Try again")
    setMode('sign-in')
    setNote(`If ${email.trim()} has an account, an email with a link is on its way`)
  }

  async function reset(event: FormEvent) {
    event.preventDefault()
    if (busy || !password || !token) return
    setBusy(true); setError(null); setNote(null)
    const r = await post('/api/auth/reset-password', { accessToken: token, password, timezone: browserZone() })
    if (r.ok) return window.location.assign('/')
    setBusy(false)
    if (r.error === 'weak') { setError(r.message ?? 'Use a longer password'); return }
    if (r.error === 'expired') { setMode('sign-in'); setToken(null); return setNote('That link has expired · Ask for a new one with Forgot password') }
    if (r.error === 'not-invited') { setMode('sign-in'); return setNote("Password saved · this address isn't on the invite list yet") }
    if (r.error === 'too-many') return setError(`Too many tries · Try again ${inWait(r.retryAfter ?? 60)}`)
    setError("Couldn't save the password · Try again")
  }

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true); setError(null); setNote(null)
    let r: { ok?: boolean; error?: string; retryAfter?: number }
    try {
      const response = await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, timezone: browserZone() }) })
      r = await response.json().catch(() => ({ error: 'unavailable' }))
    } catch { r = { error: 'unavailable' } }
    if (r.ok) return window.location.assign(safeNext(next, window.location.origin))
    setBusy(false)
    if (r.error === 'too-many') return setError(`Too many tries · Try again ${inWait(r.retryAfter ?? 60)}`)
    // Only after the right password, so they say nothing to anyone else; not red, everything was typed right (Jazz ac124ed).
    if (r.error === 'not-invited') return setNote("This address isn't on the invite list yet")
    if (r.error === 'unconfirmed') return setNote('Confirm your email first · the link is in your inbox')
    if (r.error !== 'wrong') return setError("Couldn't sign in · Try again")
    setError("That didn't work · Check the email and password")
    // The email stays; the password empties and gets the caret.
    setPassword('')
    requestAnimationFrame(() => passwordInput.current?.focus())
  }

  if (mode === 'forgot') return (
    <main className="sign-in sign-in-forgot">
      <p className="sign-in-brand"><Mark size={18} />Daythread</p>
      <form onSubmit={forgot}>
        <h1>Forgot password</h1>
        <p className="sign-in-sub">Type the address and we'll email a link to choose a new one.</p>
        <TextField type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={setEmail} isReadOnly={busy} autoFocus fullWidth>
          <Label>Email</Label>
          <Input />
        </TextField>
        <Button type="submit" className="sign-in-submit" variant="primary" fullWidth isPending={busy} isDisabled={!email.trim()}>Email me a link</Button>
        {error && <p className="sign-in-error" role="alert">{error}</p>}
        <p className="sign-in-meta"><button type="button" className="link" onClick={() => { setMode('sign-in'); setError(null) }}>Back to sign in</button></p>
      </form>
    </main>
  )
  if (mode === 'reset') return (
    <main className="sign-in sign-in-reset">
      <p className="sign-in-brand"><Mark size={18} />Daythread</p>
      <form onSubmit={reset}>
        <h1>Choose a new password</h1>
        <p className="sign-in-sub">{email ? `For ${email}. ` : ''}You'll be signed in once it's saved.</p>
        <TextField type={shown ? 'text' : 'password'} name="password" autoComplete="new-password" value={password} onChange={setPassword} isReadOnly={busy} autoFocus fullWidth>
          <Label>New password</Label>
          <div className="sign-in-password">
            <Input ref={passwordInput} />
            <button type="button" className="link sign-in-show" onClick={() => setShown(s => !s)} aria-pressed={shown}>{shown ? 'Hide' : 'Show'}</button>
          </div>
        </TextField>
        <Button type="submit" className="sign-in-submit" variant="primary" fullWidth isPending={busy} isDisabled={!password}>Save and sign in</Button>
        {error && <p className="sign-in-error" role="alert">{error}</p>}
      </form>
    </main>
  )
  return (
    <main className="sign-in">
      <p className="sign-in-brand"><Mark size={18} />Daythread</p>
      <form onSubmit={signIn}>
        <h1>{mode === 'confirming' ? 'Confirming your email…' : 'Sign in'}</h1>
        <p className="sign-in-sub">{tagline}</p>
        <TextField type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={setEmail} isReadOnly={busy} autoFocus fullWidth>
          <Label>Email</Label>
          <Input />
        </TextField>
        <TextField type={shown ? 'text' : 'password'} name="password" autoComplete="current-password" value={password} onChange={setPassword} isReadOnly={busy} fullWidth>
          <div className="sign-in-label-row">
            <Label>Password</Label>
            <button type="button" className="link" onClick={() => { setMode('forgot'); setError(null); setNote(null) }}>Forgot password?</button>
          </div>
          <div className="sign-in-password">
            <Input ref={passwordInput} />
            <button type="button" className="link sign-in-show" onClick={() => setShown(s => !s)} aria-pressed={shown}>{shown ? 'Hide' : 'Show'}</button>
          </div>
        </TextField>
        {/* Messages sit under the button, so the button never moves when one appears (Brian, Oct 26: it felt jumpy). */}
        <Button type="submit" className="sign-in-submit" variant="primary" fullWidth isPending={busy} isDisabled={!email.trim() || !password}>Sign in</Button>
        {error && <p className="sign-in-error" role="alert">{error}</p>}
        {note && <p className="sign-in-note" role="status">{note}</p>}
        <p className="sign-in-meta">New here? <Link to="/sign-up" className="link">Create an account</Link></p>
      </form>
    </main>
  )
}
