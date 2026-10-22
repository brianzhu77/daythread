import { chromium } from '@playwright/test'
const width = Number(process.argv[2] ?? 1280)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width, height: 900 } })
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${d ? ` (${d})` : ''}`) }
await p.goto('http://127.0.0.1:3425/day/'+process.argv[3], { waitUntil: 'networkidle' })
const at = () => p.evaluate(() => { const s = window.getSelection(); const n = s.anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n
  return { gap: !!document.querySelector('.ProseMirror-gapcursor'), text: el?.closest('.bn-inline-content')?.textContent ?? '', type: el?.closest('[data-content-type]')?.getAttribute('data-content-type'), off: s.anchorOffset } })
const box = await p.locator('text=TODO - Top 3').boundingBox()
await p.mouse.click(box.x + 120, box.y + box.height + 22)
await p.keyboard.type('first task'); await p.keyboard.press('Enter'); await p.keyboard.type('second'); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
const seq = [['ArrowUp', 'second'], ['ArrowUp', 'first task'], ['ArrowDown', 'second'], ['ArrowDown', ''], ['ArrowUp', 'second'], ['ArrowDown', ''], ['ArrowDown', 'TODO - Other'], ['ArrowDown', ''], ['ArrowUp', 'TODO - Other'], ['ArrowUp', '']]
let gaps = 0
for (const [k, want] of seq) {
  await p.keyboard.press(k); await p.waitForTimeout(200); const s = await at(); if (s.gap) gaps++
  log(s.text === want, `${k} → "${want}"`, `got "${s.text}" in ${s.type}`)
}
log(gaps === 0, 'no gap cursor at any step', String(gaps))
// Same horizontal position: from the 3rd character of "first task", ↓ lands on the 3rd character of "second".
await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp')
await p.keyboard.press('Meta+ArrowLeft'); for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight')
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200)
const col = await at()
log(col.text === 'second' && Math.abs(col.off - 3) <= 1, 'keeps the column', `offset ${col.off} in "${col.text}"`)
// The # menu still owns the arrows.
// A menu open on a line next to a task row keeps its arrows: Enter twice leaves a plain line under the row, / opens the menu.
const fb = await p.locator('.bn-inline-content', { hasText: 'first task' }).boundingBox(); await p.mouse.click(fb.x + fb.width - 1, fb.y + fb.height / 2)
await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.waitForTimeout(300); await p.keyboard.type('/'); await p.waitForTimeout(600)
const pick = () => p.locator('.bn-suggestion-menu-item[aria-selected="true"]').first().textContent().catch(() => null)
const m0 = await pick(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(250); const m1 = await pick()
const caretIn = await p.evaluate(() => window.getSelection().anchorNode?.textContent)
log(m0 !== null && m0 !== m1 && caretIn === '/', 'with a menu open next to a task row, ↑ moves the menu, not the caret', `${m0} → ${m1}`)
await p.keyboard.press('Escape')
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
