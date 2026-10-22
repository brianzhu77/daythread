import { createFileRoute } from '@tanstack/react-router'
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

  return (
    <main className="sign-in">
      <h1>Daythread</h1>
      {step === 'email' ? (
        <form onSubmit={send}>
          <label htmlFor="sign-in-email">Email</label>
          <input id="sign-in-email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={e => setEmail(e.target.value)} autoFocus />
          {error && <p className="sign-in-error" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !email.trim()}>Send code</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p>Enter the 6-digit code we sent to</p>
          <p className="sign-in-address">Sent to {email.trim()}</p>
          <label htmlFor="sign-in-code">Code</label>
          <input id="sign-in-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          {error && <p className="sign-in-error" role="alert">{error === "That code didn't work · Send a new code"
            ? <>That code didn't work · <button type="button" className="link" onClick={() => void send()}>Send a new code</button></>
            : error}</p>}
          <button type="submit" disabled={busy || code.length !== 6}>Sign in</button>
          {now - sentAt >= resendAfterMs && (
            <p className="sign-in-help">No code? · <button type="button" className="link" onClick={() => { setStep('email'); setError(null) }}>Use a different email</button> · <button type="button" className="link" onClick={() => void send()}>Resend</button></p>
          )}
        </form>
      )}
    </main>
  )
}
