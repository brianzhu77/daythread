# Starting empty: first sign-in and empty screens

- Author: Jazz (Design) · 2026-10-22 · status: **design states for the direct-build re-plan**. Base main b9ee9f0.
- Inputs: Brian `b15c12ac` (no data migration; the new structure starts empty), Lead `81c582ae` (screens don't change;
  new-user empty states now matter), the approved core (`supabase-data-model.md` 8a07bc4 §4) and `core-mapping.md`.
- **Evidence:** main b9ee9f0 built and run on an empty SQLite file, every screen at 390 and 1280
  (`/tmp/jazz-empty/*.png`, script `shots.mjs`). No page errors. The "new user" is Brian on switch day: his old
  pages stay in the archive, and the new app opens with nothing in it.

## 1. What has to exist at first sign-in (seed, not his data)

Created once, in the same transaction as the workspace, so no screen ever meets a missing collection:

| Seed | Why a screen needs it |
| --- | --- |
| Collections **Days, Tasks, Events, Links, Templates**, each with its system properties (`sys.date` unique, `sys.status`, `sys.plan_date` as an array, `sys.paused`, `sys.done_on`, `sys.url` unique, …) | every screen queries them; a missing one would be an error, not an empty list |
| **The day template**: one Templates page with today's five headings (**TODO - Top 3** `plan-top3`, **TODO - Other** `plan-other`, **Events** `events`, **Good Stuffs** `collect-links`, **Notes** `notes`). No review heading in the template: it's created, with role `review`, the first time a review is saved, so day pages look as they do now | keeps his day page exactly as it looks now; the titles are his wording, kept as text he can rename |
| Nothing else. **No sample page, no sample task, no welcome text** | he knows the app; sample content would be something to delete |

A day page is **not** created at sign-in. It's created the first time a day is opened, as today ("Create page"
copies the template).

## 2. Screens on an empty workspace

What the build shows today, and the change for each. Only text and visibility change, with no new screens.

