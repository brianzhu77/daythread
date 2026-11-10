import assert from 'node:assert/strict'
import { test } from 'node:test'

class FakeStorage implements Storage {
  private readonly map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

// Node has no localStorage or sessionStorage; install them before draft-slots.ts is first used.
Object.defineProperty(globalThis, 'localStorage', { value: new FakeStorage(), configurable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: new FakeStorage(), configurable: true })

const { setDraftOwner, writeOwn, readOwn, ownDrafts, orphans, ownKey, tabId } = await import('../src/components/draft-slots.ts')

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const day = 'day:2026-11-09'
const slot = { base: 'b', document: '[]' }

const keysWith = (start: string) => {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(start)) out.push(key)
  }
  return out
}

test('a draft is stored under its account', () => {
  localStorage.clear()
  setDraftOwner(A)
  writeOwn(day, slot)
  assert.ok(ownKey(day).startsWith(`daythread:draft:${A}:`))
  assert.equal(readOwn(day)?.document, slot.document)
  const drafts = ownDrafts()
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.pageId, day)
})

test('another account on the same browser never sees it, and it is back for its own account', () => {
  localStorage.clear()
  setDraftOwner(A)
  writeOwn(day, slot)
  setDraftOwner(B)
  assert.equal(readOwn(day), null)
  assert.equal(ownDrafts().length, 0)
  assert.equal(orphans(day).length, 0)
  writeOwn(day, { base: 'b', document: '["b"]' })
  setDraftOwner(A)
  assert.equal(readOwn(day)?.document, slot.document)
})

test("a gone tab's draft is an orphan only for its own account", () => {
  localStorage.clear()
  setDraftOwner(A)
  localStorage.setItem(ownKey(day, 'other-tab'), JSON.stringify({ base: 'b', document: '[1]', seen: Date.now(), closed: true }))
  assert.equal(orphans(day).length, 1)
  setDraftOwner(B)
  assert.equal(orphans(day).length, 0)
})

test('a draft from before accounts goes to the first account that loads, once', () => {
  localStorage.clear()
  setDraftOwner(null)
  writeOwn(day, slot)
  assert.ok(ownKey(day).startsWith('daythread:editor:'))
  setDraftOwner(A)
  assert.equal(readOwn(day)?.document, slot.document)
  assert.equal(keysWith('daythread:editor:').length, 0)
  setDraftOwner(B)
  assert.equal(readOwn(day), null)
})

test('with sign-in off the key is unchanged', () => {
  localStorage.clear()
  setDraftOwner('local')
  writeOwn(day, slot)
  assert.ok(ownKey(day).startsWith('daythread:editor:'))
  assert.equal(readOwn(day)?.document, slot.document)
})

test('when both keys hold a draft, the one written last stays', () => {
  localStorage.clear()
  setDraftOwner(A)
  writeOwn(day, { base: 'b', document: '["old"]' })
  const legacyKey = 'daythread:editor:' + day + ':' + tabId()
  localStorage.setItem(legacyKey, JSON.stringify({ base: 'b', document: '["new"]', seen: Date.now() + 60_000 }))
  setDraftOwner(null)
  setDraftOwner(A)
  assert.equal(readOwn(day)?.document, '["new"]')
  assert.equal(localStorage.getItem(legacyKey), null)
})

test('a draft another tab may still be writing is left alone until that tab has gone', () => {
  localStorage.clear()
  setDraftOwner(null)
  const legacyKey = 'daythread:editor:' + day + ':other-tab'
  localStorage.setItem(legacyKey, JSON.stringify({ base: 'b', document: '[1]', seen: Date.now() }))
  setDraftOwner(A)
  assert.notEqual(localStorage.getItem(legacyKey), null)
  assert.equal(orphans(day).length, 0)
  localStorage.setItem(legacyKey, JSON.stringify({ base: 'b', document: '[1]', seen: Date.now(), closed: true }))
  ownDrafts()
  assert.equal(localStorage.getItem(legacyKey), null)
  assert.equal(orphans(day).length, 1)
})

test('the oldest one-slot key is taken too', () => {
  localStorage.clear()
  setDraftOwner(null)
  localStorage.setItem('daythread:editor:' + day, JSON.stringify({ base: 'b', document: '[2]' }))
  setDraftOwner(A)
  assert.equal(keysWith('daythread:editor:').length, 0)
  const found = orphans(day)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.slot.document, '[2]')
})
