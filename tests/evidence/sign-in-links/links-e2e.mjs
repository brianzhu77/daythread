// Emailed links and "send the link again", end to end against Supabase's real auth server (PR A; Lead b20588bc,
// Jazz's words in #daythread:b842c6d3). Needs, all local (rig in README.md here):
//   - the auth server built from github.com/supabase/auth, behind a stand-in for Supabase's /auth/v1 gateway on AUTH,
//     with GOTRUE_MAILER_OTP_EXP=30 and GOTRUE_SMTP_MAX_FREQUENCY=10s, mailing to an SMTP sink that writes MAIL/*.eml
//   - the app built from this branch on BASE with SUPABASE_URL=AUTH, sign-up open, Postgres on a throwaway schema
//   node tests/evidence/sign-in-links/links-e2e.mjs http://127.0.0.1:3580 /tmp/rb-gotrue/mail chromium|webkit [SHOTS_DIR]
import { chromium, webkit } from '@playwright/test'
import fs from 'node:fs'

const [BASE, MAIL, BROWSER = 'chromium', SHOTS] = process.argv.slice(2)
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${BROWSER}-390-${name}.png` }) : undefined
const engine = { chromium, webkit }[BROWSER]
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${BROWSER}] ${what}${detail ? ` (${detail})` : ''}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const run = Date.now().toString(36)

/** Decodes quoted-printable and returns the newest email to `to` after `since`: its subject and its link. */
function mails(to) {
  return fs.readdirSync(MAIL).filter(f => f.endsWith('.eml')).sort().map(f => {
    const raw = fs.readFileSync(`${MAIL}/${f}`, 'utf8').replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    const href = /href="([^"]*verify[^"]*)"/.exec(raw)?.[1]?.replace(/&amp;/g, '&')
    return { file: f, to: /^To: (.*)$/m.exec(raw)?.[1]?.trim(), subject: /^Subject: (.*)$/m.exec(raw)?.[1]?.trim(), href }
  }).filter(m => m.to?.includes(to))
}
async function nextMail(to, before, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { const all = mails(to); if (all.length > before) return all.at(-1) }
  return null
}
const note = page => page.locator('.sign-in-note').innerText().catch(() => '')
const api = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) })

const browser = await engine.launch()
try {
  const late = `late-${run}-${BROWSER}@rig.local`, pw = 'pw-long-enough-1'

  // 1. Sign-up wait: the new words, and "send it again" sends a second confirmation.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/sign-up')
  await page.fill('input[type=email]', late); await page.fill('input[name=password]', pw)
  await page.click('button[type=submit]')
  await page.waitForSelector('.sign-in-note')
  log((await note(page)).includes(`we sent a link to ${late}. It signs you in.`), 'sign-up wait: says the link signs you in', await note(page))
  const first = await nextMail(late, 0)
  log(first?.subject !== undefined && /type=signup/.test(first?.href ?? ''), 'sign-up: a confirmation email arrives', first?.subject)
  const hint = page.locator('.sign-in-again')
  await shot(page, '1-sign-up-wait')
  log(await hint.isVisible(), "sign-up wait: \"Didn't get it? Check spam, or send it again\"", await hint.innerText().catch(() => ''))
  await sleep(10_500) // the auth server's per-address minute (10 s on the rig)
  await hint.getByRole('button', { name: 'send it again' }).click()
  await page.waitForSelector('.sign-in-again:has-text("Sent again")')
  const second = await nextMail(late, 1)
  log(!!second && second.href !== first.href && /type=signup/.test(second.href), 'send it again: a second, different confirmation link', `${mails(late).length} emails`)
  await shot(page, '2-sent-again')
  log((await hint.innerText()).startsWith(`Sent again to ${late}`), 'send it again: "Sent again to … · it can take a minute"')
  const soon = await api('/api/auth/resend', { email: late })
  log(soon.status === 429 && (await soon.json()).error === 'too-soon', 'again within the minute: 429 too-soon, no email', `${soon.status}`)
  await ctx.close()

  // 2. The late invitee: the link expired before they opened it.
  console.log('     waiting 31 s for the 30 s link to expire…')
  await sleep(31_000)
  const lateCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const lp = await lateCtx.newPage()
  await lp.goto(second.href)
  await lp.waitForSelector('.sign-in-note')
  log(new URL(lp.url()).pathname === '/sign-in' && !lp.url().includes('#'), 'expired link: lands on sign-in, the fragment cleared', lp.url())
  await shot(lp, '3-expired-link')
  log((await note(lp)) === "That link has expired or was already used · Sign in, or use Forgot password if you don't know it", 'expired link: the note', await note(lp))
  await lp.fill('input[type=email]', late); await lp.fill('input[name=password]', pw); await lp.click('button[type=submit]')
  await lp.waitForSelector('.sign-in-note:has-text("Confirm your email first")')
  await shot(lp, '4-confirm-first')
  log((await note(lp)) === 'Confirm your email first · Send the link again', 'right password, unconfirmed: "Confirm your email first · Send the link again"', await note(lp))
  const before = mails(late).length
  await lp.getByRole('button', { name: 'Send the link again' }).click()
  await lp.waitForSelector('.sign-in-note:has-text("Sent again")')
  const fresh = await nextMail(late, before)
  log(!!fresh && /type=signup/.test(fresh.href) && /Confirm/i.test(fresh.subject), 'send the link again: a new CONFIRMATION, not a reset', fresh?.subject)
  await lp.goto(fresh.href)
  await lp.waitForURL(u => new URL(u).pathname === '/', { timeout: 15_000 }).catch(() => {})
  log(new URL(lp.url()).pathname === '/' && (await lateCtx.cookies()).some(c => c.name.endsWith('daythread_session')), 'the new link signs them in and opens today', lp.url())

  // 3. The same link again: used.
  const usedCtx = await browser.newContext(); const up = await usedCtx.newPage()
  await up.goto(fresh.href); await up.waitForSelector('.sign-in-note')
  log((await note(up)).startsWith('That link has expired or was already used'), 'used link: the same note', await note(up))
  // Any other link error.
  await up.goto(BASE + '/#error=access_denied&error_code=flow_state_not_found&error_description=x'); await up.waitForSelector('.sign-in-note')
  log((await note(up)) === "That link didn't work · Sign in, or use Forgot password if you don't know it", 'another link error: "That link didn\'t work"', await note(up))
  await usedCtx.close()

  // 4. A reset link opened where they're already signed in (lateCtx is signed in, on today).
  const sent = mails(late).length
  const r = await api('/api/auth/recover', { email: late }); log(r.ok, 'forgot password asked')
  const recovery = await nextMail(late, sent)
  log(/type=recovery/.test(recovery?.href ?? ''), 'a reset email arrives', recovery?.subject)
  const sw = await lp.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r?.active ? 'active' : 'none' }).catch(() => 'none')
  await lp.goto(recovery.href)
  await lp.waitForSelector('h1:has-text("Choose a new password")', { timeout: 15_000 }).catch(() => {})
  log(await lp.locator('h1', { hasText: 'Choose a new password' }).isVisible(), 'signed in: the reset link still reaches "Choose a new password"', `${new URL(lp.url()).pathname}, service worker ${sw}`)
  log(!lp.url().includes('access_token'), 'signed in: the token left the address bar')
  await lp.fill('input[name=password]', pw); await lp.click('button[type=submit]')
  await lp.waitForSelector('.sign-in-note:has-text("already your password")').catch(() => {})
  await shot(lp, '5-same-password')
  log((await note(lp)) === "That's already your password · Sign in with it", 'the same password: "That\'s already your password · Sign in with it"', await note(lp))
  await lp.fill('input[name=password]', 'pw-long-enough-2'); await lp.click('button[type=submit]')
  await lp.waitForURL(u => new URL(u).pathname === '/', { timeout: 15_000 }).catch(() => {})
  log(new URL(lp.url()).pathname === '/', 'a new password: saved, signed in, today', lp.url())

  // 5. Signed in, an expired link: handed to sign-in too, opened fresh (as from the mail app) and on an open page.
  const expiredHash = '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
  const tab = await lateCtx.newPage()
  await tab.goto(BASE + expiredHash); await tab.waitForSelector('.sign-in-note').catch(() => {})
  log((await note(tab)).startsWith('That link has expired'), 'signed in, expired link in a new tab: the note shows on sign-in', new URL(tab.url()).pathname)
  await lp.goto(BASE + expiredHash) // lp is on today: only the fragment changes
  await lp.waitForSelector('.sign-in-note').catch(() => {})
  log((await note(lp)).startsWith('That link has expired'), 'signed in, expired link on an open today: the note shows on sign-in', new URL(lp.url()).pathname)
  await lateCtx.close()
} finally { await browser.close() }
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
