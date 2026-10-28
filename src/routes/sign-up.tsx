import { Button, Input, Label, TextField } from '@heroui/react'
import { Mark } from '../components/mark'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { NoteLine, sendConfirmationAgain, tagline, type Note } from './sign-in'
import { enterApp } from '../components/offline-copy'

export const Route = createFileRoute('/sign-up')({ component: SignUp })

/** The browser's zone, for the new workspace; the server falls back to UTC when it is not one it knows. */
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } }

/**
 * Sign-up (shot 2): email and password, one line for every refusal. The invite list is the server's: an address not
 * on it is told so and nothing is created. With email confirmation on, the next step is the link Supabase sent.
 */
function SignUp() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // The sign-up wait's second line: "Didn't get it? Check spam, or send it again", then how the re-send went.
  const [again, setAgain] = useState<Note | null>(null)
  const [done, setDone] = useState(false)
  const passwordInput = useRef<HTMLInputElement>(null)

  async function signUp(event: FormEvent) {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true); setError(null); setNote(null)
    let r: { ok?: boolean; confirm?: boolean; error?: string; message?: string; retryAfter?: number }
    try {
      const response = await fetch('/api/auth/sign-up', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, timezone: browserZone() }) })
      r = await response.json().catch(() => ({ error: 'unavailable' }))
    } catch { r = { error: 'unavailable' } }
    if (r.ok && !r.confirm) return enterApp('/')
    setBusy(false)
    if (r.ok) { setDone(true); setAgain(offerAgain()); return setNote(`Check your email · we sent a link to ${email.trim()}. It signs you in.`) }
    if (r.error === 'not-invited') return setNote("This address isn't on the invite list yet")
    if (r.error === 'exists') return setNote('There is already an account for this address · Sign in instead')
    if (r.error === 'too-many') return setError(`Too many tries · Try again in ${Math.ceil((r.retryAfter ?? 60) / 60)} min`)
    if (r.error === 'weak') { setError(r.message ?? 'Use a longer password'); setPassword(''); return requestAnimationFrame(() => passwordInput.current?.focus()) }
    if (r.error === 'invalid') return setError('Check the email address')
    setError("Couldn't create the account · Try again")
  }

  const offerAgain = (): Note => ({ text: "Didn't get it? Check spam, or", joiner: ' ', action: { label: 'send it again', run: () => void sendAgain() } })
  async function sendAgain() {
    if (busy) return
    setBusy(true); setError(null)
    const r = await sendConfirmationAgain(email, () => void sendAgain())
    setBusy(false)
    setAgain(r.note ?? offerAgain()); setError(r.error ?? null)
  }

  return (
    <main className="sign-in sign-up">
      <p className="sign-in-brand"><Mark size={18} />Daythread</p>
      <form onSubmit={signUp}>
        <h1>Create an account</h1>
        <p className="sign-in-sub">{tagline}</p>
        <TextField type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={setEmail} isReadOnly={busy || done} autoFocus fullWidth>
          <Label>Email</Label>
          <Input />
        </TextField>
        <TextField type={shown ? 'text' : 'password'} name="password" autoComplete="new-password" value={password} onChange={setPassword} isReadOnly={busy || done} fullWidth>
          <Label>Password</Label>
          <div className="sign-in-password">
            <Input ref={passwordInput} />
            <button type="button" className="link sign-in-show" onClick={() => setShown(s => !s)} aria-pressed={shown}>{shown ? 'Hide' : 'Show'}</button>
          </div>
          <p className="sign-in-hint">At least 6 characters.</p>
        </TextField>
        {!done && <Button type="submit" className="sign-in-submit" variant="primary" fullWidth isPending={busy} isDisabled={!email.trim() || !password}>Create account</Button>}
        {error && <p className="sign-in-error" role="alert">{error}</p>}
        {note && <p className="sign-in-note" role="status">{note}</p>}
        {done && again && <NoteLine note={again} className="sign-in-hint sign-in-again" />}
        <p className="sign-in-meta">Have an account? <Link to="/sign-in" search={{ next: undefined }} className="link">Sign in</Link></p>
      </form>
    </main>
  )
}
