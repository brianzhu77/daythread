// B76 cuts: no morning card, no Continue?, no Tomorrow block; a line left unsaved in the old block is saved once as a
// to-do on the later of its day and today, and a half-typed input as a to-do for today (Bumblebee 0331a0c6).
// Usage: node pending.mjs <base> (blank store).
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], out = new URL('.', import.meta.url).pathname
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const pad = n => String(n).padStart(2, '0'), iso = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
const today = iso(new Date()), yesterday = iso(new Date(Date.now() - 864e5)), tomorrow = iso(new Date(Date.now() + 864e5))
for (const [name, br, w, h] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) {
  const b = await br.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, ...(w === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(e.message) })
  await p.goto(`${base}/`); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle')
  const owner = await p.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('daythread.offline.'))?.slice('daythread.offline.'.length) ?? null)
  const body = await p.locator('body').innerText()
  ok(!/Start the day|Add all tasks|Continue\?|Add for tomorrow/.test(body) && !(await p.locator('.start-the-day, .tomorrow').count()), `${name} ${w}: no card, no Continue?, no Tomorrow block`)
  // Seed what the old block would have left on this device, under every key shape this account could use.
  const stamp = `${name}-${Date.now()}`
  await p.evaluate(({ stamp, yesterday, tomorrow }) => {
    const keys = Object.keys(localStorage)
    const owner = (window.__owner = (keys.find(k => k.startsWith('daythread.offline.')) ?? '').slice('daythread.offline.'.length) || 'local')
    const line = (title, date) => ({ key: crypto.randomUUID(), title, operationId: crypto.randomUUID(), failed: true, date, typedOn: yesterday })
    localStorage.setItem(`daythread.tomorrow-lines.${owner}`, JSON.stringify([line(`Overdue line ${stamp}`, yesterday), line(`Tomorrow line ${stamp}`, tomorrow)]))
    localStorage.setItem(`daythread.tomorrow-draft.${owner}`, `Half typed ${stamp}`)
  }, { stamp, yesterday, tomorrow })
  await p.reload(); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(2500)
  const state = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /^daythread\.tomorrow-(lines|draft)\./.test(k)).map(k => [k, localStorage.getItem(k)])))
  ok(Object.keys(state).length > 0 && Object.entries(state).every(([k, v]) => k.includes('-lines.') && v === '[]'), `${name} ${w}: storage emptied after saving (${JSON.stringify(state)})`)
  const todayText = await p.locator('.continuous-editor').innerText()
  ok(todayText.includes(`Overdue line ${stamp}`) && todayText.includes(`Half typed ${stamp}`), `${name} ${w}: the overdue line and the half-typed input are to-dos on today's page`)
  const rows = await p.locator('.editor-task', { hasText: stamp }).count()
  ok(rows === 2, `${name} ${w}: as to-do rows, not plain lines (${rows})`)
  await p.goto(`${base}/day/${tomorrow}`); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800)
  ok((await p.locator('body').innerText()).includes(`Tomorrow line ${stamp}`), `${name} ${w}: the line meant for tomorrow is planned for tomorrow`)
  // Once: a reload doesn't add them again.
  await p.goto(`${base}/`); await p.waitForLoadState('networkidle'); await p.waitForTimeout(1500)
  ok(await p.locator('.editor-task', { hasText: stamp }).count() === 2, `${name} ${w}: a reload adds nothing again`)
  await p.screenshot({ path: `${out}/${name}-${w}-today.png`, fullPage: true })
  ok(!errs.length, `${name} ${w}: no page errors ${errs.join(' | ')}`)
  await b.close()
}
process.exitCode = fail ? 1 : 0
