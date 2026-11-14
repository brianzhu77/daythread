// B98 (Ratchet 61ef1bab): the IndexedDB store's hand-off keeps the same ownership contract as the memory store, in a real
// browser: another account's original is never removed or replaced, whatever the replacement is.
// Usage: node tests/evidence/outbox/idb-handoff.mjs <dev-server-url> [chromium|webkit]  (a `vite dev` server: it imports the module)
import * as pw from '@playwright/test'
const [base, engine = 'chromium'] = process.argv.slice(2)
if (!base) { console.error('Usage: node tests/evidence/outbox/idb-handoff.mjs <dev-server-url> [chromium|webkit]'); process.exit(2) }
const browser = await pw[engine].launch(), page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage()
await page.goto(`${base}/sign-in`)
const out = await page.evaluate(async () => {
  const { idbOutboxStore, memoryOutboxStore } = await import('/src/components/outbox.ts')
  await new Promise(r => { const d = indexedDB.deleteDatabase('daythread-outbox'); d.onsuccess = d.onerror = d.onblocked = () => r(undefined) })
  const entry = (over) => ({ owner: 'a', operationId: crypto.randomUUID(), action: { type: 'task-status' }, baseRevision: 1, ownRevisions: [], readsBeyond: false, writes: ['page:r1'], refs: [], label: 'x', createdAt: 0, state: 'held', ...over })
  const run = async store => {
    const theirs = await store.add(entry({ owner: 'a' }))
    const plain = await store.handOff(theirs, 'b', null)
    const app = await store.handOff(theirs, 'b', entry({ owner: 'b', app: true, state: 'pending' }))
    const foreignReplacement = await store.handOff(theirs, 'a', entry({ owner: 'b', state: 'pending' }))
    const left = (await store.all()).map(e => `${e.owner}:${e.state}`)
    return { plain, app, foreignReplacement, left }
  }
  return { idb: await run(idbOutboxStore()), memory: await run(memoryOutboxStore()) }
})
await browser.close()
const same = JSON.stringify(out.idb) === JSON.stringify(out.memory)
const pass = same && out.idb.plain === 'not-held' && out.idb.app === 'not-held' && out.idb.foreignReplacement === 'not-held' && JSON.stringify(out.idb.left) === '["a:held"]'
console.log(`${pass ? 'PASS' : 'FAIL'} ${engine} another account's original is never removed or replaced, in IndexedDB as in memory · ${JSON.stringify(out)}`)
process.exit(pass ? 0 : 1)
