// #364: a notice swipes away toward its edge. Usage: [ONLY=chromium|webkit] node tests/evidence/toast-swipe/swipe.mjs <port> <throwaway-store> <repo-path>
// against `vite dev` with DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=<throwaway-store>. Never his data.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
const [port, store, repo] = process.argv.slice(2); if (!port || !store || !repo) throw new Error('port, store and repo required')
const require = createRequire(repo + '/')
const pw = require('@playwright/test')
const base = `http://127.0.0.1:${port}`, wait = ms => new Promise(r => setTimeout(r, ms))
const reseed = () => execSync(`cd ${repo} && node --no-warnings tests/evidence/toast-swipe/seed.ts ${repo} ${store}`, { stdio: 'ignore' })
const engines = (process.env.ONLY ?? 'chromium,webkit').split(',')
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++ }
for (const engine of engines) {
  const b = await pw[engine].launch()
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    reseed()
    const c = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' }), p = await c.newPage()
    await p.goto(base + '/tasks?view=open'); await p.getByRole('checkbox').first().waitFor({ timeout: 30000 }); await p.waitForLoadState('networkidle').catch(() => {}); await wait(600)
    const T = `${engine} ${w}`
    const notice = () => p.locator('[data-slot="toast"]:not([data-exiting="true"])')
    const tick = async () => { await p.getByRole('checkbox', { name: /Mark .* done/ }).first().click(); await notice().first().waitFor({ timeout: 4000 }); await wait(450) }
    const checked = async () => -(await p.getByRole('checkbox', { checked: false }).count())
    const drag = async (from, dy, ms = 160) => { const box = await from.boundingBox(); const x = box.x + box.width / 2, y = box.y + box.height / 2; await p.mouse.move(x, y); await p.mouse.down(); const steps = 8; for (let i = 1; i <= steps; i++) { await p.mouse.move(x, y + dy * i / steps); await wait(ms / steps) } await p.mouse.up(); await wait(450) }
    // ✕ target
    await tick()
    const x = await p.locator('[data-slot="toast"] .toast__close-button').first().boundingBox(), tb = await notice().first().boundingBox()
    ok(x && Math.round(x.width) === 44 && Math.round(x.height) === 44 && x.x + x.width <= tb.x + tb.width + 0.5 && x.y >= tb.y - 0.5, `${T} ✕ target 44x44 inside the notice (${JSON.stringify(x)} in ${JSON.stringify(tb)})`)
    if (engine === 'chromium') await p.screenshot({ path: `/tmp/toast-swipe-${w}.png` })
    // swipe up on the text closes; the change stays
    let before = await checked()
    await drag(p.locator('[data-slot="toast"] .toast__title').first(), -44)
    ok(await notice().count() === 0 && await checked() === before, `${T} swipe up 44 px closes, nothing undone`)
    // press on Undo, then swipe: closes, Undo doesn't fire
    await tick(); before = await checked()
    await drag(p.locator('[data-slot="toast"] .toast__action').first(), -44)
    ok(await notice().count() === 0 && await checked() === before, `${T} swipe starting on Undo closes without undoing`)
    // sideways 12 px from Undo and released on it: not a tap, so nothing is undone (Ratchet 9875ade4)
    await tick(); before = await checked()
    { const box = await p.locator('[data-slot="toast"] .toast__action').first().boundingBox(); const x = box.x + 8, y = box.y + box.height / 2
      await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 4; i++) { await p.mouse.move(x + 3 * i, y); await wait(20) } await p.mouse.up(); await wait(600) }
    ok(await checked() === before && await notice().count() === 1, `${T} press Undo, slide 12 px sideways, release on it: nothing undone`)
    // down 10 px on a top notice's Undo (the rubber band) and back: not a tap either
    { const box = await p.locator('[data-slot="toast"] .toast__action').first().boundingBox(); const x = box.x + box.width / 2, y = box.y + 6
      await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 4; i++) { await p.mouse.move(x, y + 3 * i); await wait(20) } await p.mouse.up(); await wait(600) }
    ok(await checked() === before, `${T} press Undo, slide 12 px down, release on it: nothing undone`)
    await p.locator('[data-slot="toast"] .toast__close-button').first().click(); await wait(400)
    // under the threshold, slow: springs back
    await tick()
    await drag(p.locator('[data-slot="toast"] .toast__title').first(), -20, 600)
    const tr = await notice().first().evaluate(e => e.style.translate)
    ok(await notice().count() === 1 && !tr, `${T} 20 px slow springs back`)
    // flick: 16 px fast
    // A real flick is faster than Playwright's mouse can move, so this one is dispatched in the page: 16 px in ~24 ms.
    await notice().first().evaluate(el => new Promise(done => {
      const r = el.querySelector('.toast__title').getBoundingClientRect(), x = r.x + 5, y0 = r.y + 5
      const ev = (type, y) => el.querySelector('.toast__title').dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 }))
      ev('pointerdown', y0); let i = 0
      const step = () => { i++; ev('pointermove', y0 - i * 4); if (i < 4) setTimeout(step, 6); else setTimeout(() => { ev('pointerup', y0 - 16); done() }, 6) }
      setTimeout(step, 6)
    }))
    await wait(450)
    ok(await notice().count() === 0, `${T} 16 px flick (~0.6 px/ms) closes`)
    // A flick that lifts with no move in between (the iOS Simulator sends these): its release counts as the move.
    await tick()
    await notice().first().evaluate(el => new Promise(done => {
      const t = el.querySelector('.toast__title'), r = t.getBoundingClientRect(), x = r.x + 5, y0 = r.y + 5
      const ev = (type, y) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 }))
      ev('pointerdown', y0); setTimeout(() => { ev("pointerup", y0 - 18); done() }, 16)
    }))
    await wait(450)
    ok(await notice().count() === 0, `${T} 18 px flick with no move event closes`)
    // The same from Undo, released 12 px up still on it: it closes, and Undo doesn't fire
    await tick(); before = await checked()
    await notice().first().evaluate(el => new Promise(done => {
      const t = el.querySelector('.toast__action'), r = t.getBoundingClientRect(), x = r.x + r.width / 2, y0 = r.y + r.height - 4
      const ev = (type, y) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 }))
      ev('pointerdown', y0); setTimeout(() => { ev('pointerup', y0 - 12); done() }, 16)
    }))
    await wait(700)
    ok(await notice().count() === 0 && await checked() === before, `${T} a move-less 12 px flick from Undo closes without undoing`)
    // Move-less releases 12 px right and 12 px down from Undo: never a tap (Ratchet b050a9e5)
    for (const [name, mx, my] of [['right', 12, 0], ['down', 0, 12]]) {
      await tick(); before = await checked()
      await notice().first().evaluate((el, [mx, my]) => new Promise(done => {
        const t = el.querySelector('.toast__action'), r = t.getBoundingClientRect(), x = r.x + 6, y0 = r.y + 6
        const ev = (type, xx, y) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 10, pointerType: 'touch', isPrimary: true, clientX: xx, clientY: y, button: 0 }))
        ev('pointerdown', x, y0); setTimeout(() => { ev('pointerup', x + mx, y0 + my); done() }, 16)
      }), [mx, my])
      await wait(700)
      ok(await checked() === before, `${T} a move-less 12 px release ${name} on Undo: nothing undone`)
      await p.locator('[data-slot="toast"] .toast__close-button').evaluateAll(es => es.forEach(e => e.click())); await p.mouse.move(5, 400); await wait(500)
    }
    // down
    await tick()
    await drag(p.locator('[data-slot="toast"] .toast__title').first(), 44)
    ok(await notice().count() === (w < 600 ? 1 : 0), `${T} swipe down ${w < 600 ? 'stays (top notice)' : 'closes (bottom notice)'}`)
    if (w < 600) { await p.locator('[data-slot="toast"] .toast__close-button').first().click(); await wait(400); ok(await notice().count() === 0, `${T} ✕ closes`) }
    // timer waits while pressed: hold 9 s (timeout 8 s), release in place
    await tick()
    { const box = await p.locator('[data-slot="toast"] .toast__title').first().boundingBox(); await p.mouse.move(box.x + 5, box.y + 5); await p.mouse.down(); await wait(9000); const still = await notice().count(); await p.mouse.move(box.x + 300, box.y + 400); await p.mouse.up(); ok(still === 1, `${T} held 9 s, still there`) }
    // slide off the notice sideways and let go outside it: the countdown still resumes and it leaves on time
    await tick()
    { const box = await p.locator('[data-slot="toast"] .toast__title').first().boundingBox(); const x = box.x + 5, y = box.y + box.height / 2
      await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(x + 60 * i, y + 30 * i); await wait(20) }
      await p.mouse.move(x + 200, 600); await p.mouse.up(); await wait(9500) }
    ok(await notice().count() === 0, `${T} slid off sideways and let go outside: gone after its 8 s`)
    // a tap on its text, then nothing: it still leaves on time
    await tick()
    await p.locator('[data-slot="toast"] .toast__title').first().click(); await p.mouse.move(5, 400); await wait(9500)
    ok(await notice().count() === 0, `${T} a tap on its text: gone after its 8 s`)
    // tap Undo still works
    // Close what's left through its ✕ (taking nodes out from under React would blank the list).
    await p.locator('[data-slot="toast"] .toast__close-button').evaluateAll(es => es.forEach(e => e.click())).catch(() => {}); await p.mouse.move(5, 400); await wait(500)
    ok(await p.getByRole('checkbox', { name: /Mark .* done/ }).count() > 0, `${T} open to-dos left for the last case`)
    await tick(); before = await checked()
    await p.locator('[data-slot="toast"] .toast__action').first().click(); await wait(800)
    ok(await checked() === before - 1, `${T} a tap on Undo still undoes`)
    await c.close()
  }
  await b.close()
}
console.log(fails ? `${fails} FAILED` : 'all passed')
