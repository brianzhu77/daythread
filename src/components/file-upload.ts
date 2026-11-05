// A file's bytes to the store, with progress, which fetch can't report on an upload. Its value goes into the row only once this has finished.
import type { FileValue } from '../domain/database'

export interface FileItem { key: string; name: string; state: 'done' | 'uploading' | 'failed'; value?: FileValue; file?: File; progress?: number; message?: string }
export interface UploadFailure { message: string; retry: boolean }

export const fileHref = (file: Pick<FileValue, 'id' | 'name'>) => `/api/files/${file.id}?name=${encodeURIComponent(file.name)}`
export const fileSizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

export function putFile(id: string, body: Blob, type: string, onProgress?: (percent: number) => void) {
  const request = new XMLHttpRequest()
  const done = new Promise<void>((resolve, reject) => {
    request.open('PUT', `/api/files/${id}`)
    request.setRequestHeader('content-type', type)
    request.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(Math.round(e.loaded / e.total * 100)) }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else if (request.status === 507) reject({ message: 'Storage full · 5 GB at most', retry: false } satisfies UploadFailure)
      else if (request.status === 413) reject({ message: 'Too large · 25 MB at most', retry: false } satisfies UploadFailure)
      else reject({ message: "Couldn't upload", retry: true } satisfies UploadFailure)
    }
    request.onerror = () => reject({ message: "Couldn't upload", retry: true } satisfies UploadFailure)
    request.onabort = () => reject({ message: 'Stopped', retry: true } satisfies UploadFailure)
    request.send(body)
  })
  return { done, abort: () => request.abort() }
}

/** A small copy for a Gallery card, as full photos would be slow there. Best effort: some images can't be decoded here (HEIC outside Safari), and the card then has the file itself. */
async function smallCopy(file: File, longest = 640): Promise<Blob | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  } catch { return null }
}

export function uploadFile(file: File, onProgress: (percent: number) => void): { done: Promise<FileValue>; abort: () => void } {
  const id = crypto.randomUUID(), type = file.type || 'application/octet-stream'
  const main = putFile(id, file, type, onProgress)
  let stopped = false
  const done = main.done.then(async (): Promise<FileValue> => {
    const value: FileValue = { id, name: file.name.slice(0, 255) || 'Untitled', size: file.size, type: type.slice(0, 100) }
    const small = stopped ? null : await smallCopy(file)
    if (!small) return value
    const thumb = crypto.randomUUID()
    // The file's in, so a card with no small copy is still a card.
    return putFile(thumb, small, 'image/jpeg').done.then(() => ({ ...value, thumb }), () => value)
  })
  return { done, abort: () => { stopped = true; main.abort() } }
}

/**
 * A picture for a page's icon or cover: only the size it needs, so a photo doesn't load whole in the sidebar, and only once its bytes are in does the page hold it, so a failed upload leaves nothing behind.
 * A picture this browser can't decode goes as it is. SVG is refused, as it could run on our origin (R3-11).
 */
export function uploadLook(file: File, longest: number, onProgress: (percent: number) => void): { done: Promise<string>; abort: () => void } {
  let current: { abort: () => void } | null = null, stopped = false
  const done = (async () => {
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw { message: 'That needs to be a picture', retry: false } satisfies UploadFailure
    const small = await smallCopy(file, longest)
    if (stopped) throw { message: 'Stopped', retry: true } satisfies UploadFailure
    const body = small ?? file, type = small ? 'image/jpeg' : file.type, id = crypto.randomUUID()
    const put = putFile(id, body, type, onProgress)
    current = put
    await put.done
    return `/api/files/${id}?name=${encodeURIComponent(file.name.slice(0, 120) || 'Untitled')}`
  })()
  return { done, abort: () => { stopped = true; current?.abort() } }
}

