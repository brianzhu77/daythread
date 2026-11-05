// Rollback for the Home Screen app's offline worker (#24, #27; Lead, Bumblebee, Ratchet #222): a tombstone at the same
// /sw.js. The browser checks /sw.js on every navigation, so an ordinary open with a connection installs this one in
// place of the caching worker. It stays installed, so a page still running #27's code that registers again gets this
// same file, and nothing that caches can come back. It has no fetch handler: every request goes to the network. It
// deletes our caches when it takes over, again shortly after (an old worker's last write can land late), and on every
// message, which covers #27's warm-up requests. Each open page is asked to reload itself once everything typed is
// saved; a tab whose typing can't save yet stays as it is (Lead: never reload over typing). Kept minimal on purpose,
// but with the push handlers below (B60): a rollback mustn't silently end the reminders he turned on.
const ours = key => key.startsWith('daythread-')
const sweep = async () => { for (const key of await caches.keys()) if (ours(key)) await caches.delete(key) }
const later = ms => new Promise(resolve => setTimeout(resolve, ms))

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim()
    await sweep()
    // Each page reloads itself once everything typed is saved (#27's `reload-when-saved`): a forced navigation would
    // raise the editor's leave-page prompt over unsaved typing.
    for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'reload-when-saved' })
    for (const ms of [2000, 10000, 30000]) { await later(ms); await sweep() }
  })())
})
self.addEventListener('message', event => event.waitUntil(sweep()))

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
