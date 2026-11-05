// Images and files in a page's body (B87, docs/design/body-files.md §4 and §6). The block goes in at once with its address, and the bytes follow; only the tab
// that holds them knows how far they've got. Any other tab finding no file says one thing: it isn't here.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createFileBlockConfig, createImageBlockConfig, fileParse, imageParse, type BlockNoteEditor } from '@blocknote/core'
import { createReactBlockSpec, FileBlockWrapper, ImageToExternalHTML, ResizableFileBlockWrapper, TextAlignButton, useBlockNoteEditor, useComponentsContext, useSelectedBlocks } from '@blocknote/react'
import { fileLimits } from '../domain/database'
import { bodyFileOf, bodyFileUrl, shownInPlace, showsAsImage } from '../domain/body-files'
import { fileSizeLabel, putFile, type UploadFailure } from './file-upload'
import { CaptionIcon, DownloadIcon, ExternalIcon, ImageIcon, PaperclipIcon } from './icons'

type UploadState = 'waiting' | 'uploading' | 'failed' | 'offline' | 'refused' | 'done'
interface Upload { id: string; file: File; preview: string | null; state: UploadState; percent: number; message: string; abort?: () => void }

const uploads = new Map<string, Upload>(), listeners = new Set<() => void>()
const atOnce = 3
const change = (id: string, next: Partial<Upload>) => { const was = uploads.get(id); if (was) uploads.set(id, { ...was, ...next }); listeners.forEach(l => l()) }
function pump() {
  const running = [...uploads.values()].filter(u => u.state === 'uploading').length
  const next = [...uploads.values()].filter(u => u.state === 'waiting').slice(0, Math.max(0, atOnce - running))
  for (const u of next) {
    const put = putFile(u.id, u.file, u.file.type || 'application/octet-stream', percent => change(u.id, { percent }))
    change(u.id, { state: 'uploading', percent: 0, abort: put.abort })
    void put.done.then(
      () => { change(u.id, { state: 'done', percent: 100, abort: undefined }); pump() },
      (failure: UploadFailure) => {
        // Stopped on purpose (its block went): it isn't a failure to say anything about, until Undo brings the block back.
        change(u.id, failure.retry
          ? navigator.onLine ? { state: 'failed', message: 'Not uploaded', abort: undefined } : { state: 'offline', message: 'Offline · Retry when you’re back', abort: undefined }
          : { state: 'refused', message: failure.message, abort: undefined })
        pump()
      },
    )
  }
}
const retry = (id: string) => { change(id, { state: 'waiting', percent: 0, message: '' }); pump() }
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { for (const u of uploads.values()) if (u.state === 'offline') retry(u.id) })
  // Closing mid-upload loses it, as closing mid-word would (§4).
  window.addEventListener('beforeunload', e => { if ([...uploads.values()].some(u => u.state === 'uploading' || u.state === 'waiting')) e.preventDefault() })
}
if (typeof window !== 'undefined') {
  // A file let go beside the column mustn't leave the page for it. A file field still takes its own.
  const isFile = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && !(e.target as Element | null)?.closest?.('input[type=file]')
  window.addEventListener('dragover', e => { if (isFile(e)) e.preventDefault() })
  window.addEventListener('drop', e => { if (isFile(e)) e.preventDefault() })
}
/** Starts the bytes on their way and gives the address the block holds from now on. */
export function startBodyUpload(file: File): string {
  const id = crypto.randomUUID(), tooLarge = file.size > fileLimits.size
  uploads.set(id, { id, file, preview: file.type.startsWith('image/') && !tooLarge ? URL.createObjectURL(file) : null, state: tooLarge ? 'refused' : 'waiting', percent: 0, message: tooLarge ? `Too large · ${fileLimits.size / 1024 / 1024} MB at most` : '' })
  pump()
  return bodyFileUrl(id, file.name.slice(0, 255) || 'Untitled', file.size, file.type)
}
/** For the editor: what its images draw while the bytes are only here. */
export const resolveBodyFile = async (url: string) => { const file = bodyFileOf(url), up = file && uploads.get(file.id); return up?.preview ?? url }
const useUpload = (id: string | undefined) => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => (id ? uploads.get(id) : undefined), () => undefined)

