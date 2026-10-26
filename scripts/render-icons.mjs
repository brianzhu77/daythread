// The Home Screen and manifest icons, rendered from the mark (src/components/mark.tsx, docs/design/system-v2.md §6):
// the regular cut in white on the darkest grey tile, at 63% of the tile as iOS draws its glyphs. Run after a change
// to the mark:  node --experimental-strip-types scripts/render-icons.mjs   (Node 22; plain node on 24)
// Writes public/icon-512.png, icon-192.png, apple-touch-icon.png and the startup images under public/splash/.
import { chromium } from '@playwright/test'
const tile = `<!doctype html><html><body style="margin:0;background:#202020">
<svg id="t" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" style="display:block">
  <rect width="512" height="512" fill="#202020"/>
  <g transform="translate(94.72 94.72) scale(6.72)" fill="none">
    <path d="M11 24H19M29 24H37" stroke="#ffffff" stroke-width="3"/>
    <circle cx="7" cy="24" r="4" stroke="#ffffff" stroke-width="3"/>
    <circle cx="41" cy="24" r="4" stroke="#ffffff" stroke-width="3"/>
    <circle cx="24" cy="24" r="5.5" fill="#0090ff"/>
  </g>
</svg></body></html>`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(tile)
  await page.evaluate(s => { const t = document.getElementById('t'); t.setAttribute('width', String(s)); t.setAttribute('height', String(s)) }, size)
  await page.screenshot({ path: `public/${name}`, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
}
// The startup images (src/components/splash.ts): the mark, 88 CSS px wide, centred on the page's own colour.
import { mkdirSync } from 'node:fs'
const { splashSizes, splashFile } = await import('../src/components/splash.ts')
mkdirSync('public/splash', { recursive: true })
const splash = (scheme) => `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${scheme === 'dark' ? '#111111' : '#ffffff'}">
<svg width="88" height="88" viewBox="0 0 48 48" fill="none"><path d="M11 24H19M29 24H37" stroke="${scheme === 'dark' ? '#eeeeee' : '#202020'}" stroke-width="3"/><circle cx="7" cy="24" r="4" stroke="${scheme === 'dark' ? '#eeeeee' : '#202020'}" stroke-width="3"/><circle cx="41" cy="24" r="4" stroke="${scheme === 'dark' ? '#eeeeee' : '#202020'}" stroke-width="3"/><circle cx="24" cy="24" r="5.5" fill="#0090ff"/></svg></body></html>`
for (const size of splashSizes) for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr })
  await page.setContent(splash(scheme))
  await page.screenshot({ path: 'public' + splashFile(size, scheme) })
  await page.close()
}
await browser.close()
console.log(`public/icon-512.png, icon-192.png, apple-touch-icon.png and ${splashSizes.length * 2} startup images under public/splash/`)
