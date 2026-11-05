// B60's line in the built app, with what the server says and the browser's push stood in for: shows when reminders stopped by themselves and a chip is still to come; Turn on here signs this device up and it goes.
// Usage: node tests/evidence/reminders/line.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/reminders/line.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const dayOf = ahead => new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() + ahead * 86_400_000))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, seed, stopped, permission, act) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/reminders/seed-line.ts ${S} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  const posted = []
  await page.route('**/api/push/key', route => route.fulfill({ json: { publicKey: 'BAAA', stopped } }))
  await page.route('**/api/push/subscribe', route => { posted.push(route.request().postDataJSON()); route.fulfill({ json: { ok: true } }) })
  await page.addInitScript(permission => {
    const sub = { endpoint: 'https://push.example/stand-in', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } } }, unsubscribe: async () => true }
    const reg = { pushManager: { subscribe: async () => sub, getSubscription: async () => null } }
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: async () => reg, register: async () => reg, addEventListener() {}, removeEventListener() {}, ready: Promise.resolve(reg) }, configurable: true })
    window.PushManager = window.PushManager || function () {}
    window.Notification = Object.assign(function () {}, { permission, requestPermission: async () => 'granted' })
  }, permission)
  let r
  try { await page.goto(`${base}/day/${dayOf(seed === 'past-only' ? -1 : 1)}`); await page.locator('.day-event', { hasText: 'Dentist' }).first().waitFor(); await wait(1500); r = await act(page, posted) } catch (e) { r = { ok: false, threw: e.message.split('\n')[0] } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 400))
  await context.close()
}
const line = page => page.locator('.reminders-stopped')
await scenario('Stopped, with a chip to come: the line shows, Turn on here signs this device up, and it goes', '', true, 'default', async (page, posted) => {
  const r = { says: (await line(page).innerText()).replace(/\s+/g, ' ') }
  await page.screenshot({ path: `/tmp/rb-csv/reminders-line-${engine}.png` })
  await line(page).getByRole('button', { name: 'Turn on here' }).click(); await wait(500)
  r.posted = posted.length; r.after = await line(page).count()
  r.ok = r.says === 'Reminders are off · Turn on here' && r.posted === 1 && r.after === 0
  return r
})
await scenario('Not stopped: nothing shows', '', false, 'default', async page => ({ ok: (await line(page).count()) === 0 }))
await scenario('Stopped, but every chip has gone by: nothing shows', 'past-only', true, 'default', async page => ({ ok: (await line(page).count()) === 0 }))
await scenario('Stopped, on a device that blocked them: nothing shows, as Turn on here could only fail', '', true, 'denied', async page => ({ ok: (await line(page).count()) === 0 }))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
