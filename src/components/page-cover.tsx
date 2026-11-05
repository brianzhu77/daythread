// A page's cover (docs/design/icons-covers.md §7.5 to §7.8). A band above the head, from an image link the browser fetches with no-referrer; the server fetches nothing.
// It holds its height whatever the picture does, so the words never move. What's on screen is the last thing chosen, and an older answer arriving late doesn't replace it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '@heroui/react'
import { coverLinkLimit, coverPlace, isCoverLink } from '../domain/page-look'
import type { Page } from '../domain/types'
import { useWorkspace } from './use-day'

type Look = { cover: string; position: number } | null
const drafts = new Map<string, Look>(), movable = new Set<string>(), listeners = new Set<() => void>()
let panel: { pageId: string; anchor: { right: number; bottom: number } } | null = null
let moving: string | null = null
const changed = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const setDraft = (pageId: string, look: Look | undefined) => { if (look === undefined) drafts.delete(pageId); else drafts.set(pageId, look); changed() }
export function openCoverPanel(pageId: string, anchor?: Element | null) {
  const box = anchor?.getBoundingClientRect()
  panel = { pageId, anchor: box ? { right: box.right, bottom: box.bottom } : { right: window.innerWidth / 2 + 180, bottom: 96 } }
  changed()
}
const closePanel = () => { panel = null; changed() }
export const startReposition = (pageId: string) => { moving = pageId; changed() }
const stopReposition = () => { moving = null; changed() }
/** Whether this picture has any height to spare at this size. One that doesn't, doesn't offer to move (§7.5). */
export const coverCanMove = (pageId: string) => movable.has(pageId)
/** For a menu that offers it: the picture usually loads after the menu's first drawn. */
export const useCoverCanMove = (pageId: string) => useSyncExternalStore(subscribe, () => movable.has(pageId), () => false)
function useLook(page: Pick<Page, 'id' | 'cover' | 'coverPosition'>): Look {
  const draft = useSyncExternalStore(subscribe, () => drafts.get(page.id), () => undefined)
  if (draft !== undefined) return draft
  return page.cover ? { cover: page.cover, position: page.coverPosition ?? 0.5 } : null
}

/** How many choices each page has had sent. Beside the drafts and as long-lived, as a panel closed and opened again mustn't take an older reply for the newest. */
const sendsOf = new Map<string, number>()
/** One choice saved: only the newest may settle what shows. A failure goes back to what's saved and says so; a refusal would only be refused again, so it says why. */
function useCoverSender() {
  const { run } = useWorkspace()
  return useCallback(function send(pageId: string, look: Look, moved = false) {
    const sent = (sendsOf.get(pageId) ?? 0) + 1
    sendsOf.set(pageId, sent)
    const newest = () => sendsOf.get(pageId) === sent
    setDraft(pageId, look)
    let failed = false
    void run({ type: 'set-page-cover', pageId, cover: look?.cover ?? null, ...(look && moved ? { position: look.position } : {}) }, r => ({ text: r.message, undoOperationId: r.operationId }), undefined, {
      quiet: true,
      onFailure: message => {
        failed = true
        if (!newest()) return
        setDraft(pageId, undefined)
        if (/fetch|network|offline|load failed|5\d\d/i.test(message)) { const key: string = toast("Couldn't change the cover", { timeout: 8000, actionProps: { children: 'Try again', onPress: () => { toast.close(key); send(pageId, look, moved) } } }) } else toast(message, { timeout: 6000 })
      },
    }).then(() => { if (!failed && newest()) setDraft(pageId, undefined) }, () => undefined)
  }, [run])
}

export function CoverPanelHost() {
  const current = useSyncExternalStore(subscribe, () => panel, () => null)
  return current ? <CoverPanel key={current.pageId} pageId={current.pageId} anchor={current.anchor} /> : null
}
/** Add is only there once this link's picture has loaded here, the way the band loads it. Having loaded once checks this preview; it doesn't promise the link will stay alive (§7.7). */
function CoverPanel({ pageId, anchor }: { pageId: string; anchor: { right: number; bottom: number } }) {
  const { workspace } = useWorkspace()
  const page = workspace?.pages.find(p => p.id === pageId)
  const look = useLook(page ?? { id: pageId })
  const send = useCoverSender()
  const [link, setLink] = useState(''), [loaded, setLoaded] = useState<string | null>(null), [failedLink, setFailedLink] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null)
  const typed = link.trim(), tooLong = typed.length > coverLinkLimit, valid = !tooLong && isCoverLink(typed)
  // Each try belongs to the link it was made for: a late answer from an earlier one is never heard, and closing drops them all.
  useEffect(() => {
    if (!valid) return
    let current = true
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => { if (current) setLoaded(typed) }
    image.onerror = () => { if (current) setFailedLink(typed) }
    image.src = typed
    return () => { current = false; image.onload = null; image.onerror = null; image.src = '' }
  }, [typed, valid])
  const ready = loaded === typed && valid
  const add = () => { if (ready) { send(pageId, { cover: typed, position: 0.5 }); closePanel() } }
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!box.current) return
    const { width } = box.current.getBoundingClientRect(), edge = 8
    setPlace({ left: Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge)), top: anchor.bottom + 4 })
  }, [anchor])
  useEffect(() => { const timer = setTimeout(() => field.current?.focus({ preventScroll: true }), 60); return () => clearTimeout(timer) }, [])
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) closePanel() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel() } }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true) }
  }, [])
  const note = tooLong ? 'That link is too long' : typed && !valid ? "That isn't an image link" : failedLink === typed && typed ? "Can't load that image" : null
  return createPortal(<div ref={box} className="cover-panel" role="dialog" aria-label={look ? 'Change cover' : 'Add cover'} style={{ left: place?.left ?? 0, top: place?.top ?? anchor.bottom + 4, visibility: place ? 'visible' : 'hidden' }}>
    <input ref={field} className="cover-panel-field" type="url" aria-label="Paste an image link" placeholder="Paste an image link" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
    {note && <p className="cover-panel-note" role="status">{note}</p>}
    {ready && <img className="cover-panel-preview" src={typed} alt="" referrerPolicy="no-referrer" />}
    <div className="cover-panel-actions">
      {look && <button type="button" className="app-link" onClick={() => { send(pageId, null); closePanel() }}>Remove</button>}
      {ready && <button type="button" className="app-link" onClick={add}>{look ? 'Change' : 'Add'}</button>}
    </div>
  </div>, document.body)
}

