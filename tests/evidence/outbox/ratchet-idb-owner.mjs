// Exercise the exact store source in real IndexedDB without starting an app/dev server during the release gate.
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import * as pw from '@playwright/test'
const source = stripTypeScriptTypes(readFileSync('src/components/outbox.ts', 'utf8').replace(/^import .*$/gm, ''), { mode: 'strip' }).replace(/^export /gm, '')
for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch(), page = await browser.newPage()
  await page.route('http://127.0.0.1:43849/**', r => r.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  await page.goto('http://127.0.0.1:43849/')
  const result = await page.evaluate(async source => {
    const { idbOutboxStore, memoryOutboxStore } = new Function(source + ';return {idbOutboxStore,memoryOutboxStore}')()
    const run = async store => {
      const original = { owner: 'a', operationId: 'original', action: { type: 'undo', targetOperationId: 'old' }, baseRevision: 1, ownRevisions: [], readsBeyond: false, writes: [], refs: [], label: 'x', createdAt: 0, state: 'held' }
      const seq = await store.add(original)
      const plain = await store.handOff(seq, 'b', null)
      const app = await store.handOff(seq, 'b', { ...original, owner: 'b', app: true, state: 'pending' })
      const foreign = await store.handOff(seq, 'a', { ...original, owner: 'b' })
      return { plain, app, foreign, remaining: (await store.all()).map(e => `${e.owner}:${e.state}`) }
    }
    return { idb: await run(idbOutboxStore()), memory: await run(memoryOutboxStore()) }
  }, source)
  await browser.close()
  const pass = JSON.stringify(result.idb) === JSON.stringify(result.memory) && result.idb.app === 'not-held' && result.idb.plain === 'not-held' && result.idb.foreign === 'not-held' && JSON.stringify(result.idb.remaining) === '["a:held"]'
  console.log(`${pass ? 'PASS' : 'FAIL'} ${engine} ${JSON.stringify(result)}`)
  if (!pass) process.exitCode = 1
}
