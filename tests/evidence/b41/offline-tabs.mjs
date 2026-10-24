// B41 (Jazz, Lead): with the connection gone, moving between screens never blanks the app. Each screen is opened
// offline, from a page loaded while online; it must show the screen or the in-app offline line, never the browser's
// error page. Built server, sign-in off, any fresh store:   node tests/evidence/b41/offline-tabs.mjs <base> [width]
import { chromium, webkit } from '@playwright/test'
const [base, width = '1280'] = process.argv.slice(2)
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const phone = Number(width) < 600
const browser = await (phone ? webkit : chromium).launch()
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${detail ? ` (${detail})` : ''}`) }
const screens = ['/pages', '/tasks', '/calendar', '/tags', '/review', '/']
for (const target of screens) {
  const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
  const p = await ctx.newPage(), failedRequests = [], errors = []
  p.on('requestfailed', r => failedRequests.push(new URL(r.url()).pathname))
  p.on('pageerror', e => errors.push(e.message))
  const start = target === '/' ? '/pages' : '/'
  await p.goto(base + start, { waitUntil: 'networkidle' }); await p.waitForTimeout(phone ? 2500 : 1500)
  await ctx.setOffline(true)
  // Review's entry on the phone is the day page's "Review today" (the sidebar link on the desktop).
  const link = target === '/review' ? p.locator('a[href^="/review"]:visible').first() : p.locator(`a[href="${target}"]:visible`).first()
  await link.click().catch(e => errors.push(`no link: ${e.message.split('\n')[0]}`))
  await p.waitForTimeout(2500)
  const url = p.url(), blank = !url.startsWith(base) || /chrome-error|about:blank/.test(url)
  const text = blank ? '' : await p.locator('body').innerText().catch(() => '')
  const shown = !blank && (new URL(url).pathname === target || text.includes('Offline')) && !errors.some(e => e.startsWith('no link'))
  log(shown, `offline ${start} → ${target}: the app stays, showing the screen or its offline line`, JSON.stringify({ url: url.replace(base, ''), failed: failedRequests.filter(x => x.includes('/assets/')).slice(0, 3), offlineLine: text.match(/Offline[^\n]*/)?.[0] ?? null }))
  await ctx.close()
}
// The editor comes with the app, so Today opens offline from Pages; its emoji menu (the one part still fetched on
// first use) fails quietly offline: no page error, the app stays.
{
  const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
  const p = await ctx.newPage(), errors = []
  p.on('pageerror', e => errors.push(e.message))
  await p.goto(base + '/pages', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  await ctx.setOffline(true)
  await p.locator('a[href="/"]:visible').first().click(); await p.waitForTimeout(2500)
  log(p.url().startsWith(base) && (await p.locator('.continuous-editor').count()) > 0, 'offline Pages → Today: the editor opens', p.url().replace(base, ''))
  const last = p.locator('.continuous-editor .bn-inline-content').last()
  await last.click(); await p.keyboard.type(' :smi'); await p.waitForTimeout(2000)
  await p.keyboard.press('Escape'); await p.keyboard.type(' still typing')
  const typed = (await p.locator('.continuous-editor').innerText()).includes('still typing')
  // The editor library's emoji menu rejects its failed import unhandled; it's reported, not shown, and nothing breaks.
  const other = errors.filter(e => !/dynamically imported module|Importing a module script failed/.test(e))
  log(p.url().startsWith(base) && typed && other.length === 0, 'offline, the emoji menu can\'t load; the app stays and typing goes on', JSON.stringify({ typed, otherErrors: other.slice(0, 2) }))
  await ctx.close()
}
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
