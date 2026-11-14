# Place step 2, the Map view: implementation contract

- Author: Roadbuster (Engineering) · 2026-11-14 · status: **approved by the Lead with inline 1280 and two additions
  (9f694596); Ratchet's boundary read pending.**
- From D15 G8-9 to G8-12 (main 4197fb5f), `place.md` §3, Jazz 74fb06f7 / 767879e2 / 754c8cf8, Ratchet's step 2
  boundary (`docs/reviews/place-boundary-ratchet.md`), and the Lead's CSP decision (26f8f7c5). D15 wins where this is
  less precise. Step 3 (inline at 390, G8-13) isn't in this step.

## 1. What the trace showed

This was a real browser trace, taken on 2026-11-14 with MapLibre 6.18.0 in Chromium and WebKit, against OpenFreeMap's
`positron` and `dark` styles. It loaded, zoomed and panned at Vancouver, using a scratch page, not the app.

- **One host:** `tiles.openfreemap.org`, with nothing else. Each kind of request is listed below.

  | What | Path |
  | --- | --- |
  | style | `/styles/positron` or `/styles/dark` |
  | vector TileJSON | `/planet` |
  | vector tiles | `/planet/<build>/{z}/{x}/{y}.pbf` |
  | sprite | `/sprites/ofm_f384/ofm{,@2x}.{json,png}` |
  | glyphs | `/fonts/<Noto Sans Regular, Italic or Bold>/{range}.pbf` |
  | shaded relief, raster | `/natural_earth/ne2sr/{z}/{x}/{y}.png`, low zooms only |

- **No 403 from this Mac.** `curl` and both browsers got 200 for every style, with no User-Agent, a browser
  User-Agent, or a Referer. Ratchet's 403 looks specific to his environment. The style replies with
  `access-control-allow-origin: *`, so nothing on our side needs a Referer or a special User-Agent.
- **Without a guard,** each request carried the page's origin as its Referer, and none carried cookies.
- **With the guard in §3,** there was no Referer and no cookies. A style rewritten to add `example.com` tiles and an
  `example.org` sprite fetched nothing from either host, while the map still drew.
- **MapLibre 6 needs WebGL2.** Headless Chromium has none by default: its checks run with SwiftShader
  (`--enable-unsafe-swiftshader --use-angle=swiftshader`). A browser without WebGL2 gets "Map unavailable" (§5). Every
  iOS version this app supports has WebGL2.

## 2. Storage

- A view gains `layout: 'map'` and `mapBy?: string`, the id of a Place property.
  - `addView`, `updateView` and Layout accept `map`, and clean `mapBy` to a live Place property or drop it.
  - Every other field a view has is kept as it is, so switching to Map and back loses nothing.
- **Where the map was** (his last area) is kept on the device, in `localStorage` under the view and block. It's never
  stored in the workspace, so panning writes nothing and syncs nothing. On a first open with no pins, it's his time
  zone's city:
  - a small table from IANA `zone1970.tab` coordinates, loaded with the map's own chunk
  - a zone not in the table gets a world view
- **Older builds (G8-12):** 4dcde91a doesn't know `map`. Its `cleanLayout` only checks a layout when a view is
  added or its layout is changed. The dashboard was carried through the same way at the old floor.
  - The floor run asserts that an older tab draws a map view as a table, and renames it, edits its filter and reloads.
  - It also writes another page. After all that, `layout: 'map'` and `mapBy` read back byte for byte.
  - It also records what the floor does if asked to change the map view's own layout.

## 3. The boundary, enforced in code (G8-11, Lead 26f8f7c5)

There's no page CSP in this step. That's its own hardening item.

- **Only one origin is allowed:** `https://tiles.openfreemap.org/`, in `mapHost`.
  - MapLibre's `transformRequest` passes a URL on that origin with `credentials: 'omit'` and
    `referrerPolicy: 'no-referrer'`.
  - Any other URL is replaced with an inert local value, so nothing is fetched from it.
- **The style is fetched by us** (`credentials: 'omit'`, `referrer: ''`) and checked before MapLibre sees it.
  - Its `sources`, `sprite` and `glyphs` must all be on that origin. A style that fails gets "Map unavailable".
  - That's a second line of defence for the guard, since the guard also covers the TileJSON's tile URLs.
- **Our own requests carry nothing of his.** Pins, row titles and workspace ids never go into any URL. Pins are a
  GeoJSON source built in memory.
- **The worker comes from our own origin.** MapLibre's worker module is emitted by Vite as a hashed asset, and its URL
  is set with `setWorkerUrl`, with no blob or CDN. The build check confirms its file is in `dist/client`.
- **No offline areas.** The service worker already sends every cross-origin request network-only, so tiles are never
  cached by us. MapLibre's own in-memory tile cache is all there is.
- **Attribution** is MapLibre's compact control, at the bottom right, linked, at both widths. The style's own text is
  kept: OpenFreeMap, © OpenMapTiles, OpenStreetMap.
- **Proof:**
  - A browser check records every request while a Map view loads, zooms and pans. Every one must be to
    `tiles.openfreemap.org`, with no Referer and no cookies.
  - A unit test runs `transformRequest` and the style check against a hostile style, and nothing is fetched.
  - A day page, and a database page with no Map view, make zero requests to that host and load no MapLibre chunk.

