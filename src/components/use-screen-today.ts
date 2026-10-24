import { useEffect, useState } from 'react'
import type { LocalDate } from '../domain/types'
import { todayIso } from './dates'

/**
 * Today for a screen that stays open on a day: read when the screen opens, and again each time the app comes back to
 * the foreground. Reading it only once let a Home Screen app resumed on Oct 23 still treat Oct 21 as today, so it
 * offered Oct 21's morning card. It never changes while the screen is in use, so the day can't switch under the cursor
 * at midnight. Labels that should turn over on their own use `useToday` (page-tree).
 */
export function useScreenToday(): LocalDate {
  const [today, setToday] = useState(todayIso)
  useEffect(() => {
    const reread = () => { if (document.visibilityState === 'visible') setToday(todayIso()) }
    document.addEventListener('visibilitychange', reread)
    window.addEventListener('pageshow', reread)
    window.addEventListener('focus', reread)
    return () => {
      document.removeEventListener('visibilitychange', reread)
      window.removeEventListener('pageshow', reread)
      window.removeEventListener('focus', reread)
    }
  }, [])
  return today
}
