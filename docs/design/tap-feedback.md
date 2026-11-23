# Tap feedback: press, working, done, failed

Owner: Jazz (design). Status: **spec for release 1**, written 2026-11-22 from main 99d606fc. Builder: Roadbuster.
Independent check: Ratchet (#373). Source: Brian b6fc2a8f ("many buttons, I can't tell if my tap worked").

Acceptance (Bumblebee, in his words): 我点任何一个按钮，手指一按下去就能看到点中了；要等的，看得到正在处理，然后是成功或失败；
不需要点第二次去确认。

## 0. What is wrong today (measured)

Press audit, `press.mjs` (Chromium, 390 touch and 1280 mouse, press held 180 ms then cancelled, computed style of the
control, its children, pseudo-elements and parent compared before and during the press), seeded copy, main 99d606fc:

- Day page at 390: **18 of 21 controls show no change while pressed**, including every draft ✓ and ✕, Apply all and
  Dismiss, all five tabs and Search. Only HeroUI buttons (date title, previous day) change.
- All six main screens: 390 52 of 63 no change; 1280 74 of 75 no change (at 1280 the press looks exactly like hover).
- Cause: Tailwind preflight and HeroUI set `-webkit-tap-highlight-color: transparent`, so the browser's own flash is
  gone, and our own controls have 129 `:hover` rules but about 6 `:active` ones. Touch has no hover, so on the phone
  nothing at all happens under the finger.
- Then the result: the four draft buttons, and about 45 other controls (Roadbuster's list, group A2), change nothing
  on screen until the server answers. Brian pressed ✓, ✓, Dismiss one second apart today and wrote 59 s later.

Not yet checked on a real iPhone (WebKit's `:active` needs a touch listener; the shared rule below avoids `:active`).

## 1. Press layer (every pressable control, one shared rule)

**1.1 One mechanism, not per-site CSS.** A single module installed once in the app shell marks the control under a
press with `data-press`. CSS keys every family's pressed look on `[data-press]` and HeroUI's `[data-pressed=true]`.
`:active` is not used: it is unreliable on iOS and doesn't cover keyboard presses.

- Pressable: `button`, `a[href]`, `summary`, `[role=button|link|tab|menuitem|menuitemcheckbox|menuitemradio|option|switch|checkbox]`,
  `label` wrapping a checkbox.
- Not pressable (rule must not touch): editable text (`isContentEditable`, text-like inputs, textareas; checkboxes and radios stay pressable), native `select` (the OS draws its own), drag handles and
  anything that lifts (they have the Lift Rule), the map canvas, `:disabled` / `aria-disabled=true`, and anything
  marked `data-no-press`.
- Start: `pointerdown` (capture, passive) on the closest pressable. Shows in the same frame: **no transition in**.
- End on lift: `pointerup`. Fades out over 120 ms (`--dur-fast`). **Minimum visible time 100 ms** for a lift: a quick
  tap (finger down 40 ms) still shows the press for 100 ms from its start.
- End at once, no minimum (Ratchet 7551ecee): `pointercancel` (the browser took the touch for a scroll), the pointer
  moving more than 8 px, `scroll`, `dragstart`, `blur` of the control, window `blur`, `visibilitychange`.
- Keyboard: only the keys that activate that control show a press: Space and Enter on a button, summary or menu item;
  Enter on a link (Space scrolls); Space on a checkbox or switch. Shown until keyup (Enter: 100 ms).
- Reduced motion: same looks, no fade (they are colour only; nothing moves or scales).

**1.2 The looks.** Step Rule: pressed is one step past hover on the same scale, never a new hue. Pressed differs from
hover, so a mouse user sees the press too.

| Family | Examples | Rest | Hover (fine pointer) | Pressed |
|---|---|---|---|---|
| Row | sidebar row, tab bar tab, card row, pill, menu item, map card row, trash row | none | gray-2 | gray-4; text and icon Ink |
| Icon button | draft ✓ ✕, ⋯, tree +/⋯, round +, New page +, Search (tab bar), editor toolbar, toast ✕ | none | `--hover-dim` / gray-3 | gray-5 fill on the whole visible button (min 32 px, its own radius); icon Ink |
| Text button | Apply all, Dismiss, Retry, Show, Undo, Move to, Templates, Export, editor save line | none | Ink text | a gray-4 pill behind the text: `background` + `box-shadow: 0 0 0 4px` same colour, radius 6 px, so nothing moves; text Ink (blue text stays blue) |
| Outline / secondary | move-confirm, formula Done, pill buttons in blocks | border | Paper tint | gray-4 fill, border one step darker |
| Filled | Thread Blue primary, Ink auth button | colour | one step | `--blue-pressed` / gray-11 (two steps for Ink) |
| HeroUI Button | date title, day arrows, toast row buttons | its own | its own | keep HeroUI's `data-pressed` look; where we set `transform: none` (day title, future day), add the Row press fill instead |
| Link (underlined) | grey links in text | gray-11 | gray-12 | gray-12 and a gray-3 pill as Text button |

Dark mode follows from the scales; no new raw values. One new alias is fine: `--press: var(--gray-4)`,
`--press-strong: var(--gray-5)`.

**1.3 A small control inside a row tints its row too.** Under a finger a 40 px button is mostly hidden. While a draft
✓ / ✕ or a row's ⋯ is pressed, its row takes gray-2 as well, so the press shows beside the finger.

**1.4 Gate.** `press.mjs` (path in the task) fails any visible pressable with no change while pressed, at 390 touch
and 1280 mouse. Lead turns it into the standing repo check.

## 2. The day draft's four buttons (release 1)

Rule for all four: **the line he pressed shows its result in the first frame after the change is stored on the
device**, never before (Ratchet 68b12ff8 §1). Storing is local and takes milliseconds; the server answer is not waited
for.

**If the device can't store it** (storage unavailable or the write fails; today `run` then sends it live), the row
shows it's working instead: ✓ ✕ are replaced by the small draft spinner (`draft-spin`) in the same spot, text
unchanged, until the server answers. Accepted: the decided look below. Failed: the row comes back with
`Not applied · try again` under it (Deadline Red, Meta size). Nothing claims done before it is stored somewhere.

**2.1 ✓ Apply one suggestion.**
1. Press: Icon button look, row tint (1.3).
2. Stored: in the same place the band turns into the line it will become: text Ink (from Ink-faint), dashed box /
   dashed bullet / dashed underline become the solid box, bullet or plain line, ✓ and ✕ go away. Its text stops being
   editable. Nothing moves. The usual `Applied · Undo` notice appears now, not after the server.
3. Server accepts: the band is replaced by the real line in the same spot. It looks identical, so nothing flickers.
4. Server refuses (decided elsewhere, no longer open): the band goes back to its draft look with ✓ ✕ (and his edited
   text) if it's still offered, and **a Meta-size line in Deadline Red sits under it for 4 s**: `Not applied · changed
   elsewhere`. The Applied notice is closed. Never a silent roll back (Lead 5d9ce740).
   - If it's no longer offered, the red line still shows **in the row's slot**: the slot keeps one line's height
     with only the red line in it for 4 s, then closes. The note belongs to the draft's host, not the row, so it
     isn't removed with the row (Ratchet 7551ecee).
   - A refusal found later (after a reload, or a change stored offline) is not this note's job: it is the outbox's
     existing refused state, which stays until he dismisses it and keeps its way back. The 4 s note is for the live
     page only.
5. Network fails: the change is still stored and will be sent; the row keeps its applied look and the existing
   outbox banner says it's waiting. No "Not saved", nothing that invites a second press (Ratchet §4).

**2.2 ✕ Skip one suggestion.**
1. Press: as 2.1.
2. Stored: the band stays in place for the tick hold (`HOLD_MS`, 1 s) in a skipped look: text Ink-faint at 50 %
   opacity with a 1 px line through it, ✓ ✕ gone. Then it closes (height to 0 over 150 ms; reduced motion: removed).
   The hold is the same reason ticks have one: the next suggestion doesn't slide under his finger before he lifts it.
   `Skipped · Undo` with Move to appears now.
3. Refused: the band comes back in draft look with `Not skipped · changed elsewhere` under it for 4 s.

**2.3 Apply all.** Press: Text button look. Stored: every suggestion **not already decided or on its way** takes the
2.1 look at once; the draft line's `4 suggestions · Apply all · Dismiss` goes away (nothing left to decide);
`Applied 4 · Undo` appears. Partial refusal: each refused row says so on its own line as 2.1.4.

**2.4 Dismiss.** As Apply all with the 2.2 look on each row, all held then closed together; `Skipped 4 · Undo`.

**2.4a Undo before the server answers.** The notice's Undo shown at once is tied to **that same stored decision**:
it is its own change with its own operation id, which names the decision it undoes (`targetOperationId`, as Undo does
today) and is sent after it, in order. Outbox entries stay as they are; whether a decision not yet sent may be
withdrawn instead is the outbox's call (send lock, later changes that depend on it), not this spec's (Ratchet 949f1c75).
What he must see: the suggestion offered again and no new line in his page, and it doesn't come back later. Acceptance
case: ✓, Undo at once, the server's answer to the ✓ lost, reopen the page: no added line, the suggestion is offered,
and it stays that way. (The server may have run the Apply and then the Undo; that's fine.)

**2.5 Second press.** A decided row has no ✓ ✕ left, so it can't be pressed twice. Other rows stay live: ✓ then ✓ on
two rows a second apart both work (Ratchet §2: never lock the whole card). Apply all / Dismiss only act on rows not
yet decided. A double click on Apply all in one frame acts once.

**2.6 Where "decided" lives.** The decided look comes from the stored change (the outbox entry), not component memory:
leaving the page and coming back, a reload, or going offline and back all show it the same (Ratchet §3).

**2.7 Delay checks.** Judge every state with the server answer held 1 s and 3 s (Lead), and with a refusal. At 3 s the
row must already look applied or skipped from the first frame after the device store. Named case (Bumblebee
a12fc0ff), his own Nov 22 sequence: four suggestions; ✓ row 1, ✓ row 3 1 s later, Dismiss 1 s after that, server held
3 s. Expected: rows 1 and 3 stay applied, rows 2 and 4 skip, the notice says `Skipped 2`, nothing is refused.

## 3. Ticks (check, not rebuild)

Ticks already draw at once with a 1 s hold. Check on the phone that the press on the box is visible (Icon button look)
and the tick appears in the same frame. Nothing else changes.

## 4. Release 2 (contract: Ratchet b527e8d8, scope: Lead 5b22d29e)

The rest of group A2 (about 45 controls) through the shared `run`. The place he pressed shows the result once it is
stored on the device; `run` still resolves with the server's receipt.

**4.1 Refused or held after being drawn (Lead f00eb610, wording Jazz 0a65952a, 5869fde3).** No banner-only fallback.
- The change goes back where he pressed, and in the same visible change a notice says
  `<What> not saved · changed elsewhere` (held) or `<What> not saved · <short reason>` (refused). Shown 6 s; the
  banner's Keep mine / Discard stays as the lasting way back.
- `<What>` is a noun per command type (Name, Icon, Cover, Property, Link, Move, …). Every A2 type has one; the plain
  `Not saved · …` fallback is only a safety net, and a test fails if an A2 type uses it.
- One notice per operation, also when the refusal is found on a retry, after a reload or in another tab (Ratchet).
  None when the caller says it in place.
- In place, for the three he uses: **Rename page**, stored name back, red Meta line under the title
  `Name not saved · changed elsewhere` (held: until Keep mine / Discard; refused: 4 s). **Links from a paste**, words
  stay as plain text, red line under that block `Links not saved · changed elsewhere`.

**4.2 Not drawn ahead (Lead 5b22d29e).** New page, template page and new database wait for the server as today: press,
then the working look (same place, reduced opacity, spinner after about 300 ms, label width held), no second press.
Rule: something he can type into isn't shown before the server has it, unless his words provably survive a refusal.

**4.3 Backlog: refused new page after he typed (Jazz 1ffaa939, 78aae57b; Ratchet point 5).** Comes back if a held or
refused create shows up in his data, or if drawing new pages ahead is reopened.
- The page stays in Pages where it was made: title Ink-faint, `Not saved` in Deadline Red at Meta size in the row's
  date/count slot. Opening it shows his title and words with `Page not saved · <reason> · Save as new page ·
  Copy text · Discard`; Discard asks `Discard this page? Keep · Discard`.
- Outbox banner line `1 page not saved · Open` until each is saved or discarded.
- Waiting (stored offline, not sent) is not failed: no `Not saved` until the server holds or refuses it.
- Save as new page: fresh id, top level if the parent is gone, title and words; the old recovery retires only after
  both the create and the content save have receipts. A failed or offline rescue leaves it `Not saved`.
- No prompt on leaving and no browser close prompt: the words are kept on the device and the row finds them.
