import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The smoke check against fixture servers: it must fail on a login wall, a redirect, an error page, a function in the
// wrong region or missing Vercel headers, and pass only on Daythread's own screens served from iad1 (Ratchet #103).
const script = fileURLToPath(new URL('../scripts/smoke-staging.mjs', import.meta.url))
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const shell = (marker: string) => `<html><head><title>Daythread</title></head><body><main class="app-main"></main>${marker}<script src="/assets/app-1.js"></script></body></html>`
const daythread: Record<string, string> = {
  [`/day/${today}`]: shell('"/day/$date":$R[9]'),
  '/pages': shell('<a aria-current="page" href="/pages">Pages</a>'),
  '/tasks?view=today': shell('<a aria-current="page" href="/tasks">Tasks</a>'),
}
type Fixture = (path: string) => { status?: number; body?: string; headers?: Record<string, string> }
async function smoke(fixture: Fixture, flags: string[] = []): Promise<{ code: number | null; out: string }> {
  const server: Server = createServer((req, res) => {
    const f = fixture(req.url ?? '/')
    res.writeHead(f.status ?? 200, { 'content-type': 'text/html', ...f.headers }); res.end(f.body ?? '')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    // Asynchronous, so the fixture server in this process keeps answering the child.
    return await new Promise(resolve => {
      const child = spawn(process.execPath, [script, ...flags, `http://127.0.0.1:${port}`]); let out = ''
      child.stdout.on('data', d => { out += d }); child.stderr.on('data', d => { out += d })
      child.on('close', code => resolve({ code, out }))
    })
  } finally { server.close() }
}
const asset = { headers: { 'cache-control': 'public, max-age=31536000, immutable' }, body: '' }
const good: Fixture = path => path.startsWith('/assets/') ? asset : { body: daythread[path], headers: { 'x-vercel-id': 'sfo1::iad1::abc-1' } }

test('passes on Daythread screens rendered in iad1 with immutable assets', async () => {
  const r = await smoke(good)
  assert.equal(r.code, 0, r.out)
})
test('fails on a login wall that returns 200 HTML', async () => {
  const r = await smoke(path => path.startsWith('/assets/') ? asset : { body: '<html><head><title>Login – Vercel</title></head><body>Log in</body></html>', headers: { 'x-vercel-id': 'sfo1::iad1::x' } })
  assert.equal(r.code, 1, r.out)
})
test('fails on a redirect to a login page', async () => {
  const r = await smoke(path => path.startsWith('/assets/') ? asset : { status: 307, headers: { location: 'https://vercel.com/login', 'x-vercel-id': 'sfo1::x' } })
  assert.equal(r.code, 1, r.out)
})
test('fails when the function runs outside iad1, even if the edge is iad1', async () => {
  const r = await smoke(path => path.startsWith('/assets/') ? asset : { body: daythread[path], headers: { 'x-vercel-id': 'iad1::pdx1::abc' } })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /function region pdx1/)
})
test('fails without Vercel headers unless --local is given', async () => {
  const bare: Fixture = path => path.startsWith('/assets/') ? asset : { body: daythread[path] }
  assert.equal((await smoke(bare)).code, 1)
  assert.equal((await smoke(bare, ['--local'])).code, 0)
})
test('fails on the right shell without the route marker (another screen or an error boundary)', async () => {
  const r = await smoke(path => path.startsWith('/assets/') ? asset : { body: shell(''), headers: { 'x-vercel-id': 'sfo1::iad1::abc' } })
  assert.equal(r.code, 1, r.out)
})

// Sign-in on, no session (Lead, sign-in deploy check).
const signedOutFixture = (open = false, crossOrigin = 403): Fixture => path => {
  const vercel = { 'x-vercel-id': 'sfo1::iad1::so' }
  if (path.startsWith('/assets/')) return asset
  if (path === '/sign-in' || path === '/sign-up') return { body: `<html><head><title>Daythread</title></head><body><main class="sign-in${path === '/sign-up' ? ' sign-up' : ''}"></main><script src="/assets/app-1.js"></script></body></html>`, headers: vercel }
  if (path.startsWith('/_serverFn/') || path.startsWith('/api/smoke')) return { status: 401, body: '{}', headers: vercel }
  if (path === '/api/auth/send') return { status: crossOrigin, headers: vercel }
  if (open) return { body: daythread[path], headers: vercel }
  return { status: 302, headers: { ...vercel, location: `/sign-in?next=${encodeURIComponent(path)}` } }
}
test('signed-out mode passes when every screen goes to sign-in and the rest is refused', async () => {
  const r = await smoke(signedOutFixture(), ['--signed-out'])
  assert.equal(r.code, 0, r.out)
})
test('signed-out mode fails when the sign-up screen does not open', async () => {
  const r = await smoke(path => path === '/sign-up' ? { status: 302, headers: { location: '/sign-in', 'x-vercel-id': 'sfo1::iad1::so' } } : signedOutFixture()(path), ['--signed-out'])
  assert.notEqual(r.code, 0, r.out)
})
test('signed-out mode fails when a screen opens without a session, or a cross-origin POST goes through', async () => {
  assert.notEqual((await smoke(signedOutFixture(true), ['--signed-out'])).code, 0)
  assert.notEqual((await smoke(signedOutFixture(false, 200), ['--signed-out'])).code, 0)
})