## 4. Loading, size and speed (G8-12, R2-7)

- **MapLibre 6.18.0** is a new dependency, pinned exactly.
  - Its main module is 1.1 MB, about 297 KB gzipped. Its worker is 520 KB, about 148 KB gzipped.
  - The Map view is `React.lazy(() => import('./database-map'))`, so the library is in its own chunk, fetched only
    when a Map view is on screen. A test asserts that no other chunk imports it.
- **Pins are capped at 100 at a time**, as D15 says: the first 100 rows with a pin, in the view's own sort and filter.
  "100 of 240 shown" goes under the map, with no button.
- **Clusters** use MapLibre's own GeoJSON clustering, with `clusterRadius` 40, up to zoom 16.
- **Measured and stated:**
  - first draw and a pan with 100 pins, and with clusters, at 1280 and at 390 with 4× CPU slowdown
  - the same with 250 and 500 pins, to say whether the cap can go above 100
  - R2-7's bar on a day page and on a database page without a Map view
  - These are measured once in a real browser. Figures go in the PR, and none of them is promised here.

## 5. Behaviour and states (G8-9, G8-10)

- **Made from** `+ Add view` → Map or `⋯` → Layout → Map.
  - It asks which Place property, and "Map by" changes it later.
  - With no Place property, it offers "+ New Place property", which makes one and sets `mapBy`.
- **Look** (Jazz G8-9, 767879e2):
  - `positron` in light and `dark` in dark, switched when the system scheme changes.
  - **Pins:** pins and clusters are our own layers, so neither style decides them.
    - A pin is a 12 px Ink dot with a 2 px Paper ring.
    - The selected pin is 16 px, with an Ink ring outside.
    - "You are here" is a hollow 14 px Ink ring, shown only after his tap.
  - **Clusters:** Ink circles of 28, 32 or 36 px by count, with the count in Paper.
  - There's no blue anywhere.
- **Loading** (Jazz 754c8cf8):
  - The map's frame draws at once, at full size, in the style's background colour: #F2F3F0 for light, #0C0C0C for
    dark. Nothing moves when the map arrives.
  - The line under it ("100 of 240 shown", "No place · 3 ›") draws at once, from the rows.
  - There's no spinner and no words.
- **Map unavailable** means the frame, in Paper-fill, at the same height, with "Map unavailable · Retry".
  - It shows when the map hasn't drawn after 10 s, the chunk or style fails, or the style fails the host check. No
    WebGL2 has its own state, below.
  - Retry is only on his tap. There's no repeated request: MapLibre doesn't retry a failed tile by itself, and we never
    reload the style on our own.
  - The rows stay listed below.
- **Clusters and cards:**
  - A tap on a cluster zooms to fit its pins.
  - At the deepest zoom, rows at one place open a card listing their titles.
  - **The card:** a tap on a pin shows its card, 280 px, floating above the pin at 1280, and full width above the tab
    bar at 390. The pin stays in view. The card shows the row's title and its shown properties.
  - A tap on the card opens the row. Esc, or a tap on the map, closes it.
- **"No place · 3 ›"** opens those rows in place, as Calendar's "No date" does.
- **Counts:** every count follows the view's filter. "100 of 240" counts rows with a pin, and "No place" counts rows
  without one, so the two add up to the filtered rows.
- **Its Place property deleted:** "Choose a Place property", with Undo restoring it, as the delete's own Undo does.
- **Keys** (R1-26):
  - Once the map has focus, arrow keys pan and `+`/`-` zoom, through MapLibre's keyboard handler.
  - The map's container stops cut, copy, paste and letter keys, so they never reach the page editor.
- **Inline at 1280** (Bumblebee 480a54f2): a Map view in a page's block, on an ordinary page or a day page, draws inline
  at a fixed 400 px tall, with the same frame, states and card. The map's chunk loads only once the block is near the
  screen (the dashboard's `Lazy` rule, 300 px margin). A day page holding one is measured against R2-7's bar. The
  height handle stays with step 3.
- **390:** full page only, as D15 says. A block showing a Map view inline at 390 shows "Open the map ›" until step 3.

- **At most one live map per page or dashboard** (Lead 9f694596): each live map holds a WebGL context, and browsers
  cap those, Safari sooner. Any other Map block or widget on the same page shows its frame with its count line and
  a Secondary "Show map" button in its middle, with no explanation (Jazz c659b8df); a tap moves the live map there, and the previous one returns to its frame. Check: a
  dashboard with three Map widgets has one WebGL context, MapLibre loaded once, and no page errors.
- **No WebGL2** isn't retryable: "Map isn't available in this browser", with no Retry (Lead 9f694596). The other
  unavailable cases keep "Map unavailable · Retry".

## 6. Not in this step

- inline at 390 and its gestures (G8-13, step 3)
- a page-wide CSP (its own item, per the Lead)
- offline map areas
- routing
- distance sort
- clusters at sizes other than Jazz's three

## 7. Release note

The Lead writes it. It names what each outside service sees:
- **OpenFreeMap:** his browser's address and the areas he views.
- **Photon:** what he types, through our server.
- **Apple Maps and OpenStreetMap:** only when he taps a place.
