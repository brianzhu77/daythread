// G8-5: search is refused before any cache lookup or outbound call when the request isn't a signed-in one. The search
// request a browser sends is captured on a sign-in-off server, then sent as is to a sign-in-on server (Postgres) with no
// session, a made-up session and a cross-site Origin; its stand-in must log nothing.
// Usage: node tests/evidence/place/signed-out.mjs <signed-in-base> <signed-in-stand-in-log> <sign-in-off-base>
import * as pw from '@playwright/test'
import { readFileSync } from 'node:fs'
const [onBase, onLog, offBase] = process.argv.slice(2), results = []
if (!onBase || !onLog || !offBase) { console.error('Usage: node tests/evidence/place/signed-out.mjs <signed-in-base> <signed-in-stand-in-log> <sign-in-off-base>'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const browser = await pw.chromium.launch(), page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
let captured = null
page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/_serverFn/') && (r.postData() ?? '').includes('Stanley Park')) captured = { path: new URL(r.url()).pathname + new URL(r.url()).search, body: r.postData(), headers: r.headers() } })
await page.goto(`${offBase}/pages?page=eats`); await page.getByText('Golden Dumpling').first().waitFor({ timeout: 20000 })
const cell = page.locator('[data-cell*="|e4|pl"]').first(), b = await cell.boundingBox()
await page.mouse.click(b.x + b.width - 12, b.y + b.height / 2)
await page.getByRole('textbox', { name: 'Search Where' }).pressSequentially('Stanley Park', { delay: 10 })
await page.locator('#place-rows .place-name').first().waitFor()
await browser.close()
ok('the search request is captured from a browser', Boolean(captured), captured?.path)
const send = (extra = {}) => fetch(`${onBase}${captured.path}`, { method: 'POST', body: captured.body, redirect: 'manual', headers: { 'content-type': captured.headers['content-type'] ?? 'application/json', ...Object.fromEntries(Object.entries(captured.headers).filter(([k]) => k.startsWith('x-tsr') || k === 'accept')), ...extra } })
// As the app's own page sends it: same origin, so only the missing session refuses it.
const own = { origin: onBase, 'sec-fetch-site': 'same-origin' }
const none = await send(own), made = await send({ ...own, cookie: 'daythread_session=' + 'A'.repeat(43) }), cross = await send({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
ok('no session: refused, 401', none.status === 401, String(none.status))
ok('a made-up session: refused, 401', made.status === 401, String(made.status))
ok('cross-site: refused, 403', cross.status === 403, String(cross.status))
ok('nothing reached the stand-in', readFileSync(onLog, 'utf8').trim() === '', readFileSync(onLog, 'utf8').slice(0, 200))
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
