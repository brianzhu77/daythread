// An open tab moves onto a new build by itself (Lead 115ea14a, 9c08dbcc; Jazz): a return marks the move, the next hide
// reloads while hidden, only when nothing is on its way or in his hands. Service worker ON (Lead): after the move the
// tab's loaded bundle must be the server's new one. Hidden is emulated and kept across the reload (window.name).
// Usage: node move.mjs <worktree> <dirA> <dirB> [port]
//   dirA/dirB: `vite build` outputs made with VITE_DAYTHREAD_BUILD=build-A / build-B. <worktree>/dist is replaced on
//   each switch, so use a worktree no one else is serving from.
// Chromium only as written. The cases that hold or fail saves use page.route, which in WebKit doesn't see requests
// made under the service worker (Lead 842f7f62).
import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [worktree, dirA, dirB, portArg] = process.argv.slice(2), port = Number(portArg ?? 3660), base = `http://127.0.0.1:${port}`
const store = join(mkdtempSync(join(tmpdir(), 'rb-build-')), 'ws.sqlite')
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const entryOf = dir => readdirSync(join(dir, 'client/assets')).find(f => /^index-.*\.js$/.test(f))
// A built server calls getAppInfo by a hashed id, read from each build's function manifest (Lead 5b9353da).
const appInfoIds = [...new Set([dirA, dirB].map(dir => readFileSync(join(dir, 'server/server.js'), 'utf8').match(/"(\w+)": \{\s*functionName: "getAppInfo_createServerFn_handler"/)?.[1]))]
if (appInfoIds.some(id => !id)) throw new Error('getAppInfo id not found in a build')
let server
// The server runs in its own process group (npx starts vite under it), killed whole however this script ends.
process.on('exit', () => { try { process.kill(-server.pid) } catch { /* gone */ } })
process.on('uncaughtException', e => { console.error(e); process.exit(1) })
const serve = async dir => {
  if (server) { const done = new Promise(r => server.once('exit', r)); process.kill(-server.pid); await done }
  rmSync(join(worktree, 'dist'), { recursive: true, force: true }); cpSync(dir, join(worktree, 'dist'), { recursive: true })
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: worktree, env: { ...process.env, DAYTHREAD_AUTH: 'off', DAYTHREAD_STORAGE: 'sqlite', DAYTHREAD_SQLITE_PATH: store }, stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/sign-in')).status < 500) return } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)) }
  throw new Error('server did not start')
}

const b = await chromium.launch()
const device = async extra => {
  const c = await b.newContext({ serviceWorkers: 'allow', viewport: { width: 1280, height: 700 }, timezoneId: 'America/Vancouver', ...extra })
  // Hidden survives a reload, as a real background tab's does.
  await c.addInitScript(() => {
    const set = v => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); Object.defineProperty(document, 'hidden', { value: v === 'hidden', configurable: true }) }
    if (window.name === 'hidden') set('hidden')
    window.__setVisibility = v => { window.name = v === 'hidden' ? 'hidden' : ''; set(v); document.dispatchEvent(new Event('visibilitychange')) }
  })
  const p = await c.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message))
  p.checks = 0; p.on('request', r => { if (appInfoIds.some(id => r.url().includes(`_serverFn/${id}`))) p.checks++ })
  return p
}
const p = await device()
const leave = async (pg = p) => { await pg.evaluate(() => window.__setVisibility('hidden')) }
const back = async (pg = p) => { await pg.evaluate(() => window.__setVisibility('visible')); await pg.waitForTimeout(800) }
const mark = (pg = p) => pg.evaluate(() => (window.__mark = Math.random()))
const sameDocument = async (m, pg = p) => (await pg.evaluate(() => window.__mark).catch(() => undefined)) === m
/** After a hide: true once the tab has reloaded (still hidden), within `ms`. */
const reloadedWithin = async (m, ms, pg = p) => { for (const until = Date.now() + ms; Date.now() < until; await pg.waitForTimeout(250)) if (!(await sameDocument(m, pg))) return true; return false }
const loadedEntry = (pg = p) => pg.evaluate(() => [...document.querySelectorAll('script[src], link[href]')].map(e => e.src || e.href).concat(performance.getEntriesByType('resource').map(e => e.name)).map(u => u.match(/\/assets\/(index-[^/]+\.js)/)?.[1]).find(Boolean))
const settle = (ms = 2500, pg = p) => pg.waitForTimeout(ms)
const blur = (pg = p) => pg.evaluate(() => document.activeElement?.blur?.())
const line = (n, pg = p) => pg.locator('.editor-task-title').filter({ hasText: new RegExp(`^Line ${n}\\b`) }).first()
const tickBox = title => p.locator(`input[type=checkbox][aria-label="Complete ${title}"]`)
const holdTicks = ms => p.route('**/_serverFn/**', async route => {
  if (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('task-status')) await new Promise(r => setTimeout(r, ms))
  return route.fallback()
})
/** A case where the move must not happen: armed by a return, then left; the tab stays as it is. */
const staysOnLeave = async (what, wait = 3000) => { const m = await mark(); await leave(); ok(!(await reloadedWithin(m, wait)), `${what}: stays`); await back() }