type Editor = BlockNoteEditor<any, any, any>
// Which image's caption is being written. Out here, as a block's view is drawn anew when focus leaves the editor.
let writingCaption: string | null = null
const writeCaption = (blockId: string | null) => { writingCaption = blockId; listeners.forEach(l => l()) }
const useWritingCaption = (blockId: string) => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => writingCaption === blockId, () => false)
const fileBlock = (file: File, as?: 'file') => ({ type: !as && showsAsImage(file.type) ? 'image' : 'file', props: { url: startBodyUpload(file), name: file.name.slice(0, 255) || 'Untitled' } })
/** From the block's own panel, or Replace. `/image` given something that isn't an image makes a file block; `/file` given an image stays a file, as asked (§2). */
export function uploadFromPanel(editor: Editor, file: File, blockId?: string) {
  const block = blockId ? editor.getBlock(blockId) : undefined
  if (block?.type === 'image' && !showsAsImage(file.type)) editor.updateBlock(blockId!, { type: 'file' } as never)
  return startBodyUpload(file)
}
/** One block per file, in order, as one change (§3). */
export function insertBodyFiles(editor: Editor, files: readonly File[], reference: string, placement: 'before' | 'after'): string[] {
  const made = editor.insertBlocks(files.map(f => fileBlock(f)) as never, reference, placement)
  return made.map((b: { id: string }) => b.id)
}
/** A paste lands at the caret and the caret goes to the line below, of the same kind, so a day's bullets carry on. An empty line it lands on is used up. */
export function pasteBodyFiles(editor: Editor, files: readonly File[]) {
  const at = editor.getTextCursorPosition().block as { id: string; type: string; content?: unknown }
  const type = at.type === 'bulletListItem' || at.type === 'numberedListItem' ? at.type : 'paragraph'
  const empty = at.type === type && Array.isArray(at.content) && at.content.length === 0
  const ids = insertBodyFiles(editor, files, at.id, 'after')
  if (empty) editor.removeBlocks([at.id])
  // A line that's empty, or a new one: typing mustn't land inside the words below.
  const last = ids.at(-1)!, below = editor.getNextBlock(last) as { id: string; type: string; content?: unknown } | undefined
  if (below?.type === type && Array.isArray(below.content) && !below.content.length) { editor.setTextCursorPosition(below.id, 'start'); return }
  const [line] = editor.insertBlocks([{ type }] as never, last, 'after')
  editor.setTextCursorPosition(line!.id, 'start')
}

