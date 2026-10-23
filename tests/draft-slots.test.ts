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
/** A tab: its own page load (a fresh module instance) with this id in its sessionStorage. */
let loads = 0
const as = async (tab: string): Promise<typeof slots> => {
  g.sessionStorage.setItem('daythread.tab', tab); g.localStorage.removeItem(`daythread:tab-owner:${tab}`)
  return await import(`../src/components/draft-slots.ts?load=${++loads}`)
}
beforeEach(() => { g.localStorage.clear(); g.sessionStorage.clear() })

test('each tab keeps its own slot; a tab reads only its own', async () => {
  const a = await as('A'); a.writeOwn(page, { base: 'b', document: 'from A' })
  const b = await as('B'); b.writeOwn(page, { base: 'b', document: 'from B' })
  assert.equal(b.readOwn(page)?.document, 'from B')
  assert.equal(a.readOwn(page)?.document, 'from A')
})

test('orphans: closed or gone quiet, never a live tab; the old one-slot key counts once', async () => {
  const now = Date.now()
  const a = await as('A'); a.writeOwn(page, { base: 'b', document: 'closed tab' }); a.touchOwn(page, true)
  const b = await as('B'); b.writeOwn(page, { base: 'b', document: 'live tab' })
  g.localStorage.setItem(`daythread:editor:${page}:C`, JSON.stringify({ base: 'b', document: 'quiet tab', seen: now - slots.goneAfterMs - 1 }))
  g.localStorage.setItem(`daythread:editor:${page}`, JSON.stringify({ base: 'b', document: 'old key' }))
  const d = await as('D')
  const found = d.orphans(page, now).map(o => o.slot.document).sort()
  assert.deepEqual(found, ['closed tab', 'old key', 'quiet tab'])
})

test('a claimed slot: the owner sees the claim, reads nothing, and the claim is swept once acted on', async () => {
  const a = await as('A'); a.writeOwn(page, { base: 'b', document: 'suspended text' })
  const b = await as('B'); b.claim(page, b.ownKey(page, 'A'))
  assert.equal(b.orphans(page).length, 0, 'a claimed slot is nobody\'s orphan')
  assert.equal(a.ownClaimed(page), true)
  assert.equal(a.readOwn(page), null, 'the claimed copy is never read back')
  a.sweepClaims(page)
  b.claim(page, `daythread:editor:${page}`)
  assert.equal(g.localStorage.getItem(`daythread:editor:${page}`), null, 'the old key is just removed')
})

test('clearOwn with a document clears only that draft', async () => {
  const a = await as('A'); a.writeOwn(page, { base: 'b', document: 'newer' })
  a.clearOwn(page, 'older'); assert.equal(a.readOwn(page)?.document, 'newer')
  a.clearOwn(page, 'newer'); assert.equal(a.readOwn(page), null)
})

test('a draft merged on opening drops what the page already has: same words (any whitespace) and empty lines', () => {
  const n = (id: string, content: string, children: any[] = []) => ({ id, content, children })
  const latest = [n('h', 'Notes'), n('x', 'already saved')]
  const draft = [n('h', 'Notes'), n('x', 'already saved  '), n('e', ''), n('y', 'new line')]
  const out = slots.withoutSaved(draft, latest, c => String(c ?? ''))
  assert.deepEqual(out.map(x => [x.id, x.content]), [['h', 'Notes'], ['x', 'already saved'], ['y', 'new line']])
})

test('an inherited tab id owned by another live load is replaced; a released one is kept (reload)', async () => {
  g.sessionStorage.setItem('daythread.tab', 'shared')
  g.localStorage.setItem('daythread:tab-owner:shared', JSON.stringify({ instance: 'another-load', seen: Date.now() }))
  const fresh = await import(`../src/components/draft-slots.ts?copied=${Date.now()}`)
  assert.notEqual(fresh.tabId(), 'shared', 'copied from a live tab: a new id')
  g.sessionStorage.setItem('daythread.tab', 'mine'); g.localStorage.removeItem('daythread:tab-owner:mine')
  const reloaded = await import(`../src/components/draft-slots.ts?reload=${Date.now()}`)
  assert.equal(reloaded.tabId(), 'mine', 'released on pagehide: the reload keeps it')
})
