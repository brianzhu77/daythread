// Two tabs on one copy of Brian's data (Lead c02857fc): coming back to a tab shows edits made elsewhere, and never
// drops what was typed there. Also Bumblebee's question: can a stale tab's save overwrite a newer edit?
//   node two-tabs.mjs <base url> <db copy> <playwright index.mjs>
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { webkit: chromium } = await import(pw)
const DAY = '2026-10-18'
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const stored = (day = DAY) => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare("SELECT editorJSON FROM pages WHERE snapshot='current' AND type='daily' AND date=?").get(day).editorJSON } finally { d.close() } }
const browser = await chromium.launch(), errors = []
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const tab = async (day = DAY) => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(`${base}/day/${day}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000); return p }
const A = await tab(), B = await tab()
const lastLine = p => p.locator('.continuous-editor .bn-block-content[data-content-type=bulletListItem] .bn-inline-content').filter({ hasText: /\S/ }).last()
const typeAtEnd = async (p, text) => { await lastLine(p).click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(text) }
const editorText = p => p.locator('.continuous-editor').innerText()
const comeBack = async p => { await p.bringToFront(); await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(1500) }
const away = p => p.waitForTimeout(5200) // the refresh runs at most once every 5s

// 1. A edits and saves; B comes back and shows it.
await A.bringToFront(); await typeAtEnd(A, ' [A1]'); await A.waitForTimeout(1500)
log(stored().includes('[A1]'), '1. A saved its edit')
log(!(await editorText(B)).includes('[A1]'), '1. B still shows the old page before coming back')
// Jazz 92f9eb25: the refresh never moves the caret or the scroll. The caret sits in the first written line, not the
// one A edited, and the page is scrolled.
const firstLine = B.locator('.continuous-editor .bn-block-content[data-content-type=bulletListItem] .bn-inline-content').filter({ hasText: /\S/ }).first()
await B.bringToFront(); await firstLine.click(); await B.keyboard.press('Meta+ArrowLeft'); await B.keyboard.press('ArrowRight'); await B.keyboard.press('ArrowRight')
await B.mouse.wheel(0, 120); await B.waitForTimeout(300)
const where = p => p.evaluate(() => { const s = getSelection(); const block = s.anchorNode?.parentElement?.closest('[data-id]'); return { block: block?.getAttribute('data-id'), offset: s.anchorOffset, scrollY: Math.round(document.scrollingElement.scrollTop + (document.querySelector('main')?.scrollTop ?? 0)) } })
const before1 = await where(B)
await away(B); await comeBack(B)
const after1 = await where(B)
log((await editorText(B)).includes('[A1]'), '1. B shows A\'s edit after coming back')
log(before1.block && before1.block === after1.block && before1.offset === after1.offset, '1. the caret stays where it was', `${JSON.stringify(before1)} → ${JSON.stringify(after1)}`)
log(Math.abs(before1.scrollY - after1.scrollY) <= 1, '1. the scroll stays where it was', `${before1.scrollY} → ${after1.scrollY}`)

// 3. Bumblebee: can a stale tab (one that never comes back) save over a newer edit? Run before case 2, so case 2's
//    refused draft (kept in this browser for recovery) isn't in the way of fresh tabs.
const OTHER = DAY
const E = await tab(OTHER), F = await tab(OTHER)
await F.bringToFront(); await typeAtEnd(F, ' [F3]'); await F.waitForTimeout(1500)
log(stored(OTHER).includes('[F3]'), '3. F saved the newer edit')
await E.bringToFront(); await E.evaluate(() => {}) // no focus event: E stays on the page it loaded
await typeAtEnd(E, ' [E3]'); await E.waitForTimeout(2500)
const s3 = stored(OTHER), status3 = await E.locator('.editor-status, [role=status]').allInnerTexts()
log(s3.includes('[F3]') && !s3.includes('[E3]'), '3. the stale save didn\'t overwrite it', `F3 ${s3.includes('[F3]')} · E3 ${s3.includes('[E3]')}`)
log(/changed elsewhere|draft kept|Not saved/i.test(status3.join(' ')), '3. E says its draft is kept', status3.join(' | ').slice(0, 140))
log((await editorText(E)).includes('[E3]'), '3. E still shows what it typed')
// 2. B has unsaved typing; A edits the same page; B comes back: its typing is saved first or kept, never dropped.
//    A and B come back first, so both start from the page as case 3 left it.
await away(A); await comeBack(A); await comeBack(B)
log((await editorText(A)).includes('[F3]') && (await editorText(B)).includes('[F3]'), '2. A and B picked up F\'s edit on coming back')
await away(B)
await B.bringToFront(); await typeAtEnd(B, ' [B2]') // no wait: still inside B's 450ms save delay
await A.bringToFront(); await typeAtEnd(A, ' [A2]'); await A.waitForTimeout(1500)
await comeBack(B)
const b2 = await editorText(B), s2 = stored()
const status2 = await B.locator('.editor-status, [role=status]').allInnerTexts()
log(b2.includes('[B2]'), '2. B still shows what it typed', status2.join(' | ').slice(0, 120))
log(s2.includes('[B2]') || s2.includes('[A2]'), '2. the database holds one of the two edits, and nothing else changed', `A2 ${s2.includes('[A2]')} · B2 ${s2.includes('[B2]')}`)
const statusA2 = await A.locator('.editor-status, [role=status]').allInnerTexts()
log(s2.includes('[A2]') || ((await editorText(A)).includes('[A2]') && /changed elsewhere|draft kept/i.test(statusA2.join(' '))), '2. whichever tab lost the race keeps its text and says draft kept', `A: ${statusA2.join(' | ').split('\n')[0].slice(0, 80)}`)
log(!(s2.includes('[A2]') && !s2.includes('[B2]') && !/changed elsewhere|draft kept/i.test(status2.join(' '))), '2. if B\'s typing isn\'t saved, B says so (draft kept)', status2.join(' | ').slice(0, 120))

log(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' / '))
await browser.close()
console.log(failures ? `${failures} failed` : 'all passed')
