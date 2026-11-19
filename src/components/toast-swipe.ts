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

type Drag = { id: number; x: number; y: number; dir: -1 | 1 | 0; moved: number; samples: { t: number; moved: number }[]; swiping: boolean }

/** `placement`: where the region sits. A top notice only goes up; a bottom one goes either way. */
export function useSwipeAway(key: string, placement: 'top' | 'bottom') {
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((el: HTMLElement | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!el) return
    let drag: Drag | null = null
    let swallowClick = false
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const set = (offset: number, fade: number) => { el.style.translate = offset ? `0 ${offset}px` : ''; el.style.opacity = fade < 1 ? String(fade) : '' }
    const resume = () => toast.resumeAll()

    const down = (e: PointerEvent) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0) || el.dataset.exiting === 'true') return
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dir: 0, moved: 0, samples: [], swiping: false }
      // The countdown waits while a finger is on the notice (hover already pauses it for a pointer).
      toast.pauseAll()
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (!drag.swiping) {
        if (Math.hypot(dx, dy) < SLOP) return
        // Sideways is not a swipe here; let the press go on as it was.
        if (Math.abs(dx) > Math.abs(dy)) { drag = null; resume(); return }
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
      if (!drag || e.pointerId !== drag.id) return
      const d = drag
      drag = null
      delete el.dataset.swiping
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

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('click', click, true)
    cleanup.current = () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('click', click, true)
      if (drag) resume()
    }
  }, [key, placement])
}
