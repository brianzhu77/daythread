import { Button, Input, Label, TextField } from '@heroui/react'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { safeNext } from '../lib/safe-next'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({ next: typeof search.next === 'string' ? search.next : undefined }),
  component: SignIn,
})

/** "in 4 min", or "in 30 s" under a minute, rounded up (Jazz 235e692). */
const inWait = (seconds: number) => seconds < 60 ? `in ${Math.max(1, Math.ceil(seconds))} s` : `in ${Math.ceil(seconds / 60)} min`

/**
 * empty-start-states.md §2, "Sign-in with a password": email and password with the autocomplete values that let
 * iOS and macOS offer the saved password, one line for every refusal, no "Forgot password?".
 */
function SignIn() {
  const { next } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notLinked, setNotLinked] = useState(false)
  const passwordInput = useRef<HTMLInputElement>(null)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (busy || !email.trim() || !password) return
    setBusy(true); setError(null); setNotLinked(false)
    let r: { ok?: boolean; error?: string; retryAfter?: number }
    try {
      const response = await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
      r = await response.json().catch(() => ({ error: 'unavailable' }))
    } catch { r = { error: 'unavailable' } }
    if (r.ok) return window.location.assign(safeNext(next, window.location.origin))
    setBusy(false)
    if (r.error === 'too-many') return setError(`Too many tries · Try again ${inWait(r.retryAfter ?? 60)}`)
    // Only after the right password, so it says nothing to anyone else; not red, he typed everything right (Jazz ac124ed).
    if (r.error === 'not-linked') return setNotLinked(true)
    if (r.error !== 'wrong') return setError("Couldn't sign in · Try again")
    setError("That didn't work · Check the email and password")
    // The email stays; the password empties and gets the caret.
    setPassword('')
    requestAnimationFrame(() => passwordInput.current?.focus())
  }

  return (
    <main className="sign-in">
      <p className="sign-in-brand">Daythread</p>
      <form onSubmit={signIn}>
        <h1>Sign in</h1>
        <TextField type="email" name="email" autoComplete="username" inputMode="email" value={email} onChange={setEmail} isReadOnly={busy} autoFocus fullWidth>
          <Label>Email</Label>
          <Input />
        </TextField>
        <TextField type={shown ? 'text' : 'password'} name="password" autoComplete="current-password" value={password} onChange={setPassword} isReadOnly={busy} fullWidth>
          <Label>Password</Label>
          <div className="sign-in-password">
            <Input ref={passwordInput} />
            <button type="button" className="link sign-in-show" onClick={() => setShown(s => !s)} aria-pressed={shown}>{shown ? 'Hide' : 'Show'}</button>
          </div>
        </TextField>
        {error && <p className="sign-in-error" role="alert">{error}</p>}
        {notLinked && <p className="sign-in-note" role="status">Your account isn't linked to this workspace · Your notes are safe</p>}
        <Button type="submit" variant="primary" fullWidth isPending={busy} isDisabled={!email.trim() || !password}>Sign in</Button>
      </form>
    </main>
  )
}
