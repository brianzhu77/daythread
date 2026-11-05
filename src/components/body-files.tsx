// Images and files in a page's body (B87, docs/design/body-files.md §4 and §6). The block goes in at once with its address, and the bytes follow; only the tab
// that holds them knows how far they've got. Any other tab finding no file says one thing: it isn't here.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createFileBlockConfig, createImageBlockConfig, fileParse, imageParse, type BlockNoteEditor } from '@blocknote/core'
import { createReactBlockSpec, FileBlockWrapper, ImageToExternalHTML, ResizableFileBlockWrapper, useBlockNoteEditor } from '@blocknote/react'
import { fileLimits } from '../domain/database'
import { bodyFileOf, bodyFileUrl, showsAsImage } from '../domain/body-files'
import { fileSizeLabel, putFile, type UploadFailure } from './file-upload'
import { PaperclipIcon } from './icons'

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
/** Starts the bytes on their way and gives the address the block holds from now on. */
export function startBodyUpload(file: File): string {
  const id = crypto.randomUUID(), tooLarge = file.size > fileLimits.size
  uploads.set(id, { id, file, preview: file.type.startsWith('image/') && !tooLarge ? URL.createObjectURL(file) : null, state: tooLarge ? 'refused' : 'waiting', percent: 0, message: tooLarge ? `Too large · ${fileLimits.size / 1024 / 1024} MB at most` : '' })
  pump()
  return bodyFileUrl(id, file.name.slice(0, 255) || 'Untitled', file.size)
}
/** For the editor: what its images draw while the bytes are only here. */
export const resolveBodyFile = async (url: string) => { const file = bodyFileOf(url), up = file && uploads.get(file.id); return up?.preview ?? url }
const useUpload = (id: string | undefined) => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => (id ? uploads.get(id) : undefined), () => undefined)

type Editor = BlockNoteEditor<any, any, any>
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
/** A paste lands at the caret and the caret goes to the line below, so typing carries on. An empty line it lands on is used up. */
export function pasteBodyFiles(editor: Editor, files: readonly File[]) {
  const at = editor.getTextCursorPosition().block as { id: string; type: string; content?: unknown }
  const empty = at.type === 'paragraph' && Array.isArray(at.content) && at.content.length === 0
  const ids = insertBodyFiles(editor, files, at.id, 'after')
  if (empty) editor.removeBlocks([at.id])
  // A line that's empty, or a new one: typing mustn't land inside the words below.
  const last = ids.at(-1)!, below = editor.getNextBlock(last) as { id: string; type: string; content?: unknown } | undefined
  if (below?.type === 'paragraph' && Array.isArray(below.content) && !below.content.length) { editor.setTextCursorPosition(below.id, 'start'); return }
  const [line] = editor.insertBlocks([{ type: 'paragraph' }] as never, last, 'after')
  editor.setTextCursorPosition(line!.id, 'start')
}

/** Whether the file's there, for a block that holds no bytes here. Looks again when the page regains focus, so an upload finished elsewhere shows up. */
function useFileThere(url: string, ours: boolean, skip: boolean): boolean | null {
  const [there, setThere] = useState<boolean | null>(null)
  useEffect(() => {
    if (!ours || skip) return
    let stopped = false
    const look = () => { void fetch(url, { cache: 'no-cache' }).then(r => { void r.body?.cancel(); if (!stopped) setThere(r.ok || r.status === 304) }, () => {}) }
    look()
    window.addEventListener('focus', look)
    return () => { stopped = true; window.removeEventListener('focus', look) }
  }, [url, ours, skip])
  return there
}
function chooseAgain(editor: Editor, blockId: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = () => { const file = input.files?.[0]; if (file) editor.updateBlock(blockId, { ...fileBlock(file, editor.getBlock(blockId)?.type === 'file' ? 'file' : undefined) } as never) }
  input.click()
}
/** The line a block says its state on (§4). It never takes the block's words from the page. */
function BodyFileLine({ blockId, up, name, missing }: { blockId: string; up: Upload | undefined; name: string; missing: boolean }) {
  const editor = useBlockNoteEditor<any, any, any>()
  const remove = <button type="button" onClick={() => editor.removeBlocks([blockId])}>Remove</button>
  let words: ReactNode = null, action: ReactNode = null
  if (up?.state === 'failed') { words = up.message; action = <button type="button" onClick={() => retry(up.id)}>Retry</button> }
  else if (up?.state === 'offline' || up?.state === 'refused') words = up.message
  else if (missing) { words = `${name} isn't here`; action = <button type="button" onClick={() => chooseAgain(editor, blockId)}>Choose again</button> }
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

function BodyImageView(props: any) {
  const url: string = props.block.props.url, name: string = props.block.props.name, ours = bodyFileOf(url)
  const up = useUpload(ours?.id), there = useFileThere(url, Boolean(ours), Boolean(up))
  const [broken, setBroken] = useState(false)
  useStopWhenGone(props.block.id, up)
  useEffect(() => setBroken(false), [url, there])
  const missing = Boolean(ours && !up && (there === false || broken))
  return <ResizableFileBlockWrapper {...props}>
    {missing
      ? <div className="body-image-box" contentEditable={false} />
      : broken && !ours
        ? <div className="body-file-line" contentEditable={false}><span>Can't load this image</span><a href={url} target="_blank" rel="noreferrer">{url}</a></div>
        : <img className="bn-visual-media" src={up?.preview ?? url} alt={name || ''} width={props.block.props.previewWidth} contentEditable={false} draggable={false} onError={() => setBroken(true)} />}
    {up?.state === 'uploading' && <div className="body-file-progress" style={{ width: `${up.percent}%` }} />}
    <BodyFileLine blockId={props.block.id} up={up} name={name || ours?.name || 'This file'} missing={missing} />
  </ResizableFileBlockWrapper>
}
function BodyFileView(props: any) {
  const url: string = props.block.props.url, ours = bodyFileOf(url), name: string = props.block.props.name || ours?.name || 'File'
  const up = useUpload(ours?.id), there = useFileThere(url, Boolean(ours), Boolean(up))
  useStopWhenGone(props.block.id, up)
  const missing = Boolean(ours && !up && there === false)
  const size = ours?.size ?? null
  const note = up?.state === 'uploading' && size !== null ? `${fileSizeLabel(size * up.percent / 100)} of ${fileSizeLabel(size)}` : size !== null ? fileSizeLabel(size) : ''
  const ready = !up || up.state === 'done'
  return <FileBlockWrapper {...props}>
    <div className="body-file" contentEditable={false}>
      <PaperclipIcon />
      {ready && !missing ? <a className="body-file-name" href={url} target="_blank" rel="noreferrer">{name}</a> : <span className="body-file-name">{name}</span>}
      {!missing && <span className="body-file-size">{note}</span>}
    </div>
    <BodyFileLine blockId={props.block.id} up={up} name={name} missing={missing} />
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
