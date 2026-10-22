// Jazz 7e6b3638: after a wrong code the boxes are empty and the caret is in the first one; the 6th digit submits;
// the email field stays on --fill when focused; no required marker; account row in --text-meta on the label edge.
import { chromium } from '@playwright/test'
const [BASE, AUTH, OUT] = process.argv.slice(2)
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
const b = await chromium.launch()
for (const width of [390, 1280]) {
  const p = await b.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } })
  await p.goto(BASE + '/sign-in', { waitUntil: 'networkidle' })
  const email = p.locator('input[type=email]')
  await email.focus()
  const bg = await email.evaluate(e => getComputedStyle(e).backgroundColor)
  log(bg === 'rgb(239, 238, 245)', `${width}: focused email field is --fill`, bg)
  log(!(await p.locator('form').textContent())?.includes('*'), `${width}: no required marker`)
  await fetch(`${AUTH}/__reset`)
  await email.fill('owner@example.com'); await p.click('button[type=submit]')
  const otp = p.locator('input[autocomplete=one-time-code]')
  await otp.waitFor()
  await p.keyboard.type('000000') // the 6th digit submits on its own
  await p.waitForSelector('.sign-in-error')
  log(await otp.inputValue() === '', `${width}: after a wrong code the boxes are empty`, await otp.inputValue())
  log(await otp.evaluate(e => e === document.activeElement), `${width}: and the caret is back in the code`)
  await p.screenshot({ path: `${OUT}/sign-in-after-wrong-${width}.png` })
  await p.keyboard.type('12')
  log(await otp.inputValue() === '12', `${width}: typing again works straight away`, await otp.inputValue())
  log(await p.locator('.sign-in-error').count() === 0, `${width}: the error clears as he types`)
  const code = (await (await fetch(`${AUTH}/__code?email=owner@example.com`)).json()).code
  await otp.fill(''); await p.keyboard.type(code)
  await p.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 15000 }).catch(() => undefined)
  log(!p.url().includes('/sign-in'), `${width}: the right code signs in without a tap`, p.url())
  if (width === 1280) {
    await p.waitForSelector('.account-row-sidebar')
    const [row, label] = await Promise.all([p.locator('.account-row-sidebar'), p.locator('.side-label').first()].map(l => l.evaluate(e => {
      const r = document.createRange(); r.selectNodeContents(e); const s = getComputedStyle(e)
      return { left: r.getClientRects()[0]?.left ?? 0, size: s.fontSize }
    })))
    log(row.size === '13px', '1280: account row in --text-meta', row.size)
    log(Math.abs(row.left - label.left) <= 1, '1280: account row text starts on the label edge', `${row.left} vs ${label.left}`)
    await p.screenshot({ path: `${OUT}/account-row-1280.png` })
  } else {
    await p.goto(BASE + '/pages', { waitUntil: 'networkidle' })
    const size = await p.locator('.account-row-phone').evaluate(e => getComputedStyle(e).fontSize)
    log(size === '13px', '390: account row in --text-meta', size)
  }
  await p.close()
}
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
