// Rollback rehearsal for the tombstone worker: #27's caching worker installed, a clean tab and a tab with unsaved
// typing open, then the rollback build served at the same address. Checks right after, and again later, that no
// caching worker and no cache of ours comes back, even when the #27 tab warms up and registers again.
// Builds: #27 (fix/offline-copy-account, ~/Developer/daythread-offline-copy) first, then this branch (/tmp/rb-rollback),
// both served on port 3572 over the same SQLite copy by /tmp/rb-serve2.sh. SETTLE_MS sets the later re-check (60 s).
import { chromium } from '/Users/dogrod/Developer/daythread-offline-copy/node_modules/@playwright/test/index.mjs'
import { execSync } from 'node:child_process'
const base = 'http://127.0.0.1:3572', db = '/tmp/rb-kill/w2.sqlite', settle = Number(process.env.SETTLE_MS ?? 60000)
const serve = dir => execSync(`/tmp/rb-serve2.sh ${dir} 3572 ${db}`, { stdio: 'inherit' })
const results = []; const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`) }
serve('/Users/dogrod/Developer/daythread-offline-copy')
const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const dialogs = []; context.on('page', p => p.on('dialog', d => { dialogs.push(d.type()); d.dismiss() }))
const open = async () => { const p = await context.newPage(); await p.goto(base + '/'); await p.locator('.bn-editor').first().waitFor(); return p }
const bundle = async p => { for (let i = 0; ; i++) { try { await p.waitForLoadState('load'); return await p.evaluate(() => [...document.scripts].map(s => s.src).find(s => s.includes('/assets/'))?.split('/').pop()) } catch (e) { if (i > 5) throw e; await p.waitForTimeout(500) } } }
const state = async p => { await p.waitForLoadState('load'); return p.evaluate(async () => ({ registrations: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).filter(k => k.startsWith('daythread-')) })) }
const clean = await open(), dirty = await open()
await dirty.waitForFunction(() => !!navigator.serviceWorker.controller); await dirty.waitForTimeout(1500)
const oldBundle = await bundle(dirty)
console.log('before', oldBundle, JSON.stringify(await state(dirty)))
// Unsaved typing: every save fails on the network, so the editor keeps it dirty and retries.
await dirty.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue())
await dirty.locator('.bn-editor [data-content-type="bulletListItem"] .bn-inline-content').last().click()
await dirty.keyboard.press('Meta+ArrowRight'); await dirty.keyboard.press('Enter'); await dirty.keyboard.type('Rollback typing check two', { delay: 20 })
await dirty.waitForTimeout(1000)
serve('/tmp/rb-rollback')
const fresh = await open() // his next ordinary open
await fresh.waitForTimeout(3000)
check('the new open gets the rollback build', (await bundle(fresh)) !== oldBundle, await bundle(fresh))
check('the clean tab reloaded by itself into the rollback build', (await bundle(clean)) !== oldBundle, await bundle(clean))
check('the typing tab was not reloaded over its typing', (await bundle(dirty)) === oldBundle && (await dirty.locator('.bn-editor').first().innerText()).includes('Rollback typing check two'))
check('no leave-page prompt', dialogs.length === 0, JSON.stringify(dialogs))
// The #27 tab keeps sending warm-ups and registers again, as its code would.
const warmAndRegister = () => dirty.evaluate(async () => {
  const ours = u => u.startsWith(location.origin + '/')
  navigator.serviceWorker.controller?.postMessage({ type: 'warm', pages: [location.href], assets: performance.getEntriesByType('resource').map(e => e.name).filter(ours) })
  await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined)
})
await warmAndRegister(); await dirty.waitForTimeout(3000)
const now = await state(fresh)
check('right after: no cache of ours', now.caches.length === 0, JSON.stringify(now))
// The save goes through once the network is back for that tab.
await dirty.unroute('**/_serverFn/**')
await dirty.waitForTimeout(settle / 2)
await warmAndRegister()
await dirty.waitForTimeout(settle / 2)
check('once its typing saved, the typing tab reloaded by itself into the rollback build', (await bundle(dirty)) !== oldBundle, await bundle(dirty))
check('and the typed line is there after the reload', (await dirty.locator('.bn-editor').first().innerText()).includes('Rollback typing check two'))
const later = await state(fresh)
check(`after ${Math.round(settle / 1000)} s: no cache of ours`, later.caches.length === 0, JSON.stringify(later))
// No worker that caches: with the connection cut, a reload is not served from any cache.
await context.setOffline(true)
const offline = await fresh.reload().then(() => fresh.locator('body').innerText()).catch(e => 'navigation failed: ' + e.message.split('\n')[0])
check('offline, nothing is served from a cache', !offline.includes('Loading your day') && !offline.includes('Offline · showing'), offline.slice(0, 80))
await context.setOffline(false)
const check2 = await open()
check('the typing was saved to the server', (await check2.locator('.bn-editor').first().innerText()).includes('Rollback typing check two'))
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
