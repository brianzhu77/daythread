// The Home Screen and manifest icons, rendered from the mark (src/components/mark.tsx, docs/design/system-v2.md §6):
// the regular cut in white on the darkest grey tile, at 63% of the tile as iOS draws its glyphs. Run after a change
// to the mark:  node scripts/render-icons.mjs   (writes public/icon-512.png, icon-192.png, apple-touch-icon.png)
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
await browser.close()
console.log('public/icon-512.png, icon-192.png, apple-touch-icon.png')
