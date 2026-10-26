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
