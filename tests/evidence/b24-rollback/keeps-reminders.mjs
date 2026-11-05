// B60 9: rolling back to this tombstone keeps reminders. In real Chrome, sign up under the live worker, swap in this tombstone at the same /sw.js, then send a real push through the real push service.
// Usage: node tests/evidence/b24-rollback/keeps-reminders.mjs <path-to-the-live-sw.js>  (needs Google Chrome; the page is a stub, so no app or store is involved)
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import webpush from 'web-push'
const liveWorker = process.argv[2]
if (!liveWorker) { console.error('Usage: node tests/evidence/b24-rollback/keeps-reminders.mjs <path-to-the-live-sw.js>'); process.exit(2) }
let worker = readFileSync(liveWorker, 'utf8')
const tombstone = readFileSync('public/sw.js', 'utf8')
const server = createServer((req, res) => {
  if (req.url === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return res.end(worker) }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>stub</title>')
}).listen(3998, '127.0.0.1')
const keys = webpush.generateVAPIDKeys(), base = 'http://127.0.0.1:3998'
const context = await chromium.launchPersistentContext(mkdtempSync('/tmp/rb-chrome-'), { headless: false, channel: 'chrome', ignoreDefaultArgs: ['--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--use-mock-keychain', '--password-store=basic'] })
await context.grantPermissions(['notifications'], { origin: base })
const page = context.pages()[0] ?? await context.newPage()
await page.goto(base)
const subscription = await page.evaluate(async key => {
  const b = key.replace(/-/g, '+').replace(/_/g, '/'), bytes = Uint8Array.from(atob(b + '='.repeat((4 - b.length % 4) % 4)), c => c.charCodeAt(0))
  await navigator.serviceWorker.register('/sw.js')
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })).toJSON()
}, keys.publicKey)
await page.waitForTimeout(6000)
worker = tombstone
await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration('/'); await reg.update(); await new Promise(r => setTimeout(r, 2500)) })
const after = await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration('/'); return { kept: Boolean(await reg.pushManager.getSubscription()), tombstone: (await (await fetch(reg.active.scriptURL, { cache: 'no-store' })).text()).includes('tombstone') } })
const sent = await webpush.sendNotification(subscription, JSON.stringify({ key: 'k1', title: 'Through the tombstone', body: 'x', url: '/' }), { vapidDetails: { subject: 'https://daythread.dogrod.com', publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 600, urgency: 'high' }).then(r => r.statusCode, e => e.statusCode)
let shown = []
// The tombstone's activation holds its sweeps for about 42 s, and a push waits for that.
for (let i = 0; i < 70 && !shown.length; i++) { await page.waitForTimeout(1000); shown = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration('/')).getNotifications()).map(n => n.title)) }
console.log(JSON.stringify({ ...after, sent, shown }))
await context.close(); server.close()
const ok = after.kept && after.tombstone && sent === 201 && shown[0] === 'Through the tombstone'
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
