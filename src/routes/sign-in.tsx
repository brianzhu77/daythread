import { createFileRoute } from '@tanstack/react-router'
import { Button, InputOTP, Input, Label, REGEXP_ONLY_DIGITS, TextField } from '@heroui/react'
import { useEffect, useState, type FormEvent } from 'react'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({ next: typeof search.next === 'string' ? search.next : undefined }),
  component: SignIn,
})

/** Matches Supabase's per-address cooldown, so Resend really sends; change both together (Roadbuster 96638974). */
const resendAfterMs = 60_000
/** Only a path on this site, never another origin. */
const safeNext = (next: string | undefined) => next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/sign-in') ? next : '/'

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return await response.json().catch(() => ({ ok: false, error: 'unavailable' }))
  } catch { return { ok: false, error: 'unavailable' } }
}

/**
 * empty-start-states.md §2: one screen, email then code. Every address gets the same "Sent to {email}" step, so the
 * screen never tells which address owns the workspace.
 */
function SignIn() {
  const { next } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [sentAt, setSentAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (step !== 'code') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step])

  async function send(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true); setError(null)
    const r = await post('/api/auth/send', { email })
    setBusy(false)
    if (r.error === 'invalid-email') return setError('Enter an email address')
    if (!r.ok) return setError("Couldn't send a code · Try again")
    setStep('code'); setCode(''); setSentAt(Date.now()); setNow(Date.now())
  }
  async function verify(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    const r = await post('/api/auth/verify', { email, code })
    if (r.ok) return window.location.assign(safeNext(next))
    setBusy(false)
    setError(r.error === 'unavailable' ? "Couldn't sign in · Try again" : "That code didn't work · Send a new code")
  }

  const wrongCode = error === "That code didn't work · Send a new code"
  return (
    <main className="sign-in">
      <p className="sign-in-brand">Daythread</p>
      {step === 'email' ? (
        <form onSubmit={send}>
          <h1>Sign in</h1>
          <TextField type="email" autoComplete="email" inputMode="email" isRequired value={email} onChange={setEmail} autoFocus fullWidth>
            <Label>Email</Label>
            <Input />
          </TextField>
          {error && <p className="sign-in-error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" fullWidth isPending={busy} isDisabled={!email.trim()}>Send code</Button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <h1>Enter the 6-digit code</h1>
          <p className="sign-in-meta sign-in-address">Sent to {email.trim()}</p>
          <InputOTP maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={code} onChange={setCode} isInvalid={wrongCode} autoFocus aria-label="Code" autoComplete="one-time-code">
            <InputOTP.Group>
              {[0, 1, 2, 3, 4, 5].map(i => <InputOTP.Slot key={i} index={i} />)}
            </InputOTP.Group>
          </InputOTP>
          {error && <p className="sign-in-meta sign-in-error" role="alert">{wrongCode
            ? <>That code didn't work · <button type="button" className="link" onClick={() => void send()}>Send a new code</button></>
            : error}</p>}
          <Button type="submit" variant="primary" fullWidth isPending={busy} isDisabled={code.length !== 6}>Sign in</Button>
          {now - sentAt >= resendAfterMs && (
            <p className="sign-in-meta">No code? · <button type="button" className="link" onClick={() => { setStep('email'); setError(null) }}>Use a different email</button> · <button type="button" className="link" onClick={() => void send()}>Resend</button></p>
          )}
        </form>
      )}
    </main>
  )
}
