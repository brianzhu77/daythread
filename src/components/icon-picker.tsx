// The icon picker (docs/design/icons-covers.md §7.4, §7.8). One at a time, opened from a page's ⋯ or by tapping its icon. The emoji's data loads only when it opens.
// What's on screen is the last thing chosen: a choice shows at once, and an older answer arriving late never replaces it. Words being saved are a separate matter, and aren't waited for.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '@heroui/react'
import type { Page } from '../domain/types'
import { uploadLook, type UploadFailure } from './file-upload'
import { PageEmoji } from './icons'
import { useKeyboardTop } from './keyboard'
import { useWorkspace } from './use-day'

type Entry = [char: string, group: number, en: string, zh: string, tones?: string[]]
interface EmojiData { groups: (string | null)[]; emoji: Entry[] }

let open: { pageId: string; anchor: { left: number; bottom: number } } | null = null
/** Esc goes back to where it was opened from (§7.4). */
let openedFrom: HTMLElement | null = null
const drafts = new Map<string, string | null>(), listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export function openIconPicker(pageId: string, anchor?: Element | null) {
  const box = anchor?.getBoundingClientRect()
  openedFrom = anchor instanceof HTMLElement ? anchor : document.activeElement instanceof HTMLElement ? document.activeElement : null
  open = { pageId, anchor: box ? { left: box.left, bottom: box.bottom } : { left: window.innerWidth / 2 - 176, bottom: 96 } }
  changed()
}
const closePicker = () => { open = null; changed() }
const setDraft = (pageId: string, icon: string | null | undefined) => { if (icon === undefined) drafts.delete(pageId); else drafts.set(pageId, icon); changed() }
/** What a page's head shows: the last choice, until what's saved has caught up with it. */
export function usePageIcon(page: Pick<Page, 'id' | 'icon'>): string | null {
  const draft = useSyncExternalStore(subscribe, () => drafts.get(page.id), () => undefined)
  return draft !== undefined ? draft : page.icon ?? null
}

let ownSet: Promise<[string, string][]> | null = null
const loadOwnIcons = () => ownSet ??= fetch('/page-icons/index.json').then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<[string, string][]> }).catch(e => { ownSet = null; throw e })
let data: Promise<EmojiData> | null = null
const loadEmoji = () => data ??= fetch('/emoji-v1.json').then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<EmojiData> }).catch(e => { data = null; throw e })
const stored = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const store = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* private mode: it just isn't kept */ } }
const recentOf = (): string[] => { try { const list = JSON.parse(stored('daythread.icon-recent') ?? '[]') as unknown; return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [] } catch { return [] } }
const tones = ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark']
const toneMarks = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿']
const emojiLike = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u
const singleEmoji = (text: string) => { const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.trim())]; return parts.length === 1 && emojiLike.test(parts[0]!.segment) ? parts[0]!.segment : null }

/** How many choices each page has had sent. Beside the drafts and as long-lived, as a picker closed and opened again mustn't take an older reply for the newest. */
const sendsOf = new Map<string, number>()
/** One choice saved: the newest sent is the only one that may settle what shows. */
function useIconSender() {
  const { run } = useWorkspace()
  return useCallback(function send(pageId: string, icon: string | null) {
    const sent = (sendsOf.get(pageId) ?? 0) + 1
    sendsOf.set(pageId, sent)
    const newest = () => sendsOf.get(pageId) === sent
    let failed = false
    void run({ type: 'set-page-icon', pageId, icon }, r => ({ text: r.message, undoOperationId: r.operationId }), undefined, {
      quiet: true,
      onFailure: message => {
        failed = true
        if (!newest()) return
        setDraft(pageId, undefined)
        // A network failure can be tried again. A refusal would only be refused again, so it says why.
        if (/fetch|network|offline|load failed|5\d\d/i.test(message)) { const key: string = toast("Couldn't change the icon", { timeout: 8000, actionProps: { children: 'Try again', onPress: () => { toast.close(key); setDraft(pageId, icon); send(pageId, icon) } } }) } else toast(message, { timeout: 6000 })
      },
    }).then(() => { if (!failed && newest()) setDraft(pageId, undefined) }, () => undefined)
  }, [run])
}

