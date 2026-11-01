// An open tab moves onto a new build by itself (Lead 115ea14a), only when he comes back to it and nothing is in his
// hands (Jazz). Service worker ON (Lead): after the move, the tab's loaded bundle must be the server's new one.
// Usage: node move.mjs <worktree> <dirA> <dirB>   (dirA/dirB: `vite build` outputs with VITE_DAYTHREAD_BUILD=build-A / build-B)
import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [worktree, dirA, dirB] = process.argv.slice(2), port = 3660, base = `http://127.0.0.1:${port}`
const store = join(mkdtempSync(join(tmpdir(), 'rb-build-')), 'ws.sqlite')
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const entryOf = dir => readdirSync(join(dir, 'client/assets')).find(f => /^index-.*\.js$/.test(f))
let server
const serve = async dir => {
  if (server) { server.kill(); await new Promise(r => server.once('exit', r)) }
  rmSync(join(worktree, 'dist'), { recursive: true, force: true }); cpSync(dir, join(worktree, 'dist'), { recursive: true })
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: worktree, env: { ...process.env, DAYTHREAD_AUTH: 'off', DAYTHREAD_STORAGE: 'sqlite', DAYTHREAD_SQLITE_PATH: store }, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/sign-in')).status < 500) return } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)) }
  throw new Error('server did not start')
}

const b = await chromium.launch()
const c = await b.newContext({ serviceWorkers: 'allow', viewport: { width: 1280, height: 700 }, timezoneId: 'America/Vancouver' })
const p = await c.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message))
let infoCalls = 0; p.on('request', r => { if (r.url().includes('_serverFn') && Buffer.from(decodeURIComponent(r.url().split('_serverFn/')[1].split('?')[0]), 'base64url').toString().includes('getAppInfo')) infoCalls++ })
const hide = () => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
const show = () => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
const mark = () => p.evaluate(() => (window.__mark = Math.random()))
const sameDocument = async m => (await p.evaluate(() => window.__mark).catch(() => undefined)) === m
const loadedEntry = () => p.evaluate(() => [...document.querySelectorAll('script[src], link[href]')].map(e => e.src || e.href).concat(performance.getEntriesByType('resource').map(e => e.name)).map(u => u.match(/\/assets\/(index-[^/]+\.js)/)?.[1]).find(Boolean))
const settle = (ms = 2500) => p.waitForTimeout(ms)
const returnTo = async () => { await hide(); await show(); await settle() }

// ---- on build A, with the worker controlling the page
await serve(dirA)
await p.goto(base + '/'); await p.locator('.continuous-editor').first().waitFor({ timeout: 30000 })
await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.locator('.continuous-editor').first().waitFor()
ok(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'the service worker controls the page')
ok(await loadedEntry() === entryOf(dirA), `tab runs build A (${await loadedEntry()})`)
// A long page, so there is a scroll to keep.
await p.locator('.editor-task-title').first().click()
for (let i = 0; i < 40; i++) { await p.keyboard.type(`Line ${i}`); await p.keyboard.press('Enter') }
await settle(3000)
await p.locator('.day-title, h1').first().click().catch(() => {}); await p.evaluate(() => (document.activeElement)?.blur?.())
await p.evaluate(() => window.scrollTo(0, 600)); await settle(500)
const url = p.url()

// ---- the server moves to build B while the tab stays open
await hide()
await serve(dirB)
const before = infoCalls

// 1. Offline: no request, no move.
await c.setOffline(true); let m = await mark(); await show(); await settle()
ok(await sameDocument(m) && infoCalls === before, `offline: no check, no move (${infoCalls - before} checks)`)
await c.setOffline(false); await hide()

// 2. Caret in the editor: stays.
await p.locator('.editor-task-title').first().click(); m = await mark(); await returnTo()
ok(await sameDocument(m), 'a caret in the editor: stays')
await p.evaluate(() => (document.activeElement)?.blur?.()); await settle(1500)

// 3. A dialog open (search): stays.
await p.keyboard.press('Meta+k'); await p.locator('[role="dialog"]').first().waitFor({ timeout: 5000 })
await p.evaluate(() => (document.activeElement)?.blur?.()); m = await mark(); await returnTo()
ok(await sameDocument(m), 'a dialog open: stays')
await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await settle(800)

// 4. A typed line that can't be saved: stays.
await p.locator('.editor-task-title').first().click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(' unsaved')
await p.route('**/_serverFn/**', route => (route.request().method() === 'POST' ? route.abort() : route.fallback()))
await p.evaluate(() => (document.activeElement)?.blur?.()); m = await mark(); await returnTo()
ok(await sameDocument(m), 'a save that fails: stays')
await p.unroute('**/_serverFn/**'); await settle(4000) // the kept line saves once the server answers again
await p.evaluate(() => (document.activeElement)?.blur?.())
await p.evaluate(() => window.scrollTo(0, 600)); await settle(500)

// 5. Nothing in his hands: moves, onto build B's bundle, same page and scroll, no notice.
m = await mark(); await hide(); await show()
await p.waitForFunction(() => window.__mark === undefined, null, { timeout: 15000 }).catch(() => {})
await p.locator('.continuous-editor').first().waitFor()
await settle(3000)
ok(!(await sameDocument(m)), 'nothing in his hands: the tab reloaded')
ok(await loadedEntry() === entryOf(dirB), `after the move the tab runs build B's bundle (${await loadedEntry()} vs ${entryOf(dirB)})`)
ok(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'still under the service worker')
ok(p.url() === url, `same page (${p.url()})`)
ok(Math.abs(await p.evaluate(() => window.scrollY) - 600) < 3, `same scroll (${await p.evaluate(() => window.scrollY)})`)
ok(await p.evaluate(() => !document.activeElement?.closest('.continuous-editor')), 'no caret: it opens as he left it')
ok((await p.locator('.app-toasts').count()) === 0 || !(await p.locator('.app-toasts').textContent()), 'no notice')
ok((await p.locator('.editor-task-title').first().textContent()).includes('unsaved'), 'the line typed before is there')

// 6. Already on the server's build: another return does nothing.
m = await mark(); await returnTo()
ok(await sameDocument(m), 'on the new build: no further move')

// 7. Loop guard: a tab still on A that already moved for B once (an old page came back) stays as it is.
await serve(dirA); await p.reload(); await p.locator('.continuous-editor').first().waitFor(); await settle()
await serve(dirB)
await p.evaluate(() => sessionStorage.setItem('daythread.movedTo', 'build-B'))
m = await mark(); await returnTo()
ok(await sameDocument(m), 'moved for B once already: no second reload')

ok(!p.errors.length, `no page errors ${JSON.stringify(p.errors)}`)
server.kill(); await b.close(); console.log(fail ? `${fail} FAIL` : 'all pass'); process.exit(fail ? 1 : 0)
