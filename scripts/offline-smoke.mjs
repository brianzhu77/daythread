// Browser run for the Home Screen app offline (docs/design/pwa.md): the worker and the last-loaded copy. Run against a
// built server over a disposable SQLite store, e.g. the browser smoke's:
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/smoke.sqlite TZ=America/Vancouver npx vite preview --port 3043 &
//   TZ=America/Vancouver node scripts/offline-smoke.mjs /tmp/offline-out
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const base = 'http://127.0.0.1:3043', out = process.argv[2]
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Vancouver', hasTouch: true, isMobile: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const results = []
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }) } catch (e) { results.push({ name, ok: false, error: e.message }); await page.screenshot({ path: `${out}/fail-${name}.png`, fullPage: true }).catch(() => {}) } }
const copyStored = () => page.waitForFunction(() => new Promise(resolve => {
  const req = indexedDB.open('daythread-offline'); req.onerror = () => resolve(false)
  req.onsuccess = () => { const db = req.result; if (!db.objectStoreNames.contains('kv')) { db.close(); return resolve(false) } const get = db.transaction('kv').objectStore('kv').get('workspace'); get.onsuccess = () => { db.close(); resolve(Boolean(get.result)) }; get.onerror = () => resolve(false) }
}), null, { timeout: 15000 })

await step('online-first-open', async () => {
  await page.goto(base + '/'); await page.locator('.editor-task-title').first().waitFor({ state: 'visible', timeout: 30000 })
  for (const p of ['/offline.html', '/splash/iphone-1179x2556-dark.png', '/manifest.webmanifest']) assert.equal((await page.request.get(base + p)).status(), 200, p)
  const head = await page.content()
  assert(head.includes('apple-touch-startup-image'), 'startup images linked')
  assert(head.includes('apple-mobile-web-app-title'), 'the iOS title')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 })
  await copyStored()
  // A second screen opened while connected, so its copy exists; the assets are in the cache by now.
  await page.goto(base + '/tasks'); await page.getByRole('heading', { name: 'Tasks' }).waitFor({ timeout: 30000 })
  await page.goto(base + '/'); await page.locator('.editor-task-title').first().waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await page.locator('.banner.offline').count(), 0, 'no offline line while connected')
})
await step('offline-reload-shows-the-copy', async () => {
  await context.setOffline(true)
  await page.reload()
  await page.locator('.banner.offline').waitFor({ timeout: 30000 })
  assert.match(await page.locator('.banner.offline').innerText(), /Offline · showing what was last loaded/)
  await page.locator('.editor-task-title').first().waitFor({ state: 'visible', timeout: 30000 })
  const text = await page.locator('main').innerText()
  assert(text.includes('Due Friday') || text.includes('Planned for Saturday') || text.includes('TODO'), 'today shows its data from the copy')
  await page.screenshot({ path: `${out}/01-offline-today.png`, fullPage: true })
  // Moving between screens needs nothing from the network (B41); a full open of a visited screen comes from the copy.
  await page.getByRole('link', { name: 'Tasks' }).first().click(); await page.getByRole('heading', { name: 'Tasks' }).waitFor({ timeout: 15000 })
  await page.goto(base + '/tasks'); await page.getByRole('heading', { name: 'Tasks' }).waitFor({ timeout: 30000 })
  await page.screenshot({ path: `${out}/02-offline-tasks.png`, fullPage: true })
})
await step('offline-unvisited-screen-gets-the-offline-page', async () => {
  await page.goto(base + '/tags/never-opened-here')
  await page.getByRole('heading', { name: 'Offline' }).waitFor({ timeout: 15000 })
  await page.screenshot({ path: `${out}/03-offline-page.png` })
  await page.getByRole('link', { name: 'Open Today' }).click()
  await page.locator('.banner.offline').waitFor({ timeout: 30000 })
})
await step('back-online-clears-it', async () => {
  await context.setOffline(false)
  await page.reload(); await page.locator('.editor-task-title').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForFunction(() => !document.querySelector('.banner.offline'), null, { timeout: 15000 })
})
await browser.close()
console.log(JSON.stringify({ results, errors: errors.filter(e => !/insights|404/.test(e)) }, null, 1))
process.exitCode = results.some(r => !r.ok) ? 1 : 0
