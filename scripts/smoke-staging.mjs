// Staging smoke check for a Vercel deploy (a PR preview).
//   VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/smoke-staging.mjs https://<preview-url>
// Checks the app shell renders on each screen, the function runs in pdx1 (next to the database) and assets are cached
// as immutable. Off Vercel (a local `DAYTHREAD_TARGET=vercel` build) the two Vercel-only checks are skipped.
const base = process.argv[2]?.replace(/\/$/, '')
if (!base) { console.error('usage: node scripts/smoke-staging.mjs <deploy url>'); process.exit(2) }
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {}
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const get = path => fetch(base + path, { headers, redirect: 'follow' })

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
for (const path of ['/', `/day/${today}`, '/pages', '/tasks']) {
  const r = await get(path)
  const html = await r.text()
  log(r.status === 200 && html.includes('</html>'), `${path} renders`, `status ${r.status}`)
  // x-vercel-id is "<edge>::<function region>::<id>"; static responses carry only the edge.
  const id = r.headers.get('x-vercel-id') ?? ''
  if (path === '/' && !id) { console.log('skip Vercel-only checks (no x-vercel-id: not served by Vercel)'); continue }
  if (path === '/') log(id.includes('pdx1'), 'the function runs in pdx1', id)
  if (path === '/') {
    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0]
    const a = asset ? await get(asset) : null
    log(Boolean(a?.ok) && /immutable/.test(a?.headers.get('cache-control') ?? ''), 'assets are served as immutable', asset ?? 'no asset found')
  }
}
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
