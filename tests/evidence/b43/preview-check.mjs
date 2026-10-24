// B43 (Lead, task #179): a link page a paste makes takes the linked page's own title and quotes its description; a site
// that can't be read leaves the page as it is today, with no error. A local "site" serves the pages; the app's server
// must be started with DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK=1 (loopback is otherwise refused). Fresh store per run:
//   DB=<store> node tests/evidence/b43/preview-check.mjs <base> <article|gbk|slow|bare|undo> [width]
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import http from 'node:http'
const [base, mode = 'article', width = '1280'] = process.argv.slice(2), DB = process.env.DB
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b43-')) throw Error('Use a disposable loopback server and a fresh /tmp/rb-b43-* store')
const gbkTitle = Buffer.concat([Buffer.from('<title>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xea, 0xcc, 0xe2]), Buffer.from('</title>')]) // 中文标题
const site = http.createServer((req, res) => {
  if (req.url === '/article') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<head><title>Felix – Blog</title><meta property="og:title" content="How to be more ambitious"><meta property="og:description" content="A tutorial for humans &amp; models"></head>') }
  if (req.url === '/gbk') { res.setHeader('content-type', 'text/html; charset=gbk'); return res.end(gbkTitle) }
  if (req.url === '/bare') { res.setHeader('content-type', 'text/html'); return res.end('<p>no head</p>') }
  if (req.url === '/slow') return // never answers
  res.statusCode = 404; res.end()
})
await new Promise(r => site.listen(0, '127.0.0.1', r))
const link = `http://127.0.0.1:${site.address().port}/${mode === 'undo' ? 'article' : mode}`
const phone = Number(width) < 600
const browser = await (phone ? webkit : chromium).launch()
const p = await browser.newPage({ viewport: { width: Number(width), height: 900 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const errors = []; p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width} ${mode}: ${what}${detail ? ` (${detail})` : ''}`) }
const linkPage = () => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare("SELECT id, title, editorJSON FROM pages WHERE snapshot='current' AND url = ?").get(link) } finally { d.close() } }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
await p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`).first().click()
await p.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, link)
const made = Date.now()
await p.waitForTimeout(mode === 'slow' ? 7000 : 3500)
const lp = linkPage(), body = lp?.editorJSON ? JSON.parse(lp.editorJSON) : []
const defaultTitle = link.replace(/^https?:\/\//, '')
if (mode === 'article') {
  log(lp?.title === 'How to be more ambitious', 'the page takes og:title (not <title>, not the URL)', lp?.title)
  log(body[0]?.type === 'quote' && body[0]?.content === 'A tutorial for humans & models', 'the description is a quote line', JSON.stringify(body[0]))
  const cardText = await p.locator('.continuous-editor [data-content-type="pageLink"]').first().innerText()
  log(cardText.includes('How to be more ambitious'), 'the card where he pasted shows the same title (Bumblebee)', JSON.stringify(cardText.slice(0, 80)))
} else if (mode === 'gbk') {
  log(lp?.title === '中文标题', 'a GBK page\'s title decodes (Lead)', lp?.title)
} else if (mode === 'slow' || mode === 'bare') {
  log(lp && lp.title.startsWith('127.0.0.1') && !lp.editorJSON, `a site that ${mode === 'slow' ? 'never answers' : 'has no title'} leaves the page as today`, lp?.title)
  const line = await p.locator('.editor-save-line').innerText().catch(() => '')
  log(!/Couldn|error|fail/i.test(line), 'and shows no error', JSON.stringify(line))
} else if (mode === 'undo') {
  log(lp?.title === 'How to be more ambitious', 'filled in')
  await p.locator('[role="alert"], [data-slot="toast"]').getByRole('button', { name: 'Undo' }).first().click(); await p.waitForTimeout(1500)
  log(!linkPage(), 'the paste\'s Undo still removes the page (the fetched title isn\'t his edit)')
}
log(Date.now() - made < 15000 && errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close(); site.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
