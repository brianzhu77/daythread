// B92 in the built app: on today's page a to-do carried 7 days or more reads "Since <date>" after its words; 6 days reads
// nothing; an older day page shows none; a deadline shows both; a long Chinese line at 390 keeps its box and doesn't overlap.
// Usage: node tests/evidence/carried-since/carried-since.mjs <base-url> <today> [chromium|webkit]  (the server's store from seed.ts for <today>)
import * as pw from '@playwright/test'
const [base, today, only] = process.argv.slice(2)
if (!base || !today) { console.error('Usage: node tests/evidence/carried-since/carried-since.mjs <base-url> <today> [chromium|webkit]'); process.exit(2) }
const results = [], ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const label = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const back = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const row = (page, words) => page.locator('.editor-task').filter({ hasText: words })
for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  for (const width of [1280, 390]) for (const scheme of ['light', 'dark']) {
    const tag = `${engine} ${width} ${scheme}`
    const context = await browser.newContext({ viewport: { width, height: 860 }, colorScheme: scheme, serviceWorkers: 'block', ...(width < 600 ? { hasTouch: true } : {}) })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}/day/${today}`); await row(page, 'Renew the TRV').waitFor({ timeout: 20000 })
    ok(`${tag} 7 days: "Since ${label(back(7))}"`, (await row(page, 'Renew the TRV').locator('.is-since').innerText().catch(() => '')) === `Since ${label(back(7))}`)
    ok(`${tag} 6 days: nothing`, await row(page, 'Six days only').locator('.is-since').count() === 0)
    const taxes = row(page, 'File the taxes')
    ok(`${tag} a deadline shows both`, await taxes.locator('.is-since').count() === 1 && /Due/.test(await taxes.locator('.app-tag:not(.is-since)').first().innerText().catch(() => '')))
    // The long Chinese line: the box stays at the line's start and the badge overlaps neither it nor the words.
    const cn = row(page, '提交加拿大')
    const geo = await cn.evaluate(el => {
      const box = el.querySelector('input[type=checkbox]').getBoundingClientRect(), since = el.querySelector('.is-since').getBoundingClientRect(), title = el.querySelector('.editor-task-title').getBoundingClientRect(), line = el.getBoundingClientRect()
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      return { boxLeft: Math.round(box.left - line.left), overlapsBox: hit(box, since), right: Math.round(since.right), lineRight: Math.round(line.right), sinceTop: Math.round(since.top), titleBottom: Math.round(title.bottom), titleLines: Math.round(title.height / parseFloat(getComputedStyle(el.querySelector('.editor-task-title')).lineHeight)) }
    })
    const other = await page.locator('.editor-task').first().evaluate(el => Math.round(el.querySelector('input[type=checkbox]').getBoundingClientRect().left - el.getBoundingClientRect().left))
    ok(`${tag} a long Chinese line keeps its box and fits`, geo.boxLeft === other && !geo.overlapsBox && geo.right <= geo.lineRight + 1, JSON.stringify(geo))
    await page.goto(`${base}/day/${back(1)}`); await row(page, 'Renew the TRV').waitFor({ timeout: 20000 })
    ok(`${tag} an older day page shows none`, await page.locator('.is-since').count() === 0)
    ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 200))
    if (process.env.SHOTS) { await page.goto(`${base}/day/${today}`); await row(page, 'Renew the TRV').waitFor(); await page.screenshot({ path: `${process.env.SHOTS}/${engine}-${width}-${scheme}.png` }) }
    await context.close()
  }
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
