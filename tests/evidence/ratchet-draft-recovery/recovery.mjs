// Nov 1 07:00Z: a tab made today's page but its draft ask never reached the server, and the tab stayed on nothing until
// reloaded (Bumblebee 29638b51, Lead b01f4205, Jazz d584f532). Each scenario runs on a fresh copy of one seeded store:
// one open to-do written on Oct 31, so Nov 1's stored draft shows "1 more open".
// Usage: node ask-again.mjs <base> seed                 (on a blank store: writes the Oct 31 to-do)
//        node ask-again.mjs <base> <scenario>           (on a copy of that store)
// Scenarios: thrown, thrown-twice, set-draft, lost, midnight, ready
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
import {readFileSync,readdirSync} from 'node:fs'
const functionSource = readdirSync('dist/server/assets').filter(n=>n.startsWith('functions-')).map(n=>readFileSync('dist/server/assets/'+n,'utf8')).join('\n')
const prepareId = functionSource.match(/prepareDayDraft_createServerFn_handler = createServerRpc\(\{\s*id: "([^"]+)/)?.[1]
const [base, scenario] = process.argv.slice(2)
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', `[${scenario}]`, s); if (!v) fail++ }
const b = await (process.argv[4] === 'webkit' ? webkit : chromium).launch()
const c = await b.newContext({ serviceWorkers: 'block', viewport: { width: process.argv[4] === 'webkit' ? 390 : 1280, height: 900 }, timezoneId: 'America/Vancouver' })
const p = await c.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message))
const fnName = url => { if(prepareId && url.includes('/_serverFn/'+prepareId))return 'prepareDayDraft'; try { return JSON.parse(Buffer.from(decodeURIComponent(url.split('_serverFn/')[1].split('?')[0]), 'base64url').toString()).export.split('_')[0] } catch { return '' } }
let asks = 0, setDrafts = 0
p.on('request', r => { if (fnName(r.url()) === 'prepareDayDraft') asks++; if ((r.postData() ?? '').includes('set-draft')) setDrafts++ })
/** Fails the next n asks (or set-draft sends); `hang` holds them with no reply instead. */
const failNext = async (what, n, how = 'abort') => {
  let left = n
  await p.route('**/_serverFn/**', async route => {
    const r = route.request(), hit = what === 'ask' ? fnName(r.url()) === 'prepareDayDraft' : (r.postData() ?? '').includes('set-draft')
    if (hit && left > 0) { left--; if (how === 'hang') return; return route.abort() }
    return route.fallback()
  })
}
const line = async () => ((await p.locator('.draft-line').first().textContent({ timeout: 500 }).catch(() => '')) ?? '').trim()
const settle = async () => { await p.waitForTimeout(2500) }
const hide = () => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
const show = () => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
const open = async () => { await p.goto(base + '/'); await p.locator('.continuous-editor').first().waitFor({ timeout: 30000 }); await settle() }
// Without a model key the server stores a fallback draft marked failed; "N more open" (the Oct 31 to-do) shows it is
// stored, which a failure in the tab never is.
const hasBand = async () => (await p.locator('.draft-more-toggle').count()) > 0

if (scenario === 'seed') {
  await p.clock.install({ time: new Date('2026-11-01T05:00:00Z') }) // Oct 31, 22:00 in Vancouver
  await open()
  await p.locator('.editor-task-title').filter({ hasText: /^$/ }).first().click(); await p.keyboard.type('Buy a dog bed', { delay: 15 })
  await p.waitForTimeout(3000)
  ok((await p.locator('.editor-save-line').textContent()) === 'Saved', 'Oct 31 to-do saved')
} else if (scenario === 'midnight') {
  // Open on Oct 31, idle; hidden before midnight; the new day's ask is lost (aborted, as from a frozen tab); then shown.
  await p.clock.install({ time: new Date('2026-11-01T06:45:00Z') })
  await open()
  const before = asks
  await failNext('ask', 1)
  await hide()
  await p.clock.runFor(17 * 60_000); await settle()
  ok(asks === before + 1, `hidden at midnight: the new page asked once (${asks - before})`)
  ok(!(await hasBand()), `nothing stored yet (${await line()})`)
  await show(); await settle()
  ok(asks === before + 2, `shown again: one more ask (${asks - before})`)
  ok(await hasBand(), `then the band (${await line()})`)
} else {
  await p.clock.install({ time: new Date('2026-11-01T15:00:00Z') }) // Nov 1, 08:00
  if (scenario === 'thrown') {
    await failNext('ask', 1)
    await open()
    ok(asks === 1 && /Couldn.t draft.*Retry/.test(await line()), `a thrown ask shows Retry, not nothing (${await line()})`)
    await hide(); await show(); await settle()
    ok(asks === 2 && await hasBand(), `back on the page: asks again by itself and the band comes (${asks}, ${await line()})`)
  } else if (scenario === 'thrown-twice') {
    await failNext('ask', 2)
    await open()
    await hide(); await show(); await settle()
    ok(asks === 2 && /Couldn.t draft.*Retry/.test(await line()), `second ask failed too: Retry stays (${asks}, ${await line()})`)
    await hide(); await show(); await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await settle()
    ok(asks === 2, `no third ask by itself (${asks})`)
    await p.locator('.draft-line button', { hasText: 'Retry' }).click(); await settle()
    ok(asks === 3 && await hasBand(), `Retry asks and the band comes (${asks}, ${await line()})`)
  } else if (scenario === 'set-draft') {
    await failNext('set', 2)
    await open()
    ok(asks === 1 && setDrafts === 2 && /Couldn.t draft.*Retry/.test(await line()), `set-draft failed twice: Retry (${asks}/${setDrafts}, ${await line()})`)
    await hide(); await show(); await settle()
    ok(asks === 2 && await hasBand(), `back on the page: asks again and the band comes (${asks}, ${await line()})`)
  } else if (scenario === 'lost') {
    await failNext('ask', 1, 'hang')
    await open()
    ok(/Preparing/.test(await line()), `a hanging ask shows Preparing (${await line()})`)
    await hide(); await show(); await settle()
    ok(asks === 1, `within a minute it is still in flight: no second ask (${asks})`)
    await p.clock.runFor(61_000)
    console.log('OBSERVED after 61 seconds without focus:', await line())
    await hide(); await show(); await settle()
    ok(asks === 2 && await hasBand(), `after a minute it is taken as lost: one more ask, then the band (${asks}, ${await line()})`)
  } else if (scenario === 'ready') {
    await open()
    ok(asks === 1 && await hasBand(), `first open asks once (${asks}, ${await line()})`)
    for (let i = 0; i < 3; i++) { await hide(); await show(); await p.evaluate(() => window.dispatchEvent(new Event('focus'))) }
    await settle()
    await open()
    ok(asks === 1, `a stored draft never asks again: focus, visibility and a reload (${asks})`)
  }
}
ok(!p.errors.length, `no page errors ${JSON.stringify(p.errors)}`)
await b.close(); process.exit(fail ? 1 : 0)