/** The band. No cover, nothing's drawn or held (P1-1). */
export function PageCover({ page, place }: { page: Pick<Page, 'id' | 'cover' | 'coverPosition'>; place: 'page' | 'day' | 'peek' }) {
  const look = useLook(page)
  const nowMoving = useSyncExternalStore(subscribe, () => moving === page.id, () => false)
  const send = useCoverSender()
  const [state, setState] = useState<{ url: string; status: 'loaded' | 'failed' } | null>(null), [position, setPosition] = useState<number | null>(null), [canMove, setCanMove] = useState(false)
  const band = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null), drag = useRef<{ y: number; from: number; travel: number } | null>(null)
  const status = look && state?.url === look.cover ? state.status : 'loading'
  // Vertical room the crop leaves at this size. A picture wider than the band has none.
  const travel = () => { const b = band.current, i = image.current; return b && i?.naturalWidth ? b.clientWidth * i.naturalHeight / i.naturalWidth - b.clientHeight : 0 }
  const measure = useCallback(() => { const can = travel() > 1; setCanMove(can); if (can) movable.add(page.id); else movable.delete(page.id); changed() }, [page.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const b = band.current; if (!b) return; const watch = new ResizeObserver(measure); watch.observe(b); return () => { watch.disconnect(); movable.delete(page.id) } }, [measure, page.id, Boolean(look)]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (nowMoving) { setPosition(look?.position ?? 0.5); band.current?.focus({ preventScroll: true }) } else setPosition(null) }, [nowMoving]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!look) return null
  const shown = position ?? look.position
  const done = () => { if (position !== null && position !== look.position) send(page.id, { cover: look.cover, position: coverPlace(position) }, true); stopReposition() }
  const press = (e: ReactPointerEvent) => { if (!nowMoving || (e.target as Element).closest('button')) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, from: shown, travel: travel() } }
  const pull = (e: ReactPointerEvent) => { const d = drag.current; if (d && d.travel > 0) setPosition(Math.min(1, Math.max(0, d.from - (e.clientY - d.y) / d.travel))) }
  const keys = (e: ReactKeyboardEvent) => {
    if (!nowMoving) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setPosition(Math.min(1, Math.max(0, shown + (e.key === 'ArrowUp' ? 0.05 : -0.05)))) }
    else if (e.key === 'Enter') { e.preventDefault(); done() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopReposition() }
  }
  return <div ref={band} className={`page-cover is-${place}${nowMoving ? ' is-moving' : ''}`} tabIndex={nowMoving ? 0 : undefined} onKeyDown={keys} onPointerDown={press} onPointerMove={pull} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
    {status !== 'failed' && <img ref={image} key={look.cover} className="page-cover-image" src={look.cover} alt="" referrerPolicy="no-referrer" draggable={false} style={{ objectPosition: `50% ${shown * 100}%`, opacity: status === 'loaded' ? 1 : 0 }}
      onLoad={() => { setState({ url: look.cover, status: 'loaded' }); measure() }} onError={() => setState({ url: look.cover, status: 'failed' })} />}
    {status === 'failed' && <span className="page-cover-failed" role="status">{navigator.onLine ? "Can't load this cover" : 'Offline'}</span>}
    {nowMoving
      ? <span className="page-cover-moving"><span>Drag to move</span><button type="button" onClick={done}>Done</button><button type="button" onClick={stopReposition}>Cancel</button></span>
      : <span className="page-cover-actions"><button type="button" onClick={e => openCoverPanel(page.id, e.currentTarget)}>Change</button>{canMove && status === 'loaded' && <button type="button" onClick={() => startReposition(page.id)}>Reposition</button>}</span>}
  </div>
}