| Screen | Today on empty (observed) | Change |
| --- | --- | --- |
| **Sign-in** (new) | none | One screen: "Daythread" · email field · **Send code** → "Enter the 6-digit code we sent to {email}" · code field · **Sign in**. Errors under the field: "That code didn't work · Send a new code". **Any email gets the same "Enter the 6-digit code we sent to {email}"**, including one that isn't his (sign-up is off, Lead `64eee13e`). No code arrives, and a guessed code fails with the same line, so the screen never confirms which address owns the workspace. **A mistyped address** (Bumblebee `aaaf77c7`): the code step shows the typed address in `--ink`, full, on its own line ("Sent to brain.zhu77@gmail.com"), and after **60 s** (a constant in code matching Supabase's per-address cooldown, so his Resend really sends; change both together, Roadbuster `96638974`) adds "No code? · **Use a different email** · Resend". The text is the same for every address. **Send failures:** "Couldn't send a code · Try again" only for failures that hit every address alike (project email limit, network). Errors only his address can get (the per-address cooldown) are shown as a normal send, like the unknown-address error (Roadbuster `7cf86f2b`, Lead `0c458a44`). After sign-in → Today. |
| **Sign-in with a password** (option A, Roadbuster `d17f2b40`, chosen by Lead `48163c61`) | none | Used while Supabase can't send a code (no custom SMTP). One screen: "Daythread" · **Sign in** · Email (`autocomplete="username"`) · Password (`type=password`, `autocomplete="current-password"`, a **Show** text button inside the field's right end, 44 px) · **Sign in**, full width, enabled once both fields have text. Return in the password field submits. iOS and Mac offer the saved password with Face ID or Touch ID, which makes sign-in one tap; that's why the two `autocomplete` values matter. **Wrong password, unknown email or not the owner:** one line under the fields, "That didn't work · Check the email and password", in `--red` meta. The password field empties and gets the caret, and the email stays. It never says which part was wrong. **Too many tries** (our per-IP brake or Supabase's limit): "Too many tries · Try again in {wait}", with the real wait from the server, rounded up: "in 4 min", or "in 30 s" under a minute (Bumblebee `2cef8a00`). The line doesn't count down; the button stays enabled, and a tap during the wait shows the updated line. Same for every address, since the brake is per IP or global. Devices already signed in keep working during a brake. **Network or Supabase down:** "Couldn't sign in · Try again". **Right password, but the account isn't the one the workspace is linked to** (workspace link plan; Bumblebee, Roadbuster `fb275f23`): "Your account isn't linked to this workspace · Your notes are safe", in `--ink-2` meta, not red, since he did nothing wrong. Both fields keep their values, and it doesn't count toward the brake. We fix it from our side (`credentials.md`). **While checking:** the button shows its spinner and both fields are read-only. **No "Forgot password?"**: a reset email holds a link that opens in Safari, not in the home-screen app, so recovery is his own step in Supabase (Users → reset). **The code screen and its endpoints are removed** (Lead `48163c61`: no unused auth surface). They're in git at `0e1988d` if he sets up SMTP later. Tokens as §7 of `tokens.md`. |
| **Signed in / Sign out** (new) | none | A session lasts until he signs out (Lead `be5d2b86`), so the only control is quiet. **Desktop:** the sidebar's last row, under Trash and the Old notes row, in `--ink-3`: "{email} · Sign out". **Phone:** the same line at the bottom of the Pages screen, the one screen with a list end. Sign out asks nothing, ends the session and shows the sign-in screen. Unsaved drafts stay on the device and come back after signing in with the same account. |
| **Today, first day** | the template plus the morning card, "Start the day · No suggestions from last night · **Draft my day** · Done · Later" | **Hide the morning card when there's nothing to start from**: no earlier day page and no open task. "From last night" is false on day one, and Draft my day has nothing to read. The card appears from day two, or as soon as there's an open task. |
| Today, empty task rows | empty checkbox under each plan heading | Unchanged. The existing placeholder shows when the caret is in the row. |
| **Tasks** | "Nothing planned for today." (and the other views' own lines) | Add one second line, only while the workspace has **no task at all**: "Add tasks on **today's page**" (link to today). Once any task exists, back to today's lines. |
| **Pages** | "No pages yet. Tap + to start one." at both widths | Use "**Use + to start one**" so it reads right with a mouse too. |
| **Tags** | "No tags yet · Type # and a word…" | Unchanged. It already teaches the one thing needed. |
| **Calendar** | the list of days, no dots | Unchanged. No dots is the correct "nothing written". |
| **Review, first evening** | "Wed · **0 open of 0** · Nothing on today's plan." over four steps | When the day has no tasks, the headline reads "**Wed · nothing planned**", with no count. The steps stay, since reflection and tomorrow still apply. |
| **Sidebar** | "DAYS · Today", "PAGES · + New page" | Unchanged. |
| **Trash** | not shown when empty | Unchanged. |

## 3. Switch day: the read-only archive (Bumblebee `ad163028`, `aa0fc5db`)

The old app keeps running read-only on his Mac (3000). Every screen there shows one line at the top, "**Archived · read
only · your new Daythread is at {url}**". Write entry points (+ capture, the morning card, Draft my day, the editor) stay
visible but inert. Edits are refused with the same line, and nothing else changes. One way back, from the new app (Bumblebee `58a76f87`, Ratchet `a63389b9`): a single quiet row at the bottom of the
desktop sidebar, under Trash, in `--ink-3`. "Desktop" can't tell which computer it is (another Mac's
`localhost:3000` is itself), so the link is **enabled per browser, on the Mac mini only**:
- **Turned on by the archive itself** (Bumblebee, adopted over a manual setting): the archive's banner link
  "your new Daythread is at {url}" opens the new app with a marker. That browser stores "archive reachable here" in
  local storage only (not his account) and from then on shows the row as a link, "Old notes (before {switch date})
  ↗", opening the archive in a new tab.
- **Every other browser and device shows nothing**, not even text. He knows where his old notes are, and a row that
  can't open is noise.
- It's never shown on the phone. It's a plain link out, never old pages inside the new app. If the archive doesn't
  answer, the browser's own error shows; the row stays, because the Mac may just be asleep.

## 4. Checks

1. A fresh workspace after sign-in has the five collections and the template. Opening Today creates exactly one Days
   page with the five headings and their roles.
2. Day one: no morning card. Add one task, and the card appears the next morning. With an open task, it appears
   the same day.
3. The Tasks hint appears with zero tasks and disappears after the first one.
4. Review on a day without tasks reads "nothing planned", with no "0 of 0".
5. Sign-in: a wrong code, an expired code, and a resend each show their line, and nothing is lost on a retry.
6. All of the above at 390 and 1280, plus the geometry gate (`check-alignment`) on the template rows.
