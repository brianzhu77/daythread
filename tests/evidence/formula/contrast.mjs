// R4-3 `style`: every text colour and tint a formula can draw, measured in both themes from the built app's own tokens. Text needs 4.5:1 on what's behind it:
// the page, a card, hover, a picked row, and its own tint; the ink on each tint too. A colour on another colour's tint is what he typed, so it's listed, not gated.
// Usage: node tests/evidence/formula/contrast.mjs <base-url> [chromium|webkit]
import * as pw from '@playwright/test'
const [base, engine = 'chromium'] = process.argv.slice(2)
if (!base) { console.error('Usage: node tests/evidence/formula/contrast.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const names = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
const browser = await pw[engine].launch({ headless: true })
let fails = 0
for (const colorScheme of ['light', 'dark']) {
  const page = await (await browser.newContext({ colorScheme, serviceWorkers: 'block' })).newPage()
  await page.goto(`${base}/sign-in`).catch(() => {}); await page.waitForTimeout(500)
  const out = await page.evaluate(names => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const rgba = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255] }
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    const resolve = n => { const el = document.createElement('i'); el.style.color = `var(${n})`; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c }
    const over = (t, u) => [0, 1, 2].map(i => t[i] * t[3] + u[i] * (1 - t[3]))
    const lum = c => c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0)
    const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05) }
    const page = over(rgba(resolve('--bg-doc')), [255, 255, 255])
    const surfaces = { page, hover: over(rgba(resolve('--hover-dim')), page), 'soft fill': over(rgba(resolve('--fill-soft')), page), 'picked row': over(rgba(resolve('--blue-soft')), page) }
    const rows = []
    for (const [where, under] of Object.entries(surfaces)) rows.push({ what: `an error's words on ${where}`, ratio: ratio(over(rgba(resolve('--formula-red')), page), under), gated: true })
    const ink = over(rgba(resolve('--ink')), page)
    for (const n of names) {
      const text = over(rgba(resolve(`--formula-${n}`)), page), tint = over(rgba(resolve(`--formula-${n}-tint`)), page)
      for (const [where, under] of Object.entries(surfaces)) rows.push({ what: `${n} on ${where}`, ratio: ratio(text, under), gated: true })
      rows.push({ what: `${n} on its tint`, ratio: ratio(text, tint), gated: true })
      rows.push({ what: `ink on ${n} tint`, ratio: ratio(ink, tint), gated: true })
      rows.push({ what: `${n} tint against the page`, ratio: ratio(tint, page), gated: false })
      // A rule's tint behind a row (R4-12): its words, its quieter words, and a formula's colours on it.
      const rule = over(rgba(resolve(`--tint-${n}`)), page)
      rows.push({ what: `ink on rule ${n}`, ratio: ratio(ink, rule), gated: true })
      rows.push({ what: `ink-2 on rule ${n}`, ratio: ratio(over(rgba(resolve('--ink-2')), page), rule), gated: true })
      rows.push({ what: `ink-3 on rule ${n}`, ratio: ratio(over(rgba(resolve('--ink-3')), page), rule), gated: false, quiet: true })
      for (const m of names) rows.push({ what: `${m} on rule ${n}`, ratio: ratio(over(rgba(resolve(`--formula-${m}`)), page), rule), gated: false, onRule: true })
      for (const m of names) if (m !== n) rows.push({ what: `${n} on ${m} tint`, ratio: ratio(text, over(rgba(resolve(`--formula-${m}-tint`)), page)), gated: false, other: true })
    }
    return rows
  }, names)
  const gated = out.filter(r => r.gated), below = gated.filter(r => r.ratio < 4.5)
  fails += below.length
  const worst = gated.reduce((a, b) => (a.ratio < b.ratio ? a : b))
  console.log(`${colorScheme}: ${gated.length - below.length} of ${gated.length} at 4.5:1 or more; lowest ${worst.what} ${worst.ratio.toFixed(2)}`)
  for (const r of below) console.log(`  BELOW ${r.what} ${r.ratio.toFixed(2)}`)
  const others = out.filter(r => r.other), low = others.reduce((a, b) => (a.ratio < b.ratio ? a : b))
  console.log(`  another colour's tint, not gated: lowest ${low.what} ${low.ratio.toFixed(2)}, ${others.filter(r => r.ratio < 4.5).length} of ${others.length} below 4.5`)
  const quiet = out.filter(r => r.quiet), lowQuiet = quiet.reduce((a, b) => (a.ratio < b.ratio ? a : b)), onRule = out.filter(r => r.onRule), lowRule = onRule.reduce((a, b) => (a.ratio < b.ratio ? a : b))
  console.log(`  ink-3 on a rule, not gated: lowest ${lowQuiet.what} ${lowQuiet.ratio.toFixed(2)}`)
  console.log(`  a formula's colour in a tinted row, not gated: lowest ${lowRule.what} ${lowRule.ratio.toFixed(2)}, ${onRule.filter(r => r.ratio < 4.5).length} of ${onRule.length} below 4.5`)
  const tints = out.filter(r => r.what.endsWith('against the page')), faint = tints.reduce((a, b) => (a.ratio < b.ratio ? a : b))
  console.log(`  faintest tint against the page: ${faint.what.split(' ')[0]} ${faint.ratio.toFixed(2)}`)
  await page.close()
}
console.log(fails ? `${fails} BELOW` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
