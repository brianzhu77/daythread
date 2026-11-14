# Place step 1: implementation contract

- Author: Roadbuster (Engineering) · 2026-11-14 · status: **approved by the Lead with additions (cb4e0d08), taken in below;
  Ratchet's full read pending.** Changes since 3cd42c30: the shared 429 pause (Ratchet eecf6ded), Jazz's Enter rule
  (f705a3a0, Bumblebee 8a29de95), the older-tab type assertion (Bumblebee ccef53c3), one threshold function, the pick
  notice, and a live-Worker search before release (Lead cb4e0d08, Jazz d5c18c44).
- From D15 G8-1 to G8-8 (main a57eed7e), `place.md`, Jazz 74fb06f7 / 2b3eb494 / 5e17371d, Lead ad34ae2c / b41107d1, and
  Ratchet's boundary review (`review/ratchet-place` 85d18064). D15 wins where this is less precise. This page fixes the
  numbers, scopes and failure rules the build follows, as Ratchet's handoff asks. Step 1 is the Place property only: no
  map, no MapLibre, no OpenFreeMap.

## 1. The stored value (G8-1)

A new property type, `place`, joins `propertyTypes`. A row stores its value under the property id, as every type does:

```ts
interface PlaceValue {
  name: string // 1..10,000 characters, Text's own limit; required
  address?: string // up to 300 characters
  lat?: number // -90..90, finite; only with lon
  lon?: number // -180..180, finite; only with lat
  ref?: string // the provider's id, e.g. "osm:N123456"; up to 64 characters; metadata only
}
```

- **His words are never cut** (Ratchet c504bd98 and 086c93e0, Bumblebee fba653ee). A name holds as much as a Text
  value can, 10,000 characters, so Text to Place reads every value whole, and the keep row saves whatever the field
  holds. Only the search is shorter: up to 256 characters. Past that there's no Search row and no suggestions, and
  nothing is sent, while the keep row stays (G8-1, main 29b381ab). A cut-off part isn't searched, since it might name
  another place.
- **Name only is a valid value** (a kept "golden dumpling", or Text changed to Place). A pin is `lat` and `lon` together;
  one without the other is refused. Coordinates are stored as Photon gives them, rounded to 7 decimals.
- `storedValue` validates and trims. Anything else (an empty name, a bad pair, an over-long string, extra fields) is
  refused with a plain error and nothing is written. Strings are stored and shown as text, never as HTML.
- **No URL from the provider is stored.** Links are built at draw time from two templates, with encoded values:
  - at 390 and in the Home Screen app: `https://maps.apple.com/?ll={lat},{lon}&q={name}`
  - at 1280: `https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=17/{lat}/{lon}`
- **Changing type, as every type does here, leaves the stored value alone and converts on read** (`readValue`). So:
  - Text → Place reads each string as a name with no pin. The notice says how many: "12 kept as names without a place".
  - Place → Text reads "name, address".
  - Changing back shows the stored value again.
  - Showing, exporting and converting call no provider.
- **Filter** has Text's operators (contains, does not contain, is empty, is not empty) over the name and the address. **Sort** is
  alphabetical by name. There's no distance sort. Place isn't offered for Group, Chart, Rollup or a Button's "set value"
  in step 1. A formula's `prop()` reads the name.
- **Copy and export.** A value pastes into another type as its text, "name, address". CSV export writes one cell,
  `name, address (lat, lon)`, with the parts it has. CSV import into a Place column keeps the words as a name with no pin.

## 2. The Worker's search (G8-5)

One server function, `searchPlaces`, POST, behind the existing gate (`authGate`). The gate runs before anything below,
so signed-out, bad-cookie and cross-site requests are refused before any cache lookup, limit count or outbound call.
That holds for every route. Locally, with sign-in off, the gate's this-machine-only rule applies.

- **Input**, validated with zod:
  - `q`: the trimmed query, 1..256 characters. It's NFC-normalised, and control characters are refused.
  - `explicit`: true for a Search row or Enter.
  - The server checks the 2/3-character rule again for automatic searches. CJK is any character in the Han, Hiragana,
    Katakana or Hangul scripts. A short query that isn't `explicit` is refused, so a client bug can't spend the quota.
  - **One threshold function for both sides** (Lead cb4e0d08): `searchQuery`, `searchFrom` and `searchesAsTyped` live
    in `src/domain/place.ts`. The editor and the server function both import them, and a unit test covers 西湖 (2),
    京 (no), `ab` (no), `abc` (yes) and a mixed query such as `a西` (2, CJK present).
- **Outbound:**
  - One GET to the fixed `https://photon.komoot.io/api` with `q` and `limit=5` only. There's no `lang`, so names come
    in the place's own language, which is what Bumblebee's 20-place test measured. There's no area or location bias.
  - Only a fixed `User-Agent: Daythread place search (a personal notes app; one person typing)` and `Accept: application/json` go
    out. No cookies, authorization, IP or forwarded headers, account, workspace or page ids, and no Referer.
  - `redirect: 'error'`, so a redirect is a failure, not a new host.
  - An `AbortController` timeout of 5 s.
  - The reply is read up to 256 KB. Past that it counts as oversized, which is a failure.
