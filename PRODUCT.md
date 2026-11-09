# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: Brian**, the owner, a senior engineer. He uses Daythread every day on an iPhone (installed from Safari as a
Home Screen app) and in a Mac browser, to start and end his day, keep notes, and hold the material and structured
records he used to keep in Notion and Craft. He writes notes in Chinese and English; the interface is English.

**Direction (Brian, 2026-11-08):** he is the first user, and the product is meant to become one other people sign up
for. Design must not assume one person's habits, and nothing about him becomes a hard-coded rule.

**Today's second audience:** a few invited people (invite-only sign-up), guests of an early version. They are the first
evidence of use beyond the owner.

**Situation:** short sessions on the phone through the day; longer writing and arranging on the Mac; the evening look
at tomorrow; CJK input in the editor.

## Product Purpose

A personal workspace of pages and databases, with a page for each day. Each day starts from a page already prepared
(the day template: TODO, Events, Good Stuffs, Notes); unfinished to-dos carry over to tomorrow; a future `@date` line
returns on its day. It exists to cut the daily cost of recalling, re-sorting and looking things up.

Success is the user opening and closing each day in it for consecutive days, going back to older tools less, and
material saved there actually being reused.

## Positioning

**A personal workspace where days are one strong view among others** (Brian, 2026-11-08), not a journal with a
database attached. The mechanism a neighbour could not truthfully copy: the day is a page like any other, so to-dos,
events, database rows, linked views and references all meet on the date they matter, and nothing is copied between
days. A to-do has one identity; the row on a day page is only where it shows.

Sign-in tagline (binding copy): "A page for each day, with the to-dos that carry over."

**AI is durable and core** (Brian, 2026-11-08): natural-language capture and drafting are part of the promise, and
future surfaces may be designed for them even where they are off today. Current state: one day-draft call through
OpenRouter, server-only key, per-account allow-list, off by default for invited accounts. The app is complete with no
model configured and says "Simulated" when none is set. A mocked reply is never presented as a model's.

## Operating Context

- **Devices:** iPhone at 390 wide (installed PWA, safe areas, floating tab bar, bottom sheets) and desktop at 1280
  (sidebar, peek). Every visual change is checked at both.
