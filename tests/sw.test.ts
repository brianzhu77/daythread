import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// The service worker's routing (docs/design/pwa.md): what is cached how, and what is never touched. The worker is a
// plain file; it is run here with a stand-in `self` and asked through the decision function it exposes.
function load() {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  const listeners: Record<string, unknown[]> = {}
  const self = { addEventListener: (type: string, fn: unknown) => { (listeners[type] ??= []).push(fn) }, registration: {}, clients: {}, location: { origin: 'https://daythread.test' }, skipWaiting() {} }
  const context = vm.createContext({ self, fetch: () => Promise.reject(new Error('no network')), URL, Response, caches: undefined, console })
  vm.runInContext(source, context)
  const dt = (self as unknown as { __daythread: { version: string; strategyFor: (req: { url: string; method: string; mode: string }) => string } }).__daythread
  return { dt, listeners }
}
const req = (path: string, mode = 'cors', method = 'GET') => ({ url: 'https://daythread.test' + path, method, mode })

test('sw: assets cache-first, app screens network-first with the copy kept, everything with a session in it untouched', () => {
  const { dt, listeners } = load()
  assert.match(dt.version, /^daythread-\d+$/, 'a versioned cache name')
  for (const type of ['install', 'activate', 'fetch', 'push', 'notificationclick', 'pushsubscriptionchange']) assert.ok(listeners[type]?.length, `listens to ${type}`)
  assert.equal(dt.strategyFor(req('/assets/router-BIZ_KC1K.js')), 'cache-first')
  assert.equal(dt.strategyFor(req('/assets/styles-abc.css')), 'cache-first')
  for (const p of ['/favicon.svg', '/icon-192.png', '/apple-touch-icon.png', '/manifest.webmanifest', '/splash/iphone-1179x2556-dark.png']) assert.equal(dt.strategyFor(req(p)), 'cache-first', p)
  for (const p of ['/', '/day/2026-10-27', '/tasks', '/tasks?view=upcoming', '/calendar', '/pages?page=x', '/tags', '/tags/rewind', '/review']) assert.equal(dt.strategyFor(req(p, 'navigate')), 'network-first', p)
  for (const p of ['/sign-in', '/sign-in?next=%2F', '/sign-up']) assert.equal(dt.strategyFor(req(p, 'navigate')), 'network-only', p)
  for (const p of ['/api/auth/sign-in', '/api/push/key', '/api/export', '/_serverFn/abc', '/_server/x']) assert.equal(dt.strategyFor(req(p)), 'network-only', p)
  assert.equal(dt.strategyFor(req('/api/push/subscribe', 'cors', 'POST')), 'network-only')
  assert.equal(dt.strategyFor(req('/', 'navigate', 'POST')), 'network-only', 'a POST navigation is never served from cache')
  assert.equal(dt.strategyFor(req('/sw.js')), 'network-only', 'the worker itself is never cached by the worker')
  assert.equal(dt.strategyFor({ url: 'https://fonts.example/x.css', method: 'GET', mode: 'cors' }), 'network-only', 'another origin')
})

// Ratchet #222: the first open loaded its screen and files before the worker controlled the page, so nothing was kept.
test('sw warm-up: the page it is told about and its files are kept by the same rules; nothing with a session in it', async () => {
  const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  const stored = new Map<string, Map<string, unknown>>(), fetched: string[] = []
  const open = async (name: string) => {
    const m = stored.get(name) ?? new Map<string, unknown>(); stored.set(name, m)
    const key = (r: string) => new URL(r, 'https://daythread.test').href
    return {
      match: async (r: string) => m.get(key(r)),
      put: async (r: string, v: unknown) => { m.set(key(r), v) },
      add: async (r: string) => { fetched.push(new URL(key(r)).pathname); m.set(key(r), 'asset') },
    }
  }
  const respond = (path: string) => path === '/day/2026-10-27'
    ? { ok: true, redirected: true, type: 'basic' } // signed out: the server sends sign-in
    : { ok: true, redirected: false, type: 'basic' }
  const self = { addEventListener() {}, registration: {}, clients: {}, location: { origin: 'https://daythread.test' }, skipWaiting() {} }
  const context = vm.createContext({ self, URL, Response, console, caches: { open }, fetch: async (url: string) => { const p = new URL(url, 'https://daythread.test').pathname; fetched.push(p); return respond(p) } })
  vm.runInContext(source, context)
  const warm = (self as unknown as { __daythread: { warm: (pages: unknown, assets: unknown) => Promise<void> } }).__daythread.warm
  const at = (p: string) => 'https://daythread.test' + p
  await warm([at('/'), at('/sign-in'), at('/day/2026-10-27'), 'https://other.example/'], [at('/assets/main-abc.js'), at('/assets/styles-abc.css'), at('/_serverFn/load'), at('/api/push/key'), 'https://fonts.example/x.css'])
  const shell = [...(stored.get('daythread-1-shell')?.keys() ?? [])].map(u => new URL(u).pathname)
  const assets = [...(stored.get('daythread-1-assets')?.keys() ?? [])].map(u => new URL(u).pathname).sort()
  assert.deepEqual(shell, ['/'], 'the app screen is kept; sign-in, a redirect (signed out) and another origin are not')
  assert.deepEqual(assets, ['/assets/main-abc.js', '/assets/styles-abc.css'], 'only cache-first files')
  assert.ok(!fetched.includes('/sign-in') && !fetched.includes('/_serverFn/load') && !fetched.includes('/api/push/key'), 'never even fetched')
  fetched.length = 0
  await warm([], [at('/assets/main-abc.js')])
  assert.deepEqual(fetched, [], 'a file already kept is not fetched again')
  await warm('not a list', 42)
})
