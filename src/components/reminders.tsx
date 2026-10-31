import { useEffect, useState } from 'react'
import { AccountItem } from './account-item'

/**
 * Reminders over web push (docs/design/reminders.md), one control in the account row: "Turn on reminders" asks the
 * browser, subscribes and tells the server; "Reminders on · Turn off" undoes it. Shown only when the server has keys.
 * On an iPhone, Safari has no push outside the Home Screen app, so the row says that instead.
 */
type State = 'loading' | 'hidden' | 'home-screen' | 'off' | 'on' | 'denied' | 'busy' | 'failed'

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const iphoneBrowser = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js')
}

export function Reminders() {
  const [state, setState] = useState<State>('loading')
  const [publicKey, setPublicKey] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    void (async () => {
      try {
        const r = await fetch('/api/push/key', { cache: 'no-store' })
        const { publicKey } = (await r.json()) as { publicKey: string | null }
        if (gone) return
        if (!publicKey) return setState('hidden')
        setPublicKey(publicKey)
        if (!supported()) return setState(iphoneBrowser() ? 'home-screen' : 'hidden')
        const reg = await navigator.serviceWorker.getRegistration('/')
        const sub = await reg?.pushManager.getSubscription()
        if (gone) return
        setState(sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off')
      } catch { if (!gone) setState('hidden') }
    })()
    return () => { gone = true }
  }, [])

  async function turnOn() {
    if (!publicKey) return
    setState('busy')
    let sub: PushSubscription | null = null
    try {
      const reg = await registration()
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied')
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource })
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
      if (!r.ok) throw new Error(`subscribe ${r.status}`)
      setState('on')
    } catch {
      await sub?.unsubscribe().catch(() => undefined)
      setState('failed')
    }
  }
  async function turnOff() {
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined)
        await sub.unsubscribe()
      }
    } catch { /* the browser side is what matters; the server drops a dead endpoint on its own */ }
    setState('off')
  }

  if (state === 'loading' || state === 'hidden') return null
  const on = <button type="button" className="link" onClick={() => void turnOn()}>Turn on reminders</button>
  return (
    // A message and its action are two items, so the row's own "·" sits between them and either can start a line.
    <>
      {state === 'home-screen' && <AccountItem><span className="account-text">Reminders: add Daythread to the Home Screen first</span></AccountItem>}
      {state === 'off' && <AccountItem>{on}</AccountItem>}
      {state === 'busy' && <AccountItem>Reminders…</AccountItem>}
      {state === 'denied' && <AccountItem><span className="account-text">Reminders blocked in the browser’s settings</span></AccountItem>}
      {state === 'failed' && <><AccountItem><span className="account-text">Couldn’t turn on reminders</span></AccountItem><AccountItem>{on}</AccountItem></>}
      {state === 'on' && <><AccountItem><span className="account-text">Reminders on</span></AccountItem><AccountItem><button type="button" className="link" onClick={() => void turnOff()}>Turn off</button></AccountItem></>}
    </>
  )
}