// ---- on build A, with the worker controlling the page
await serve(dirA)
await p.goto(base + '/'); await p.locator('.continuous-editor').first().waitFor({ timeout: 30000 })
await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.locator('.continuous-editor').first().waitFor()
ok(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'the service worker controls the page')
ok(await loadedEntry() === entryOf(dirA), `tab runs build A (${await loadedEntry()})`)
await p.locator('.editor-task-title').first().click()
for (let i = 0; i < 40; i++) { await p.keyboard.type(`Line ${i}`); await p.keyboard.press('Enter') }
await settle(3000); await blur()

// ---- the server moves to build B while the tab is away
await leave(); await serve(dirB)

// 1. Offline: a return doesn't check, so leaving doesn't move.
await p.context().setOffline(true); const checks = p.checks; await back()
ok(p.checks === checks, 'offline: no check')
await staysOnLeave('offline')
await p.context().setOffline(false)
// Returns from here on are online, so each one marks the move.
await back()
ok(p.checks === checks + 1, `online: one check (${p.checks - checks})`)

// 2. A dialog open (search).
await p.keyboard.press('Meta+k'); await p.locator('[role="dialog"]').first().waitFor({ timeout: 5000 }); await settle(2200)
await staysOnLeave('a dialog open')
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await blur(); await settle(500)

// 3. A letter typed in the last 2 s.
await line(3).click(); await p.keyboard.press('ArrowLeft'); await settle(2200); await p.keyboard.type('x')
await staysOnLeave('a letter typed just before leaving')
// 4. An IME composition still open.
await settle(2200); await p.evaluate(() => document.dispatchEvent(new CompositionEvent('compositionstart')))
await staysOnLeave('a composition still open')
await p.evaluate(() => document.dispatchEvent(new CompositionEvent('compositionend')))
// 5. A typed line that can't be saved.
await line(0).click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(' unsaved')
await p.route('**/_serverFn/**', route => (route.request().method() === 'POST' ? route.abort() : route.fallback()))
await settle(2200); await staysOnLeave('a save that fails', 4000)
await p.unroute('**/_serverFn/**'); await blur(); await settle(4000)
// 6. A tick held 15 s, past the 10 s wait.
await holdTicks(15_000); await tickBox('Line 5').click(); await settle(2200)
await staysOnLeave('a tick still out after 10 s', 12_000)
await settle(4000); await p.unroute('**/_serverFn/**')
ok(await tickBox('Line 5').isChecked(), 'the held tick landed')
// 6b. An Undo notice showing (its time stops while hidden): that leave is skipped.
await settle(10_000); await tickBox('Line 7').click(); await settle(1000)
ok((await p.locator('.app-toasts [role="alertdialog"]').count()) > 0, 'the Undo notice is showing')
await staysOnLeave('an Undo notice showing')
// 6c. A tick out for 3 s when he leaves: the move waits for it, but its notice then holds the move to the next leave.
await settle(10_000)
await holdTicks(3000); await tickBox('Line 6').click(); await settle(2200)
await staysOnLeave('a tick that lands, with its notice, while away', 6000)
await p.unroute('**/_serverFn/**')
ok(await tickBox('Line 6').isChecked(), 'that tick landed')

