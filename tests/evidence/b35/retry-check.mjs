// B35 part 1: a save that fails on the network goes by itself once the connection is back (no Retry tap), and a
// lost reply doesn't save twice. Built server, sign-in off, fresh SQLite:
//   DB=<sqlite> node tests/evidence/b35/retry-check.mjs <base> [width]
import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [BASE, W] = process.argv.slice(2), width = Number(W ?? 1280), DB = process.env.DB
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width, height: 900 } }), p = await ctx.newPage()
let failed = 0; const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${d ? ` (${d})` : ''}`) }
const saved = text => { const db = new DatabaseSync(DB, { readOnly: true }); try { return db.prepare("SELECT editorJSON FROM pages WHERE snapshot='current'").all().some(r => String(r.editorJSON ?? '').includes(text)) } finally { db.close() } }
const count = text => { const db = new DatabaseSync(DB, { readOnly: true }); try { return db.prepare("SELECT editorJSON FROM pages WHERE snapshot='current'").all().reduce((n, r) => n + (String(r.editorJSON ?? '').split(text).length - 1), 0) } finally { db.close() } }
const status = () => p.locator('.editor-save-line').innerText().catch(() => '')
await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
const h = await p.locator('h2', { hasText: 'Notes' }).first().boundingBox()
await p.mouse.click(h.x + 60, h.y + h.height + 18); await p.waitForTimeout(200); await p.keyboard.press(`${mod}+ArrowRight`)
await p.keyboard.type('online line'); await p.waitForTimeout(1500)
log(saved('online line'), 'saved while online')
await ctx.setOffline(true)
await p.keyboard.press('Enter'); await p.keyboard.type('typed offline'); await p.waitForTimeout(2500)
log(!saved('typed offline'), 'offline: not saved yet')
log(/Offline · saves when you're back|Not saved yet · trying again/.test(await status()), 'the line says it will save (Jazz bebe67e3)', await status())
await ctx.setOffline(false); await p.waitForTimeout(3000)
log(saved('typed offline'), 'back online: saved with no tap', await status())
log(count('typed offline') === 1, 'saved once')
// A reply lost after the server applied the save: the retry with the same operation id replays, nothing doubles.
let dropped = 0
await p.route('**/_serverFn/**', async route => { if (route.request().method() === 'POST' && !dropped) { dropped++; const r = await route.fetch(); void r; await route.abort('failed') } else await route.continue() })
await p.keyboard.press('Enter'); await p.keyboard.type('reply lost'); await p.waitForTimeout(7000)
log(dropped === 1 && count('reply lost') === 1, 'a lost reply is retried and saved once', `dropped ${dropped}, copies ${count('reply lost')}`)
log(!/couldn.t save/i.test(await status()), 'and the line settles', await status())
console.log(failed ? `${failed} FAILED` : 'all passed'); await b.close(); process.exit(failed ? 1 : 0)
