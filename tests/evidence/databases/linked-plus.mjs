// A linked view's new property keeps its Undo (R4-18): by the head's +, and by the menu. One Undo takes the property out of the source and the column out of the view.
// Usage: node tests/evidence/databases/linked-plus.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server uses, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/databases/linked-plus.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const data = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const props = () => data().pages.find(p => p.id === 'home-db').database.properties.map(p => p.name)
const open = async page => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/opening/seed.ts ${S}`, { stdio: 'ignore' })
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }), p = await c.newPage(), errors = []
  p.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
  await p.goto(`${base}/pages?page=${page}`); await p.waitForTimeout(2200)
  return { c, p, errors, wait: ms => p.waitForTimeout(ms) }
}
const heads = p => p.locator('.database-th').allInnerTexts().then(t => t.map(x => x.trim()).filter(x => x && x !== '+'))
const notices = p => p.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const undo = p => p.getByRole('button', { name: 'Undo' })

{ const { c, p, errors, wait } = await open('linked')
  await p.locator('.database-th.is-add button').first().click(); await wait(1500)
  check((await heads(p)).includes('Property') && props().includes('Property'), "the linked view's +: a new column, in the source too", [await heads(p), props()])
  check(await undo(p).count() === 1 && /Added Property/.test(await notices(p)), 'and its notice still has Undo once everything has saved', await notices(p))
  await undo(p).first().click(); await wait(1500)
  check(!props().includes('Property') && !(await heads(p)).includes('Property'), 'one Undo takes it out of the source and the view', [await heads(p), props()])
  await p.reload(); await wait(2200)
  check(!(await heads(p)).includes('Property') && errors.length === 0, 'and it stays out after a reload, with no page errors', [await heads(p), errors])
  await p.locator('.database-th.is-add button').first().click(); await wait(1500)
  check((await heads(p)).includes('Property') && await undo(p).count() === 1, 'the + works again after that', await heads(p))
  await p.reload(); await wait(2200)
  check((await heads(p)).includes('Property') && props().includes('Property'), 'and a property left in stays, after a reload', [await heads(p), props()])
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// Typing straight after doesn't lose either, though that later save takes the Undo, as any later change does.
{ const { c, p, errors, wait } = await open('linked')
  await p.locator('.bn-inline-content', { hasText: 'The line above' }).click(); await p.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End')
  await p.locator('.database-th.is-add button').first().click(); await p.locator('.bn-inline-content', { hasText: 'The line above' }).click(); await p.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End'); await p.keyboard.type(' typed'); await wait(2500)
  check((await heads(p)).includes('Property') && props().includes('Property') && JSON.stringify(data().pages.find(x => x.id === 'linked').document).includes('The line above typed'), 'typing straight after the +: both are kept', [await heads(p), props()])
  await p.reload(); await wait(2200)
  check((await heads(p)).includes('Property'), 'and the column is there after a reload', await heads(p))
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// Another save of the page already on its way (Ratchet): the property still waits for the column, and keeps its Undo.
{ const { c, p, errors, wait } = await open('linked')
  const order = [], held = []
  await p.route('**/*', async route => { const q = route.request(); if (q.method() === 'POST' && /save-editor|change-database/.test(q.postData() ?? '')) { const kind = /save-editor/.test(q.postData()) ? 'save-editor' : 'addProperty'; order.push(kind); if (held.length === 0) { held.push(1); await new Promise(r => setTimeout(r, 1500)) } } await route.continue() })
  await p.locator('.bn-inline-content', { hasText: 'The line above' }).click(); await p.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End'); await p.keyboard.type(' more'); await wait(900)
  await p.locator('.database-th.is-add button').first().click(); await wait(3200)
  check(order.at(-1) === 'addProperty', 'the property goes last, after the save on its way and the column', order)
  check((await heads(p)).includes('Property') && await undo(p).count() === 1, 'and keeps its Undo', [await heads(p), await notices(p)])
  await undo(p).first().click(); await wait(1500)
  check(!props().includes('Property'), 'one Undo takes it out', props())
  check(JSON.stringify(data().pages.find(x => x.id === 'linked').document).includes('The line above more'), 'and the words typed before it stay')
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// Left before the column saved (Ratchet): the property nobody's seen isn't made, and a later change keeps its own Undo.
{ const { c, p, errors, wait } = await open('linked')
  const order = [], held = []
  await p.route('**/*', async route => { const q = route.request(); if (q.method() === 'POST' && /save-editor|change-database/.test(q.postData() ?? '')) { order.push(/save-editor/.test(q.postData()) ? 'save-editor' : 'addProperty'); if (held.length === 0) { held.push(1); await new Promise(r => setTimeout(r, 1500)) } } await route.continue() })
  await p.locator('.bn-inline-content', { hasText: 'The line above' }).click(); await p.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End'); await p.keyboard.type(' more'); await wait(900)
  await p.locator('.database-th.is-add button').first().click(); await wait(100)
  await p.locator('.sidebar a, .sidebar button', { hasText: /^elsewhere$/ }).first().click(); await wait(3500)
  check(!order.includes('addProperty') && !props().includes('Property'), 'leaving while it waits: the property is not made', [order, props()])
  check(JSON.stringify(data().pages.find(x => x.id === 'linked').document).includes('The line above more'), 'and the words typed before it stay')
  await p.locator('.sidebar a, .sidebar button', { hasText: /^linked$/ }).first().click(); await wait(2200)
  check(!(await heads(p)).includes('Property'), 'and going back shows no column', await heads(p))
  await p.locator('.database-th.is-add button').first().click(); await wait(1500)
  check((await heads(p)).includes('Property') && await undo(p).count() === 1, 'the + still works, with Undo', await heads(p))
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// A page that can't save (Ratchet): the property waits for the column, as a later save would take its Undo, and goes when the page saves again.
{ const { c, p, errors, wait } = await open('linked')
  const block = route => { const q = route.request(); return q.method() === 'POST' && /save-editor/.test(q.postData() ?? '') ? route.abort() : route.continue() }
  await p.route('**/*', block)
  await p.locator('.database-th.is-add button').first().click(); await wait(3000)
  check(!props().includes('Property'), "with the page's saves failing, the property waits", props())
  check(/not saved|trying again|couldn|offline|draft/i.test(await p.locator('.editor-save-line').innerText().catch(() => '')), 'and the page says its save failed', await p.locator('.editor-save-line').innerText().catch(() => ''))
  await p.unroute('**/*', block)
  for (let i = 0; i < 80 && !props().includes('Property'); i++) await wait(500)
  await wait(800)
  check(props().includes('Property') && (await heads(p)).includes('Property'), 'when the page saves again, the column and the property arrive', [props(), await heads(p)])
  check(await undo(p).count() === 1, 'with Undo', await notices(p))
  await undo(p).first().click(); await wait(1500)
  check(!props().includes('Property'), 'one Undo takes it out', props())
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// The menu's New property.
{ const { c, p, errors, wait } = await open('linked')
  const menu = p.locator('.database-menu')
  await p.locator('.database-more-button').first().click(); await wait(250); await menu.getByRole('menuitem', { name: 'Properties' }).click(); await wait(250)
  await menu.getByRole('menuitem', { name: '+ Add property' }).click(); await wait(250)
  await menu.getByLabel('Property name').fill('Mood'); await p.keyboard.press('Enter'); await wait(1500)
  check((await heads(p)).includes('Mood') && props().includes('Mood'), 'the menu: a new column, in the source too', [await heads(p), props()])
  check(await menu.locator('input[aria-label], input').count() > 0, 'and its panel opens on the new property')
  check(await undo(p).count() === 1, 'with Undo still there', await notices(p))
  await p.keyboard.press('Escape'); await wait(250); await undo(p).first().click(); await wait(1500)
  check(!props().includes('Mood') && !(await heads(p)).includes('Mood'), 'one Undo takes it out', [await heads(p), props()])
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// A home block is as before.
{ const { c, p, errors, wait } = await open('home')
  await p.locator('.database-th.is-add button').first().click(); await wait(1500)
  check(await undo(p).count() === 1 && (await heads(p)).includes('Property'), "a home block's + is as before")
  await undo(p).first().click(); await wait(1500)
  check(!props().includes('Property'), 'with one Undo')
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
