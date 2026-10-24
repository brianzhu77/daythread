// Bytes of JS and CSS a fresh load of a path downloads (transfer, uncompressed body sizes).
import { chromium } from '@playwright/test'
const [base, path = '/'] = process.argv.slice(2)
const b = await chromium.launch(), p = await b.newPage(); let js = 0, css = 0, n = 0
p.on('response', async r => { const u = r.url(); if (!/\/assets\//.test(u)) return; const len = (await r.body().catch(() => Buffer.alloc(0))).length; n++; if (u.endsWith('.js')) js += len; else if (u.endsWith('.css')) css += len })
await p.goto(base + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
console.log(JSON.stringify({ path, files: n, jsKB: Math.round(js / 1024), cssKB: Math.round(css / 1024) }))
await b.close()