/** Whether the file's there, for a block that holds no bytes here. Looks again when the page regains focus, so an upload finished elsewhere shows up. */
function useFileThere(url: string, look: boolean): boolean | null {
  const [there, setThere] = useState<boolean | null>(null)
  useEffect(() => {
    if (!look) return
    let stopped = false
    const ask = () => { void fetch(url, { method: 'HEAD', cache: 'no-store' }).then(r => { if (!stopped) setThere(r.ok) }, () => {}) }
    ask()
    window.addEventListener('focus', ask)
    return () => { stopped = true; window.removeEventListener('focus', ask) }
  }, [url, look])
  return there
}
/** Choose again and Replace: the block, its width and its caption stay. The old file stays until the sweep, so Undo brings it back. */
function chooseAgain(editor: Editor, blockId: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = () => { const file = input.files?.[0]; if (file) editor.updateBlock(blockId, { ...fileBlock(file, editor.getBlock(blockId)?.type === 'file' ? 'file' : undefined) } as never) }
  input.click()
}
const uploadDone = (url: string) => { const file = bodyFileOf(url), up = file && uploads.get(file.id); return !up || up.state === 'done' }
const openFile = (url: string) => { window.open(url, '_blank', 'noopener') }
function downloadFile(url: string, name: string) {
  const link = document.createElement('a')
  link.href = url; link.download = name
  link.click()
}
/** Align only shows on an image narrower than the column (§5). */
function narrowerThanColumn(editor: Editor, blockId: string) {
  const image = editor.domElement?.querySelector<HTMLElement>(`.bn-block[data-id="${blockId}"] .bn-visual-media`), column = image?.closest<HTMLElement>('.bn-block-content')
  return Boolean(image && column && image.getBoundingClientRect().width < column.getBoundingClientRect().width - 1)
}
const useSelectedFile = () => {
  const blocks = useSelectedBlocks<any, any, any>(), block = blocks[0]
  return blocks.length === 1 && (block?.type === 'image' || block?.type === 'file') && block.props.url ? block : undefined
}
/** Trimmed to images: a day note's lines have no alignment (Jazz, #6). */
export function BodyImageAlign() {
  const editor = useBlockNoteEditor<any, any, any>(), block = useSelectedFile()
  if (block?.type !== 'image' || !narrowerThanColumn(editor, block.id)) return null
  return <><TextAlignButton textAlignment="left" /><TextAlignButton textAlignment="center" /><TextAlignButton textAlignment="right" /></>
}
/** Written in place, as a line under the picture (§5). A file is one row, with no caption. */
export function BodyImageCaptionButton() {
  const Components = useComponentsContext()!, block = useSelectedFile()
  if (block?.type !== 'image') return null
  return <Components.FormattingToolbar.Button className="bn-button" label="Caption" mainTooltip="Caption" icon={<CaptionIcon />} onClick={() => writeCaption(block.id)} />
}
/** ↗ and Download, neither until the upload's done (§5). A web link has nothing of ours to save. */
export function BodyFileOpenButtons() {
  const Components = useComponentsContext()!
  const block = useSelectedFile(), ours = block && bodyFileOf(block.props.url)
  useUpload(ours?.id)
  if (!block || !uploadDone(block.props.url)) return null
  return <>
    {ours && <Components.FormattingToolbar.Button className="bn-button" label="Download" mainTooltip="Download" icon={<DownloadIcon />} onClick={() => downloadFile(block.props.url, block.props.name || ours.name)} />}
    <Components.FormattingToolbar.Button className="bn-button" label="Open in a new tab" mainTooltip="Open in a new tab" icon={<ExternalIcon />} onClick={() => openFile(block.props.url)} />
  </>
}
/** The phone's way to what a selected block's bar offers at 1280 (§5): there's no bar to hover over, and no resize. Opening it lets the keyboard go, which would leave the menu no room. */
function BodyBlockMenu({ block }: { block: { id: string; type: string; props: Record<string, any> } }) {
  const editor = useBlockNoteEditor<any, any, any>(), button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const url: string = block.props.url, ours = bodyFileOf(url), done = uploadDone(url)
  const close = () => { setOpen(false); setAt(null) }
  useLayoutEffect(() => {
    if (!open || !menu.current || !button.current) return
    const box = button.current.getBoundingClientRect(), { height, width } = menu.current.getBoundingClientRect(), edge = 8
    const below = box.bottom + 4, top = below + height <= window.innerHeight - edge ? below : Math.max(edge, box.top - 4 - height)
    setAt({ top, left: Math.max(edge, Math.min(box.right - width, window.innerWidth - width - edge)) })
  }, [open])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close() }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  const act = (run: () => void) => () => { close(); run() }
  const align = (textAlignment: string) => act(() => editor.updateBlock(block.id, { props: { textAlignment } } as never))
  return <>
    <button ref={button} type="button" className="body-file-more" aria-label="More" aria-expanded={open} contentEditable={false} onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setOpen(!open) }}>⋯</button>
    {open && createPortal(<div ref={menu} className="app-menu body-file-menu" role="menu" aria-label="File actions" style={{ position: 'fixed', top: at?.top ?? 0, left: at?.left ?? 0, right: 'auto', visibility: at ? 'visible' : 'hidden' }}>
      {block.type === 'image' && <button type="button" role="menuitem" onClick={act(() => writeCaption(block.id))}>Caption</button>}
      <button type="button" role="menuitem" onClick={act(() => chooseAgain(editor, block.id))}>Replace</button>
      {block.type === 'image' && narrowerThanColumn(editor, block.id) && <>
        <button type="button" role="menuitem" onClick={align('left')}>Align left</button>
        <button type="button" role="menuitem" onClick={align('center')}>Align centre</button>
        <button type="button" role="menuitem" onClick={align('right')}>Align right</button>
      </>}
      {done && ours && <button type="button" role="menuitem" onClick={act(() => downloadFile(url, block.props.name || ours.name))}>Download</button>}
      {done && <button type="button" role="menuitem" onClick={act(() => openFile(url))}>Open in a new tab</button>}
      <button type="button" role="menuitem" onClick={act(() => editor.removeBlocks([block.id]))}>Remove</button>
    </div>, document.body)}
  </>
}
/** The caption's field, in the caption's place. Enter leaves it for a line below, Esc leaves it as it was, and going elsewhere keeps what's written (§5). */
function BodyCaptionField({ blockId, caption }: { blockId: string; caption: string }) {
  const editor = useBlockNoteEditor<any, any, any>(), left = useRef(false)
  const leave = (value: string | null, lineBelow = false) => {
    if (left.current) return
    left.current = true
    writeCaption(null)
    editor.transact(() => {
      if (value !== null && value !== caption) editor.updateBlock(blockId, { props: { caption: value } } as never)
      if (!lineBelow) return
      const below = editor.getNextBlock(blockId) as { id: string; type: string; content?: unknown } | undefined
      const line = below?.type === 'paragraph' && Array.isArray(below.content) && !below.content.length ? below : editor.insertBlocks([{ type: 'paragraph' }] as never, blockId, 'after')[0]!
      editor.setTextCursorPosition(line.id, 'start')
    })
    if (lineBelow) editor.focus()
  }
  return <input className="body-image-caption" aria-label="Caption" placeholder="Caption" autoFocus defaultValue={caption} maxLength={1000}
    onBlur={e => leave(e.currentTarget.value)}
    onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); leave(e.currentTarget.value, true) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leave(null) }
    }} />
}
/** The line a block says its state on (§4). It never takes the block's words from the page. */
function BodyFileLine({ blockId, up, name, missing, cantShow }: { blockId: string; up: Upload | undefined; name?: string; missing: boolean; cantShow?: string }) {
  const editor = useBlockNoteEditor<any, any, any>()
  const remove = <button type="button" onClick={() => editor.removeBlocks([blockId])}>Remove</button>
  let words: ReactNode = null, action: ReactNode = null
  if (up?.state === 'failed') { words = up.message; action = <button type="button" onClick={() => retry(up.id)}>Retry</button> }
  else if (up?.state === 'offline' || up?.state === 'refused') words = up.message
  else if (missing) { words = name ? `${name} isn't here` : "Isn't here"; action = <button type="button" onClick={() => chooseAgain(editor, blockId)}>Choose again</button> }
  else if (cantShow) return <div className="body-file-line" contentEditable={false} role="status"><span>Can't show this image here</span><button type="button" onClick={() => downloadFile(cantShow, name ?? '')}>Download</button></div>
  if (!words) return null
  return <div className="body-file-line" contentEditable={false} role="status"><span>{words}</span>{action}{remove}</div>
}
/** A block deleted mid-upload stops its upload (§4). Undo brings it back, reading Not uploaded · Retry. */
function useStopWhenGone(blockId: string, up: Upload | undefined) {
  const editor = useBlockNoteEditor<any, any, any>()
  const id = up?.id
  useEffect(() => () => {
    if (!id) return
    queueMicrotask(() => { const now = uploads.get(id); if (now && (now.state === 'uploading' || now.state === 'waiting') && !editor.getBlock(blockId)) { now.abort?.(); change(id, { state: 'failed', message: 'Not uploaded', abort: undefined }) } })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** An `Add image` nobody filled: its way out, as a handle or a key isn't always to hand on a phone (B87 15). */
function BodyEmptyFile({ blockId, children }: { blockId: string; children: ReactNode }) {
  const editor = useBlockNoteEditor<any, any, any>()
  return <div className="body-file-empty">{children}<button type="button" contentEditable={false} onClick={() => editor.removeBlocks([blockId])}>Remove</button></div>
}
function BodyImageView(props: any) {
  const url: string = props.block.props.url, name: string = props.block.props.name, ours = bodyFileOf(url)
  const [broken, setBroken] = useState(false), [failedOnce, setFailedOnce] = useState(false), [loaded, setLoaded] = useState(false), [chosen, setChosen] = useState(false)
  const up = useUpload(ours?.id)
  // The picture's own request says whether it's there; asking first would cost every photo on a day a second trip.
  const there = useFileThere(url, Boolean(ours && !up && failedOnce))
  const writing = useWritingCaption(props.block.id)
  useStopWhenGone(props.block.id, up)
  useEffect(() => { setBroken(false); setFailedOnce(false); setLoaded(false) }, [url])
  // A caption is written where it reads: a click on it edits it.
  useEffect(() => {
    const onCaption = (e: MouseEvent) => { const on = e.target as Element; if (on.closest?.('.bn-file-caption') && on.closest('.bn-block')?.getAttribute('data-id') === props.block.id) writeCaption(props.block.id) }
    document.addEventListener('click', onCaption)
    return () => document.removeEventListener('click', onCaption)
  }, [props.block.id])
  // Only once it's gone: an error that arrives alongside the file being found mustn't be forgotten, with the same picture never failing again. If it turns up later, the picture's drawn anew.
  useEffect(() => { if (there === false) setBroken(false) }, [there])
  // Back online, it tries again: the picture's drawn anew.
  useEffect(() => { const again = () => setBroken(false); window.addEventListener('online', again); return () => window.removeEventListener('online', again) }, [])
  // A tap selects it on a phone, where there's no hover to bring its actions (§5).
  useEffect(() => {
    const away = (e: PointerEvent) => { const on = e.target as Element; if (!on.closest?.('.body-file-menu')) setChosen(on.closest?.('.bn-block')?.getAttribute('data-id') === props.block.id) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [props.block.id])
  const missing = Boolean(ours && !up && there === false), cantShow = Boolean(ours && broken && (up || there === true))
  // Ours, online and not yet known either way: the box holds its place until the answer's back.
  const failed = broken && !missing && !cantShow && (!ours || !navigator.onLine)
  if (!url) return <BodyEmptyFile blockId={props.block.id}><ResizableFileBlockWrapper {...props} buttonIcon={<ImageIcon />} /></BodyEmptyFile>
  return <ResizableFileBlockWrapper {...props}>
    {missing || cantShow || (broken && !failed)
      ? <div className="body-image-box" contentEditable={false} />
      : failed
        ? <div className="body-file-line" contentEditable={false}><span>{navigator.onLine ? "Can't load this image" : "Offline · Can't load this image"}</span>{!ours && <a href={url} target="_blank" rel="noreferrer">{url}</a>}</div>
        : <img className={`bn-visual-media${loaded ? '' : ' body-image-loading'}`} src={up?.preview ?? url} alt={name || ''} width={props.block.props.previewWidth} loading="lazy" decoding="async" contentEditable={false} draggable={false} onLoad={() => setLoaded(true)} onError={() => { setBroken(true); setFailedOnce(true) }} />}
    {(up?.state === 'uploading' || up?.state === 'waiting') && <div className="body-file-progress"><div style={{ width: `${up.percent}%` }} /></div>}
    {chosen && <div className="body-image-more"><BodyBlockMenu block={props.block} /></div>}
    <BodyFileLine blockId={props.block.id} up={up} name={name || ours?.name || 'This file'} missing={missing} cantShow={cantShow && uploadDone(url) ? url : undefined} />
    {writing && <BodyCaptionField blockId={props.block.id} caption={props.block.props.caption ?? ''} />}
  </ResizableFileBlockWrapper>
}
function BodyFileView(props: any) {
  const url: string = props.block.props.url, ours = bodyFileOf(url), name: string = props.block.props.name || ours?.name || 'File'
  const up = useUpload(ours?.id), there = useFileThere(url, Boolean(ours && !up))
  useStopWhenGone(props.block.id, up)
  const missing = Boolean(ours && !up && there === false)
  if (!url) return <BodyEmptyFile blockId={props.block.id}><FileBlockWrapper {...props} buttonIcon={<PaperclipIcon />} /></BodyEmptyFile>
  const size = ours?.size ?? null
  const note = up?.state === 'uploading' && size !== null ? `${fileSizeLabel(size * up.percent / 100)} of ${fileSizeLabel(size)}` : size !== null ? fileSizeLabel(size) : ''
  const ready = !up || up.state === 'done', opens = !ours || shownInPlace.has(ours.type)
  return <FileBlockWrapper {...props}>
    <div className="body-file" contentEditable={false}>
      <PaperclipIcon />
      {ready && !missing ? <a className="body-file-name" href={url} target="_blank" rel="noreferrer">{name}</a> : <span className="body-file-name">{name}</span>}
      {!missing && <span className="body-file-size">{note}</span>}
      {ready && !missing && <a className="body-file-go" href={url} {...opens ? { target: '_blank', rel: 'noreferrer', 'aria-label': `Open ${name}` } : { download: name, 'aria-label': `Download ${name}` }}>{opens ? <ExternalIcon /> : <DownloadIcon />}</a>}
      <span className="body-file-menu-at"><BodyBlockMenu block={props.block} /></span>
    </div>
    <BodyFileLine blockId={props.block.id} up={up} missing={missing} />
  </FileBlockWrapper>
}

export const bodyImageSpec = createReactBlockSpec(createImageBlockConfig, config => ({
  meta: { fileBlockAccept: ['image/*'] },
  render: BodyImageView,
  parse: imageParse(config),
  toExternalHTML: ImageToExternalHTML,
  runsBefore: ['file'],
}))
export const bodyFileSpec = createReactBlockSpec(createFileBlockConfig, {
  render: BodyFileView,
  parse: fileParse(),
  toExternalHTML: (props: any) => (props.block.props.url ? <a href={props.block.props.url}>{props.block.props.name || props.block.props.url}</a> : <p>Add file</p>),
})