- **The reply** is parsed and validated feature by feature:
  - A feature needs a point geometry with finite coordinates in range.
  - `name` falls back to "housenumber street", then to the street.
  - `address` is built from housenumber and street, then city, state and country, joined with ", ", and capped.
  - `ref` is `osm:{N|W|R}{osm_id}`.
  - Invalid features are dropped, and at most 5 are kept.
  - The result is `{ status: 'ok', places: PlaceValue[] }`. A reply that's valid but holds nothing is `ok` with no
    places, which the client shows as **No places for "…"**.
- **Other results:**
  - `{ status: 'limit' }` when a limit refuses the search, or Photon answers 429.
  - `{ status: 'unavailable' }` for a timeout, network error, non-2xx answer, malformed JSON, an oversized reply or
    a redirect.
  - The client shows both as "Search unavailable · Retry". The keep row works either way.
- **The limiter fails closed.** If its database can't be reached or errors, the search is `unavailable` and nothing
  goes to Photon.
- **Logs** carry only an event name, the status, the elapsed time and the number of places. No query, coordinates,
  upstream URL or account id is logged, in errors either.

### Limits: shared across Worker instances

- **Values:**
  - 30 a minute and 500 a day per account
  - 60 a minute across the deployment
  - in one `placeLimits` constant, with the cache's TTL and size beside them
- **Where they're held.** A Postgres table in the workspace's schema, with RLS on and no policies, made on first use
  the way `SessionStore` makes its tables (catalog check, then an advisory-locked create):

  ```sql
  create table place_searches (user_id text not null, at timestamptz not null);
  create index place_searches_at on place_searches (at);
  create index place_searches_user_at on place_searches (user_id, at);
  ```

  It holds only who searched and when. There's no query, result or location in it.
- **One check and count is one transaction.** It takes `pg_advisory_xact_lock(hashtext('daythread.place-search'))`,
  so concurrent requests on any instance can't all read the old count. It counts the account's rows in the last
  minute and the last day, and everyone's rows in the last minute. If all three are under their limits, it inserts the
  row. It also deletes rows older than a day.
  - This serialises searches across the deployment. At a ceiling of 60 a minute that costs nothing measurable.
- **What counts.** Only a search that goes out counts, and it's counted before it goes, so a failed upstream call still
  counts. A cache hit and a refused search don't count.
- **Provider 429:** `Retry-After` is honoured, at least 60 s and at most 1 hour. Until then every search returns
  `limit` without going out. Overlapping 429s extend it with `max(existing, new)`, so a shorter one can't reopen it
  early. **The pause is deployment-wide** (Ratchet eecf6ded), so no instance keeps calling after
  Photon has asked us to stop. It's held in `place_search_pause (id int primary key check (id = 1), until timestamptz)`
  in the same schema, also with RLS on, and read inside the same locked transaction as the counts.
- **Local and test runs** (SQLite storage, sign-in off) use an in-process limiter with the same numbers and the same
  interface. Tests run both: the Postgres one on PGlite and on real Postgres. Two accounts and two limiter instances on
  one database show the shared counts.

### Cache

- **Five minutes, per account, query and language.** The key is a SHA-256 of `user_id`, NUL, the normalised query,
  NUL and the language ("default"), so no query text is a key.
- **It's held in the Worker instance's memory only:** an LRU of at most 200 entries and 64 KB of results each, and
  never written to the database or the Cache API. It ends with the instance, so it can't become search history.
- **The cost:** a hit only happens on the instance that made the entry. That's enough for its purpose, the same
  words searched again while typing and backspacing in one session. A shared cache would mean storing his searches
  server-side, which is what the boundary rules out.
- **What's cached:** `ok` results only, including an empty one. `limit` and `unavailable` are never cached.

## 3. The editor (G8-2, G8-3, G8-6)

- **Where it opens:**
  - a popover at 1280 and a sheet at 390, with the field first and focused
  - opening one sends nothing, even with words already in the field
- **Rows, in order:**
  - **Search "…"**, while the field holds words that haven't been searched. It shows below the length threshold, and
    on opening with words already there.
  - "Use current location", with `Saved as "…"` under it
  - up to 5 suggestions, each a name with its address in Meta Ink-soft
  - the result line, when there is one:
    - **No places for "…"** for no match
    - or "Search unavailable · Retry" for a failure or the limit
  - **Keep "…" without a place**, while there are words
  - the foot: "Search by Photon · © OpenStreetMap"
- **Enter acts on what's highlighted, and something always is** (Jazz f705a3a0; Bumblebee withdrew the
  alternative, 8a29de95):
  - While the field holds words that haven't been searched, or a search is running, the Search row is highlighted,
    so Enter searches. It never pins a place.
  - When suggestions show, the first one is highlighted at once, in Paper-fill as a menu row is, and the arrows move
    the highlight, the keep row included.
  - Enter acts only on rows already on screen. A reply that lands after Enter never picks anything.
  - Enter never keeps his words silently: the keep row is only taken when it's highlighted.
