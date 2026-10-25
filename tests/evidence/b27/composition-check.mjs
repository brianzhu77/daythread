// B27: `＠` then a pinyin composition (Chromium's IME events through CDP). The list must survive the pinyin and read
// 明天 once it's committed; Return makes the chip. Built server, fresh store from seed.ts:
//   node tests/evidence/b27/composition-check.mjs <base>
import * as pw from '@playwright/test'
const [base] = process.argv.slice(2)
if (!base || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} chromium: ${what}${detail ? ` (${detail})` : ''}`) }
const browser = await pw.chromium.launch(), p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
const cdp = await p.context().newCDPSession(p)
await p.goto(`${base}/day/${today}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const later = p.getByRole('button', { name: 'Later', exact: true }); if (await later.count()) await later.tap()
await p.locator(`.bn-block-outer[data-id="day:${today}:good-stuffs:template:0"] .bn-inline-content`).tap(); await p.waitForTimeout(200)
const menu = () => p.evaluate(() => [...document.querySelectorAll('.date-menu [role="option"], .date-menu .date-menu-hint')].map(e => e.textContent?.trim()))
await cdp.send('Input.insertText', { text: '开会' })
await cdp.send('Input.insertText', { text: '＠' }); await p.waitForTimeout(250)
log((await menu()).length === 4, '＠ opens the list')
for (const step of ['m', 'mi', 'min', 'ming', "ming't", "ming'ti", "ming'tia", "ming'tian"]) { await cdp.send('Input.imeSetComposition', { text: step, selectionStart: step.length, selectionEnd: step.length }); await p.waitForTimeout(60) }
await p.waitForTimeout(200)
log((await menu()).length >= 1, 'the list stays open through the pinyin', JSON.stringify(await menu()))
await cdp.send('Input.insertText', { text: '明天' }); await p.waitForTimeout(400)
const read = await menu()
log(read.length === 1 && /All day/.test(read[0]), 'after the commit, 明天 reads as tomorrow', JSON.stringify(read))
await p.keyboard.press('Enter'); await p.waitForTimeout(200)
const chips = await p.evaluate(() => [...document.querySelectorAll('.bn-editor .date-ref')].map(c => c.textContent))
log(chips.includes('Tomorrow'), 'Return made the chip', JSON.stringify(chips))
// ＠ and a committed word that isn't a date: the list closes, the text stays (Bumblebee 37b2c238).
await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.waitForTimeout(100)
await cdp.send('Input.insertText', { text: '找' }); await cdp.send('Input.insertText', { text: '＠' }); await p.waitForTimeout(250)
for (const step of ['l', 'la', 'lao', "lao'w", "lao'wang"]) { await cdp.send('Input.imeSetComposition', { text: step, selectionStart: step.length, selectionEnd: step.length }); await p.waitForTimeout(60) }
await cdp.send('Input.insertText', { text: '老王' }); await p.waitForTimeout(400)
const text = await p.evaluate(() => [...document.querySelectorAll('.bn-editor .bn-inline-content')].map(e => e.textContent).find(t => t?.startsWith('找')))
log(!(await menu()).length && text === '找＠老王', '＠老王: the list closed and the text is as typed', JSON.stringify(text))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