// 7. A resting caret, nothing else: the next leave reloads while hidden. Shown again: build B's bundle, the same
//    scroll and caret, both ticks, no notice.
await settle(10_000)
ok((await p.locator('.app-toasts [role="alertdialog"]').count()) === 0, 'the notices have run out while he looked')
await line(20).click(); await p.keyboard.press('Meta+ArrowLeft'); for (let n = 0; n < 3; n++) await p.keyboard.press('ArrowRight')
await p.evaluate(() => window.scrollTo(0, 600)); await settle(2200)
let m = await mark(); const t0 = Date.now(); await leave()
const moved = await reloadedWithin(m, 10_000), waited = Date.now() - t0
ok(moved, `nothing in his hands, a resting caret: reloaded while hidden (${waited} ms)`)
await p.unroute('**/_serverFn/**').catch(() => {})
await p.waitForFunction(() => document.querySelector('.continuous-editor'), null, { timeout: 15000 }); await settle(2000)
ok(await p.evaluate(() => document.visibilityState) === 'hidden', 'it is still hidden after the reload')
await back(); await settle(1500)
ok(await loadedEntry() === entryOf(dirB), `shown: runs build B's bundle (${await loadedEntry()} vs ${entryOf(dirB)})`)
ok(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'still under the service worker')
ok(Math.abs(await p.evaluate(() => window.scrollY) - 600) < 3, `same scroll (${await p.evaluate(() => window.scrollY)})`)
await p.keyboard.type('X'); await settle(2500)
ok((await p.locator('.editor-task-title', { hasText: /^LinXe 20$/ }).count()) === 1, 'the caret is back in Line 20 at offset 3: typing lands there')
ok(await tickBox('Line 5').isChecked() && await tickBox('Line 6').isChecked() && await tickBox('Line 7').isChecked(), 'all three ticks are there')
ok((await p.locator('.editor-task-title').first().textContent()).includes('unsaved'), 'the line typed before is there')
ok(!((await p.locator('.app-toasts').count()) && (await p.locator('.app-toasts').textContent())), 'no notice')

// 8. Already on the server's build: returning and leaving does nothing.
await blur(); await settle(2200); await back(); await staysOnLeave('on the new build')

// 9. Loop guard: a tab still on A that already moved for B once stays as it is.
await serve(dirA); await p.reload(); await p.locator('.continuous-editor').first().waitFor(); await settle()
await serve(dirB); await back(); await blur(); await settle(2200)
await staysOnLeave('moved for B once already (an old page came back)')
ok(!p.errors.length, `no page errors ${JSON.stringify(p.errors)}`)

// 9b. Leaving by keyboard: the shortcut's own keydown doesn't hold the move (Lead 842f7f62). A fresh tab on B; the
//     server swaps between A and B, so each case is a new build and moves once.
const k = await device()
await k.goto(base + '/'); await k.locator('.continuous-editor').first().waitFor(); await k.evaluate(() => navigator.serviceWorker.ready); await settle(2200, k)
let on = 'B'
for (const keys of ['Meta', 'Control', 'Meta+t', 'Control+Tab']) {
  on = on === 'A' ? 'B' : 'A'; await serve(on === 'A' ? dirA : dirB)
  await back(k); await k.keyboard.press(keys)
  const km = await mark(k); await leave(k)
  ok(await reloadedWithin(km, 15_000, k), `${keys} just before leaving: moves`)
  await k.waitForFunction(() => document.querySelector('.continuous-editor'), null, { timeout: 15000 }); await back(k); await settle(1500, k)
  ok(await loadedEntry(k) === entryOf(on === 'A' ? dirA : dirB), `${keys}: runs build ${on}`)
}
ok(!k.errors.length, `keyboard leaves: no page errors ${JSON.stringify(k.errors)}`)

// 10. A touch screen: no caret is put back, so no keyboard comes up.
await serve(dirA)
const t = await device({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
await t.goto(base + '/'); await t.locator('.continuous-editor').first().waitFor(); await t.evaluate(() => navigator.serviceWorker.ready); await settle(2000, t)
await line(10, t).tap(); await settle(2200, t)
ok(await t.evaluate(() => Boolean(document.activeElement?.closest('.continuous-editor'))), 'phone: a caret in the editor before leaving')
await leave(t); await serve(dirB); await back(t)
m = await mark(t); await leave(t)
ok(await reloadedWithin(m, 15_000, t), 'phone: reloaded while hidden')
await t.waitForFunction(() => document.querySelector('.continuous-editor'), null, { timeout: 15000 }); await settle(2000, t)
await back(t); await settle(1500, t)
ok(await loadedEntry(t) === entryOf(dirB), `phone: runs build B (${await loadedEntry(t)})`)
ok(await t.evaluate(() => !document.activeElement?.closest('.continuous-editor')), 'phone: no caret put back, so no keyboard')
ok(!t.errors.length, `phone: no page errors ${JSON.stringify(t.errors)}`)
await b.close(); console.log(fail ? `${fail} FAIL` : 'all pass'); process.exit(fail ? 1 : 0)
