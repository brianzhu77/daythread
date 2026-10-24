// B40: a save the server refuses (not the network): after the second refusal the line says where to act.
const pw = await import('playwright')
const base = `http://127.0.0.1:${process.argv[2]}`
const b = await pw.chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage()
const errors = []; p.on('pageerror', e => errors.push(e.message)); const log = (k, v) => console.log(`${k}: ${JSON.stringify(v)}`)
const mode = { v: 'block' }; let refused = 0
await p.route('**/*', r => {
  const req = r.request(), body = req.postData() ?? ''
  if (req.method() !== 'POST' || !body.includes('save-editor')) return r.continue()
  if (mode.v === 'block') return r.abort('failed')
  if (mode.v === 'refuse') { refused++; const at = body.indexOf('"k":["type","pageId","expectedContent"'); const re = /\{"t":1,"s":"((?:[^"\\]|\\.)*)"\}/g; re.lastIndex = body.indexOf('"v":[', at); re.exec(body); re.exec(body); const m = re.exec(body); return r.continue({ postData: m ? body.slice(0, m.index) + '{"t":1,"s":"stale"}' + body.slice(m.index + m[0].length) : body }) }
  return r.continue()
})
await p.goto(base + '/day/2026-10-22', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
await p.getByText('#daythread feedback').first().click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.press('Enter'); await p.keyboard.type('refuse' + (Date.now() % 1000)); await p.waitForTimeout(1500)
await p.locator('.sidebar .side-row:has-text("Pages")').first().click(); await p.waitForTimeout(2500); log('kept', await p.evaluate(() => document.querySelector('.editor-unsaved-line.is-elsewhere')?.textContent))
mode.v = 'refuse'
for (let i = 1; i <= 3; i++) { await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(2500); log(`after attempt ${i} (refused ${refused})`, { line: await p.evaluate(() => document.querySelector('.editor-unsaved-line.is-elsewhere')?.textContent), header: await p.evaluate(() => document.querySelector('.banner.save-failed')?.textContent ?? null) }) }
mode.v = 'ok'; await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(3000); log('cause cleared', await p.evaluate(() => document.querySelector('.editor-unsaved-line.is-elsewhere')?.textContent ?? null))
console.log('errors:', errors.length ? errors.join(' | ') : 'none'); await b.close()
