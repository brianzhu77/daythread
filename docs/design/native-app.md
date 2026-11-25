# The native app: architecture and order

- Author: Claude · 2026-11-25 · status: **approved by Brian 2026-11-25 ("LGTM. let's do it"). Phase 0 is built, merged and checked on his data on the simulator; the install on his phone is deferred (`docs/plan/native-phase-0.md`).**
- Asked by Brian (2026-11-25): make Daythread native first. His words, in order:
  - "交互采用原生组件作为基础，如果有冲突的部分，以原生为主" (native components are the base; where there is a conflict,
    native wins).
  - "我只是希望有一个 iOS 原生 app，并且整体的交互更加顺畅。目前的 Web app，让我觉得交互总是有一点卡卡的感觉。我想要有 Craft
    那样的交互" (a native iOS app, smoother overall; the web app always feels a little stuck; interaction like Craft's).
  - "完全不接受套壳的方式。我希望做一个新的 Native App。如果可以的话，遵循 Apple 的规范，同时支持 macOS 和 iOS" (no shell
    of any kind; a new native app; follow Apple's conventions; macOS and iOS).
  - "Web 和 App 同时开发，但 App 优先。Web 可能滞后" (both developed, app first, web may lag).
  - SwiftUI or UIKit: "决定去哪在你" (the choice is mine).
  - "NO TYPESCRIPT AT ALL. WRITE IN SWIFT THE APPLE WAY".
- This document is the umbrella: what is being built, the decisions every later piece rests on, and the order. Each
  phase in §10 gets its own design and plan before it is built.
- "My call" marks a decision Brian handed to me or never spoke to. Everything else under "Decided" is his.
- **Evidence:** the code and docs on main `3bc4e18e`. The toolchain on this Mac is Xcode 27.2, Swift 6.4, with iOS
  26.4, 26.5 and 27.0 Simulator runtimes. I have not built anything against the iOS 27 SDK; anything this document says
  about system components is from iOS 26 and must be checked against the current SDK by whoever plans a phase.

## 1. Intent

A new Daythread app for iPhone and Mac, written in Swift on Apple's frameworks, that feels the way Craft feels: a tap
answers at once, typing never stutters, and navigation, sheets, menus, pickers and drag are the system's own. It reads
and writes the same workspace as the web app, through the same server.

Why: the web app on the phone "always feels a little stuck". 78 of the 139 B-rows in
`docs/plan/first-version-checklist.md` mention the phone, the keyboard, Safari, touch or the Home Screen app (a grep,
so approximate): the status bar, the keyboard covering the toolbar, the first tap lost, sheets and safe areas, drag on
touch. Those are the costs of imitating a platform from inside a browser. A native app does not pay them.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Brian opens and closes his day in the native app on his iPhone, and stops opening the Home Screen web app for it.
2. Every interaction that the system has a component for uses that component, with its default behaviour.
3. Everything on screen is read from the device. Nothing waits on the network to appear, and the app opens offline.
4. One codebase for iPhone and Mac.
5. The web app keeps working on the same data, with nothing lost when a page is edited by both.

**Non-goals**

- Parity with the web app on day one. The app grows by phase (§10); the web app remains the place for what the app
  does not have yet.
- iPad as a checked target. The app will run on iPad because Mac Catalyst is built from the iPad idiom, but no iPad
  screen is designed or verified unless Brian asks.
- A new data model, a new server, or a new sync system. The stored records, the commands and the server stay.
- Android, watchOS, visionOS.

**Anti-goals (a failure even if it works)**

- Any web view showing app UI, or any JavaScript engine running in the app.
- A hand-built copy of a control the system already provides (a tab bar, a sheet, a menu, a date picker, a drag
  preview).
- A page saved by the app that the web app then shows with something missing, or the reverse.
- A tap that shows a spinner because the app went to the server to find out what to draw.

## 3. Decided

| Decision | Whose |
|---|---|
| A new native app; no shell, no web view | Brian |
| Swift only in the app; no TypeScript or JavaScript on the device | Brian |
| Apple's conventions; where Daythread's design conflicts with the platform, the platform wins | Brian |
| iOS and macOS | Brian |
| App first; web continues and may lag | Brian |
| UIKit for the app's structure and its document surfaces; SwiftUI only for leaf screens (§5) | my call |
| macOS through Mac Catalyst, so the editor is written once (§5) | my call |
| iOS 26 and macOS 26 as the minimum, built with the current SDK | my call |
| No third-party dependencies; Apple frameworks only (§5) | my call, from "the Apple way" |
| The rules are ported to Swift, phase by phase, and held to the server's by shared test cases (§6) | Brian chose A |
| The stored document format stays BlockNote's JSON (§7) | my call |
| A block the app cannot draw is kept untouched and shown as a placeholder (§7) | my call |
| The existing server stays in TypeScript and gains a small JSON API for the app (§8) | my call; see the note below |
| The app lives in this repository, under `native/` | my call |

**Note on "no TypeScript at all".** I read it as: none in the app. Two things on the web side still have to be written
in TypeScript, because that is where they live: the server's new endpoints (§8), and a script that writes the shared
test cases as JSON files (§6). Neither ships in the app. If Brian meant the server too, that is a different and much
larger project (a Swift server, and the web app rebuilt on it) and this document does not cover it.

**Note on the repository.** One repository, because a rule that changes stored data lands in the server, in
`DaythreadCore` and in the shared cases as one change, and CI can fail it when they disagree. Phase 0 makes two CI
changes for it: `native/**` joins `paths-ignore` in `cloudflare.yml`, so a Swift commit never redeploys the web app,
and the Swift tests get a macOS job that runs only when `native/**` or `fixtures/**` change. `native/` can be split
out later with its history if the app ever needs a home of its own.

## 4. Approaches considered

**Where the rules live on the device.** The web app is fast because `src/domain` (about 12,400 lines, pure functions,
101 test files) runs in the browser: a tick is drawn before the server answers, and every list is derived locally.
The app needs the same.

- **A. A Swift port, by phase, with shared test cases. Chosen (Brian).** Native speed, no bridge, the app is plain
  Swift. Cost: the rules exist twice. The server remains the authority, so a wrong Swift result is a wrong prediction
  that the server's reply corrects, never a wrong stored value; and the shared cases (§6) make drift a failing test.
- **B. The TypeScript domain run headless in JavaScriptCore.** One implementation and every rule on day one. Rejected
  by Brian. It also runs without JIT inside an app, moves the workspace across a bridge as JSON and keeps state in two
  heaps, which is where the stutter could come back.
- **C. A thin client; the server computes each screen.** Dropped before it was offered: every tap waits on the
  network and nothing opens offline, the opposite of what was asked.

**UIKit or SwiftUI.** Brian had heard SwiftUI is unreliable and asked for my view.

- **UIKit throughout** is the most predictable, and the most code for forms and settings.
- **SwiftUI throughout** is the least code and is fine for standard screens. Its weak places are text editing under
  an input method, keyboard and scroll control, and long lists reordered by drag. Those are the centre of this app,
  and they are also where its behaviour has changed most between OS releases.
- **UIKit for structure and document surfaces, SwiftUI for leaf screens. Chosen.** The app delegate, scenes,
  navigation, tab bar, sidebar, sheets, menus, the editor and the database canvases are UIKit. Settings, the account
  screen, property editors, filter and sort sheets and other forms are SwiftUI inside `UIHostingController`, and a
  cell's contents may be SwiftUI through `UIHostingConfiguration` where the cell holds no editable text. The line is:
  SwiftUI never owns navigation, the keyboard, or a view the user types a page into.

**The Mac.**

- **Mac Catalyst. Chosen.** One UIKit editor, one set of screens; the Mac gets the menu bar, keyboard shortcuts,
  multiple windows, the toolbar and pointer behaviour through UIKit's Mac support. Craft ships this way, as far as I
  know. Cost: a few AppKit-only controls are unavailable and the result is slightly less Mac-like than AppKit.
- **A separate AppKit app on a shared core.** The most Mac-like. It means a second editor on `NSTextView` and a
  second set of screens, roughly doubling the largest part of the work. Not chosen; it stays possible later because
  the core (§5) has no UIKit in it.

## 5. The shape of the app

Four Swift packages under `native/Packages/`, and one app target with iPhone and Mac Catalyst destinations.

| Package | Holds | May import |
|---|---|---|
| `DaythreadCore` | The records (`Workspace`, `Page`, `Task`, the document's blocks), reading and writing them as JSON, the derived readings (carry-over, Upcoming, events, tags, the page tree, the task tree, search), the commands as values, and the prediction of what a command does | Foundation only |
| `DaythreadSync` | The server client, the session token in the Keychain, the store on the device, the outbox, and the engine that keeps the three in step | Foundation, SwiftData, Security, `DaythreadCore` |
| `DaythreadEditor` | The block editor: the document as a list of cells, text input, chips, menus, drag | UIKit, `DaythreadCore` |
| `DaythreadUI` | Screens, navigation, the design rules of §9 | UIKit, SwiftUI, the three above |

- **`DaythreadCore` has no UI and no I/O**, like `src/domain`. Its tests run with `swift test` on the Mac, with no
  Simulator, in seconds. This is where the shared test cases run.
- **State.** One actor owns the workspace in memory, as an immutable value, the way a browser tab holds it today.
  Screens observe readings derived from it. A change produces a new value; the diffable data sources work out what
  moved. Documents are parsed per page on first read and cached, as `pageNodes` does.
- **Concurrency.** Swift 6 language mode with complete concurrency checking. Derivations that could take more than a
  frame run off the main actor.
- **Frameworks.** Apple's only: UIKit, SwiftUI, TextKit 2, SwiftData, URLSession, Security, Observation,
  UserNotifications, BackgroundTasks, PhotosUI, QuickLook, os; later MapKit and Swift Charts (in place of MapLibre
  and the app's own chart drawing), WidgetKit, App Intents, CoreSpotlight. Tests are Swift Testing for the packages
  and XCTest for UI runs.
- **The store on the device is behind a protocol** (`WorkspaceStore`: load everything, write these rows, the outbox's
  entries, the drafts), as the server's `WorkspaceRepository` is. SwiftData is my call for what is behind it: the
  shapes are simple (rows by id, no queries beyond "all" and "by id", because lists are derived in memory), which
  keeps to the part of SwiftData that is dependable. If it misbehaves, the fallback is the system's SQLite behind the
  same protocol; nothing above the protocol changes.

## 6. Rules: one authority, two implementations

- **The server decides.** Every change is a command, applied by `applyCommand` on the server, as today. The app
  sends the same JSON actions the web app sends (`Action` in `src/domain/types.ts`).
- **The app predicts.** For a command the app can predict, it applies its own Swift version at once, draws the
  result, writes the command to its outbox, and sends it. The server's reply (the receipt and the changed rows)
  replaces the prediction. This is the web outbox's contract (`docs/design/outbox.md`), and the app follows that
  document's rules for ids made on the client, held entries and replays.
- **A prediction may be partial (my call).** `applyCommand` does more than the command's own change: a tick also
  makes a repeating to-do's next one, and every command may set off automations, which pull in the database, formula
  and button code of phase 4. The Swift prediction covers what its screen draws (the tick); the server's reply
  supplies the rest (the next to-do, a rule's result). A shared case names the parts of the output it compares, so a
  partial port is tested on exactly what it claims. Until a command's reads are ported, the app states them to the
  outbox conservatively (`readsBeyond`), which can only make the server more careful.
- **A command the app cannot predict at all is sent and waited for.** It needs a connection, shows that it is working,
  and draws the server's reply. Each phase's design lists which commands are predicted. This is what lets the port
  go phase by phase: a rule is ported when its screen needs to be instant, not before.
- **The app does the web shell's writes on opening**, from phase 1: `ensure-day` for today, and `run-repeats` when a
  repeat or a scheduled rule is due (`app-shell.tsx`). They are sent and waited for, with nothing shown unless one
  fails. Otherwise, once he stops opening the web app, nothing would run them.
- **Readings are always local.** A list or a count is never asked of the server. A reading the app does not have yet
  means the screen that needs it is not in that phase.
- **Shared test cases keep the two in step.** `fixtures/core/<area>/*.json`, each a case: an input (a workspace,
  and an action or the reading's arguments) and the expected output. A script on the web side
  (`scripts/export-core-fixtures.mjs`) writes them by running the TypeScript domain over the invented workspaces the
  tests already use. `DaythreadCore`'s tests read the same files and must produce the same output. CI regenerates the
  files and fails on a difference, so a rule changed in TypeScript without its case, or a case the Swift side no
  longer passes, stops the build.
- **Consequence for "web may lag".** Web screens may lag. A rule that changes what is stored cannot: it lands in the
  server's TypeScript and in `DaythreadCore`, with its cases, in the same change.

## 7. The document and the editor

**The format does not change.** A page's `document` stays BlockNote's JSON (`EditorNode[]`: `id`, `type`, `props`,
`content`, `children`), because both apps and the server read it, and the server derives to-dos, events, tags and
links from it.

**The round-trip rule.** The app decodes a document into typed blocks for what it knows and keeps the raw JSON value
for everything else: an unknown block type, an unknown prop, an unknown inline item, an unknown style. Encoding writes
those back as they were. Two tests guard it, on the invented workspaces and, before any release, on a copy of Brian's
data: every document decodes and encodes to an equal JSON value, and editing one block leaves every other block equal.
The app keeps each page's document string exactly as the server sent it, since the save's `expectedContent` is a key
of that string (`pageContentKey`).

**A block the app cannot draw yet** is a placeholder cell stating what it is (its kind, and its name where it has
one). It can be moved with its neighbours. It cannot be edited or deleted in the app.

**The same rule the other way.** When the app is first to write a new kind of block or prop, the web app must already
keep it untouched and show a placeholder. BlockNote's schema drops what it does not know, so this is real web work,
and it is the one piece of web work that cannot lag behind the app. A phase that adds a stored shape includes it.

**The editor's structure (my call): one cell per block, as in Craft.**

- A `UICollectionView` with a list layout and a diffable data source keyed by block id. Nested blocks are the same
  cells, indented.
- A text block's cell holds a `UITextView` on TextKit 2. `@date` chips and page links are inline attachments.
- Return splits a block; Backspace at the start joins or outdents; the arrow keys cross from one block to the next;
  Tab and Shift-Tab nest.
- **Input methods come first.** A cell holding marked text (pinyin being composed) is never reconfigured or reloaded
  until the composition ends. Correct Chinese input on a new line, on a split and on a join is an acceptance check in
  every editor phase (B49 is the web's history here).
- `/`, `@` and `[[` open a list of choices above the keyboard on the phone and at the caret on the Mac.
- The formatting bar is the keyboard's input accessory view; selection actions go in the system's edit menu.
- Moving lines is the collection view's own drag and drop, with the system's lift and drop. The web's Lift Rule and
  its springs do not come across.
- A to-do row is a block whose cell has the tick; ticking is a command, never an edit of the text.

**A difference Brian should know about.** The web editor is one continuous text: a selection can run from the middle
of one line to the middle of another. With one text view per block, text selection stays inside a block, and
selecting across blocks selects whole blocks. That is how Craft and Notion's phone app behave. One text view for the
whole page (as Apple Notes and Bear do) would keep continuous selection and make databases, synced blocks, per-line
drag and per-line menus much harder. I chose the Craft shape because he asked for Craft's interaction.

**Saving.** A page's edits are kept on the device as a draft as he types and sent as `save-editor`, with the web's
rules for a stale save (`docs/design/save-conflict-states.md`). The first editor phase's design sets how the draft is
merged or offered when the server refuses it.

**A save is not an outbox entry, as on the web.** The web sends `save-editor` by its own path, checked against the
whole workspace's revision, with its own recovery, and `outbox.md` §3 keeps it out of the outbox on purpose. The app
keeps that split (§8 has a route for each). One rule joins them: a change that depends on a page's unsaved text, such
as a tick on a to-do typed a moment ago, waits behind that page's save, as the web does ("a tick that writes an open
page saves and holds it first"). So the engine built in phase 0 is one ordered queue holding both kinds, not two
independent senders.

## 8. The server's part (TypeScript, on the web side)

The web app talks to the server through TanStack server functions and a cookie. Neither suits an app. Added beside
what exists:

| Endpoint | Does |
|---|---|
| `POST /api/v1/auth/sign-in`, `sign-out` | The existing session (an opaque token, stored as its SHA-256), returned in the body and sent back as `Authorization: Bearer` |
| `GET /api/v1/workspace?have=<revision>` | The workspace as the browser gets it (`forBrowser`), or "unchanged" when the revision is the one the app has |
| `POST /api/v1/commands` | `runOutbox`: the action, its operation id, the expected owner and the basis; replies with the outcome, the receipt and the changed rows |
| `POST /api/v1/saves` | `runCommand` for `save-editor` only: the action, its operation id and the expected revision; replies with the receipt and the changed rows |
| `GET`, `PUT /api/v1/files/:id` | The existing file routes, for the app. Phase 2, with images and files |

- All are thin routes over the functions the web app already calls; isolation by workspace stays in
  `request-owner.ts`.
- **One shared piece changes: the gate in `src/server/auth/server.ts`.** Today it reads the token only from the
  cookie, refuses any POST without `Sec-Fetch-Site` or `Origin`, and lets through a fixed list of public paths. It
  gains, for paths under `/api/v1/` only: the token read from an `Authorization` header and never from the cookie; a
  write with neither `Sec-Fetch-Site` nor `Origin` let through (a browser always sends one, so such a request is not
  a browser, and these paths honour no cookie for another site to borrow); and the v1 sign-in path in the public
  list. Every other path, and every cookie request, is checked exactly as before. This is a change to the sign-in
  gate, so it gets its own review (`docs/plan/native-phase-0.md`, Task 1).
- `/api/v1` is versioned because an installed app cannot be redeployed with the server. A v1 reply only ever gains
  optional fields.
- **Loading only what changed since a revision is not in the first version.** A command's reply already carries its
  own changes; a full load happens only when another device has changed something. If that proves slow on a large
  workspace, rows changed since a revision is the next step, and the design for it comes with the measurement.
- Phase 1 adds `POST /api/v1/day-draft` over `prepareDayDraft` (§10). Later phases add their own (smart notes,
  registering for Apple's push service). Each comes with its phase.
- Sign-up, password reset and account deletion stay on the web until the phase that prepares the App Store build,
  which needs account deletion in the app.

## 9. Design: the platform's, with Daythread's name on it

Brian's rule is that native wins a conflict. Stated so it can be applied without asking each time:

1. **Use the system component with its default appearance.**
2. **If it needs to be ours, configure it** (the tint, a symbol, a title), never restyle it.
3. **Build a view only where the system has none:** the editor's cells, a database board or timeline, the mark, and
   the notice that carries Undo (iOS has no system toast, and "nothing is lost silently" needs one). Such a view uses
   system materials, system text styles, system spacing and system colours.

| From `DESIGN.md` and `PRODUCT.md` | In the app |
|---|---|
| The name, the mark, the wordmark | Kept |
| Quiet copy; menus show titles only; the on-screen terms (page, to-do, Tomorrow, Not today…) | Kept. This is voice, not a component |
| One accent | Thread Blue is the app's tint. The system decides where a tint shows |
| Red only for a passed deadline or a destructive action | Kept; it is also the system's destructive role |
| The One Blue Rule's closed list; the grey primary button; grey underlined links | Yield to the system's buttons and tint |
| The Rounded-Rectangle Rule; pills only in two places | Yields to the system's shapes |
| The 12-step grey scale, hairlines, the Float shadow, glass | Yield to system colours, separators, materials |
| The type scale in pixels | Yields to system text styles, so Dynamic Type works |
| The app's own icon set | SF Symbols; an own drawing only where no symbol exists |
| The floating tab capsule and `+`; the bottom sheet; the menus | The system tab bar, sheets with detents, `UIMenu` and context menus |
| The Lift Rule | The system's drag and drop |
| The date picker with written-day dots | `UICalendarView` with decorations |
| The geometry gate | Stays the web's gate. The app's own visual checks are set in the first phase with screens |
| Dark mode follows the system | Kept, and free |
| 44 px targets | The system's 44 pt, and free with system controls |

- Structure on the phone: the system tab bar holding the web's five places (Today, Tasks, Calendar, Pages, Tags) and
  Search, which is the web's round button and goes in the system's search place. Whether six fit the system's bar
  without a More tab is checked against the SDK in phase 1; the places themselves are Brian's and do not change. On
  the Mac and at regular width: a sidebar with the same places and the page tree, a split view, the menu bar,
  keyboard shortcuts and more than one window.
- Row actions are swipe actions and context menus. A tick has a haptic. Pull to refresh asks the server.
- `DESIGN.md` stays the web app's system. The app's is a short document of its own
  (`docs/design/native-system.md`), written in the first phase that has screens, and it should stay short: it lists
  the tint, the mark, the voice and the views built under rule 3. `PRODUCT.md`'s Platform line and Operating Context
  are updated when this design is approved.

## 10. Order

This is several projects. Each phase is designed and planned on its own, and each ends with something Brian can use.
The Mac destination builds from the first phase so it never rots; it is made good in phase 3.

| Phase | Holds | Done when |
|---|---|---|
| **0. Ground** | The `/api/v1` endpoints. The Xcode project and packages. `DaythreadCore`'s records with the round-trip rule. The store, the engine, the outbox. Sign-in. Today, read only | His real workspace opens on his iPhone, offline too, and every one of his documents passes the round-trip test |
| **1. The day** | The editor for a day page: text, headings, lists, to-do rows, `@date` chips, ticking, moving lines, Chinese input. The day draft (below), Tomorrow, Tasks and Upcoming, the Calendar, moving between days, Undo, working offline, reminders (below) | He opens and closes his day in the app for seven days in a row without opening the web app for day work |
| **2. Pages** | The page tree, documents, page links and `[[`, search, tags, Trash, icons and covers, bookmark pages, images and files, synced blocks, line links, comments | A day's notes and material never send him to the web app |
| **3. The Mac** | The sidebar and split view, the menu bar, shortcuts, windows, pointer and hover, drag between windows | He writes on the Mac in the app instead of the browser |
| **4. Databases** | Reading a table and a list; editing values; board, calendar, gallery; filter, sort, group; then formulas (the engine's port), timeline, chart, feed, dashboard, form, map, buttons, automations, CSV | Layout by layout; each is its own small design |
| **5. The system** | Widgets, Shortcuts, Spotlight, a share extension for adding from other apps, smart notes, reminders through Apple's push service if the device's own prove not enough, and what an App Store build needs | Its own designs, in the order he wants them |

- Phase 0 and phase 1 are the first design to write. Phase 1 is the largest single piece, and the editor is most of it.
- **The day draft is in phase 1, because it is the morning.** There is no morning card any more: carry-over reaches
  today's page as the day's draft, which the server builds (`prepareDayDraft`, with the model where the account has
  it and the app's own fallback where not) and the page shows as bands to apply, skip, snooze or move. Seven days
  without the web app needs it. Phase 1 therefore includes the `/api/v1/day-draft` route, the port of
  `src/domain/day-draft.ts`'s readings, and the draft's commands. Carrying with `plan-tasks` instead would be less
  work and wrong: the web reads an applied draft item as carried and a plain plan row as chosen (`carried.ts`), so
  the two apps would then disagree about the same to-do.
- **Reminders in phase 1 are scheduled on the device (my call).** The app already derives the `@date` events for
  the Calendar, so it schedules the coming ones as local notifications, with the web's rule for times
  (`docs/design/reminders.md`). Otherwise reminders would keep arriving through the Home Screen web app, and a tap
  would open the web app. He turns web reminders off on that phone, since each device is its own subscription. A
  device only knows what it has loaded, so a chip added on the Mac reminds on the phone only after the phone has
  opened; if that gap matters in use, the server's push in phase 5 closes it.
- Until a phase arrives, its blocks show as placeholders (§7) and its screens are absent; the web app covers them.
- Size, plainly: the web app is 3,233 commits. Reaching what it does today is work of that order again, less what
  the system gives for free (navigation, sheets, pickers, dark mode, accessibility) and what the server already does.
  Phases 0 and 1 are the part that changes his day.

**How app-first work is recorded.** A feature is designed once, for both. Its rule lands on the server and in
`DaythreadCore` with its cases. Its screen ships in the app. The web screen is a row in `docs/plan/native-parity.md`,
marked built, placeholder or absent, so what the web lacks is always written down.

## 11. How it is checked

- **Rules:** the shared cases, in `swift test`, on every change.
- **The document:** the round-trip tests of §7.
- **Screens:** UI tests in the Simulator on a throwaway workspace, with the screen read back as pictures, at iPhone
  size and in a Mac window. Chinese input is typed, not pasted.
- **Feel:** scroll and typing hitches measured with XCTest's metrics on a long day page and a large page tree. The
  budgets are set in phase 1's design from first measurements, not guessed here. Two are fixed now because they are
  the point: a tick is drawn in the frame it is tapped, and launch shows the device's copy without waiting for the
  network.
- **The real phone:** the Simulator cannot prove the keyboard, haptics or the photo picker. Brian's iPhone is the
  last check of each phase, as it is today.

## 12. Needed from Brian before phase 0 starts

- An Apple Developer Program membership, for installing on his phone beyond a week at a time, TestFlight, and later
  push. A team id and a bundle id (I would use `app.daythread.Daythread` unless he has one).
- Nothing else. The server's staging and the invented workspaces already exist.

## 13. Left to the builder and to later designs

- The module-internal types and names in each package.
- The exact sidebar and tab structure in UIKit (one adaptive tab bar controller, or a tab bar on the phone and a
  split view at regular width); checked against the current SDK in phase 1.
- How typing's Undo (the system's `UndoManager`) and a command's Undo (the server's one slot) share ⌘Z and shake.
- Sync while the app is in the background.
- A reviewer read this document as a builder who could not ask questions (2026-11-25). The split between saves and
  the outbox, partial prediction, the writes on opening, the day draft in phase 1, the change to the sign-in gate and
  the Tags tab are from that read, each checked against the code.
- Everything inside phases 2 to 5.