export function IconPickerHost() {
  const current = useSyncExternalStore(subscribe, () => open, () => null)
  return current ? <IconPicker key={current.pageId} pageId={current.pageId} anchor={current.anchor} /> : null
}
function IconPicker({ pageId, anchor }: { pageId: string; anchor: { left: number; bottom: number } }) {
  const { workspace } = useWorkspace()
  const page = workspace?.pages.find(p => p.id === pageId)
  const shown = usePageIcon(page ?? { id: pageId, icon: undefined })
  const send = useIconSender()
  const [emoji, setEmoji] = useState<EmojiData | null>(null), [failed, setFailed] = useState(false), [query, setQuery] = useState(''), [composing, setComposing] = useState(false)
  const [tone, setTone] = useState(() => Number(stored('daythread.icon-tone')) || 0), [recent, setRecent] = useState(recentOf)
  const panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'emoji' | 'icons' | 'upload'>('emoji'), [own, setOwn] = useState<[string, string][] | null>(null), [ownFailed, setOwnFailed] = useState(false)
  const loadOwn = useCallback(() => { setOwnFailed(false); loadOwnIcons().then(setOwn, () => setOwnFailed(true)) }, [])
  useEffect(() => { if (tab === 'icons') loadOwn() }, [tab, loadOwn])
  const [upload, setUpload] = useState<{ percent: number; note: string | null; retry: File | null; busy: string | null }>({ percent: 0, note: null, retry: null, busy: null })
  const putting = useRef<{ abort: () => void } | null>(null)
  useEffect(() => () => putting.current?.abort(), [])
  const sendFile = (file: File) => {
    setUpload({ percent: 0, note: null, retry: null, busy: file.name })
    const put = uploadLook(file, 256, percent => setUpload(u => ({ ...u, percent })))
    putting.current = put
    // Cancel has already let this one go, so whatever it comes back with says nothing.
    put.done.then(url => { if (putting.current !== put) return; putting.current = null; pick(url) }, (failure: UploadFailure) => { if (putting.current !== put) return; putting.current = null; setUpload({ percent: 0, note: failure.message, retry: failure.retry ? file : null, busy: null }) })
  }
  const cancelUpload = () => { const put = putting.current; putting.current = null; put?.abort(); setUpload({ percent: 0, note: null, retry: null, busy: null }) }
  const phone = useMemo(() => window.matchMedia('(max-width: 899px)').matches, [])
  const keyboardTop = useKeyboardTop()
  const load = useCallback(() => { setFailed(false); loadEmoji().then(setEmoji, () => setFailed(true)) }, [])
  useEffect(load, [load])
  // At 390 the caret waits to be asked for, so the keyboard stays down (P1-2).
  // After the menu it was opened from has handed focus back. Esc closes it wherever the focus is.
  useEffect(() => { if (phone) return; const timer = setTimeout(() => search.current?.focus({ preventScroll: true }), 60); return () => clearTimeout(timer) }, [phone])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !panel.current?.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); finishBack() } }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  })
  useEffect(() => {
    // Not while a picture's on its way: a click elsewhere isn't asking to lose it. Esc and Cancel are.
    const away = (e: PointerEvent) => { if (!putting.current && !panel.current?.contains(e.target as Node)) finish() }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  })
  // Random sends what it settles on, once the presses stop: a run of them is one change, and Undo goes back to before the run.
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; icon: string } | null>(null)
  const flush = () => { if (pending.current) { clearTimeout(pending.current.timer); const { icon } = pending.current; pending.current = null; send(pageId, icon) } }
  const finish = () => { flush(); closePicker() }
  const finishBack = () => { finish(); if (openedFrom?.isConnected) openedFrom.focus({ preventScroll: true }) }
  const withTone = (entry: Entry) => (tone && entry[4]?.[tone - 1]) || entry[0]
  const remember = (icon: string) => { if (icon.startsWith('/')) return; const next = [icon, ...recent.filter(x => x !== icon)].slice(0, 16); setRecent(next); store('daythread.icon-recent', JSON.stringify(next)) }
  const pick = (icon: string) => { if (pending.current) { clearTimeout(pending.current.timer); pending.current = null } remember(icon); setDraft(pageId, icon); send(pageId, icon); closePicker() }
  const remove = () => { if (pending.current) { clearTimeout(pending.current.timer); pending.current = null } setDraft(pageId, null); send(pageId, null); closePicker() }
  const random = () => {
    if (!emoji) return
    const entry = emoji.emoji[Math.floor(Math.random() * emoji.emoji.length)]!, icon = withTone(entry)
    setDraft(pageId, icon)
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { icon, timer: setTimeout(flush, 300) }
  }
  const typed = composing ? '' : query.trim().toLowerCase()
  const asEmoji = singleEmoji(query)
  const found = useMemo(() => (typed && emoji ? emoji.emoji.filter(e => e[2].includes(typed) || e[3].includes(typed)) : null), [typed, emoji])
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (phone || !panel.current) return
    const { width, height } = panel.current.getBoundingClientRect(), edge = 8
    setPlace({ left: Math.max(edge, Math.min(anchor.left, window.innerWidth - width - edge)), top: Math.max(edge, Math.min(anchor.bottom + 4, window.innerHeight - height - edge)) })
  }, [phone, anchor])
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishBack(); return }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return
    const cells = [...(panel.current?.querySelectorAll<HTMLElement>('.icon-picker-cell') ?? [])], on = document.activeElement as HTMLElement, at = cells.indexOf(on)
    if (e.key === 'Enter') { if (at < 0 && cells[0]) { e.preventDefault(); cells[0].click() } return }
    if (at < 0) { if (e.key === 'ArrowDown') { e.preventDefault(); cells[0]?.focus() } return }
    e.preventDefault()
    const across = 8, next = at + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? across : -across)
    if (next < 0) search.current?.focus(); else cells[Math.min(next, cells.length - 1)]?.focus()
  }
  const cell = (icon: string, label: string) => <button key={`${icon}-${label}`} type="button" className="icon-picker-cell" aria-label={label} onClick={() => pick(icon)}>{icon.startsWith('icon:') ? <PageEmoji icon={icon} /> : icon}</button>
  const ownFound = own && (typed ? own.filter(([name, words]) => name.includes(typed) || words.includes(typed)) : own)
  return createPortal(<div ref={panel} className={`icon-picker${phone ? ' is-sheet' : ''}`} role="dialog" aria-label="Choose an icon" onKeyDown={onKeyDown}
    style={phone ? (keyboardTop !== null ? { bottom: window.innerHeight - keyboardTop, height: Math.min(window.innerHeight * 0.6, (window.visualViewport?.height ?? window.innerHeight) - 8) } : undefined) : { left: place?.left ?? anchor.left, top: place?.top ?? anchor.bottom + 4, visibility: place ? 'visible' : 'hidden' }}>
    <div className="icon-picker-top">
      {tab !== 'upload' && <input ref={search} className="icon-picker-search" type="text" aria-label="Search emoji" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={e => { setComposing(false); setQuery(e.currentTarget.value) }} />}
      {tab === 'emoji' && <button type="button" className="app-link" disabled={!emoji} onClick={random}>Random</button>}
      {shown && <button type="button" className="app-link icon-picker-remove" onClick={remove}>Remove</button>}
    </div>
    <div className="icon-picker-tabs" role="tablist">{(['emoji', 'icons', 'upload'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>{t === 'emoji' ? 'Emoji' : t === 'icons' ? 'Icons' : 'Upload'}</button>)}</div>
    {tab === 'icons' && <div className="icon-picker-scroll">
      {ownFailed && !own ? <p className="icon-picker-note">Can't load icons · <button type="button" className="app-link" onClick={loadOwn}>Try again</button></p>
        : !ownFound ? <div className="icon-picker-grid is-loading" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <span key={i} className="icon-picker-blank" />)}</div>
        : ownFound.length ? <div className="icon-picker-grid">{ownFound.map(([name]) => cell(`icon:${name}`, name))}</div> : <p className="icon-picker-note">No icon for {query.trim()}</p>}
    </div>}
    {tab === 'upload' && <div className="icon-picker-scroll icon-picker-upload">
      <label className="app-link icon-picker-choose">Choose a picture<input type="file" accept="image/*" disabled={Boolean(upload.busy)} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) sendFile(file) }} /></label>
      {upload.busy && <p className="icon-picker-note" role="status">Uploading {upload.busy} · <button type="button" className="app-link" onClick={cancelUpload}>Cancel</button></p>}
      {upload.busy && <div className="icon-picker-track" aria-hidden="true"><div style={{ width: `${upload.percent}%` }} /></div>}
      {upload.note && <p className="icon-picker-note" role="status">{upload.note === "Couldn't upload" ? 'Not uploaded' : upload.note}{upload.retry && <> · <button type="button" className="app-link" onClick={() => sendFile(upload.retry!)}>Retry</button></>}</p>}
    </div>}
    {tab === 'emoji' && <div className="icon-picker-scroll">
      {asEmoji && cell(asEmoji, asEmoji)}
      {failed && !emoji ? <p className="icon-picker-note">Can't load emoji · <button type="button" className="app-link" onClick={load}>Try again</button></p>
        : !emoji ? <div className="icon-picker-grid is-loading" aria-hidden="true">{Array.from({ length: 64 }, (_, i) => <span key={i} className="icon-picker-blank" />)}</div>
        : found ? (found.length || asEmoji ? <div className="icon-picker-grid">{found.map(e => cell(withTone(e), e[2].split(' ')[0]!))}</div> : <p className="icon-picker-note">No emoji for {query.trim()}</p>)
        : <>
          <div className="icon-picker-group-head"><span>{recent.length ? 'Recent' : ''}</span>
            <select className="icon-picker-tone" aria-label="Skin tone" value={tone} onChange={e => { const next = Number(e.target.value); setTone(next); store('daythread.icon-tone', String(next)) }}>{tones.map((t, i) => <option key={t} value={i}>{toneMarks[i]} {t}</option>)}</select>
          </div>
          {recent.length > 0 && <div className="icon-picker-grid">{recent.map(icon => cell(icon, icon))}</div>}
          {emoji.groups.map((name, group) => name && <section key={name} className="icon-picker-section"><div className="icon-picker-group-head"><span>{name}</span></div><div className="icon-picker-grid">{emoji.emoji.filter(e => e[1] === group).map(e => cell(withTone(e), e[2].split(' ')[0]!))}</div></section>)}
        </>}
    </div>}
  </div>, document.body)
}

/** The icon above a page's title, when it has one. A tap opens the picker. No icon, nothing's drawn or held (P1-1). */
export function PageIconLine({ page }: { page: Pick<Page, 'id' | 'icon'> }) {
  const icon = usePageIcon(page)
  if (!icon) return null
  return <div className="page-icon-line"><button type="button" className="page-icon" aria-label="Change icon" onClick={e => openIconPicker(page.id, e.currentTarget)}><PageEmoji icon={icon} className="page-icon-glyph" /></button></div>
}
