import { createFileRoute } from '@tanstack/react-router'
import { Button, InputOTP, Input, Label, REGEXP_ONLY_DIGITS, TextField } from '@heroui/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { safeNext } from '../lib/safe-next'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({ next: typeof search.next === 'string' ? search.next : undefined }),
  component: SignIn,
})

/** Matches Supabase's per-address cooldown, so Resend really sends; change both together (Roadbuster 96638974). */
const resendAfterMs = 60_000

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
  const codeInput = useRef<HTMLInputElement>(null)
  // The code last submitted on its own: a complete code submits by itself once, never again in a loop (Bumblebee).
  const autoSubmitted = useRef<string | null>(null)
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
    setStep('code'); setCode(''); setSentAt(Date.now()); setNow(Date.now()); autoSubmitted.current = null
  }
  async function verify(value = code, event?: FormEvent) {
    event?.preventDefault()
    if (busy || value.length !== 6) return
    setBusy(true); setError(null)
    const r = await post('/api/auth/verify', { email, code: value })
    if (r.ok) return window.location.assign(safeNext(next, window.location.origin))
    setBusy(false)
    setError(r.error === 'unavailable' ? "Couldn't sign in · Try again" : "That code didn't work · Send a new code")
    // Ready to type the code again at once (Jazz 7e6b3638): empty boxes, caret in the first.
    setCode('')
    requestAnimationFrame(() => codeInput.current?.focus())
  }
  function typeCode(value: string) {
    setCode(value)
    if (error) setError(null)
  }

  const wrongCode = error === "That code didn't work · Send a new code"
  return (
    <main className="sign-in">
      <p className="sign-in-brand">Daythread</p>
      {step === 'email' ? (
        <form onSubmit={send}>
          <h1>Sign in</h1>
          <TextField type="email" autoComplete="email" inputMode="email" value={email} onChange={setEmail} autoFocus fullWidth>
            <Label>Email</Label>
            <Input />
          </TextField>
          {error && <p className="sign-in-error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" fullWidth isPending={busy} isDisabled={!email.trim()}>Send code</Button>
        </form>
      ) : (
        <form onSubmit={e => void verify(code, e)}>
          <h1>Enter the 6-digit code</h1>
          <p className="sign-in-meta sign-in-address">Sent to {email.trim()}</p>
          <InputOTP ref={codeInput} maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={code} onChange={typeCode} onComplete={(value: string) => { if (autoSubmitted.current === value) return; autoSubmitted.current = value; void verify(value) }} isInvalid={wrongCode} autoFocus aria-label="Code" autoComplete="one-time-code">
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
