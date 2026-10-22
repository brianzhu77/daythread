// Sign-in, end to end against a built server (Ratchet f6dc9688, d1ec5845; Bumblebee 869d3f42). Needs: the app on
// BASE with sign-in on, the fake auth server on AUTH (fake-auth.mjs), Postgres on DB with schema SCHEMA.
//   node tests/evidence/sign-in/e2e.mjs http://127.0.0.1:3473 http://127.0.0.1:54999 postgres://... signin_check
import { chromium } from '@playwright/test'
import postgres from 'postgres'
const [BASE, AUTH, DB, SCHEMA] = process.argv.slice(2)
const sql = postgres(DB, { prepare: false, onnotice: () => {} })
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
// Each call its own client address, so the per-address send brake (5 per 10 min) only bites where a test wants it.
let ip = 0
const post = (path, body, headers = { origin: BASE }) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip}`, ...headers }, body: JSON.stringify(body) })
const code = async email => (await (await fetch(`${AUTH}/__code?email=${email}`)).json()).code
const signIn = async email => {
  await fetch(`${AUTH}/__reset`)
  await post('/api/auth/send', { email })
  const r = await post('/api/auth/verify', { email, code: await code(email) })
  return { r, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] }
}

// 1. Signed out: pages go to sign-in, every server function and API call is 401.
let r = await fetch(BASE + '/tasks?x=1', { redirect: 'manual' })
log(r.status === 302 && r.headers.get('location') === '/sign-in?next=%2Ftasks%3Fx%3D1', 'signed out: a page redirects to sign-in with next', `${r.status} ${r.headers.get('location')}`)
for (const [method, path] of [['GET', '/_serverFn/anything'], ['POST', '/_serverFn/anything'], ['GET', '/api/other']]) {
  r = await fetch(BASE + path, { method, redirect: 'manual', headers: { origin: BASE } })
  log(r.status === 401, `signed out: ${method} ${path} is 401`, String(r.status))
}
log((await fetch(BASE + '/sign-in')).status === 200, 'the sign-in screen opens signed out')

// 2. Cross-site writes are refused before anything else.
log((await post('/api/auth/send', { email: 'owner@example.com' }, { origin: 'https://evil.example' })).status === 403, 'a POST from another origin is 403')
log((await post('/api/auth/send', { email: 'owner@example.com' }, { 'sec-fetch-site': 'cross-site', origin: BASE })).status === 403, 'Sec-Fetch-Site cross-site is 403')
log((await post('/api/auth/send', { email: 'owner@example.com' }, {})).status === 403, 'a POST with neither Origin nor Sec-Fetch-Site is 403')

// 3. Sending: the same answer for any address, the owner's cooldown included; a project-wide failure says so.
await fetch(`${AUTH}/__reset`)
const sends = []
for (const email of ['nobody@example.com', 'owner@example.com', 'owner@example.com']) { r = await post('/api/auth/send', { email }); sends.push(`${r.status} ${await r.text()}`) }
log(new Set(sends).size === 1 && sends[0] === '200 {"ok":true}', 'unknown address, owner, owner in cooldown: identical replies', sends.join(' | '))
await fetch(`${AUTH}/__limit?on=1`)
r = await post('/api/auth/send', { email: 'nobody@example.com' })
log(r.status === 503, 'project email limit: "Couldn\'t send a code" for every address', String(r.status))
await fetch(`${AUTH}/__limit?on=0`)
const brake = []
for (let i = 0; i < 6; i++) brake.push((await post('/api/auth/send', { email: 'nobody@example.com' }, { origin: BASE, 'x-forwarded-for': '10.9.9.9' })).status)
log(brake.slice(0, 5).every(s => s === 200) && brake[5] === 429, 'a 6th code request from one address within 10 min is refused', brake.join(','))

// 4. Codes: wrong, expired, reused and a non-owner's real code are the same refusal; no cookie.
const wrong = await post('/api/auth/verify', { email: 'owner@example.com', code: '000000' })
log(wrong.status === 401 && !wrong.headers.get('set-cookie'), 'wrong code: 401, no cookie')
await fetch(`${AUTH}/__reset`); await post('/api/auth/send', { email: 'owner@example.com' })
const expiredCode = await code('owner@example.com'); await fetch(`${AUTH}/__expire?email=owner@example.com`)
log((await post('/api/auth/verify', { email: 'owner@example.com', code: expiredCode })).status === 401, 'expired code: 401')
const other = await signIn('other@example.com')
log(other.r.status === 401 && !other.r.headers.get('set-cookie'), 'a verified non-owner account: 401, no session', String(other.r.status))
const owner = await signIn('owner@example.com')
const setCookie = owner.r.headers.get('set-cookie') ?? ''
log(owner.r.status === 200 && /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Max-Age=259\d{4}/.test(setCookie), 'owner code: session cookie, HttpOnly, SameSite=Lax, 30 days', setCookie.replace(/=[\w-]{43}/, '=<token>'))
const usedCode = await code('owner@example.com')
log((await post('/api/auth/verify', { email: 'owner@example.com', code: usedCode })).status === 401, 'the same code again: 401')
const stored = await sql.unsafe(`select token_hash, email from ${SCHEMA}.sessions`)
log(stored.length === 1 && stored[0].email === 'owner@example.com' && !owner.cookie.includes(stored[0].token_hash), 'one session stored, as a hash only')

// 5. Signed in: pages and server functions pass; the app loads with his address in the account row.
r = await fetch(BASE + '/', { redirect: 'manual', headers: { cookie: owner.cookie } })
log(r.status === 200, 'signed in: today opens', String(r.status))
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const [name, value] = owner.cookie.split('=')
await context.addCookies([{ name, value, url: BASE, httpOnly: true, sameSite: 'Lax' }])
const page = await context.newPage(); const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
const body = await page.textContent('body')
log(!/Couldn.t load/.test(body) && /Today/.test(body), 'signed in in the browser: today loads', errors.join('; '))
log(await page.locator('.account-row-sidebar').textContent().then(t => /owner@example.com · Sign out/.test(t ?? '')).catch(() => false), 'sidebar: "{email} · Sign out"')

// 6. Session gone mid-edit (expired or signed out elsewhere): the next save sends him to sign-in, and after signing
//    in the text he typed is saved (Bumblebee 869d3f42).
const editor = page.locator('.bn-editor[contenteditable="true"]').first()
await editor.click(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.press('Enter')
await sql.unsafe(`delete from ${SCHEMA}.sessions`)
await page.keyboard.type('typed while the session was gone')
await page.waitForURL(/\/sign-in\?next=/, { timeout: 15000 }).catch(() => undefined)
log(page.url().includes('/sign-in?next=%2F'), 'the refused save sends the page to sign-in with next', page.url())
await fetch(`${AUTH}/__reset`)
await page.fill('input[type=email]', 'owner@example.com'); await page.click('button[type=submit]')
await page.waitForSelector('input[autocomplete=one-time-code]')
await page.fill('input[autocomplete=one-time-code]', await code('owner@example.com')); await page.click('button[type=submit]')
await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 15000 }).catch(() => undefined)
await page.waitForTimeout(4000)
const saved = JSON.stringify((await sql.unsafe(`select data from ${SCHEMA}.workspace`))[0]?.data ?? '').includes('typed while the session was gone')
log(page.url() === BASE + '/' && saved, 'after signing in: back on today, and the typed text is saved', page.url())
log(!/Load latest/.test(await page.textContent('body')), 'no "Load latest" conflict')

// 7. Sign out: the cookie is cleared and the same token is refused afterwards, from any tab or copy.
const tokenBefore = (await context.cookies()).find(c => c.name === name)?.value
await page.click('.account-row-sidebar button')
await page.waitForURL(/\/sign-in/, { timeout: 10000 }).catch(() => undefined)
log(page.url().startsWith(BASE + '/sign-in'), 'Sign out shows the sign-in screen')
r = await fetch(BASE + '/_serverFn/anything', { method: 'POST', redirect: 'manual', headers: { origin: BASE, cookie: `${name}=${tokenBefore}` } })
log(r.status === 401, 'the signed-out token, replayed: 401', String(r.status))
log((await sql.unsafe(`select count(*)::int as n from ${SCHEMA}.sessions`))[0].n === 0, 'no session row left')
await browser.close(); await sql.end()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
