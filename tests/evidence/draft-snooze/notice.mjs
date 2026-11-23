// B100: the notice after ✕ or Dismiss on a day's suggestions, on screen. Usage: [ONLY=chromium|webkit] node
// tests/evidence/draft-snooze/notice.mjs <port> <throwaway-store> <repo-path> against `vite dev` with DAYTHREAD_STORAGE=sqlite
// DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=<throwaway-store>. Reseeds per case (seed.ts). Never his data.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
const [port, store, repo] = process.argv.slice(2); if (!port || !store || !repo) throw new Error('port, store and repo required')
const require = createRequire(repo + '/'), pw = require('@playwright/test')
const { SqliteWorkspaceRepository } = await import(repo + '/src/server/sqlite-repository.ts')
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms))
// A fixed weekday: the day row leaves out tomorrow, so on a Sunday it has no Mon (Lead e4d87fa8). The browser's clock runs
// from 10:00 on this week's Wednesday, and the store is seeded for that day.
const now = new Date(), wednesday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 3, 10)
const today = new Intl.DateTimeFormat('en-CA').format(wednesday)
const reseed = () => execSync(`cd ${repo} && node --no-warnings tests/evidence/draft-snooze/seed.ts ${store} ${today}`, { stdio: 'ignore' })
const { plannedOn } = await import(repo + '/src/domain/workspace.ts')
const planned = async title => { const w = await new SqliteWorkspaceRepository(store).load(); return plannedOn(w, w.tasks.find(x => x.title === title).id) }
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++ }
for (const engine of (process.env.ONLY ?? 'chromium,webkit').split(',')) {
  const b = await pw[engine].launch()
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const T = `${engine} ${w}`
    const c = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' })
    await c.clock.install({ time: wednesday })
    const open = async () => { reseed(); const p = await c.newPage(); await p.goto(base + '/'); await p.locator('.draft-band').first().waitFor({ timeout: 30000 }); await p.waitForLoadState('networkidle').catch(() => {}); await wait(800); return p }
    const texts = async p => (await p.locator('[data-slot="toast"]:not([data-exiting="true"])').allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim())
    const front = p => p.locator('[data-slot="toast"]:not([data-exiting="true"])').first()
    // Targets (Ratchet 8d183260, e0544f3d): 44 px tall on a phone, every button inside the notice, none over Undo or ✕.
    const targets = p => p.evaluate(() => { const box = e => e.getBoundingClientRect(), t = box(document.querySelector('[data-slot="toast"]')), u = box(document.querySelector('[data-slot="toast"] .toast__action')), x = box(document.querySelector('[data-slot="toast"] .toast__close-button')), hit = (a, c) => a.x < c.right && c.x < a.right && a.y < c.bottom && c.y < a.bottom
      const bs = [...document.querySelectorAll('.toast-row-button')].map(box); return { min: Math.min(...bs.map(b => b.height)), inside: bs.every(b => b.x >= t.x - .5 && b.right <= t.right + .5 && b.y >= t.y - .5 && b.bottom <= t.bottom + .5), clear: !bs.some(b => hit(b, u) || hit(b, x)) } })
    const targetsOk = async (p, what) => { const r = await targets(p); ok(r.inside && r.clear && (w >= 640 || r.min >= 44), `${T} ${what}: day buttons ${Math.round(r.min)} px tall, inside the notice, clear of Undo and ✕`) }
    const closeAll = async p => { await p.locator('[data-slot="toast"] .toast__close-button').evaluateAll(es => es.forEach(e => e.click())); await p.mouse.move(5, 500); await wait(700) }
    // 1. ✕ on a to-do → day row; Mon → planned on Monday, Moved notice; Undo move → Skipped back; Undo → suggestion back
    { const p = await open()
      await p.getByRole('button', { name: /Skip Tech Design Review/ }).click(); await wait(700)
      let t = await texts(p); ok(/^Skipped Undo Move to \S+ \S+ Mon \S+ Pick…$|^Skipped Undo Move to Mon \S+ Pick…$/.test(t[0] ?? ''), `${T} ✕ on a to-do: ${JSON.stringify(t[0])}`)
      await targetsOk(p, '✕')
      const row = await p.locator('.toast-row').first().boundingBox(), n = await front(p).boundingBox()
      ok(row && row.x >= n.x && row.x + row.width <= n.x + n.width + 0.5, `${T} the day row sits inside the notice`)
      const mon = p.locator('.toast-row-button', { hasText: /^Mon / }); const monDate = (await mon.getAttribute('aria-label')).replace(/^Move to /, '')
      await mon.click(); await wait(900)
      t = await texts(p); ok(t[0] === `Moved to ${monDate} Undo`, `${T} Mon → ${JSON.stringify(t[0])}`)
      ok((await p.locator('.draft-band', { hasText: 'Fraud' }).count()) === 0, `${T} the suggestion stays off today`)
      const mondayIso = await planned('Tech Design Review - Fraud'); ok(mondayIso && new Date(mondayIso + 'T12:00').getDay() === 1 && mondayIso > today, `${T} the to-do is planned on Monday (${mondayIso})`)
      await front(p).getByRole('button', { name: 'Undo' }).click(); await wait(900)
      t = await texts(p); ok(/^Skipped Undo Move to/.test(t[0] ?? ''), `${T} Undo move brings back the Skipped notice`)
      await front(p).getByRole('button', { name: 'Undo' }).click(); await wait(1000)
      ok((await p.locator('.draft-band', { hasText: 'Fraud' }).count()) === 1, `${T} its Undo brings the suggestion back`)
      ok((await planned('Tech Design Review - Fraud')) < today, `${T} and its plan is back as it was`)
      await p.close() }
    // 2. ✕ on a line: no day row
    { const p = await open()
      await p.getByRole('button', { name: /Skip Draft the offsite agenda/ }).click(); await wait(700)
      const t = await texts(p); ok(t[0] === 'Skipped Undo' && (await p.locator('.toast-row').count()) === 0, `${T} ✕ on a line: ${JSON.stringify(t[0])}, no day row`)
      await p.close() }
    // 3. Dismiss on a mix: the row names the to-dos; Sat/Mon moves all three
    { const p = await open()
      await p.getByRole('button', { name: 'Dismiss' }).click(); await wait(800)
      let t = await texts(p); ok(/^Skipped 4 Undo Move 3 to-dos to/.test(t[0] ?? ''), `${T} Dismiss on a mix: ${JSON.stringify(t[0])}`)
      await targetsOk(p, 'Dismiss on a mix')
      await p.locator('.toast-row-button', { hasText: /^Mon / }).click(); await wait(900)
      t = await texts(p); ok(/^Moved 3 to /.test(t[0] ?? ''), `${T} → ${JSON.stringify(t[0])}`)
      await p.close() }
    // 4. Pick…: the notice waits for the picker (no timeout) instead of leaving under it
    { const p = await open()
      await p.getByRole('button', { name: /Skip Umbrella/ }).click(); await wait(600)
      await p.locator('.toast-row-button', { hasText: 'Pick…' }).click(); await p.keyboard.press('Escape').catch(() => {}); await p.mouse.move(5, 500); await wait(11000)
      ok((await texts(p)).some(s => s.startsWith('Skipped')), `${T} after Pick… the notice is still there at 11 s`)
      await p.close() }
    await c.close()
  }
  await b.close()
}
console.log(fails ? `${fails} FAILED` : 'all passed')
