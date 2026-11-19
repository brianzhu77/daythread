// #364 (Jazz in #363 3bd4f1cc, Lead d2d043f0): a notice can be swiped away toward the edge it sits at. Phone
// notices sit at the top and go up; laptop notices sit at the bottom and go up or down, so neither direction needs
// learning (Brian asked for "swipe up"). HeroUI's Toast has no swipe, so this is plain pointer handling on its element.
import { toast } from '@heroui/react'
import { useCallback, useRef } from 'react'

/** A press that moves this far is a swipe, never a tap on the button under it. */
const SLOP = 8
/** Released this far toward the edge, it goes. */
const DISTANCE = 32
/** Or flicked: at least this far, this fast (px per ms). */
const FLICK_DISTANCE = 10
const FLICK_SPEED = 0.3
/** The wrong way it gives a little and no more. */
const RUBBER = 0.2
const RUBBER_MAX = 12

/** How far back a release looks to tell a flick (a single last move is too noisy on a phone). */
const FLICK_WINDOW = 80

type Drag = { id: number; x: number; y: number; target: EventTarget | null; dir: -1 | 1 | 0; moved: number; samples: { t: number; moved: number }[]; swiping: boolean; sideways: boolean }

/** `placement`: where the region sits. A top notice only goes up; a bottom one goes either way. */
export function useSwipeAway(key: string, placement: 'top' | 'bottom') {
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((el: HTMLElement | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!el) return
    let drag: Drag | null = null
    let swallowClick = false
    let cancelling = false
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const set = (offset: number, fade: number) => { el.style.translate = offset ? `0 ${offset}px` : ''; el.style.opacity = fade < 1 ? String(fade) : '' }
    const resume = () => toast.resumeAll()

    const down = (e: PointerEvent) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0) || el.dataset.exiting === 'true') return
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, target: e.target, dir: 0, moved: 0, samples: [], swiping: false, sideways: false }
      // The countdown waits while a finger is on the notice (hover already pauses it for a pointer).
      toast.pauseAll()
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id || drag.sideways) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (!drag.swiping) {
        if (Math.hypot(dx, dy) < SLOP) return
        // Past 8 px in any direction it's no longer a tap (Ratchet 9875ade4): the button under the finger is told the
        // press is cancelled, as the browser does when it takes over a touch, so React Aria never calls its onPress.
        cancelling = true
        try { drag.target?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary })) } finally { cancelling = false }
        // Sideways is not a swipe here: it just isn't a tap any more.
        if (Math.abs(dx) > Math.abs(dy)) { drag.sideways = true; return }
        drag.swiping = true
        drag.dir = placement === 'top' ? -1 : dy < 0 ? -1 : 1
        el.dataset.swiping = 'true'
        // Capturing moves the release off the button, so the button under the finger doesn't fire.
        try { el.setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ }
      }
      if (placement === 'bottom') drag.dir = dy < 0 ? -1 : 1
      const toward = dy * drag.dir
      const shown = toward >= 0 ? toward : -Math.min(RUBBER_MAX, -toward * RUBBER)
      set(drag.dir * shown, Math.max(0.3, 1 - Math.max(0, toward) / 140))
      drag.moved = toward
      drag.samples.push({ t: e.timeStamp, moved: toward })
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0]!.t > FLICK_WINDOW) drag.samples.shift()
      e.preventDefault()
    }
    const up = (e: PointerEvent) => {
      if (cancelling || !drag || e.pointerId !== drag.id) return
      const d = drag
      drag = null
      // A press focuses the notice, and React Aria holds the countdown while focus is inside it, so one tap on its
      // text kept it up for good. Focus a press gave it goes again; focus from the keyboard stays.
      setTimeout(() => { if (el.contains(document.activeElement) && !el.querySelector(':focus-visible') && !el.matches(':focus-visible')) (document.activeElement as HTMLElement).blur() }, 0)
      delete el.dataset.swiping
      if (d.sideways) { swallowClick = true; setTimeout(() => { swallowClick = false }, 0) }
      if (!d.swiping) { resume(); return }
      swallowClick = true
      setTimeout(() => { swallowClick = false }, 0)
      const first = d.samples[0], last = d.samples[d.samples.length - 1]
      const speed = first && last && last !== first ? (last.moved - first.moved) / Math.max(1, last.t - first.t) : 0
      if (e.type === 'pointerup' && (d.moved >= DISTANCE || (d.moved >= FLICK_DISTANCE && speed >= FLICK_SPEED))) {
        el.dataset.swiped = 'true'
        if (!reduced()) set(d.dir * (el.offsetHeight + 24), 0)
        else set(0, 0)
        resume()
        toast.close(key)
        return
      }
      set(0, 1)
      resume()
    }
    // A release after a swipe can still end in a click on the button under it; that click never counts.
    const click = (e: MouseEvent) => { if (swallowClick) { e.stopPropagation(); e.preventDefault() } }

    // Move and release are watched on the window: a finger that slides off the notice before it counts as a swipe
    // (sideways, say) still ends the press there, so the countdown always resumes.
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    el.addEventListener('click', click, true)
    cleanup.current = () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('click', click, true)
      if (drag) resume()
    }
  }, [key, placement])
}
