import { chromium } from '@playwright/test'
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
await p.goto('http://127.0.0.1:3490/', { waitUntil: 'networkidle' })
const box = await p.locator('text=TODO - Top 3').boundingBox()
await p.mouse.click(box.x + 120, box.y + box.height + 22)
await p.keyboard.type('past task'); await p.keyboard.press('Enter'); await p.waitForTimeout(3000)
console.log(await p.evaluate(() => [...document.querySelectorAll('[data-content-type]')].map(e => e.getAttribute('data-content-type') + ':' + (e.querySelector('.bn-inline-content')?.textContent ?? e.textContent ?? '').slice(0, 20)).slice(0, 8)))
await b.close()
