// Browser smoke for reminders (docs/design/reminders.md) on a real Postgres, with a stand-in PushManager in the page
// (headless Chromium has no push service) and the tick's log transport on the server. Run:
//   node scripts/vapid-keys.mjs   → the two keys below
//   DAYTHREAD_STORAGE=postgres DAYTHREAD_AUTH=off DATABASE_URL=$DB DAYTHREAD_VAPID_PUBLIC_KEY=… DAYTHREAD_VAPID_PRIVATE_KEY=… \
//     CRON_SECRET=s3cret DAYTHREAD_PUSH_TRANSPORT=log TZ=America/Vancouver npx vite preview --port 3046 > preview.log &
//   DB=$DB LOG=preview.log TZ=America/Vancouver node scripts/push-smoke.mjs /tmp/push-out
// Covers: the control in the account row, turning on (permission, subscription, the server's row), a reload keeping it
// on, a chip a minute in the past sent by the tick once and only once, turning off, and the tick with no subscription.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import postgres from 'postgres'
const base = 'http://127.0.0.1:3046', out = process.argv[2], log = process.env.LOG
const sql = postgres(process.env.DB ?? 'postgres://postgres@127.0.0.1:54329/daythread_push', { prepare: false })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Vancouver', permissions: ['notifications'] })
// The stand-in: a subscription that survives reloads (localStorage), with the shape the browser's own has.
await context.addInitScript(() => {
  const make = () => ({ endpoint: 'https://push.example/smoke-1', keys: { p256dh: 'BPsmoke-p256dh', auth: 'smoke-auth' } })
  const fake = {
    async getSubscription() { return localStorage.getItem('fake-push') ? sub() : null },
    async subscribe() { localStorage.setItem('fake-push', '1'); return sub() },
  }
  const sub = () => ({ ...make(), options: {}, toJSON: () => make(), async unsubscribe() { localStorage.removeItem('fake-push'); return true } })
  Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { configurable: true, get: () => fake })
  window.PushManager = window.PushManager ?? function PushManager() {}
})
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const results = []
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }) } catch (e) { results.push({ name, ok: false, error: e.message }); await page.screenshot({ path: `${out}/fail-${name}.png`, fullPage: true }).catch(() => {}) } }
const reminders = () => page.locator('.reminders')
const tick = async () => { const r = await page.request.get(`${base}/api/push/tick?token=s3cret`); assert.equal(r.status(), 200, 'tick answers'); return r.json() }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })

await step('turn-on', async () => {
  await page.goto(base + '/'); await page.locator('.editor-task-title').first().waitFor({ state: 'visible', timeout: 30000 })
  assert.equal((await page.request.get(`${base}/sw.js`)).status(), 200, 'the service worker is served')
  await reminders().waitFor({ timeout: 15000 })
  assert.equal(await reminders().getAttribute('data-state'), 'off')
  await page.getByRole('button', { name: 'Turn on reminders' }).click()
  await page.waitForFunction(() => document.querySelector('.reminders')?.dataset.state === 'on', null, { timeout: 15000 })
  assert.match(await reminders().innerText(), /Reminders on · Turn off/)
  await page.screenshot({ path: `${out}/01-reminders-on.png`, fullPage: true })
  const rows = await sql`select endpoint, p256dh, auth from daythread.push_subscriptions`
  assert.deepEqual([...rows], [{ endpoint: 'https://push.example/smoke-1', p256dh: 'BPsmoke-p256dh', auth: 'smoke-auth' }], 'the server keeps the subscription')
  await page.reload(); await reminders().waitFor({ timeout: 15000 })
  await page.waitForFunction(() => document.querySelector('.reminders')?.dataset.state === 'on', null, { timeout: 15000 })
})
await step('tick-sends-once', async () => {
  // A chip one minute ago, Vancouver time, on today's page: the tick's hour-long window covers it.
  const at = new Date(Date.now() - 60_000)
  const hhmm = at.toLocaleTimeString('en-GB', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const date = at.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
  const [row] = await sql`select workspace_id, document from daythread.pages where id = ${'day:' + today}`
  assert.ok(row, "today's page exists")
  const doc = JSON.parse(row.document)
  doc.push({ id: 'smoke-reminder-line', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Call the dentist ', styles: {} }, { type: 'dateMention', props: { eventId: 'smoke-e1', date, time: hhmm } }], children: [] })
  await sql`update daythread.pages set document = ${JSON.stringify(doc)} where workspace_id = ${row.workspace_id} and id = ${'day:' + today}`
  const first = await tick()
  assert.deepEqual({ workspaces: first.workspaces, due: first.due, sent: first.sent }, { workspaces: 1, due: 1, sent: 1 }, JSON.stringify(first))
  const second = await tick()
  assert.equal(second.sent, 0, 'the same reminder is not sent twice: ' + JSON.stringify(second))
  if (log) {
    const lines = readFileSync(log, 'utf8').split('\n').filter(l => l.includes('"push.log"'))
    assert.equal(lines.length, 1, 'one payload logged')
    const payload = JSON.parse(lines[0]).payload
    assert.equal(payload.title, 'Call the dentist'); assert.equal(payload.url, `/day/${date}`); assert.match(payload.body, /·/)
  }
  assert.equal((await sql`select count(*)::int as n from daythread.push_sent`)[0].n, 1)
})
await step('turn-off', async () => {
  await page.getByRole('button', { name: 'Turn off' }).click()
  await page.waitForFunction(() => document.querySelector('.reminders')?.dataset.state === 'off', null, { timeout: 15000 })
  assert.equal((await sql`select count(*)::int as n from daythread.push_subscriptions`)[0].n, 0, 'the server dropped the subscription')
  const r = await tick()
  assert.equal(r.workspaces, 0)
  assert.equal((await page.request.get(`${base}/api/push/tick?token=wrong`)).status(), 401)
  await page.screenshot({ path: `${out}/02-reminders-off.png`, fullPage: true })
})
await browser.close(); await sql.end()
console.log(JSON.stringify({ results, errors }, null, 1))
process.exitCode = results.some(r => !r.ok) || errors.length ? 1 : 0
