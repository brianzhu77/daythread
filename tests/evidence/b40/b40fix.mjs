// B40 fixes (Roadbuster 6958aa41, Ratchet 6913ab0), after Ratchet's open-race.mjs and resume-taking.mjs:
//   node tests/evidence/b40/b40fix.mjs <port> <leave|newer>
// leave: a closed tab's draft for a page open here waits while he types there, then saves once he leaves the page.
// newer: the owner comes back while another tab is taking its draft and types more; the take then succeeds. The
//        owner's slot keeps its newer text (not claimed), and every line ends up saved once.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const [port, mode] = process.argv.slice(2), base = `http://127.0.0.1:${port}`
const b = await chromium.launch(), ctx = await b.newContext()
const saves = r => r.request().method() === 'POST' && (r.request().postData() || '').includes('save-editor')
const type = async (p, m) => { const t = p.getByText('PAC Lunch').first(); await t.scrollIntoViewIfNeeded(); await t.click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.press('Enter'); await p.keyboard.type(m) }
const server = async p => (await (await p.request.get(`${base}/day/2026-10-22`)).text())
const count = (s, m) => s.split(m).length - 1
const errors = []
try {
  if (mode === 'leave') {
    const a = await ctx.newPage(), other = await ctx.newPage()
    for (const p of [a, other]) { p.on('pageerror', e => errors.push(e.message)); await p.goto(`${base}/day/2026-10-22`, { waitUntil: 'networkidle' }) }
    await other.route('**/*', r => saves(r) ? r.abort('failed') : r.continue())
    await type(other, 'GONE_B'); await other.waitForTimeout(800); await other.close({ runBeforeUnload: true })
    await type(a, 'OPEN_A'); await a.waitForTimeout(500)
    await a.evaluate(() => window.dispatchEvent(new Event('online'))); await a.waitForTimeout(4000)
    await type(a, 'NEXT_KEY'); await a.waitForTimeout(2500)
    const status = await a.locator('.editor-save-line').innerText()
    const kept = await a.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:') && localStorage.getItem(k).includes('GONE_B')).length)
    console.log(JSON.stringify({ whileOpen: { status: status.split('\n')[0], goneSlotKept: kept } }))
    assert.ok(!/changed/i.test(status), 'no conflict while he types'); assert.equal(kept, 1, "the closed tab's draft waits")
    await a.getByRole('link', { name: 'Tasks' }).first().click(); await a.waitForTimeout(6000)
    await a.goto(`${base}/day/2026-10-22`, { waitUntil: 'networkidle' }); await a.waitForTimeout(1500)
    const page = await a.locator('.bn-editor').innerText(), left = await a.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:') && JSON.parse(localStorage.getItem(k)).document?.includes('GONE_B')).length)
    const toast = await a.getByText('Added unsaved text from another tab').count()
    console.log(JSON.stringify({ afterLeaving: { GONE_B: count(page, 'GONE_B'), OPEN_A: count(page, 'OPEN_A'), unclaimedSlots: left, notice: toast } }))
    assert.equal(count(page, 'GONE_B'), 1); assert.equal(count(page, 'OPEN_A'), 1); assert.equal(left, 0)
  } else {
    const owner = await ctx.newPage(), keeper = await ctx.newPage()
    for (const p of [owner, keeper]) p.on('pageerror', e => errors.push(e.message))
    await owner.goto(`${base}/day/2026-10-22`, { waitUntil: 'networkidle' })
    await owner.route('**/*', r => saves(r) ? r.abort('failed') : r.continue())
    await type(owner, 'FROZEN_OWNER'); await owner.waitForTimeout(700)
    const key = await owner.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('daythread:editor:') && localStorage.getItem(k).includes('FROZEN_OWNER')))
    let release, started; const held = new Promise(r => { release = r }), start = new Promise(r => { started = r })
    await keeper.route('**/*', async r => { if (saves(r)) { started(); await held; return r.continue() } return r.continue() })
    await keeper.goto(`${base}/tasks`, { waitUntil: 'networkidle' })
    await owner.evaluate(k => { const d = JSON.parse(localStorage.getItem(k)); d.seen = 0; localStorage.setItem(k, JSON.stringify(d)) }, key)
    await keeper.evaluate(() => window.dispatchEvent(new Event('online'))); await start
    await owner.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
    await owner.keyboard.type(' MORE_AFTER'); await owner.waitForTimeout(1200)
    release(); await keeper.waitForTimeout(2500)
    const slot = await owner.evaluate(k => JSON.parse(localStorage.getItem(k)), key)
    console.log(JSON.stringify({ ownerSlot: { claimed: Boolean(slot?.claimedBy), taking: Boolean(slot?.taking), hasNewer: Boolean(slot?.document?.includes('MORE_AFTER')) } }))
    assert.ok(slot && !slot.claimedBy && slot.document.includes('MORE_AFTER'), 'owner keeps its newer text, unclaimed')
    await owner.unroute('**/*'); await owner.evaluate(() => window.dispatchEvent(new Event('online'))); await owner.keyboard.type('!'); await owner.waitForTimeout(4000)
    const status = (await owner.locator('.editor-save-line').innerText()).split('\n')
    console.log(JSON.stringify({ ownerStatus: status }))
    if (/changed/i.test(status[0])) { await owner.getByRole('button', { name: 'Load latest' }).click(); await owner.waitForTimeout(3000); console.log(JSON.stringify({ afterLoadLatest: (await owner.locator('.editor-save-line').innerText()).split('\n')[0] })) }
    await owner.reload({ waitUntil: 'networkidle' }); await owner.waitForTimeout(1500)
    const page = await owner.locator('.bn-editor').innerText()
    console.log(JSON.stringify({ saved: { FROZEN_OWNER: count(page, 'FROZEN_OWNER'), MORE_AFTER: count(page, 'MORE_AFTER') } }))
    assert.equal(count(page, 'FROZEN_OWNER'), 1); assert.equal(count(page, 'MORE_AFTER'), 1)
  }
  console.log('errors:', errors.length ? errors.join(' | ') : 'none')
} finally { await b.close() }
