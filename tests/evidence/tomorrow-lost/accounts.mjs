// B68 (Ratchet, Lead on PR #32): the Tomorrow block's unsaved lines and draft are kept per account. Two accounts on
// one browser: A leaves a line on Retry and a draft, signs out; B signs in and sees neither, and nothing of A's is
// sent while B is signed in; A signs in again and gets both back, saved to A's own days.
// Needs sign-in on: a local Supabase auth server and a throwaway Postgres schema (tests/evidence/sign-in-links has the
// rig), with email confirmation off so sign-up signs in at once. Never point it at production: it signs up and writes.
//   node tests/evidence/tomorrow-lost/accounts.mjs http://127.0.0.1:3591
import { chromium, webkit } from '@playwright/test'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error('usage: accounts.mjs http://127.0.0.1:<port> (local only: it writes)'); process.exit(2) }
let failed = 0
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }
const flat = text => text.replace(/\n/g, ' / ')
const password = 'rig-password-1'

const input = page => page.getByRole('textbox', { name: 'Add a to-do for tomorrow' })
const blockText = page => page.locator('.tomorrow').innerText()
async function signUp(page, email) {
  await page.goto(base + '/sign-up', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.locator('.tomorrow').waitFor({ timeout: 30000 })
}
async function signIn(page, email) {
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.locator('.tomorrow').waitFor({ timeout: 30000 })
}
// What the Sign out link does (account-row.tsx): the server ends the session, the offline copy goes, then /sign-in.
async function signOut(page) {
  await page.evaluate(() => fetch('/api/auth/sign-out', { method: 'POST' }))
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle' })
}
const isAdd = route => route.request().method() === 'POST' && (route.request().postData() ?? '').includes('"add-task"')

for (const [engine, width] of [[chromium, 1280], [webkit, 390]]) {
  const browser = await engine.launch()
  const tag = `${width} ${engine.name()}`, stamp = Date.now().toString(36)
  const a = `a-${stamp}@example.test`, b = `b-${stamp}@example.test`
  const line = `A's unsaved line ${stamp}`, draft = `A's draft ${stamp}`
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Vancouver', serviceWorkers: 'block' })
  const page = await context.newPage(), errors = [], sent = []
  // WebKit reports a request cancelled by a navigation (the save pagehide starts, cut off by the next page) as a page
  // error, "... due to access control checks". No unhandled rejection or window error is raised in the page with it.
  const cancelled = /\/_serverFn\/.* due to access control checks/
  page.on('pageerror', e => { if (!cancelled.test(e.message)) errors.push(e.message) })
  page.on('request', r => { if (r.method() === 'POST') sent.push(r.postData() ?? '') })

  // A: a line left on Retry, then a draft typed with no Return.
  await signUp(page, a)
  await page.route('**/_serverFn/**', route => (isAdd(route) ? route.abort() : route.continue()))
  await input(page).fill(line)
  await input(page).press('Enter')
  await page.locator('.tomorrow-pending', { hasText: line }).getByText('Not added').waitFor({ timeout: 15000 })
  await input(page).fill(draft)
  await signOut(page)
  await page.unroute('**/_serverFn/**')

  // B, same browser: neither shows, and nothing of A's is sent.
  const before = sent.length
  await signUp(page, b)
  await page.waitForTimeout(2000)
  const blockB = await blockText(page), inputB = await input(page).inputValue(), pageB = await page.locator('.continuous-editor').first().innerText()
  check(`${tag} B sees neither A's line nor A's draft`, !blockB.includes(line) && !blockB.includes(draft) && !inputB.includes(draft), `${flat(blockB)} | input "${inputB}"`)
  check(`${tag} nothing of A's is sent while B is signed in`, !sent.slice(before).some(p => p.includes(stamp) && (p.includes("A's unsaved") || p.includes("A's draft"))))
  check(`${tag} B's page has neither`, !pageB.includes(line) && !pageB.includes(draft))
  await signOut(page)

  // A again: both come back and save to A's tomorrow.
  await signIn(page, a)
  await page.locator('.tomorrow-row', { hasText: line }).waitFor({ timeout: 15000 }).catch(() => {})
  const blockA = await blockText(page), inputA = await input(page).inputValue()
  const lineBack = (await page.locator('.tomorrow-row', { hasText: line }).count()) === 1
  const draftBack = blockA.includes(draft) || inputA === draft
  check(`${tag} A signs in again: the line is back and saved to A's tomorrow`, lineBack, flat(blockA))
  check(`${tag} A signs in again: the draft is back (as a line or in the input)`, draftBack, `${flat(blockA)} | input "${inputA}"`)
  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  await context.close()
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
