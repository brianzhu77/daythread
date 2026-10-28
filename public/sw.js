// Rollback for the Home Screen app's offline worker (#24, #27; Lead, Bumblebee, Ratchet #222). Deployed in place of the
// caching worker, it removes itself: the browser checks /sw.js on every navigation, finds this one, and installs it.
// It takes over the open windows, deletes our caches, unregisters, and reloads each window once from the server, so
// an ordinary open with a connection is all it takes. No fetch handler: every request already goes to the network.
// Offline, the old worker keeps serving its copy until the next open with a connection.
// Reminders: unregistering drops this browser's push subscription; reminders were never on in production.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim()
    for (const key of await caches.keys()) if (key.startsWith('daythread-')) await caches.delete(key)
    await self.registration.unregister()
    // The editor keeps unsaved typing as a draft on pagehide (B35/B40), so the reload doesn't lose a line.
    for (const client of await self.clients.matchAll({ type: 'window' })) await client.navigate(client.url).catch(() => undefined)
  })())
})
