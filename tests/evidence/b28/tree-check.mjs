// B28 (Jazz rule 3): Tasks and Review list a sub-task under its parent when both are listed, "↳ parent" otherwise.
// Built server, sign-in off, a store from seed.ts:   node tests/evidence/b28/tree-check.mjs <base> [width]
import { chromium, webkit } from '@playwright/test'
const [base, width = '1280'] = process.argv.slice(2)
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const phone = Number(width) < 600
const browser = await (phone ? webkit : chromium).launch()
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const p = await ctx.newPage(), errors = []
p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${detail ? ` (${detail})` : ''}`) }
// Each row: indent from the list's left edge, its "↳" line, its title; and whether the checkbox is level with the title.
const rows = (selector, titleSel, step) => p.locator(selector).evaluateAll((els, [titleSel, step]) => {
  const left = Math.min(...els.map(e => e.getBoundingClientRect().left))
  return els.map(e => {
    const parent = e.querySelector('.task-parent')?.textContent?.trim() ?? ''
    const title = (e.querySelector(titleSel)?.textContent ?? '').replace(parent, '').trim().split(/\s/)[0]
    // The title's own words (not the "↳" line): the first text node outside .task-parent, measured with a Range.
    const walker = document.createTreeWalker(e.querySelector(titleSel), NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement?.closest('.task-parent') || !n.textContent.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT })
    const words = walker.nextNode(), range = document.createRange()
    if (words) range.selectNodeContents(words)
    const titleText = words ? range.getClientRects()[0] : null, check = e.querySelector('.check')?.getBoundingClientRect()
    return { line: `${' '.repeat(Math.round((e.getBoundingClientRect().left - left) / step) * 2)}${title}${parent ? ` ${parent}` : ''}`, level: check && titleText ? Math.abs((check.top + check.height / 2) - (titleText.top + titleText.height / 2)) : -1 }
  })
}, [titleSel, step])
await p.goto(base + '/tasks?view=today', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const today = await rows('.task-list > li', '.task-title', 30)
log(JSON.stringify(today.map(r => r.line)) === JSON.stringify(['P', '  c1', '  c2', '    g', 'Q', 'c3 ↳ R']), 'Tasks · Today: sub-tasks under their parent, one level deeper each; c3 names its parent planned elsewhere', JSON.stringify(today.map(r => r.line)))
const underParent = await p.locator('.task-list > li').evaluateAll(els => {
  const box = (e, sel) => e.querySelector(sel)?.getBoundingClientRect()
  const title = e => { const w = document.createTreeWalker(e.querySelector('.task-title'), NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement?.closest('.task-parent') || !n.textContent.trim() ? 2 : 1 }); const t = w.nextNode(); const r = document.createRange(); r.selectNodeContents(t); return r.getClientRects()[0] }
  return [[0, 1], [2, 3]].map(([parent, child]) => Math.round(box(els[child], '.check').left - title(els[parent]).left))
})
log(underParent.every(d => Math.abs(d) <= 1), 'a sub-task\'s checkbox starts at its parent\'s title (B39)', JSON.stringify(underParent))
log(today.every(r => r.level >= 0 && r.level <= 3), 'each checkbox is level with its own title, also under a "↳" line', JSON.stringify(today.map(r => Math.round(r.level))))
await p.screenshot({ path: `/tmp/rb-b28-tasks-${width}.png` })
await p.goto(base + '/tasks?view=upcoming', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const upcoming = await rows('.task-list > li', '.task-title', 30)
log(JSON.stringify(upcoming.map(r => r.line)) === JSON.stringify(['R']), 'Tasks · Upcoming: R alone on tomorrow, no "↳"', JSON.stringify(upcoming.map(r => r.line)))
await p.goto(base + '/review', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const review = await rows('.plan-card', '.plan-title', 24)
const reviewParents = await p.locator('.plan-card').evaluateAll(els => els.map(e => e.querySelector('.task-parent')?.textContent?.trim() ?? ''))
log(JSON.stringify(review.map(r => r.line.split(' ')[0].trim() ? r.line : r.line).map(l => l.replace(/ ↳.*/, ''))) === JSON.stringify(['P', '  c1', '  c2', '    g', 'Q', 'c3']) && reviewParents[5] === '↳ R', 'Review · plan cards in the same outline, c3 with "↳ R"', JSON.stringify({ lines: review.map(r => r.line), reviewParents }))
await p.screenshot({ path: `/tmp/rb-b28-review-${width}.png` })
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
