// B27 picker (plan §3, Jazz b27-at-date-states §1–§2): `@` opens a list that reads the date; Return makes a chip,
// Esc leaves the text; emails, handles and prices never open it; the chip becomes a row on its day. Built server on a
// fresh store made by seed.ts (it types and saves):
//   node tests/evidence/b27/picker-check.mjs <base> [webkit|chromium] [1280|390]
import * as pw from '@playwright/test'
const [base, engine = 'webkit', width = '1280'] = process.argv.slice(2)
if (!base || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${engine} ${width}: ${what}${detail ? ` (${detail})` : ''}`) }
const browser = await pw[engine].launch()
const phone = width === '390'
const p = await browser.newPage({ viewport: { width: Number(width), height: phone ? 844 : 900 }, hasTouch: phone })
const errors = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) }); p.on('console', m => { if (m.type() === 'error' && !/interactive-widget|ResizeObserver loop/.test(m.text())) errors.push(m.text()) })
await p.goto(`${base}/day/${today}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const later = p.getByRole('button', { name: 'Later', exact: true }); if (await later.count()) await later.click()

const menu = () => p.evaluate(() => [...document.querySelectorAll('.date-menu [role="option"], .date-menu .date-menu-hint')].map(e => e.textContent?.trim()))
/** The line that starts with `start`: its text and its chips. */
const lineState = start => p.evaluate(start => {
  const el = [...document.querySelectorAll('.bn-editor .bn-inline-content')].find(e => e.textContent?.startsWith(start))
  return { text: el?.textContent, chips: [...(el?.querySelectorAll('.date-ref') ?? [])].map(c => c.textContent) }
}, start)
/** A fresh line: the first time, Good Stuffs' empty bullet; after that, Return at the end of what was just typed. */
let started = false
async function freshLine() {
  if (started) { await p.keyboard.press('Enter'); await p.waitForTimeout(100); return }
  started = true
  const empty = p.locator(`.bn-block-outer[data-id="day:${today}:good-stuffs:template:0"] .bn-inline-content`)
  if (phone) await empty.tap(); else await empty.click()
  await p.waitForTimeout(150)
}

// Return makes the chip; the rest of the line keeps typing after it.
await freshLine()
await p.keyboard.type('PAC Lunch @'); await p.waitForTimeout(250)
const empty = await menu()
log(empty.length === 4 && /Today/.test(empty[0]) && /Tomorrow/.test(empty[1]), 'just typed @: Today, Tomorrow and two more days', JSON.stringify(empty))
await p.keyboard.type('nov 20 12pm'); await p.waitForTimeout(250)
const reading = await menu()
log(reading.length === 1 && /Nov 20/.test(reading[0]) && /12:00 PM/.test(reading[0]), 'typed query: one reading with its time', JSON.stringify(reading))
await p.keyboard.press('Enter'); await p.waitForTimeout(150)
await p.keyboard.type('at school')
let s = await lineState('PAC Lunch')
log(s.chips.length === 1 && /Nov 20 · 12 PM/.test(s.chips[0]) && /PAC Lunch\s*.*at school/.test(s.text), 'Return made the chip and typing goes on after it', JSON.stringify(s))

// ⌘Z right after choosing, at typing speed, gives back exactly what was typed (Ratchet 6dfe2029, Bumblebee).
await freshLine()
await p.keyboard.type('undo check @Nov 20'); await p.keyboard.press('Enter'); await p.waitForTimeout(150)
const made = await lineState('undo check')
await p.keyboard.press('Meta+z'); await p.waitForTimeout(500)
const undone = await lineState('undo check')
log(made.chips.length === 1 && undone.text === 'undo check @Nov 20' && !undone.chips.length, '⌘Z right after a fast Return gives back the typed line', JSON.stringify({ made, undone }))

// Esc leaves the text.
await freshLine()
await p.keyboard.type('Dentist @fri'); await p.waitForTimeout(200)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
s = await lineState('Dentist')
log(s.chips.length === 0 && s.text === 'Dentist @fri' && !(await menu()).length, 'Esc: list closed, text as typed', JSON.stringify(s))

// Emails, handles and prices.
await freshLine()
await p.keyboard.type('mail brian@gmail.com'); await p.waitForTimeout(200)
log(!(await menu()).length, 'an email never opens the list')
await p.keyboard.type(' and @brian'); await p.waitForTimeout(250)
log(!(await menu()).length, '@brian: the list closed on its own')
await p.keyboard.type(' costs $5@3'); await p.waitForTimeout(200)
log(!(await menu()).length && (await lineState('mail brian')).chips.length === 0, 'a price never opens the list')

// The list never gets in the way of ordinary text (Bumblebee 37b2c238, Lead e775b188): it closes on the first
// character that can't lead to a date, and Return on "Keep typing a date" is an ordinary Return.
await freshLine()
await p.keyboard.type('Meet @ the cafe'); await p.waitForTimeout(250)
log(!(await menu()).length && (await lineState('Meet')).text === 'Meet @ the cafe', '`@ ` closes the list; text as typed')
await freshLine()
await p.keyboard.type('Back @home soon'); await p.waitForTimeout(250)
log(!(await menu()).length && (await lineState('Back')).text === 'Back @home soon', '`@home` closes the list; text as typed')
await freshLine()
await p.keyboard.type('Budget @Nov '); await p.waitForTimeout(250)
const waiting = await menu()
log(waiting.length === 1 && /Keep typing a date/.test(waiting[0]), '`@Nov ` waits for the day: Keep typing a date', JSON.stringify(waiting))
const linesBefore = await p.locator('.bn-editor .bn-block-outer').count()
await p.keyboard.press('Enter'); await p.waitForTimeout(400)
await p.keyboard.type('next line')
const after = await p.evaluate(() => [...document.querySelectorAll('.bn-editor .bn-inline-content')].map(e => e.textContent))
log(after.includes('Budget @Nov ') && after.includes('next line') && (await p.locator('.bn-editor .bn-block-outer').count()) === linesBefore + 1 && !(await menu()).length, 'Return on Keep typing makes a new line; the text stays', JSON.stringify(after.filter(t => /Budget|next line/.test(t))))

// Full-width ＠ and Chinese forms.
await freshLine()
await p.keyboard.type('开会'); await p.keyboard.insertText('＠'); await p.waitForTimeout(250)
log((await menu()).length === 4, '＠ after Chinese text opens the list')
await p.keyboard.insertText('明天'); await p.waitForTimeout(250)
const zh = await menu()
log(zh.length === 1 && /All day/.test(zh[0]), '＠明天 reads as tomorrow, all day', JSON.stringify(zh))
await p.keyboard.press('Enter'); await p.waitForTimeout(150)
s = await lineState('开会')
log(s.chips.length === 1 && /Tomorrow/.test(s.chips[0]), 'the chip says Tomorrow', JSON.stringify(s))

// A to-do row takes a chip too.
const todoRow = p.locator('.bn-editor [data-content-type="task"] .bn-inline-content').filter({ hasText: /^$/ }).first()
await todoRow.click(); await p.keyboard.type('Call plumber @'); await p.waitForTimeout(250)
await p.keyboard.type('3pm'); await p.waitForTimeout(250)
await p.keyboard.press('Enter'); await p.waitForTimeout(150)
const todo = await p.evaluate(() => { const row = [...document.querySelectorAll('.bn-block-outer')].find(b => b.querySelector('[data-content-type="task"]') && b.textContent.includes('Call plumber')); return row ? [...row.querySelectorAll('.date-ref')].map(c => c.textContent) : null })
log(todo?.length === 1 && /Today · 3 PM/.test(todo[0]), 'a to-do row holds a chip (a time alone is the page\'s day)', JSON.stringify(todo))

// Copying a chip-bearing line's text makes a second event; cutting and pasting it back keeps the one (Ratchet 26291155).
const ids = () => p.evaluate(() => [...document.querySelectorAll('.bn-editor [data-inline-content-type="dateMention"]')].map(e => e.getAttribute('data-event-id')))
const pacId = (await p.evaluate(() => [...document.querySelectorAll('.bn-editor .bn-inline-content')].find(e => e.textContent.startsWith('PAC Lunch'))?.querySelector('[data-event-id]')?.getAttribute('data-event-id')))
const pac = p.locator('.bn-editor .bn-inline-content', { hasText: /^PAC Lunch/ })
if (phone) await pac.tap({ position: { x: 4, y: 6 } }); else await pac.click({ position: { x: 4, y: 6 } })
await p.keyboard.press('Meta+ArrowLeft'); await p.keyboard.press('Meta+Shift+ArrowRight')
await p.keyboard.press('Meta+C'); await p.waitForTimeout(150)
const target = p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`)
// Centred first, so a fixed toolbar at the bottom of a phone screen can't take the tap.
await target.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(150)
if (phone) await target.tap(); else await target.click()
await p.waitForTimeout(150); await p.keyboard.press('Meta+V'); await p.waitForTimeout(300)
let all = await ids()
log(all.filter(x => x === pacId).length === 1 && all.length >= 2, 'a pasted copy of the line gets its own event id', JSON.stringify({ pacId, all }))
// Cut the pasted copy's chip line and paste it back: same id.
const copyId = all.find(x => x !== pacId && !x.startsWith('7351'))
await p.keyboard.press('Meta+ArrowLeft'); await p.keyboard.press('Meta+Shift+ArrowRight'); await p.keyboard.press('Meta+X'); await p.waitForTimeout(150)
await p.keyboard.press('Meta+V'); await p.waitForTimeout(300)
all = await ids()
log(all.includes(copyId), 'cut and paste back keeps its id', JSON.stringify({ copyId, all }))

// Saved, the chips are rows on their days: today shows "Call plumber" under Events.
await p.waitForTimeout(2000)
const rows = await p.evaluate(() => [...document.querySelectorAll('.day-event-title')].map(e => e.textContent))
log(rows.includes('Call plumber'), 'after the save, today\'s Events shows the to-do\'s event', JSON.stringify(rows))
await p.goto(`${base}/day/2026-11-20`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
const future = await p.evaluate(() => document.body.textContent)
log(/PAC Lunch at school/.test(future) && /Create page/.test(future), 'Nov 20 (no page yet) lists the event and still offers Create page')
log(!errors.length, 'no page errors', errors.join(' | '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
