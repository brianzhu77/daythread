// Browser run for the Cloudflare Worker build (B67) on a throwaway Postgres with scripts/fake-supabase-auth.mjs
// standing in for Supabase. Never point it at production: it signs up, writes and signs out. Run:
//   FAKE_USERS='old@test.com:right-pw-1' node scripts/fake-supabase-auth.mjs 54330 &
//   DAYTHREAD_TARGET=cloudflare npx vite build
//   npx wrangler dev -c .output/server/wrangler.json --port 8787 --var DATABASE_URL:$DB \
//     --var SUPABASE_URL:http://127.0.0.1:54330 --var SUPABASE_PUBLISHABLE_KEY:pk --var DAYTHREAD_INVITES:new@test.com,old@test.com &
//   DB=$DB node scripts/worker-smoke.mjs http://127.0.0.1:8787 /tmp/worker-smoke
// Checks: signed-out redirects; an invited sign-up lands on Today with the first-day line; a typed line is saved to
// Postgres and survives a reload, a sign-out and a sign-in; Pages and Tasks render; an address not on the list is
// refused; the Home Screen worker serves Today offline after one open.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'
import postgres from 'postgres'

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, ''), out = process.argv[3] ?? '/tmp/worker-smoke'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local Worker only: this run signs up and writes')
mkdirSync(out, { recursive: true })
const sql = postgres(process.env.DB ?? 'postgres://daythread@127.0.0.1:54329/daythread', { prepare: false, onnotice: () => {} })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
const results = []
async function run(name, fn, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Vancouver', ...options })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/favicon|status of (400|401|403|404|429)|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push('console: ' + m.text()) })
  try { await fn(page, context); results.push({ name, ok: !errors.length, errors }) }
  catch (e) { results.push({ name, ok: false, error: e.message, errors }); await page.screenshot({ path: `${out}/fail-${name}.png`, fullPage: true }).catch(() => {}) }
  finally { await context.close() }
}
async function signIn(page, email, password) {
  await page.goto(base + '/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => new URL(u).pathname === '/', { timeout: 20000 })
}
const line = `Worker smoke ${Date.now()}`

await run('signed-out-redirects', async page => {
  for (const path of ['/', '/pages', '/tasks']) {
    await page.goto(base + path)
    await page.waitForURL(/\/sign-in/, { timeout: 15000 })
  }
  assert((await page.locator('main').innerText()).includes('Sign in'))
})
await run('invited-sign-up-types-and-saves', async page => {
  await page.goto(base + '/sign-up')
  await page.getByLabel('Email').fill('new@test.com')
  await page.getByLabel('Password').fill('right-pw-2')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL(u => new URL(u).pathname === '/', { timeout: 20000 })
  await page.locator('.day-first').waitFor({ timeout: 30000 })
  await page.screenshot({ path: `${out}/01-first-day.png`, fullPage: true })
  await page.locator('.editor-task-title').filter({ hasText: /^$/ }).first().click()
  await page.keyboard.type(line)
  await page.waitForFunction(() => document.querySelector('.editor-save-line')?.textContent === 'Saved', null, { timeout: 15000 })
  for (let i = 0; i < 40; i++) {
    const [{ n }] = await sql`select count(*)::int as n from daythread.pages where document like ${'%' + line + '%'}`
    if (n === 1) break
    if (i === 39) throw new Error('typed line never reached Postgres')
    await page.waitForTimeout(250)
  }
  await page.reload()
  await page.getByText(line).waitFor({ timeout: 20000 })
})
await run('sign-out-sign-in-keeps-the-line', async page => {
  await signIn(page, 'new@test.com', 'right-pw-2')
  await page.getByText(line).waitFor({ timeout: 20000 })
  await page.goto(base + '/pages'); await page.locator('main').waitFor()
  await page.goto(base + '/tasks'); await page.locator('main').waitFor()
  await page.goto(base + '/')
  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await page.waitForURL(/\/sign-in/, { timeout: 15000 })
})
await run('not-invited-is-refused', async page => {
  await page.goto(base + '/sign-up')
  await page.getByLabel('Email').fill('stranger@test.com')
  await page.getByLabel('Password').fill('right-pw-3')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByText(/invite/i).first().waitFor({ timeout: 15000 })
  assert.equal(new URL(page.url()).pathname, '/sign-up')
})
await run('offline-after-one-open', async (page, context) => {
  await signIn(page, 'new@test.com', 'right-pw-2')
  await page.getByText(line).waitFor({ timeout: 20000 })
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30000 }).catch(async () => { await page.reload(); await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30000 }) })
  await page.waitForTimeout(3000) // let the worker warm the copy
  await context.setOffline(true)
  await page.reload()
  await page.getByText(line).waitFor({ timeout: 20000 })
  await page.screenshot({ path: `${out}/02-offline.png`, fullPage: true })
  await context.setOffline(false)
}, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

await browser.close(); await sql.end()
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.error ? ` · ${r.error}` : ''}${r.errors.length ? ` · ${r.errors.join(' | ')}` : ''}`)
process.exit(results.every(r => r.ok) ? 0 : 1)
