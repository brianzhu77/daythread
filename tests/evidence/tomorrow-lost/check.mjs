// Brian, Oct 29 (task #227): to-dos typed under Tomorrow the evening before weren't anywhere the next morning.
// Fake clock in Vancouver, a throwaway SQLite store with sign-in off. Never point it at production: it writes.
//   saved:  on Oct 27 a control line goes to Oct 28 (left open); on Oct 28 two lines go under Tomorrow and save.
//           Oct 29: the two are to-dos on Oct 29's page; the card offers only the control, by design.
//   unsent: a line typed with no Return, then a reload: it must still be there.
//   failed: the same two lines while saves fail ("Not added · Retry"), then Oct 29 with the connection back.
//           Today, the card, the page and the Tomorrow block are checked for them, and the device's store.
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/x/ws.sqlite npx vite --port 3127
//   node tests/evidence/tomorrow-lost/check.mjs http://127.0.0.1:3127
import { chromium, webkit } from '@playwright/test'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error('usage: check.mjs http://127.0.0.1:<port> (local only: it writes)'); process.exit(2) }
const evening = day => new Date(`2026-10-${day}T21:00:00-07:00`), morning = day => new Date(`2026-10-${day}T09:00:00-07:00`)
let failed = 0
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }

async function openToday(page, at) {
  await page.clock.setSystemTime(at)
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await page.locator('.tomorrow').waitFor({ timeout: 30000 })
}
async function typeTomorrow(page, title) {
  const input = page.getByRole('textbox', { name: 'Add a to-do for tomorrow' })
  await input.fill(title)
  await input.press('Enter')
}
const pageText = page => page.locator('.continuous-editor').first().innerText()
const cardText = page => page.locator('.start-the-day').innerText().catch(() => '')
const blockText = page => page.locator('.tomorrow').innerText()

for (const [engine, width] of [[chromium, 1280], [webkit, 390]]) {
  const browser = await engine.launch()
  const tag = `${width} ${engine.name()}`, stamp = Date.now().toString(36)
  const control = `Control ${stamp} left open`, lines = [`Saved line A ${stamp}`, `Saved line B 买狗窝 ${stamp}`]
  const lost = [`Unsaved line C ${stamp}`, `Unsaved line D 买狗窝 ${stamp}`]
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Vancouver' })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.clock.install({ time: evening(27) })

  // Saved: the path that works.
  await openToday(page, evening(27))
  await typeTomorrow(page, control)
  await page.locator('.tomorrow-row', { hasText: control }).waitFor({ timeout: 15000 })
  await openToday(page, evening(28))
  for (const l of lines) await typeTomorrow(page, l)
  for (const l of lines) await page.locator('.tomorrow-row', { hasText: l }).waitFor({ timeout: 15000 })
  await openToday(page, morning(29))
  const page29 = await pageText(page), card29 = await cardText(page)
  check(`${tag} saved: both lines are to-dos on Oct 29's page`, lines.every(l => page29.includes(l)), page29.slice(0, 200).replace(/\n/g, ' / '))
  check(`${tag} saved: the card offers the line left open on Oct 28`, card29.includes(control), card29.replace(/\n/g, ' / ') || '(no card)')
  check(`${tag} saved: the card doesn't offer the Tomorrow lines (they're already today's)`, !lines.some(l => card29.includes(l)))

  // Failed: the same, while saves fail on Oct 29 evening (for Oct 30).
  await openToday(page, evening(29))
  await page.route('**/_serverFn/**', route => (route.request().method() === 'POST' ? route.abort() : route.continue()))
  for (const l of lost) await typeTomorrow(page, l)
  await page.locator('.tomorrow-pending', { hasText: lost[1] }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const evening29 = await blockText(page)
  check(`${tag} failed: on the evening the block shows the lines as not added`, lost.every(l => evening29.includes(l)) && /Not added/.test(evening29), evening29.replace(/\n/g, ' / '))
  await page.unroute('**/_serverFn/**')
  await openToday(page, morning(30))
  const page30 = await pageText(page), card30 = await cardText(page), block30 = await blockText(page)
  const stored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('daythread.review-lines.')).map(k => [k, JSON.parse(localStorage.getItem(k)).map(l => l.title)])))
  check(`${tag} failed: next morning the lines are on Oct 30's page`, lost.every(l => page30.includes(l)), 'not on the page')
  check(`${tag} failed: next morning the card offers them`, lost.every(l => card30.includes(l)), card30.replace(/\n/g, ' / ') || '(no card)')
  check(`${tag} failed: next morning the Tomorrow block still shows them`, lost.every(l => block30.includes(l)), block30.replace(/\n/g, ' / '))
  console.log(`     ${tag} device store next morning: ${JSON.stringify(stored)}`)

  // Unsent: typed but Return never pressed (or a pinyin candidate confirmed and nothing more), then the app closes.
  const unsent = `Typed no Return ${stamp}`
  await page.getByRole('textbox', { name: 'Add a to-do for tomorrow' }).fill(unsent)
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await openToday(page, morning(30))
  const input30 = await page.getByRole('textbox', { name: 'Add a to-do for tomorrow' }).inputValue(), block30b = await blockText(page)
  check(`${tag} unsent: after a reload the typed line is still in the block`, input30.includes(unsent) || block30b.includes(unsent), `input "${input30}"`)
  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  await context.close()
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
