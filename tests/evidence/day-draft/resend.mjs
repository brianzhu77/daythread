// A save refused only because the workspace moved on goes again once, silently (Lead b5e55c49); a real change to
// the same page still shows. Two browser contexts on one blank store stand in for two devices.
// Usage: node resend.mjs <base>   (a blank store, sign-in off)
import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await chromium.launch()
const device = async () => { const c = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, timezoneId: 'America/Vancouver' }); const p = await c.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message)); return p }
const open = async (p, path = '/') => { await p.goto(base + path); await p.locator('.continuous-editor').first().waitFor({ timeout: 30000 }); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800) }
const saveLine = p => p.locator('.editor-save-line').textContent()
const settle = async p => { for (let i = 0; i < 40; i++) { const t = await saveLine(p); if (t === 'Saved' || /Couldn't|elsewhere|changed/i.test(t ?? '')) return t; await p.waitForTimeout(250) } return saveLine(p) }
const typeIn = async (p, words) => { await p.locator('.editor-task-title').filter({ hasText: /^$/ }).first().click(); await p.keyboard.type(words, { delay: 15 }) }

const a = await device(), other = await device()
await open(a)
// 1. Another device makes a day page after A loaded (as at his midnight, 07:00Z): A's revision is behind.
await open(other, '/day/2026-10-20')
await typeIn(a, 'After the other device made a day')
ok(await settle(a) === 'Saved', `new day elsewhere: A's save goes through (${await saveLine(a)})`)
// 2. Another device changes a different page again, then A types more.
await open(other, '/day/2026-10-21')
await a.keyboard.type(' and more', { delay: 15 })
ok(await settle(a) === 'Saved', `another page changed: A's next save goes through (${await saveLine(a)})`)
await a.reload(); await a.locator('.editor-task-title').first().waitFor()
ok((await a.locator('.editor-task-title').first().textContent()).includes('After the other device made a day and more'), 'after a reload A\'s words are there')
// 3. A real change to the same page on the other device still shows on A: both add to the same to-do line.
const appendTo = async (p, words) => { await p.locator('.editor-task-title').first().click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(words, { delay: 15 }) }
await open(other, '/')
await appendTo(other, ' (other device)'); ok(await settle(other) === 'Saved', 'other device saved its change to Today')
await appendTo(a, ' (A meanwhile)')
const t = await settle(a)
ok(t !== 'Saved', `same page changed elsewhere: A is told, not overwritten (${t})`)
ok(!a.errors.length && !other.errors.length, `no page errors ${JSON.stringify([...a.errors, ...other.errors])}`)
await b.close(); console.log(fail ? `${fail} FAIL` : 'all pass'); process.exit(fail ? 1 : 0)
