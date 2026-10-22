import { DatabaseSync } from 'node:sqlite'
const { chromium } = await import('/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs')
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 1000 } }), errors = []
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto('http://127.0.0.1:3376/day/2026-10-18', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const chip = await p.locator('.continuous-editor .bn-inline-content', { hasText: 'line link:' }).first().innerText()
console.log('renders as:', JSON.stringify(chip))
await p.locator('.continuous-editor .bn-inline-content', { hasText: '奥德赛' }).first().click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(' x'); await p.waitForTimeout(1800)
const d = new DatabaseSync('/tmp/rb-a11/w.sqlite', { readOnly: true }); const j = d.prepare("SELECT editorJSON FROM pages WHERE snapshot='current' AND type='daily' AND date='2026-10-18'").get().editorJSON; d.close()
console.log('after an edit elsewhere on the page, lineId still stored:', j.includes('"lineId"'), '| link still there:', j.includes('"pageRef"'), '| errors:', errors)
await b.close()
