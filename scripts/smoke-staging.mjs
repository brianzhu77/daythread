// Staging smoke check for a Vercel deploy (a PR preview).
//   VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/smoke-staging.mjs https://<preview-url>
//   node scripts/smoke-staging.mjs --local http://127.0.0.1:<port>   (a local DAYTHREAD_TARGET=vercel build)
// Each screen must be Daythread's own page for that route (not a login wall, an error page or a redirect elsewhere),
// the server function must run in iad1 (next to the database) and assets must be immutable. Only --local skips the two
// checks that need Vercel's headers. Negative cases: tests/smoke-staging.test.ts.
const args = process.argv.slice(2)
const local = args.includes('--local')
const base = args.find(a => !a.startsWith('--'))?.replace(/\/$/, '')
if (!base) { console.error('usage: node scripts/smoke-staging.mjs [--local] <deploy url>'); process.exit(2) }
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {}
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const get = path => fetch(base + path, { headers, redirect: 'manual' })

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
// A marker only the matched route renders: the route's own preload entry, or its nav link marked as the current page.
const screens = [
  { path: `/day/${today}`, marker: '"/day/$date":' },
  { path: '/pages', marker: 'aria-current="page" href="/pages"' },
  { path: '/tasks?view=today', marker: 'aria-current="page" href="/tasks"' },
]
let sawFunction = false, assetPath
for (const { path, marker } of screens) {
  const r = await get(path)
  const html = r.status === 200 ? await r.text() : ''
  const shell = html.includes('<title>Daythread</title>') && html.includes('class="app-main"')
  log(r.status === 200 && shell && html.includes(marker), `${path} is Daythread's ${path.split(/[/?]/)[1]} screen`,
    r.status !== 200 ? `status ${r.status}${r.headers.get('location') ? ` → ${r.headers.get('location')}` : ''}` : !shell ? 'not the Daythread shell' : html.includes(marker) ? '' : 'route marker missing')
  assetPath ??= html.match(/\/assets\/[^"']+\.js/)?.[0]
  // x-vercel-id is "<edge>::<function region>::<request id>" for a function response, "<edge>::<request id>" otherwise.
  const segments = (r.headers.get('x-vercel-id') ?? '').split('::')
  if (local) continue
  if (segments.length >= 3) { sawFunction = true; log(segments[1] === 'iad1', `${path} ran its function in iad1`, `function region ${segments[1]}`) }
  else log(false, `${path} has a function region`, segments[0] ? `x-vercel-id ${segments.join('::')}` : 'no x-vercel-id')
}
if (!local) {
  log(sawFunction, 'at least one screen was rendered by a function')
  const a = assetPath ? await get(assetPath) : null
  log(Boolean(a?.ok) && /immutable/.test(a?.headers.get('cache-control') ?? ''), 'assets are served as immutable', assetPath ?? 'no asset found')
} else console.log('skip Vercel-only checks (--local)')
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
