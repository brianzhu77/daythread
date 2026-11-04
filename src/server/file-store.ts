// Files (R3-11, docs/plan/files-sizing.md): the bytes, kept outside the workspace. R2 through the Worker's binding when it has one, a folder
// otherwise, so the Mac and every check run without Cloudflare. The key starts with the signed-in account, which never comes from the request.
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileLimits } from '../domain/database.ts'
import { currentOwner } from './auth/request-owner.ts'

export const fileSizeLimit = fileLimits.size
export const fileIdPattern = /^[A-Za-z0-9_-]{8,64}$/

export interface StoredKey { key: string; size: number; storedAt: number }
export interface StoredFile { body: ReadableStream; size: number; type: string; etag: string }
export interface FileStore {
  put(key: string, body: ReadableStream, size: number, type: string): Promise<void>
  get(key: string): Promise<StoredFile | null>
  delete(keys: string[]): Promise<void>
  /** Every key under a prefix, with its size and when it was stored. */
  list(prefix: string): Promise<StoredKey[]>
}
export const ownerPrefix = (owner: string | undefined = currentOwner()) => `${owner ?? 'local'}/`
export const fileKey = (fileId: string, owner: string | undefined = currentOwner()) => `${ownerPrefix(owner)}${fileId}`

/** An upload this size would pass the account's limit. Read from the store, so two at once can pass it by one file: it's a guard, not a meter. */
export async function accountIsFull(store: FileStore, size: number, owner?: string): Promise<boolean> {
  const stored = await store.list(ownerPrefix(owner))
  return stored.reduce((sum, f) => sum + f.size, 0) + size > fileLimits.account
}

const sweepAfterMs = 7 * 24 * 60 * 60_000
/** Every token that could be a file's id, in whatever text can hold one. It reads all of it, not just Files values: a property changed to another type keeps its old value. */
export const idsHeldIn = (text: string): Set<string> => new Set(text.match(/[A-Za-z0-9_-]{8,64}/g) ?? [])
/**
 * Removes what nothing holds any more (R3-11). This is the one thing that can lose a file for good, so it errs towards keeping: anything anywhere
 * that reads as the id holds it, and nothing under 7 days old goes, which covers an upload not attached yet, a tab behind and restoring a recent backup.
 */
export async function sweepFiles(store: FileStore, held: Set<string>, now: number, owner?: string): Promise<number> {
  const prefix = ownerPrefix(owner)
  const gone = (await store.list(prefix)).filter(f => now - f.storedAt > sweepAfterMs && !held.has(f.key.slice(prefix.length))).map(f => f.key)
  if (gone.length) await store.delete(gone)
  return gone.length
}

class FolderFileStore implements FileStore {
  private readonly root: string
  constructor(root: string) { this.root = root }
  private path(key: string) { return join(this.root, key) }
  async put(key: string, body: ReadableStream, size: number, type: string) {
    const path = this.path(key), part = `${path}.part`
    await mkdir(dirname(path), { recursive: true })
    await pipeline(Readable.fromWeb(body as never), createWriteStream(part))
    if ((await stat(part)).size !== size) { await rm(part, { force: true }); throw new Error('The file came in at a different size') }
    await writeFile(`${path}.type`, type)
    await rename(part, path)
  }
  async get(key: string): Promise<StoredFile | null> {
    const path = this.path(key)
    const info = await stat(path).catch(() => null)
    if (!info) return null
    return { body: Readable.toWeb(createReadStream(path)) as ReadableStream, size: info.size, type: await readFile(`${path}.type`, 'utf8').catch(() => 'application/octet-stream'), etag: `${info.size}-${Math.floor(info.mtimeMs)}` }
  }
  async delete(keys: string[]) {
    for (const key of keys) await Promise.all([rm(this.path(key), { force: true }), rm(`${this.path(key)}.type`, { force: true })])
  }
  async list(prefix: string) {
    const folder = this.path(prefix.replace(/\/$/, ''))
    const names = await readdir(folder).catch(() => [] as string[])
    const out: StoredKey[] = []
    for (const name of names) {
      if (name.endsWith('.type') || name.endsWith('.part')) continue
      const info = await stat(join(folder, name))
      out.push({ key: `${prefix.replace(/\/$/, '')}/${name}`, size: info.size, storedAt: info.mtimeMs })
    }
    return out
  }
}

interface R2Object { size: number; httpEtag: string; httpMetadata?: { contentType?: string }; body: ReadableStream }
interface R2Bucket {
  put(key: string, body: ReadableStream, options: { httpMetadata: { contentType: string } }): Promise<unknown>
  get(key: string): Promise<R2Object | null>
  delete(keys: string[]): Promise<void>
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: Array<{ key: string; size: number; uploaded: Date }>; truncated: boolean; cursor?: string }>
}
class R2FileStore implements FileStore {
  private readonly bucket: R2Bucket
  constructor(bucket: R2Bucket) { this.bucket = bucket }
  async put(key: string, body: ReadableStream, _size: number, type: string) { await this.bucket.put(key, body, { httpMetadata: { contentType: type } }) }
  async get(key: string): Promise<StoredFile | null> {
    const object = await this.bucket.get(key)
    return object && { body: object.body, size: object.size, type: object.httpMetadata?.contentType ?? 'application/octet-stream', etag: object.httpEtag }
  }
  async delete(keys: string[]) { for (let at = 0; at < keys.length; at += 1000) await this.bucket.delete(keys.slice(at, at + 1000)) }
  async list(prefix: string) {
    const out: StoredKey[] = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix, ...(cursor ? { cursor } : {}) })
      out.push(...page.objects.map(o => ({ key: o.key, size: o.size, storedAt: o.uploaded.getTime() })))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return out
  }
}

let store: Promise<FileStore> | undefined
/** The specifier is a variable so no other build tries to resolve the Workers-only module. */
export function fileStore(): Promise<FileStore> {
  return store ??= (async () => {
    if (globalThis.navigator?.userAgent === 'Cloudflare-Workers') {
      const workers = 'cloudflare:workers'
      const { env } = await import(/* @vite-ignore */ workers) as { env: { DAYTHREAD_FILES?: R2Bucket } }
      if (!env.DAYTHREAD_FILES) throw new Error('The Worker has no DAYTHREAD_FILES binding')
      return new R2FileStore(env.DAYTHREAD_FILES)
    }
    return new FolderFileStore(process.env.DAYTHREAD_FILES_PATH ?? join(dirname(process.env.DAYTHREAD_SQLITE_PATH ?? '.'), 'daythread-files'))
  })()
}
