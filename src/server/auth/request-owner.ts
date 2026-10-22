// The account a request was signed in as, set by the gate for everything the request runs (Lead 7b…, Ratchet):
// the workspace store reads and writes only the row linked to it. Background work started by the request carries it
// explicitly (model/service.ts). Absent when sign-in is off (the Mac's 3000).
import { AsyncLocalStorage } from 'node:async_hooks'

const owner = new AsyncLocalStorage<string>()
export const currentOwner = (): string | undefined => owner.getStore()
export const asOwner = <T,>(userId: string | undefined, fn: () => T): T => userId ? owner.run(userId, fn) : fn()
