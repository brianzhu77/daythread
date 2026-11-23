// Tap feedback §1 (docs/design/tap-feedback.md): one module marks the control under a press with `data-press`, so every
// pressable shows it in the same frame, on touch, mouse and keyboard, with no per-site CSS. `:active` isn't used: iOS
// doesn't apply it without a touch listener, and it never covers keys.

/** What can be pressed (§1.1). Checked against the event's target with `closest`. */
export const PRESSABLE = [
  'button', 'a[href]', 'summary', 'label', 'input[type=checkbox]', 'input[type=radio]',
  ...['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'checkbox'].map(r => `[role=${r}]`),
].join(', ')

/**
 * Never marked: the handles themselves (grips, a column edge: they have the Lift Rule), the map (it's drawn on), and
 * anything opting out. Not everything inside a draggable ancestor: BlockNote makes the block under the mouse draggable,
 * and a control in it still gets the press; a row that can be pressed or dragged shows the press, cleared at once on
 * dragstart or a move past 8 px (Lead cb75a132, Jazz 41ad161d).
 */
const LEFT_ALONE = [
  '[data-no-press]', '.drag-handle', '[data-drag-handle]', '.editor-handle', '.editor-touch-handle', '.database-row-handle',
  '.database-list-handle', '.database-pane-handle', '.database-lane-grip', '.database-column-edge', '.map-canvas', '.maplibregl-canvas',
].join(', ')

/**
 * A pressed control's look (§1.2): `box` (a checkbox or radio: a halo around it, Jazz 28eea1ab), `icon` (no words: a
 * stronger fill, the whole button), `text` (words with no room
 * around them, such as Apply all or a grey link: a pill behind the words) or `row` (everything else). Its tone says
 * which way the press moves its own colour: `dim` darker, `lift` lighter, or the theme's way when it has no fill of its own.
 */
export type PressFamily = 'box' | 'icon' | 'text' | 'row'
export type PressTone = 'dim' | 'lift' | 'theme'

const MIN_MS = 100
const PRESS_ATTRS = ['data-press', 'data-press-tone', 'data-press-via', 'data-press-row', 'data-press-out']
const FADE_MS = 120
const SLOP_PX = 8

/** The pressable a press on `target` is for, or null when the press shows nothing. */
export function pressableOf(target: EventTarget | null): HTMLElement | null {
  const start = target instanceof Element ? target : null
  const el = start?.closest<HTMLElement>(PRESSABLE) ?? null
  if (!el || el.isContentEditable || el.closest(LEFT_ALONE)) return null
  // A label is pressable only around a checkbox or radio (§1.1): a label around a text field is the field's.
  if (el.tagName === 'LABEL' && !el.querySelector('input[type=checkbox], input[type=radio]')) return null
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset:disabled')) return null
  return el
}

/** Relative luminance of a computed colour, or null when it's (almost) transparent. */
export function fillLuminance(color: string): number | null {
  const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/.exec(color)
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  if (alpha < 0.5) return null
  const [r, g, b] = [m[1], m[2], m[3]].map(v => { const c = parseFloat(v!) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** One step past its own colour, whatever that is (Step Rule): darker on a light or coloured fill, lighter on a dark one. */
export function toneOf(backgroundColor: string): PressTone {
  const lum = fillLuminance(backgroundColor)
  return lum === null ? 'theme' : lum < 0.12 ? 'lift' : 'dim'
}

export function familyOf(el: Element, style: Pick<CSSStyleDeclaration, 'paddingLeft' | 'paddingRight' | 'display'>): PressFamily {
  // A native box ignores a background (the editor's to-do box keeps appearance: auto), so it gets a halo instead.
  if (el.matches('input[type=checkbox], input[type=radio]')) return 'box'
  if (el.matches('[role=checkbox], [role=switch]')) return 'icon'
  if (!(el.textContent ?? '').trim()) return 'icon'
  const room = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  // Words in a line of text (the draft's Apply all and Dismiss are flex buttons there): blue words stay blue (Jazz 93fbd48f).
  if (room < 6 && (style.display.startsWith('inline') || el.matches('.draft-line button, .app-link')) && !el.matches('[role=tab], [role=menuitem], [role=option]')) return 'text'
  return 'row'
}

/** The row a small control sits in (§1.3): its row takes a tint too, so the press shows beside the finger. */
const ROW = '.draft-band, .draft-more-item, .editor-task, [role=treeitem], .tree-row, .task-row, .card-row, .database-row, .database-list-row'

interface Press { el: HTMLElement; row: HTMLElement | null; at: number; x: number; y: number; pointer: number | null; key: string | null; timer?: ReturnType<typeof setTimeout> }

/** Installs the press layer on `doc`; returns its removal. Safe to call once per document. */
let lastLift: { el: HTMLElement; at: number } | null = null
/** The control a press just ended on, whose click is what's running now; null once it's older than `withinMs` or gone. */
export function justPressed(withinMs = 500): HTMLElement | null {
  const l = lastLift
  if (!l || !l.el.isConnected || performance.now() - l.at > withinMs) return null
  // A menu closes as its item is chosen: the button that opened it is the place he pressed that stays on screen.
  const menu = l.el.closest('[role=menu]')
  return menu?.parentElement?.querySelector<HTMLElement>(':scope > [aria-haspopup=menu], :scope > * > [aria-haspopup=menu]') ?? l.el
}

const WORKING_SLOW_MS = 300
const working = new Map<HTMLElement, number>()
/** Presses on a working control go nowhere: its change is already on its way (§4.2: no second press). */
const swallow = (e: Event) => {
  for (const el of working.keys()) if (e.target instanceof Node && el.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); return }
}
/**
 * Tap feedback §4.2 (release 2): the control whose change waits for the server, as it waits: reduced in place, a spinner
 * after 300 ms, its label's width held, and no second press. Returns the call that ends it.
 */
export function markWorking(el: HTMLElement): () => void {
  const doc = el.ownerDocument
  if (!working.size) for (const t of ['click', 'pointerdown', 'keydown']) doc.addEventListener(t, swallow, true)
  working.set(el, (working.get(el) ?? 0) + 1)
  el.setAttribute('data-working', '')
  el.setAttribute('aria-busy', 'true')
  const slow = setTimeout(() => { if (working.has(el)) el.setAttribute('data-working', 'slow') }, WORKING_SLOW_MS)
  let ended = false
  return () => {
    if (ended) return
    ended = true
    clearTimeout(slow)
    const left = (working.get(el) ?? 1) - 1
    if (left > 0) { working.set(el, left); return }
    working.delete(el)
    el.removeAttribute('data-working'); el.removeAttribute('aria-busy')
    if (!working.size) for (const t of ['click', 'pointerdown', 'keydown']) doc.removeEventListener(t, swallow, true)
  }
}

export function installPress(doc: Document = document): () => void {
  const win = doc.defaultView!
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)')
  let current: Press | null = null
  /** Which press each marked element shows: a press that ended doesn't touch an element a newer one has taken. */
  const owner = new WeakMap<HTMLElement, Press>()

  const unmark = (p: Press, fade: boolean) => {
    clearTimeout(p.timer)
    const parts = [p.el, p.row].filter((e): e is HTMLElement => !!e && owner.get(e) === p)
    const clear = () => { for (const e of parts) for (const a of PRESS_ATTRS) e.removeAttribute(a) }
    if (!fade || reduced?.matches) return clear()
    // Fading out keeps the family and tone; a new press of the same control before it's done starts from full.
    for (const e of parts) e.setAttribute('data-press-out', '')
    p.timer = setTimeout(() => { if (parts.every(e => e.hasAttribute('data-press-out'))) clear() }, FADE_MS)
  }
  /** Ends the current press: `lift` keeps it to its 100 ms minimum and fades it; anything else clears it now. */
  const end = (lift: boolean) => {
    const p = current
    if (!p) return
    current = null
    if (!lift) return unmark(p, false)
    lastLift = { el: p.el, at: performance.now() }
    const left = MIN_MS - (performance.now() - p.at)
    if (left > 0) p.timer = setTimeout(() => unmark(p, true), left)
    else unmark(p, true)
  }
  const start = (el: HTMLElement, from: Pick<Press, 'x' | 'y' | 'pointer' | 'key'>) => {
    if (current) end(false)
    // Read its own look, not a press still fading on it.
    for (const a of PRESS_ATTRS) el.removeAttribute(a)
    // Read before marking: a computed style is live, and the marks change it.
    const style = win.getComputedStyle(el), family = familyOf(el, style), tone = toneOf(style.backgroundColor)
    // The veil is a background image; a control already drawn with one (a checked box's tick) takes it as an inset
    // shadow instead, and one with both as a filter.
    const via = family === 'box' || style.backgroundImage === 'none' ? null : style.boxShadow === 'none' ? 'shadow' : 'filter'
    const row = family === 'icon' || family === 'box' ? el.parentElement?.closest<HTMLElement>(ROW) ?? null : null
    el.setAttribute('data-press', family)
    el.setAttribute('data-press-tone', tone)
    if (via) el.setAttribute('data-press-via', via)
    row?.setAttribute('data-press-row', 'on')
    current = { el, row, at: performance.now(), ...from }
    // Enter clicks on its key down, before any lift.
    if (from.key) lastLift = { el, at: current.at }
    owner.set(el, current)
    if (row) owner.set(row, current)
  }

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const el = pressableOf(e.target)
    if (el) start(el, { x: e.clientX, y: e.clientY, pointer: e.pointerId, key: null })
    else if (current) end(false)
  }
  const onMove = (e: PointerEvent) => {
    const p = current
    if (p && p.pointer === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) end(false)
  }
  const onUp = (e: PointerEvent) => { if (current?.pointer === e.pointerId) end(true) }
  const onCancel = () => end(false)
  const activates = (el: HTMLElement, key: string) => {
    if (key === 'Enter') return !el.matches('input[type=checkbox], input[type=radio], [role=checkbox], [role=switch]')
    // Space scrolls past a link; it presses everything else here.
    return key === ' ' && !el.matches('a[href], [role=link]')
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return
    const el = pressableOf(e.target)
    if (el && el === doc.activeElement && activates(el, e.key)) start(el, { x: 0, y: 0, pointer: null, key: e.key })
  }
  const onKeyUp = (e: KeyboardEvent) => { if (current?.key === e.key) end(true) }
  const onFocusOut = (e: FocusEvent) => { if (current && e.target === current.el) end(false) }
  const onHidden = () => { if (doc.visibilityState === 'hidden') end(false) }

  const capture = { capture: true, passive: true } as const
  doc.addEventListener('pointerdown', onDown, capture)
  doc.addEventListener('pointermove', onMove, capture)
  doc.addEventListener('pointerup', onUp, capture)
  doc.addEventListener('pointercancel', onCancel, capture)
  doc.addEventListener('dragstart', onCancel, capture)
  doc.addEventListener('scroll', onCancel, capture)
  doc.addEventListener('keydown', onKeyDown, capture)
  doc.addEventListener('keyup', onKeyUp, capture)
  doc.addEventListener('focusout', onFocusOut, capture)
  doc.addEventListener('visibilitychange', onHidden)
  win.addEventListener('blur', onCancel)
  return () => {
    end(false)
    doc.removeEventListener('pointerdown', onDown, capture)
    doc.removeEventListener('pointermove', onMove, capture)
    doc.removeEventListener('pointerup', onUp, capture)
    doc.removeEventListener('pointercancel', onCancel, capture)
    doc.removeEventListener('dragstart', onCancel, capture)
    doc.removeEventListener('scroll', onCancel, capture)
    doc.removeEventListener('keydown', onKeyDown, capture)
    doc.removeEventListener('keyup', onKeyUp, capture)
    doc.removeEventListener('focusout', onFocusOut, capture)
    doc.removeEventListener('visibilitychange', onHidden)
    win.removeEventListener('blur', onCancel)
  }
}
