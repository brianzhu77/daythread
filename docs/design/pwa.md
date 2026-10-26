# The Home Screen app: offline shell, last copy, splash

Status: built Oct 26. Brian: "can we add PWA support to optimize the iPhone experience?"

## What was already there

The manifest (`standalone`, the icons), `apple-mobile-web-app-capable`, the status-bar style and the safe-area work
(B52), one JS bundle so moving between screens never downloads (B41), drafts kept and retried while offline (B35,
B38, B40), and a service worker for reminders (`/sw.js`, push only). What was missing: opening the app with no
connection gave Safari's error page, and a cold open with a slow connection showed a white screen until the bundle
came.

## What this adds

1. **The shell opens offline.** The service worker keeps the app's HTML and its hashed assets. Assets are served from
   the cache first (they are immutable by name). A navigation to an app screen goes to the network first and the copy
   is kept; with no connection the copy of that screen is served, else a small offline page with Open Today and a
   Retry (never another screen's HTML: a page rendered for one address does not hydrate at another). Nothing with a session in it is ever cached: the sign-in and sign-up screens, `/api/*`, server
   functions and every non-GET pass straight through, and a redirect (signed out) is never kept.
2. **The data opens offline.** After each successful load or save the browser keeps the workspace it holds (IndexedDB,
   one record). When a load fails for lack of network, that copy is adopted and a quiet line says
   "Offline · showing what was last loaded"; the next `online` event or return to the tab loads again and the line
   goes. A load that fails for any other reason (signed out, a server error) never falls back to the copy. Sign-out
   and Delete account drop the copy and the caches. Writes while offline keep today's behaviour: the editor keeps and
   retries drafts; a command fails with Retry.
3. **iOS details.** `apple-mobile-web-app-title`, startup images for current iPhone sizes in light and dark (the mark
   on the page's own colour, so the launch looks like the app, not a poster), `id` and `description` in the manifest.
4. **A hint on iPhone Safari**, in the account row, when the app is not yet on the Home Screen: "Add to Home Screen
   for the full-screen app: Share, then Add to Home Screen". Dismissable; never shown in the installed app.

## Rules

- The worker is versioned; a new version takes over on the next launch and drops the old caches. It never caches
  anything that could carry another person's data: only `/assets/*`, the root static files, and the HTML of app
  routes, whose server-rendered body holds no workspace data (the data is loaded by the client).
- The offline copy belongs to whoever was signed in when it was written. It is written only after a successful
  network load, overwritten by every later one, and removed on sign-out and account deletion. It is read only when
  the network is the reason a load failed.
- No background sync, no offline queue of commands: the editor's draft keeping already covers the case that matters
  (typing), and a queue of domain commands would need conflict rules the model does not have yet.

## Checks

- `tests/sw.test.ts`: the worker's routing decisions (what is cached how, what is never touched) and its version.
- `tests/offline-copy.test.ts`: when the copy is used and when it is not.
- `scripts/offline-smoke.mjs`: a browser run with the connection cut: the app reloads from the cache with the data
  and the offline line, screens open, a never-visited screen gets the offline page, the connection back clears it.

## Not in this round

Background sync of commands made offline; a per-page "last changed" view; caching of the emoji menu's separate
download (the one thing that still cannot open offline, B41's known limit).
