// Repro for Lead 1d5e2e28: a save sent after the server stored the day draft but before this tab adopted it.
// The draft's reply is held for HOLD ms (the server has already committed set-draft); the typing in that window saves.
// Usage: node race.mjs <base> [HOLD]
import { chromium } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], hold = Number(process.argv[3] ?? 2500)
const b = await chromium.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, timezoneId: 'America/Vancouver' })
const p = await ctx.newPage(); const log = []
let draftSeen = false
await p.route('**/_serverFn/**', async route => {
  const body = route.request().postData() ?? ''
  if (route.request().method() === 'POST' && body.includes('date') && !body.includes('action')) {
    draftSeen = true; const res = await route.fetch(); log.push(`draft committed on server, reply held ${hold}ms`)
    await new Promise(r => setTimeout(r, hold)); return route.fulfill({ response: res })
  }
  return route.continue()
})
p.on('response', r => { if (r.url().includes('_serverFn') && r.request().method() === 'POST') log.push(`POST ${r.status()}`) })
await p.goto(base + '/'); await p.locator('.editor-task-title').first().waitFor({ timeout: 30000 })
for (let i = 0; i < 40 && !draftSeen; i++) await p.waitForTimeout(100)
await p.locator('.editor-task-title').filter({ hasText: /^$/ }).first().click()
await p.keyboard.type('Race line', { delay: 30 })
await p.waitForTimeout(hold + 1500)
const status = await p.locator('.editor-save-line').textContent()
console.log(log.join('\n')); console.log('draft requested:', draftSeen, '| save line:', JSON.stringify(status))
console.log(/Couldn't save|elsewhere/.test(status ?? '') ? 'REPRODUCED' : status === 'Saved' ? 'SAVED' : 'OTHER')
await b.close()
