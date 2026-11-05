// B60 1 on the deployed preview Worker, with no sign-in: real Chrome subscribes with the preview's public key, an invented workspace with a chip two minutes ahead goes in daythread_preview, and the deployed cron has to deliver it.
// Every statement names daythread_preview; nothing reads or writes any other schema. The rows it adds are removed at the end, whatever happens. It prints counts and timings only: no key, no endpoint.
// Usage: DATABASE_URL=… DAYTHREAD_VAPID_PUBLIC_KEY=… node tests/evidence/reminders/preview-push.mjs <path-to-live-sw.js>  (needs Google Chrome)
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import postgres from 'postgres'
const { DATABASE_URL: url, DAYTHREAD_VAPID_PUBLIC_KEY: key } = process.env, worker = process.argv[2]
if (!url || !key || !worker) { console.error('Usage: DATABASE_URL=… DAYTHREAD_VAPID_PUBLIC_KEY=… node tests/evidence/reminders/preview-push.mjs <path-to-live-sw.js>'); process.exit(2) }
const schema = 'daythread_preview', workspaceId = 'b6000000-0000-4000-8000-000000000060', userId = 'b6000000-0000-4000-8000-000000000061'
const server = createServer((req, res) => {
  if (req.url === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return res.end(readFileSync(worker)) }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>stub</title>')
}).listen(3996, '127.0.0.1')
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {}, ssl: 'require' })
const context = await chromium.launchPersistentContext(mkdtempSync('/tmp/rb-chrome-'), { headless: false, channel: 'chrome', ignoreDefaultArgs: ['--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--use-mock-keychain', '--password-store=basic'] })
// The cascade takes its page, subscription and sent keys with it.
const remove = () => sql.unsafe(`delete from ${schema}.workspaces where id = $1::uuid`, [workspaceId])
let exit = 1
try {
  await context.grantPermissions(['notifications'], { origin: 'http://127.0.0.1:3996' })
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto('http://127.0.0.1:3996')
  const sub = await page.evaluate(async key => {
    const b = key.replace(/-/g, '+').replace(/_/g, '/'), bytes = Uint8Array.from(atob(b + '='.repeat((4 - b.length % 4) % 4)), c => c.charCodeAt(0))
    await navigator.serviceWorker.register('/sw.js')
    const reg = await navigator.serviceWorker.ready
    return (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })).toJSON()
  }, key)
  await page.waitForTimeout(6000)
  // On UTC, so the wall clock needs no zone data. Two minutes ahead, on a whole minute: it has to fall after the sign-up.
  const fire = new Date(Math.ceil((Date.now() + 120_000) / 60_000) * 60_000), [date, rest] = fire.toISOString().split('T'), time = rest.slice(0, 5)
  const doc = JSON.stringify([{ id: 'b60-line', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Invented reminder ', styles: {} }, { type: 'dateMention', props: { eventId: 'b60-event', date, time } }], children: [] }])
  await remove()
  await sql.unsafe(`insert into ${schema}.workspaces (id, user_id, timezone) values ($1::uuid, $2::uuid, 'UTC')`, [workspaceId, userId])
  await sql.unsafe(`insert into ${schema}.pages (workspace_id, id, position, type, title, document) values ($1::uuid, 'b60-page', 0, 'document', 'Invented', $2)`, [workspaceId, doc])
  await sql.unsafe(`insert into ${schema}.push_subscriptions (endpoint, workspace_id, p256dh, auth) values ($1, $2::uuid, $3, $4)`, [sub.endpoint, workspaceId, sub.keys.p256dh, sub.keys.auth])
  console.log(`added 1 workspace, 1 page, 1 subscription; due in ${Math.round((fire - Date.now()) / 1000)} s`)
  let shown = []
  const until = fire.getTime() + 240_000
  while (Date.now() < until && !shown.length) { await page.waitForTimeout(2000); shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => n.title)) }
  const [{ sent }] = await sql.unsafe(`select count(*)::int as sent from ${schema}.push_sent where workspace_id = $1::uuid and lease_until is null`, [workspaceId])
  console.log(JSON.stringify({ arrived: shown.length, secondsAfterDue: shown.length ? Math.round((Date.now() - fire) / 1000) : null, recordedSent: sent }))
  exit = shown.length === 1 && sent === 1 ? 0 : 1
} finally {
  await remove().catch(e => { console.error('REMOVE FAILED: the invented workspace is still there, id in this script', String(e.message).slice(0, 80)); exit = 1 })
  const [{ left }] = await sql.unsafe(`select count(*)::int as left from ${schema}.workspaces where id = $1::uuid`, [workspaceId])
  console.log(`rows left: ${left}`)
  await context.close(); server.close(); await sql.end()
}
console.log(exit ? 'FAIL' : 'PASS')
process.exit(exit)
