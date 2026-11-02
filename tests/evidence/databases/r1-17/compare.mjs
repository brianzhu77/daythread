// His real pages, main build against this build, on two identical copies: text, pixels, errors, and nothing written by opening.
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
const [mainUrl, prUrl, mainStore, prStore, outDir] = process.argv.slice(2)
if (!outDir) { console.error('Usage: node compare.mjs <main-url> <this-url> <main-store> <this-store> <out-dir>'); process.exit(2) }
// WebKit draws the 64th page opened in one browser run blank, on either build (order swapped: it hits main), so the last path needs a check of its own.
mkdirSync(outDir, { recursive: true })
const ws = s => JSON.parse(execSync(`sqlite3 ${s} "select data from workspace"`, { maxBuffer: 1 << 28 }).toString())
const before = ws(prStore)
const paths = ['/', '/tasks', '/calendar', '/pages', '/review', '/trash']
for (const p of before.pages) { if (p.trashedAt) continue; if (p.type === 'daily') paths.push(`/day/${p.date}`); else if (p.type === 'document') paths.push(`/pages?page=${encodeURIComponent(p.id)}`) }
const results = []
for (const engine of ['chromium', 'webkit']) for (const [w, h, mobile] of [[1280, 900, false], [390, 844, true]]) {
  const browser = await pw[engine].launch({ headless: true })
  const ctx = await browser.newContext(engine === 'webkit' ? { viewport: { width: w, height: h } } : { viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile })
  for (const [i, path] of paths.entries()) {
    const row = { engine, w, n: i, kind: path.split('?')[0].replace(/\d{4}-\d\d-\d\d/, 'D') }
    const shots = {}
    for (const [name, base] of [['main', mainUrl], ['pr', prUrl]]) {
      const page = await ctx.newPage(); const errors = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
      try { await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 }) } catch (e) { errors.push('goto: ' + e.message.split('\n')[0]) }; await page.waitForTimeout(2500)
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
      await page.mouse.move(0, 0); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(150)
      const text = await page.evaluate(() => document.body.innerText)
      const file = `${outDir}/${engine}-${w}-${i}-${name}.png`; await page.screenshot({ path: file, fullPage: true })
      shots[name] = { text, file, errors }; await page.close()
    }
    row.sameText = shots.main.text === shots.pr.text
    row.errMain = shots.main.errors.length; row.errPr = shots.pr.errors.length
    if (row.errPr > row.errMain) row.newErrors = shots.pr.errors
    if (!row.sameText) { const a = shots.main.text.split('\n'), b = shots.pr.text.split('\n'); row.textDiff = { onlyMain: a.filter(x => !b.includes(x)).length, onlyPr: b.filter(x => !a.includes(x)).length } }
    results.push({ ...row, a: shots.main.file, b: shots.pr.file })
  }
  await browser.close()
}
const after = ws(prStore)
const docs = d => Object.fromEntries(d.pages.map(p => [p.id, p.document]))
const a = docs(before), b = docs(after)
const changed = Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]).length
writeFileSync(`${outDir}/results.json`, JSON.stringify({ paths: paths.length, revBefore: before.revision, revAfter: after.revision, pagesBefore: before.pages.length, pagesAfter: after.pages.length, tasksSame: JSON.stringify(before.tasks) === JSON.stringify(after.tasks), docsChanged: changed, results }))
console.log('done', results.length)