- **Rhythm:** morning (today's page with carried to-dos), the day (notes, pasted links, `/` and `@` and `[[`
  commands, databases), evening (the Tomorrow block on today's page).
- **Offline:** the shell and the last loaded workspace open offline; drafts are kept and retried; failures are shown
  quietly with Retry.
- **Dark mode** follows the system setting; no switch in the app.
- **Reminders** for `@date` chips by web push: live in production since 2026-11-05 (B60); each person turns them on for their device.
- **Deployment:** a Cloudflare Worker with Supabase Postgres (through Hyperdrive) in production; every push to main deploys it,
  after its tests (#184). SQLite locally with sign-in off.
  `npm run dev` serves http://127.0.0.1:3000.
- **Process:** decisions and designs are recorded under `docs/` (specs, design, plan, reviews, validation), each
  attributed to Brian's message. A geometry gate (`node scripts/check-alignment.mjs <url>`, 0 FAIL / 0 MISSING at
  1280 and 390) runs on a copy of his data before any visual change is shown to anyone.

## Capabilities and Constraints

**Built** (main `0f8fd6fa`, 2026-11-08):

- Pages: day pages and documents, a nested tree, Trash and restore, icons and covers, bookmark pages from a URL,
  search, tags, peek, synced blocks, line links and page links, comments (on a block, on selected words, on synced
  lines), move row, drag and drop, sub-items, CSV import, export, files in the body.
- To-dos: one identity across pages; status, deadline, attention (start) date, paused; carry-over; the Tomorrow block;
  Upcoming; the calendar; dependency between to-dos.
- Databases: inline and full page; table, board, list, gallery, calendar, timeline, chart, feed, dashboard and form
  layouts; linked views; filter groups; formulas; conditional colour; buttons; automations on a schedule.
- Accounts: Supabase auth through the app's own server, invite-only sign-up (switchable to open), password reset,
  delete account, one workspace per account, a time zone per account.
- Editor: BlockNote 0.56 on TipTap and ProseMirror, one continuous page, kept drafts, save-conflict states, Undo
  (one slot, server-side inverse).

**Technical constraints:**

- TanStack Start, React 19, TypeScript, Vite; Tailwind v4 with HeroUI v3 (React Aria); BlockNote; Postgres via
  `postgres` (PGlite in tests); Node 24. One JS bundle so moving between screens never downloads.
- Two stored record kinds, Page and Task; everything else is derived from the page documents. Isolation per workspace
  is enforced by the server on every statement.
- 44 px touch targets on the phone. System font stack. Icons are the app's own SVG set in `src/components/icons.tsx`.

**Terminology on screen:** page, day page, to-do (a `Task` in code), row, property, view, linked view, database,
dashboard, feed, form, Trash, Tomorrow, Upcoming, Today, Not today, Put back, peek, synced block, tag, `@date` chip.

**Open, not decided:**

- Which model, which accounts have AI on, and how natural-language capture returns to the app. The 2026-10 AI
  contract in `docs/specs/03-ai-contract.md` is historical.
- Reminders in production.
- The shape of a public launch: open sign-up, pricing, onboarding. Nothing is decided; design no claims.
- Localisation: the interface is English only; notes are often Chinese.

## Brand Commitments

- **Name:** Daythread, one capital. The wordmark is the app's title weight, tracked -1%.
- **Mark:** "Three days, one thread": yesterday, today and tomorrow as three dots on one line, today filled in the
  app's one blue. `src/components/mark.tsx`, `public/favicon.svg`, Home Screen icons via `scripts/render-icons.mjs`.
  Never recoloured, never a letterform; clear space of one dot's width.
- **Voice, binding (Brian, 2026-10-31):** quiet copy. On-screen text states the user's data or state, or warns before
  something is lost. Text that explains how the app works is left out. Menus show titles only.
- **Colour, binding (Brian, 2026-10-26):** everything grey from one 12-step neutral scale on white surfaces; blue only
  for the very few (focus ring, checked box, text selection, the editor's chips, "Today"); the auth screens grey only;
  the primary button is the darkest grey; links grey and underlined; red only for a passed deadline or a destructive
  action. The visual system itself is recorded in `DESIGN.md`, from `docs/design/system-v2.md` and
  `docs/design/tokens.md`.
- **References Brian named:** Craft (the first version "can copy Craft", 2026-10-16, since replaced by the own system;
  Craft's icons, illustrations and brand assets are never copied), another app he pointed to (grey with a little blue), Notion (database
  vocabulary and behaviour).

## Evidence on Hand

- Real use: Brian's own workspace. The team's usage reads cover only his (rule from 2026-10-28).
- Validation scripts and runs in `docs/validation/`, with invented data shaped like his real notes.
- The decision record: `docs/design/*.md`, `docs/plan/first-version-checklist.md` (15 of 15 first-version rows built
  as of 2026-10-28), `docs/reviews/`.
- Assets: the mark and icons in `public/` and `src/components/mark.tsx`; page icons, covers, an emoji set and splash
  images in `public/`.
- The invite note in `docs/ops/invite-note.md`, in English and Chinese.
- **Absent, never to be fabricated:** testimonials, customer names or logos, usage numbers beyond the owner, pricing,
  a public landing page, press.

## Product Principles

1. **The day is where everything meets.** Any record can appear on the date it matters without being copied there.
2. **One identity per thing.** A to-do, a row or a page shows in many places and is the same everywhere.
3. **Nothing is lost silently.** Every destructive step has Undo or a warning; failures are visible and retryable;
   drafts survive going offline.
4. **Complete without AI, better with it.** The model proposes, the user decides, and no promise rests on a model
   being on.
5. **Say less.** The interface states data and state, never instructions, and prefers patterns the user already knows
   from Notion, Craft and iOS to invented ones.
6. **Built from the owner's real days, designed so a stranger could sign up.**

## Accessibility & Inclusion

No formal standard has been adopted. In place: HeroUI v3 on React Aria (keyboard and screen-reader support, WCAG 2.1
AA components), visible focus rings, `prefers-reduced-motion` honoured, system dark mode, 44 px targets on the phone,
and a 3:1 minimum contrast for small status marks enforced by the geometry gate. Menus driveable by keyboard and
IME-safe editing (no broken or duplicated CJK input) are explicit acceptance criteria.
