// B3 export (Lead 1ce5dd8b, Jazz f10f8de5): Export in the account row downloads a zip of Markdown plus workspace.json.
// Built server, sign-in off, a store from seed.ts:   DB=<store> node tests/evidence/b3/export-check.mjs <base> [width]
import { chromium, webkit } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
const [base, width = '1280'] = process.argv.slice(2)
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const phone = Number(width) < 600
const browser = await (phone ? webkit : chromium).launch()
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: Number(width), height: 1000 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const p = await ctx.newPage(), errors = []
p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${detail ? ` (${detail})` : ''}`) }
await p.goto(base + (phone ? '/pages' : '/'), { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const row = p.locator('.account-row:visible')
log((await row.innerText()).trim() === 'Export', 'with sign-in off the row is just "Export"', JSON.stringify(await row.innerText()))
// Busy: the link says Exporting… and is disabled while the zip is built.
await p.route('**/api/export', async r => { await new Promise(res => setTimeout(res, 800)); await r.continue() })
const download = p.waitForEvent('download')
await row.getByRole('button', { name: 'Export' }).click(); await p.waitForTimeout(200)
const busy = row.getByRole('button', { name: 'Exporting…' })
log(await busy.count() === 1 && await busy.isDisabled(), 'while building: "Exporting…", disabled')
const d = await download, file = await d.path()
log(/^daythread-export-\d{4}-\d{2}-\d{2}\.zip$/.test(d.suggestedFilename()), 'the zip is named for the day', d.suggestedFilename())
await p.waitForTimeout(300)
log((await row.innerText()).trim() === 'Export', 'after the download the row is back to "Export" (no notice)')
const zip = unzipSync(readFileSync(file)), names = Object.keys(zip)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }), root = `daythread-export-${today}/`
const cjk = '原生家庭创伤导致的讨好型人格如何解决？（是否强关联？）'
const want = ['README.md', 'workspace.json', `days/${today}.md`, `pages/${cjk}.md`, `pages/${cjk} (2).md`, 'pages/Q4 plan- home-office.md']
log(want.every(w => names.includes(root + w)) && !names.some(n => n.includes('Trashed draft')), 'files: README, workspace.json, the day, CJK titles kept with (2), unsafe characters replaced, no trashed page', JSON.stringify(names.map(n => n.slice(root.length))))
const md = strFromU8(zip[`${root}days/${today}.md`])
log(/- \[ \] corridor\n\t- \[ \] Rewind App PR/.test(md) && /- \[x\] plaid/.test(md), 'to-dos and nesting: corridor › Rewind App PR, plaid ticked')
log(md.includes(`- Read **slowly** · [[${cjk} (2)]] and [a link](https://example.com/a)\n\t- [x] nested tick`), 'styles, links, and the [[link]] points at the final name')
const json = JSON.parse(strFromU8(zip[root + 'workspace.json']))
log(json.format === 'daythread-export' && json.formatVersion === 1 && !('receipts' in json) && !('undo' in json) && json.pages.some(pg => pg.id === 'gone' && pg.trashedAt), 'workspace.json: versioned, trash included, no receipts or Undo copy')
const head = await p.request.get(base + '/api/export')
log(head.headers()['cache-control']?.includes('no-store') && head.headers()['content-type'] === 'application/zip', 'the response is never cached', head.headers()['cache-control'])
// Failure: "Couldn't export · Try again" in the row; Try again works.
await p.unroute('**/api/export'); await p.route('**/api/export', r => r.fulfill({ status: 500, body: 'no' }))
await row.getByRole('button', { name: 'Export' }).click(); await p.waitForTimeout(500)
log((await row.innerText()).trim() === 'Couldn’t export · Try again', 'a failure says "Couldn’t export · Try again"', JSON.stringify(await row.innerText()))
const underline = await row.getByRole('button', { name: 'Try again' }).evaluate(e => getComputedStyle(e).textDecorationLine)
log(underline === 'underline', 'Try again is underlined (Jazz)', underline)
await p.unroute('**/api/export')
const again = p.waitForEvent('download')
await row.getByRole('button', { name: 'Try again' }).click()
log(Boolean(await (await again).path()), 'Try again downloads it')
// Typing still waiting for autosave is in the export (Ratchet 8b6615ff); if it can't be saved, no zip and the row says
// so (Jazz 8c4c749b). Desktop: the editor stays open beside the row. Phone: he types on Today, opens Pages (the editor
// closes and saves as it goes), then taps Export.
const typeThenExport = async text => {
  if (phone) { await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800) }
  const last = p.locator('.continuous-editor .bn-inline-content').last()
  await last.scrollIntoViewIfNeeded(); await last.click(); await p.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+ArrowRight`); await p.keyboard.type(text)
  if (phone) { await p.locator('a[href="/pages"]:visible').first().click(); await p.waitForTimeout(150) }
  await p.locator('.account-row:visible').getByRole('button', { name: 'Export' }).click()
}
await p.route('**/_serverFn/**', async r => { if (r.request().method() === 'POST') await new Promise(res => setTimeout(res, 1800)); await r.continue() })
const pending = p.waitForEvent('download')
await typeThenExport(' PENDING_EXPORT_MARKER')
const pendingZip = unzipSync(readFileSync(await (await pending).path()))
log(strFromU8(pendingZip[root + 'workspace.json']).includes('PENDING_EXPORT_MARKER') && strFromU8(pendingZip[`${root}days/${today}.md`]).includes('PENDING_EXPORT_MARKER'), 'typing still waiting for autosave is in the export')
await p.unroute('**/_serverFn/**'); await p.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort('failed') : r.continue())
let downloaded = false; p.on('download', () => { downloaded = true })
const posts = []; p.on('request', r => { if (r.method() === 'POST') posts.push(r.url().split('/').pop().slice(0, 40)) })
await typeThenExport(' UNSAVABLE_MARKER'); await p.waitForTimeout(4500)
if (process.env.DEBUG_B3) console.log(JSON.stringify({ posts, stash: await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:'))) }))
const refused = (await p.locator('.account-row:visible').innerText()).trim()
log(!downloaded && refused === 'Not exported · latest text not saved yet · Try again', 'typing that can\'t be saved: no download, "Not exported · latest text not saved yet · Try again"', JSON.stringify({ refused, downloaded }))
await p.unroute('**/_serverFn/**')
// Back online: desktop taps Try again (the open editor saves first); on the phone the text waits in Today's draft, so
// he opens Today (it's saved there) and exports again. Either way the zip now holds it.
if (phone) { await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
  if (process.env.DEBUG_B3) console.log(JSON.stringify({ line: await p.locator('.editor-save-line').innerText().catch(() => '?'), shown: (await p.locator('.continuous-editor').innerText()).includes('UNSAVABLE_MARKER'), slots: await p.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('daythread:editor:')).map(([k, v]) => [k.slice(-8), v.includes('UNSAVABLE'), JSON.parse(v).claimedBy ?? null])) }))
  await p.locator('a[href="/pages"]:visible').first().click(); await p.waitForTimeout(300) }
const recovered = p.waitForEvent('download')
await p.locator('.account-row:visible').getByRole('button', { name: phone ? 'Export' : 'Try again' }).click()
const recoveredZip = unzipSync(readFileSync(await (await recovered).path()))
log(strFromU8(recoveredZip[root + 'workspace.json']).includes('UNSAVABLE_MARKER'), 'once it can save again, the export includes that text')
await p.screenshot({ path: `/tmp/rb-b3-row-${width}.png` })
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
