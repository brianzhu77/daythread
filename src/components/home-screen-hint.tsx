import { useEffect, useState } from 'react'

/**
 * On an iPhone in Safari, before the app is on the Home Screen (docs/design/pwa.md §4): one line in the account row
 * with the two taps it takes. Never in the installed app; "Got it" keeps it away on this device.
 */
const dismissedKey = 'daythread.home-screen-hint'
const iphoneSafari = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone && !window.matchMedia('(display-mode: standalone)').matches

export function HomeScreenHint({ prefix = '' }: { prefix?: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem(dismissedKey) === '1' } catch { /* no storage: show it */ }
    setShown(!dismissed && iphoneSafari())
  }, [])
  if (!shown) return null
  const dismiss = () => { try { localStorage.setItem(dismissedKey, '1') } catch { /* fine */ } setShown(false) }
  return (
    <span className="home-screen-hint">
      {prefix}Add to Home Screen for the full-screen app: Share, then “Add to Home Screen” · <button type="button" className="link" onClick={dismiss}>Got it</button>
    </span>
  )
}
