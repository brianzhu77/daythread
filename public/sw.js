// Reminders (docs/design/reminders.md): the service worker shows a pushed reminder and opens its page on tap.
// Nothing else: no caching, no fetch handling.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

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
