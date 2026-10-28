// Daythread's service worker (docs/design/pwa.md): the app shell and its assets kept so the Home Screen app opens
// with no connection, and reminders shown when a push arrives. Nothing with a session in it is ever cached.
const VERSION = 'daythread-1'
const SHELL = VERSION + '-shell', ASSETS = VERSION + '-assets'
const OFFLINE_PAGE = '/offline.html'
// The app's own screens: their server-rendered HTML holds no workspace data (the client loads it), so a copy is safe.
const appRoutes = /^\/(|day\/\d{4}-\d{2}-\d{2}|tasks|calendar|pages|tags(\/[^/]+)?|review)$/

/** How a request is served: assets and static files from the cache first; app screens from the network, the copy kept; all else untouched. */
function strategyFor(request) {
  if (request.method !== 'GET') return 'network-only'
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return 'network-only'
  const p = url.pathname
  if (p === '/sw.js') return 'network-only'
  if (p.startsWith('/assets/') || p.startsWith('/splash/') || p === OFFLINE_PAGE || /^\/[\w-]+\.(ico|png|svg|webmanifest)$/.test(p)) return 'cache-first'
  if (request.mode === 'navigate' && appRoutes.test(p)) return 'network-first'
  return 'network-only'
}
self.__daythread = { version: VERSION, strategyFor }

const keepable = response => response && response.ok && !response.redirected && (response.type === 'basic' || response.type === 'default')

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try { const cache = await caches.open(SHELL); await cache.add(OFFLINE_PAGE) } catch { /* the offline page is a nicety */ }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('daythread-') && !key.startsWith(VERSION)) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const strategy = strategyFor(event.request)
  if (strategy === 'network-only') return
  if (strategy === 'cache-first') {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS)
      const hit = await cache.match(event.request)
      if (hit) return hit
      const response = await fetch(event.request)
      if (keepable(response)) cache.put(event.request, response.clone()).catch(() => undefined)
      return response
    })())
    return
  }
  // network-first: the live screen when there is a connection; else this screen's copy, else the offline page. Never
  // another screen's HTML: the server-rendered page is this route's, and hydrating it at another address mismatches.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL)
    try {
      const response = await fetch(event.request)
      if (keepable(response)) cache.put(event.request, response.clone()).catch(() => undefined)
      return response
    } catch {
      const url = new URL(event.request.url)
      return (await cache.match(event.request)) || (await cache.match(url.pathname, { ignoreSearch: true })) || (await cache.match(OFFLINE_PAGE))
        || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
    }
  })())
})

// Warm-up (Ratchet #222): a page that loaded before this worker controlled it (the first open, a new version) kept
// nothing, so going offline right after showed "This screen hasn't been opened". Once the worker controls it, the page
// lists its addresses and the files it loaded (app-shell.tsx); each is fetched again and kept by the same rules as above.
async function warm(pages, assets) {
  const jobs = [], shell = await caches.open(SHELL)
  for (const page of Array.isArray(pages) ? pages.slice(0, 5) : [])
    if (typeof page === 'string' && strategyFor({ url: page, method: 'GET', mode: 'navigate' }) === 'network-first')
      jobs.push((async () => {
        const response = await fetch(page, { credentials: 'same-origin', headers: { accept: 'text/html' } })
        if (keepable(response)) await shell.put(page, response)
      })())
  const cache = await caches.open(ASSETS)
  for (const url of Array.isArray(assets) ? assets.slice(0, 200) : [])
    if (typeof url === 'string' && strategyFor({ url, method: 'GET', mode: 'no-cors' }) === 'cache-first')
      jobs.push((async () => { if (!(await cache.match(url))) await cache.add(url) })())
  await Promise.allSettled(jobs)
}
self.__daythread.warm = warm

self.addEventListener('message', event => {
  const data = event.data
  if (data && data.type === 'warm') event.waitUntil(warm(data.pages, data.assets))
})

// Reminders: show the pushed reminder; open its page on tap.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Daythread', body: event.data ? event.data.text() : '' } }
  const title = data.title || 'Daythread'
  // The key as the tag: the same reminder pushed twice shows once.
  event.waitUntil(self.registration.showNotification(title, { body: data.body || '', tag: data.key || undefined, data: { url: data.url || '/' } }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const open = clients.find(c => 'focus' in c)
    if (open) return (open.navigate ? open.navigate(url) : Promise.resolve()).then(() => open.focus())
    return self.clients.openWindow(url)
  }))
})

// The push service replaced the subscription: tell the server the new one, so reminders keep coming.
self.addEventListener('pushsubscriptionchange', event => {
  const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    .then(sub => fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) }))
    .catch(() => undefined))
})
