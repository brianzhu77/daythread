// Rollback for the Home Screen app's offline worker (#24, #27; Lead, Bumblebee, Ratchet #222): a tombstone at the same
// /sw.js. The browser checks /sw.js on every navigation, so an ordinary open with a connection installs this one in
// place of the caching worker. It stays installed, so a page still running #27's code that registers again gets this
// same file, and nothing that caches can come back. It has no fetch handler: every request goes to the network. It
// deletes our caches when it takes over, again shortly after (an old worker's last write can land late), and on every
// message, which covers #27's warm-up requests. Each open page is asked to reload itself once everything typed is
// saved; a tab whose typing can't save yet stays as it is (Lead: never reload over typing). Kept minimal on purpose:
// no push handlers (reminders are off in production; adding them back is on B60 for when they go on).
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
