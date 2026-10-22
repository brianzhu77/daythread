// Password sign-in, end to end against a built server (Ratchet f6dc9688, e4da96ff; Bumblebee 869d3f42, 2cef8a00;
// Jazz 8e3fe0e/235e692). Needs the app on BASE with sign-in on, the fake auth server on AUTH (fake-auth.mjs) and
// Postgres on DB with schema SCHEMA (a fresh one per run).
//   node tests/evidence/sign-in/e2e.mjs http://127.0.0.1:3473 http://127.0.0.1:54999 postgres://... signin_check SHOTS_DIR
import { chromium } from '@playwright/test'
import postgres from 'postgres'
const [BASE, AUTH, DB, SCHEMA, SHOTS] = process.argv.slice(2)
const sql = postgres(DB, { prepare: false, onnotice: () => {} })
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
// Each call its own client address unless a test sets one, so the per-address brake only bites where a test wants it.
let ip = 0
const post = (path, body, headers = { origin: BASE }) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ip % 250}`, ...headers }, body: JSON.stringify(body) })
const signIn = (email, password, headers) => post('/api/auth/sign-in', { email, password }, headers)
const calls = async () => (await (await fetch(`${AUTH}/__calls`)).json()).calls
const OWNER = ['owner@example.com', 'owner-pass-1']

// 1. Signed out: pages go to sign-in, every server function and API call is 401; the code endpoints are gone.
let r = await fetch(BASE + '/tasks?x=1', { redirect: 'manual' })
log(r.status === 302 && r.headers.get('location') === '/sign-in?next=%2Ftasks%3Fx%3D1', 'signed out: a page redirects to sign-in with next', `${r.status} ${r.headers.get('location')}`)
for (const [method, path] of [['GET', '/_serverFn/anything'], ['POST', '/_serverFn/anything'], ['POST', '/api/auth/send'], ['POST', '/api/auth/verify']]) {
  r = await fetch(BASE + path, { method, redirect: 'manual', headers: { origin: BASE } })
  log(r.status === 401, `signed out: ${method} ${path} is 401`, String(r.status))
}
log((await fetch(BASE + '/sign-in')).status === 200, 'the sign-in screen opens signed out')

// 2. Cross-site writes are refused before anything else.
log((await signIn(...OWNER, { origin: 'https://evil.example' })).status === 403, 'a POST from another origin is 403')
log((await signIn(...OWNER, { 'sec-fetch-site': 'cross-site', origin: BASE })).status === 403, 'Sec-Fetch-Site cross-site is 403')
log((await signIn(...OWNER, {})).status === 403, 'a POST with neither Origin nor Sec-Fetch-Site is 403')

// 3. One refusal for every way of not being the owner; no cookie; the password is never echoed.
const refusals = []
for (const [email, password] of [['owner@example.com', 'Not-The-Pass-7'], ['nobody@example.com', 'owner-pass-1'], ['other@example.com', 'other-pass-1']]) {
  r = await signIn(email, password); const text = await r.text()
  refusals.push(`${r.status} ${text} ${r.headers.get('set-cookie') ? 'cookie' : 'no-cookie'}`)
  if (text.includes(password)) log(false, 'the response never contains the password', email)
}
log(new Set(refusals).size === 1 && refusals[0] === '401 {"ok":false,"error":"wrong"} no-cookie', 'wrong password, unknown address, verified non-owner: identical 401, no cookie', refusals.join(' | '))
await fetch(`${AUTH}/__down?on=1`)
r = await signIn(...OWNER)
log(r.status === 503 && (await r.json()).error === 'unavailable', 'Supabase down: 503 "couldn\'t sign in", not a wrong password')
await fetch(`${AUTH}/__down?on=0`)

// 4. Brakes. Per address: an 11th try within 10 min is refused without reaching Supabase.
const before = await calls(), statuses = []
for (let i = 0; i < 11; i++) statuses.push((await signIn('nobody@example.com', 'x', { origin: BASE, 'x-forwarded-for': '10.9.9.9' })).status)
log(statuses.slice(0, 10).every(s => s === 401 || s === 429) && statuses[10] === 429 && (await calls()) - before <= 10, 'per address: the 11th try in 10 min is 429 and never reaches Supabase', statuses.join(','))
// Global: the failures so far (3 above, plus up to 10 here) already passed 5, so every address now waits.
r = await signIn(...OWNER)
const braked = await r.json()
log(r.status === 429 && braked.error === 'too-many' && braked.retryAfter > 0 && braked.retryAfter <= 900, 'global: past 5 failures even the right password waits, with the real wait', JSON.stringify(braked))
const n = (await sql.unsafe(`select count(*)::int as n from ${SCHEMA}.sign_in_failures`))[0].n
await signIn('nobody@example.com', 'x')
log((await sql.unsafe(`select count(*)::int as n from ${SCHEMA}.sign_in_failures`))[0].n === n, 'a refused try records nothing, so it never pushes the wait out')
const body = await (await signIn('someone@example.com', 'y')).json()
log(body.error === 'too-many' && Math.abs(body.retryAfter - braked.retryAfter) <= 2, 'the same wait for any address', `${body.retryAfter} vs ${braked.retryAfter}`)
// Signed-in devices keep working during a brake (Bumblebee 2cef8a00): a session made before is still accepted.
await sql.unsafe(`delete from ${SCHEMA}.sign_in_failures`)
const first = await signIn(...OWNER)
const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0]
for (let i = 0; i < 6; i++) await signIn('owner@example.com', 'wrong')
log((await signIn(...OWNER)).status === 429, 'the brake is on again')
r = await fetch(BASE + '/', { redirect: 'manual', headers: { cookie } })
log(r.status === 200, 'a device signed in before the brake still opens today', String(r.status))
await sql.unsafe(`delete from ${SCHEMA}.sign_in_failures`)

// 5. The owner signs in: cookie flags, one stored hash, a success clears the failures.
for (let i = 0; i < 3; i++) await signIn('owner@example.com', 'wrong')
const owner = await signIn(...OWNER)
const setCookie = owner.headers.get('set-cookie') ?? ''
log(owner.status === 200 && /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Max-Age=259\d{4}/.test(setCookie), 'owner: session cookie, HttpOnly, SameSite=Lax, 30 days', setCookie.replace(/=[\w-]{43}/, '=<token>'))
log((await sql.unsafe(`select count(*)::int as n from ${SCHEMA}.sign_in_failures`))[0].n === 0, 'a success clears the failure count')
const stored = await sql.unsafe(`select token_hash, email from ${SCHEMA}.sessions`)
const token = setCookie.split(';')[0].split('=')[1]
log(stored.every(s => s.email === 'owner@example.com' && s.token_hash !== token), 'sessions are stored as hashes only')

// 6. The screen (Jazz 8e3fe0e, 235e692) at 390 and 1280, then the session-gone-mid-edit recovery and sign-out.
const browser = await chromium.launch()
for (const width of [390, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } })
  const requests = []
  page.on('request', q => { if (q.url().includes('/api/auth/sign-in')) requests.push(q.postData() ?? '') })
  await page.goto(BASE + '/sign-in?next=%2Ftasks', { waitUntil: 'networkidle' })
  const [emailAc, passwordAc] = await Promise.all(['input[type=email]', 'input[name=password]'].map(s => page.getAttribute(s, 'autocomplete')))
  log(emailAc === 'username' && passwordAc === 'current-password', `${width}: autocomplete username / current-password`, `${emailAc} / ${passwordAc}`)
  log(!/forgot/i.test(await page.textContent('body')), `${width}: no "Forgot password?"`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sign-in-${width}.png` })
  await page.fill('input[type=email]', 'owner@example.com'); await page.fill('input[name=password]', 'wrong')
  await page.press('input[name=password]', 'Enter')
  await page.waitForSelector('.sign-in-error')
  const err = await page.textContent('.sign-in-error')
  log(err === "That didn't work · Check the email and password", `${width}: one line for a refusal`, err)
  log(await page.inputValue('input[type=email]') === 'owner@example.com' && await page.inputValue('input[name=password]') === '', `${width}: the email stays, the password empties`)
  log(await page.evaluate(() => document.activeElement?.getAttribute('name')) === 'password', `${width}: the caret is in the password`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sign-in-wrong-${width}.png` })
  await page.click('.sign-in-show')
  log(await page.getAttribute('input[name=password]', 'type') === 'text', `${width}: Show reveals the password`)
  await page.click('.sign-in-show')
  // Keychain fills both fields at once: one request.
  await page.fill('input[name=password]', 'owner-pass-1')
  const n0 = requests.length
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 15000 }).catch(() => undefined)
  log(new URL(page.url()).pathname === '/tasks' && requests.length - n0 === 1, `${width}: signs in to next (/tasks) with one request`, page.url())
  log(!page.url().includes('owner-pass-1') && !page.url().includes('wrong'), `${width}: the password is never in the URL`)
  await page.close()
}
// A brake shows the real wait (Jazz 235e692).
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
for (let i = 0; i < 6; i++) await signIn('nobody@example.com', 'x')
await page.goto(BASE + '/sign-in', { waitUntil: 'networkidle' })
await page.fill('input[type=email]', 'owner@example.com'); await page.fill('input[name=password]', 'owner-pass-1'); await page.click('button[type=submit]')
await page.waitForSelector('.sign-in-error')
const waitLine = await page.textContent('.sign-in-error')
log(/^Too many tries · Try again in \d+ (s|min)$/.test(waitLine ?? ''), 'braked: "Too many tries · Try again in {wait}"', waitLine)
if (SHOTS) await page.screenshot({ path: `${SHOTS}/sign-in-too-many-390.png` })
await sql.unsafe(`delete from ${SCHEMA}.sign_in_failures`)

// Session gone mid-edit: the next save sends him to sign-in, and after signing in the typed text is saved.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const [name, value] = setCookie.split(';')[0].split('=')
await context.addCookies([{ name, value, url: BASE, httpOnly: true, sameSite: 'Lax' }])
const app = await context.newPage()
await app.goto(BASE + '/', { waitUntil: 'networkidle' })
log(await app.locator('.account-row-sidebar').textContent().then(t => /owner@example.com · Sign out/.test(t ?? '')).catch(() => false), 'sidebar: "{email} · Sign out"')
const editor = app.locator('.bn-editor[contenteditable="true"]').first()
await editor.click(); await app.keyboard.press('Meta+ArrowDown'); await app.keyboard.press('Enter')
await sql.unsafe(`delete from ${SCHEMA}.sessions`)
await app.keyboard.type('typed while the session was gone')
await app.waitForURL(/\/sign-in\?next=/, { timeout: 15000 }).catch(() => undefined)
log(app.url().includes('/sign-in?next=%2F'), 'the refused save sends the page to sign-in with next', app.url())
await app.fill('input[type=email]', 'owner@example.com'); await app.fill('input[name=password]', 'owner-pass-1'); await app.click('button[type=submit]')
await app.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 15000 }).catch(() => undefined)
await app.waitForTimeout(4000)
const saved = JSON.stringify((await sql.unsafe(`select data from ${SCHEMA}.workspace`))[0]?.data ?? '').includes('typed while the session was gone')
log(app.url() === BASE + '/' && saved, 'after signing in: back on today, and the typed text is saved', app.url())
log(!/Load latest/.test(await app.textContent('body')), 'no "Load latest" conflict')
const tokenBefore = (await context.cookies()).find(c => c.name === name)?.value
await app.click('.account-row-sidebar button')
await app.waitForURL(/\/sign-in/, { timeout: 10000 }).catch(() => undefined)
log(app.url().startsWith(BASE + '/sign-in'), 'Sign out shows the sign-in screen')
r = await fetch(BASE + '/_serverFn/anything', { method: 'POST', redirect: 'manual', headers: { origin: BASE, cookie: `${name}=${tokenBefore}` } })
log(r.status === 401, 'the signed-out token, replayed: 401', String(r.status))
// Linked to another account (his Supabase account recreated): a distinct, calm line; nothing counted (Bumblebee
// fb275f23, Jazz ac124ed).
await sql.begin(async tx => { await tx.unsafe("set local daythread.allow_relink = 'on'"); await tx.unsafe(`update ${SCHEMA}.workspace set user_id = '0ccccccc-0000-4000-8000-000000000003' where id = 1`) })
const failuresBefore = (await sql.unsafe(`select count(*)::int as n from ${SCHEMA}.sign_in_failures`))[0].n
const linkPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
await linkPage.goto(BASE + '/sign-in', { waitUntil: 'networkidle' })
await linkPage.fill('input[type=email]', 'owner@example.com'); await linkPage.fill('input[name=password]', 'owner-pass-1'); await linkPage.click('button[type=submit]')
await linkPage.waitForSelector('.sign-in-note')
const note = await linkPage.textContent('.sign-in-note'), color = await linkPage.locator('.sign-in-note').evaluate(e => getComputedStyle(e).color)
log(note === "Your account isn't linked to this workspace · Your notes are safe" && color === 'rgb(110, 110, 115)', 'not linked: the calm line in --ink-2', `${note} · ${color}`)
log(await linkPage.inputValue('input[type=email]') === 'owner@example.com' && await linkPage.inputValue('input[name=password]') === 'owner-pass-1', 'not linked: both fields keep their values')
log((await sql.unsafe(`select count(*)::int as n from ${SCHEMA}.sign_in_failures`))[0].n === failuresBefore, 'not linked: no failure counted')
if (SHOTS) await linkPage.screenshot({ path: `${SHOTS}/sign-in-not-linked-390.png` })
await browser.close(); await sql.end()
const serverLog = process.env.SERVER_LOG ? (await import('node:fs')).readFileSync(process.env.SERVER_LOG, 'utf8') : null
if (serverLog !== null) log(!/owner-pass-1|other-pass-1|Not-The-Pass-7/.test(serverLog), 'no password in the server log')
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
