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
| **The day template**: one Templates page with today's five headings (**TODO - Top 3** `plan-top3`, **TODO - Other** `plan-other`, **Events**, **Good Stuffs** `collect-links`, **Notes**) plus the review heading role | keeps his day page exactly as it looks now; the titles are his wording, kept as text he can rename |
| Nothing else. **No sample page, no sample task, no welcome text** | he knows the app; sample content would be something to delete |

A day page is **not** created at sign-in. It's created the first time a day is opened, as today ("Create page"
copies the template).

## 2. Screens on an empty workspace

What the build shows today, and the change for each. Only text and visibility change, with no new screens.

| Screen | Today on empty (observed) | Change |
| --- | --- | --- |
| **Sign-in** (new) | none | One screen: "Daythread" · email field · **Send code** → "Enter the 6-digit code we sent to {email}" · code field · **Sign in**. Errors under the field: "That code didn't work · Send a new code". After sign-in → Today. |
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
visible but inert. Edits are refused with the same line, and nothing else changes. No link
from the new app to the archive: it would bring the old data back into view as if it were part of the new one.

## 4. Checks

1. A fresh workspace after sign-in has the five collections and the template. Opening Today creates exactly one Days
   page with the five headings and their roles.
2. Day one: no morning card. Add one task, and the card appears the next morning. With an open task, it appears
   the same day.
3. The Tasks hint appears with zero tasks and disappears after the first one.
4. Review on a day without tasks reads "nothing planned", with no "0 of 0".
5. Sign-in: a wrong code, an expired code, and a resend each show their line, and nothing is lost on a retry.
6. All of the above at 390 and 1280, plus the geometry gate (`check-alignment`) on the template rows.
