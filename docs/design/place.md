# Place and Map: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **step 1 approved by the Lead with conditions (ad34ae2c); short queries and current location decided (b41107d1).** Acceptance is D15 in `docs/plan/first-version-checklist.md`, which wins where this doc is less precise. Look: Jazz 74fb06f7 and 2b3eb494. Boundary: Ratchet's `docs/reviews/place-boundary-ratchet.md` (`review/ratchet-place` 85d18064). Not built.
- Asked by the Lead (3f046122), who listed Place. Map is in the same doc because a Place property mostly exists to feed it, and `databases.md` §14 lists both as Later. Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [maps](https://www.notion.com/help/maps), which I read but haven't used. It doesn't cover clusters, a phone, or which search provider it uses. His use: no databases at the last read (Nov 2), so the examples are illustrations.

## 1. The idea

**Place** is a property holding a location. **Map** is a layout showing rows as pins. "Restaurants to try", "Where I ran".

Both need outside services we don't have: **an address search and map images.** That's the decision in §4.

## 2. Place

- **Value:** a name, an address and coordinates. Reads as the name in a cell, and a tap on the name opens the pin in Apple Maps on a phone and in the Home Screen app, or OpenStreetMap's own page at 1280, since Photon has no map page (Jazz 74fb06f7). A tap elsewhere in the cell edits.
- **Entering one:** a search field with suggestions as he types (a sheet at 390, a popover at 1280), plus **Use current location**. Suggestions start at 2 characters when the query has Chinese, Japanese or Korean in it and at 3 otherwise; below that, a **Search "…"** row runs it on Enter (Lead b41107d1).
- **Never lost:** if search fails, or nothing matches, the **Keep "…" without a place** row keeps what he typed as a name with no pin. Enter never keeps silently (Jazz 74fb06f7). Such a value sits in "No place" on a map (§3).
- **Filter and sort,** as Notion: text in the name or address, and alphabetical. No distance.
- **Changing type:** Text to Place keeps the words as names with no pin, and says how many, and each gets its pin one at a time from the search. **No bulk "Find places" in step 1** (Ratchet: Photon's maintainers send batch lookups to a private instance). Place to Text gives the name and address. Changing back restores it (§6.2).
- **Current location:** asks the browser's permission only on that tap. It stores his coordinates with the name in the field, or "Location on Nov 14" when empty, and looks up no address, so his location never goes to Photon (Lead b41107d1, Jazz 2b3eb494). Denied says "Location is off", and search still works. To be tested in the Home Screen app, where permission can behave differently.
- **Copying:** a value pastes as text into a cell of another type. CSV export writes name, address and coordinates.

## 3. Map

- **Made from** `+ Add view` → Map or `⋯` → Layout. It asks which Place property (Layout → "Map by" changes it later). With none, it offers "+ New Place property", as Calendar does for a date.
- **Pins:** a tap shows the row's title and chosen properties in a small card, and a second tap opens the row. Close pins cluster with a count. **Notion's page goes straight to the row and doesn't mention clusters, so these two are my proposal.**
- **100 at a time, as Notion,** with a line saying how many are shown once there are more, and a filter narrows it. I'd rather go higher if clusters perform, for Roadbuster to measure.
- **No place:** one quiet line, "No place · 3 ›", as Calendar's "No date", which opens in place. Rows are never silently missing.
- **Look:** a grey map style with black pins, matching 116a40ab. Attribution stays visible, since map data licences require it.
- **Keys and block rules:** arrow keys pan once selected. Cut, paste and letters stay out of the page (R1-26).

**The phone needs care.** A map inside a page fights with scrolling that page. **Jazz's call (fb7d3274), not prototyped:** inline, one finger scrolls the page. **A full-screen button is always visible at 390, as the real way to move the map,** as a full-page database does by default. A tap on a pin still shows its card. Two fingers moving the map is a bonus only if the map library gives it cheaply, since it's hidden and we don't write hints explaining gestures. Needs a real iPhone before building, as the Simulator can't judge two fingers. It's the riskiest part of this layout.

| State | He sees |
| --- | --- |
| Offline or images fail | A grey area with "Map unavailable", and the rows stay listed below |
| No rows or no pins | The map at his last area, with the "No place" line if any |
| Its Place property deleted | "Choose a Place property", with Undo restoring it |

## 4. Search and map images, for the Lead

**Decided (Lead b9af4ec7):** OpenFreeMap for map images, and a 20-place search test on public places only, against Photon, when this reaches the front of the queue. If Photon misses Chinese places he'd use, Mapbox goes to Brian as one choice, because it needs an account and probably a card, with numbers checked on Mapbox's own pricing page. Search sends what he types to an outside service, so the release note tells him that plainly.

**Privacy first:** whatever he types in search, and roughly where he's looking, goes to the provider. Sending search through our Worker hides his address from them, but not what he types. Nothing else from the workspace goes.

| | A. Open data | B. Mapbox |
| --- | --- | --- |
| Map images | OpenFreeMap with MapLibre: no key, no limit stated, donation-funded, best effort with no guarantee. Its own [terms](https://openfreemap.org/tos/) and [privacy](https://openfreemap.org/privacy/) pages now exist and allow embedded maps (Ratchet's review) | Reported 50,000 map loads a month free |
| Search | Photon (OSM data). Nominatim's policy is reported to ban suggest-as-you-type, so it's out | Reported free tier, but sources disagree: 10,000 or 100,000 searches a month |
| Cost for one person | None | None expected within the free tier. Needs an account, probably a card, and a key |
| If it goes away | Pins are stored, so nothing is lost, and we'd switch | The same |

All Mapbox numbers come from third-party comparison sites, so check [its pricing page](https://www.mapbox.com/pricing) first.

**A small test I ran on Photon's public service, 7 searches of public places:**

| Search | Top result | Good? |
| --- | --- | --- |
| Vancouver Public Library | A branch and the Central Library | Yes |
| 1055 Canada Place Vancouver | Vancouver Convention Centre West | Yes |
| Stanley Park | Vancouver, then Blackpool | Yes |
| Granville Isl (partial) | Granville Island | Yes |
| 北京故宫 | 故宫, Beijing | Yes |
| 上海外滩 | Museum and hotel on the Bund, not the Bund | Weak |
| 杭州西湖 | A place in Kaohsiung, not West Lake | **Wrong** |

Seven searches can't decide it, but it suggests Vancouver is fine and Chinese places are the weak spot, and he writes in both.

**The 20-place test, run 2026-11-05 by Bumblebee, on Photon's public service, public places only. The places are my choice, not ones Brian has searched for.**

| Searched | In the top three | First result right | Missed |
| --- | --- | --- | --- |
| 10 in English, around Vancouver plus two abroad | 10 | 8 | UBC Museum of Anthropology came second, after one in Madrid. Tokyo Tower came third, after two towers with similar names |
| 10 in Chinese | 7 | 7 | 上海外滩: museum and hotels, not the Bund. 杭州西湖: a place of that name in Kaohsiung, with 高雄市 showing. 西安兵马俑: nothing |

**All three Chinese misses are found under the short name:** 西湖, 外滩 and 兵马俑 each come first with the right city, as do 西湖 杭州 and 外滩 上海 with a space. City and place run together is what fails. 

**Decided (Lead f9bab535): Place stays on Photon, and doesn't go to Brian as a choice.** My recommendation was: This doesn't meet "misses Chinese places he'd use": each place was found, and a wrong result shows its city. Nothing is lost if he still can't find one, as his words are kept with no pin (§2), and coordinates are stored, so the provider can change later. Look at Mapbox again if he reports a place it can't find.

**The test as written:** 20 public places, half in Chinese. If Mapbox is chosen, it's for search only, with a hard cap on our side so that it can't start billing. The choice is easy to change, since coordinates are stored with the value.

## 5. For Roadbuster and Jazz

- **Bundle:** I recall MapLibre being large. It must load only when a map is on screen, with no cost to day pages (R2-7).
- **Storage:** a new property type and `layout: map`. An older tab must keep the values (R3-17), so check that a value of an unknown type isn't wiped.
- **Search goes through the Worker,** with a limit, so that the key stays private if we use one.
- **Jazz:** the pin card, clusters and the two-finger rule.

## 6. Release order, within Place

1. Place property, with search and Use current location: useful alone, as a tap opens it in a map app.
2. Map at 1280 and full-page at 390.
3. Inline at 390, after the native check.

## 7. Checks before release

- A place typed with no match keeps his words.
- Every Place value survives a provider being down.
- At 390 in the Home Screen app: permission, denied permission, Pinyin in search, the sheet above the keyboard, and page scroll with an inline map.
- Search sends only what he typed: checked in the network log.
- A filter and a cap agree with what's shown, and "No place" counts match.
- An older tab keeps values and `layout`, with a rollback run.
- A copy of his real data: no day page slows or changes (R1-18, R2-7).
