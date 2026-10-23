import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// B35 part 2: per-tab recovery slots. Node has no localStorage/sessionStorage, so small in-memory ones stand in.
class MemoryStorage {
  private items = new Map<string, string>()
  get length() { return this.items.size }
  key(i: number) { return [...this.items.keys()][i] ?? null }
  getItem(k: string) { return this.items.get(k) ?? null }
  setItem(k: string, v: string) { this.items.set(k, String(v)) }
  removeItem(k: string) { this.items.delete(k) }
  clear() { this.items.clear() }
}
const g = globalThis as unknown as { localStorage: MemoryStorage; sessionStorage: MemoryStorage }
g.localStorage = new MemoryStorage(); g.sessionStorage = new MemoryStorage()
const slots = await import('../src/components/draft-slots.ts')
const page = 'day:2026-10-23'
const as = (tab: string) => { g.sessionStorage.setItem('daythread.tab', tab) }
beforeEach(() => { g.localStorage.clear(); g.sessionStorage.clear() })

test('each tab keeps its own slot; a tab reads only its own', () => {
  as('A'); slots.writeOwn(page, { base: 'b', document: 'from A' })
  as('B'); slots.writeOwn(page, { base: 'b', document: 'from B' })
  assert.equal(slots.readOwn(page)?.document, 'from B')
  as('A'); assert.equal(slots.readOwn(page)?.document, 'from A')
})

test('orphans: closed or gone quiet, never a live tab; the old one-slot key counts once', () => {
  const now = Date.now()
  as('A'); slots.writeOwn(page, { base: 'b', document: 'closed tab' }); slots.touchOwn(page, true)
  as('B'); slots.writeOwn(page, { base: 'b', document: 'live tab' })
  g.localStorage.setItem(`daythread:editor:${page}:C`, JSON.stringify({ base: 'b', document: 'quiet tab', seen: now - slots.goneAfterMs - 1 }))
  g.localStorage.setItem(`daythread:editor:${page}`, JSON.stringify({ base: 'b', document: 'old key' }))
  as('D')
  const found = slots.orphans(page, now).map(o => o.slot.document).sort()
  assert.deepEqual(found, ['closed tab', 'old key', 'quiet tab'])
})

test('a claimed slot: the owner sees the claim, reads nothing, and the claim is swept once acted on', () => {
  as('A'); slots.writeOwn(page, { base: 'b', document: 'suspended text' })
  as('B'); slots.claim(page, slots.ownKey(page, 'A'))
  assert.equal(slots.orphans(page).length, 0, 'a claimed slot is nobody\'s orphan')
  as('A')
  assert.equal(slots.ownClaimed(page), true)
  assert.equal(slots.readOwn(page), null, 'the claimed copy is never read back')
  slots.writeOwn(page, { base: 'b', document: 'x' }) // the editor checks ownClaimed before writing; this is the store
  slots.sweepClaims(page)
  as('B'); slots.claim(page, `daythread:editor:${page}`)
  assert.equal(g.localStorage.getItem(`daythread:editor:${page}`), null, 'the old key is just removed')
})

test('clearOwn with a document clears only that draft', () => {
  as('A'); slots.writeOwn(page, { base: 'b', document: 'newer' })
  slots.clearOwn(page, 'older'); assert.equal(slots.readOwn(page)?.document, 'newer')
  slots.clearOwn(page, 'newer'); assert.equal(slots.readOwn(page), null)
})