- **A pick shows in the cell at once** under the place's own name, with an Undo notice naming the place and its city:
  "Golden Dumpling, Richmond · Undo" (Lead cb4e0d08, Jazz d5c18c44).
  - The city comes from the suggestion's reply, not from storage, falling back to the region and then the country.
  - If it's too long, the name is cut with "…" first, and the city stays.
- **When it searches as he types:**
  - It waits 300 ms after the last change, and needs 2 characters if the query has any CJK, 3 otherwise.
  - It sends nothing while `compositionstart` is open. It searches 300 ms after `compositionend`.
- **Superseded and late replies.** Each search, and each location request, gets a sequence number. Searches also get
  their own `AbortController`. A newer
  keystroke, a pick, a keep, a close or the cell unmounting aborts it. A reply whose number isn't the latest, or that
  arrives after any of those, is dropped without touching the field, the list or any value. So a late reply can't
  overwrite his typing, a picked value, another cell or a closed sheet. Location uses the same token. A second tap
  supersedes the first. Checks cover a late location success after each exit (close, unmount, an edit, a pick, a
  keep) and two overlapping taps (Ratchet c504bd98).
- **Retry** runs only on his tap, once per tap, with the same words. There's no automatic retry or loop.
- **The keep row** stores `{ name: words }` and is always present while there are words, whatever the search state.
- **Offline** (`navigator.onLine === false`, or a fetch that fails) is `unavailable`. Stored values read and open
  without any provider.

## 4. Use current location (G8-4)

- **Only that row's tap** calls `navigator.geolocation.getCurrentPosition`, once, with a 10 s timeout,
  `maximumAge: 60 000` and `enableHighAccuracy: false`. There's no `watchPosition`, and nothing on open or load.
- **The value:**
  - `{ name, lat, lon }`, rounded to 6 decimals
  - `name` is the field's words, or `Location on {date}` when the field is empty, with his local date in the app's
    short format ("Nov 14")
  - the row shows that `Saved as "…"` before the tap
  - there's no address and no `ref`
  - **No lookup: the coordinates never leave the browser except in the saved value.** They're never sent to the
    Worker's search or to Photon.
- **While it waits** (Jazz 9e67764b, Bumblebee b84193f7 and 3443eec6): the row's second line reads **Finding your
  location…** in place of `Saved as "…"`. The field and the suggestions keep working meanwhile.
  - When the position arrives, the value saves and the popover or sheet closes, as any pick does.
  - Picking a suggestion or keeping the words ends the request.
  - **Closing first saves nothing.** A position that arrives after a close, a pick or a keep is dropped, by the same
    sequence and liveness check as a late search reply (§3).
- **When it fails.** A denial or timeout shows "Location is off" in that row's second line, for the rest of that
  popover or sheet. Search and keep still work.

## 5. Network and older builds (G8-7, G8-8)

- **Network.**
  - An ordinary day page, and a database page with a Place column and no search open, make zero requests to Photon,
    OpenFreeMap or `searchPlaces`.
  - No map code exists in step 1, and the browser bundle holds no Photon host. A browser check records every request
    while it loads both pages and while it opens and closes a cell's editor without typing.
  - The proof of what goes out is a server-side trace of one synthetic search, made against a local mock upstream.
    Mocked failures cover timeout, 500, 429, a redirect, malformed JSON and an oversized reply.
- **Older builds** (the floor, 4dcde91a since Lead a5befc0d) don't know `place`. Its `cleanProperty` only runs on add and update, so a Place
  property it reads is carried as it is, as Button's was (G3-9).
  - **Checked as the dashboard's floor run was.** A store made by this build is edited by the floor's own code with:
    - an unrelated page write
    - an edit to another property of the same row
    - a view edit
    - a type round trip on another property
    - a reload

    Then this build reads every Place value back byte for byte.
  - There's also a browser half on the floor's server, checking that the page draws with no page errors.
  - **Asserted, not just recorded** (Bumblebee ccef53c3): the floor's tab turns the Place property into Text and saves
    a row edit. This build then turns it back to Place, and every value reads back byte for byte. That works because
    a type change rewrites no values. If it fails, it's the one Place data-loss case, and it's known before release.

## 6. Release checks beyond D15's rows

- **One real search from the deployed Worker before Brian is told** (Lead cb4e0d08). Photon sees the Worker's
  requests coming from Cloudflare's shared addresses, which no local run can show. The check is one signed-in search
  each for "Stanley Park" and 西湖 on the live Worker, recording the status and the time taken. If either comes back
  `limit` or `unavailable`, the release note says so and doesn't promise search.

## 7. Not in step 1

- the map, `layout: map`, MapLibre, OpenFreeMap and its CSP
- reverse geocoding
- an area hint
- bulk "Find places"
- distance sort
- Place in Group, Chart, Rollup, Button set-value or a Form question (a form has no place editor yet)
- the release note, which Lead writes and which names Photon as the search provider
- the native Home Screen checks, which stay with G8-4's native row
