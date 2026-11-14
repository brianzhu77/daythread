# B98: the outbox (changes kept on the device until the server has them)

Status: **contract, for Ratchet's sign-off before any code** (Lead 37e856f8). Row: B98 in
`docs/plan/first-version-checklist.md`. Engineering: Roadbuster. What he sees: Jazz (§8). Review: Ratchet.

## 1. The problem, as measured

Commands are queued and sent from tab memory only (`use-day.tsx`: `run()`'s queue, `lastFailed`). A reload, a closed
tab or iOS killing the Home Screen app before a command leaves loses it, with no warning (Roadbuster dc9541ce:
`notes/scripts/cutoff.mjs`, WebKit and Chromium, on a throwaway store):

| Case | Result |
|---|---|
| Page text, reloaded at once | kept (the editor's draft slots, B35) |
| A tick held 1.5 s in the browser, reloaded | **lost**: shown ticked, unticked after the reload |
| A tick that reached the server, reloaded before the reply | applied |

Offline is where it bites: a command made offline fails into `lastFailed` (header Retry) and lives only in the tab.

## 2. What already exists and is reused

- **Replays are safe on the server.** `applyCommand` returns the stored receipt for an `operationId` it has seen with
  the same action (`workspace.ts`, "Operation identity reused with different input" otherwise). Receipts are kept for
  the last 500 operations, then as tombstones for 3,000 more ("This change was already applied · reload"); past that an
  old operation is unknown. Today its revision check refuses it; a row-scoped replay bypasses that check, so §5 adds
  `receiptsForgottenThrough` to keep "unknown" from ever meaning "run it again" (Ratchet 3da5ff6b).
- **The domain is pure and runs in the browser** (`applyCommand`), so a pending change can be shown applied locally.
- **IndexedDB is already used** for the offline copy (`offline-copy.ts`), with owner stamping against late replies.
- **Row-level storage on Postgres** (`workspace-rows.ts`: `rowsOf`, `planWrites`): pages (a database row is a page),
  tasks, deleted tasks, comment threads, task links, plus the workspace's own settings.

## 3. Scope

Every command sent through `run()` goes through the outbox, **except `save-editor`**, which keeps its own recovery
(draft slots, merge, "Load latest"; B35/B81). Two recovery paths for the same text would fight. Server-only commands
(`apply-link-preview` via `executeOnLatest`) are not browser commands and are out.

Not in scope: Background Sync (Safari has none), sending from the service worker, rebasing a conflicted change.

## 4. The entry and the store

**Store: IndexedDB**, database `daythread-outbox`, version 1, object store `entries`, key `seq` (auto-increment),
index `owner`. Not localStorage: it is synchronous on the main thread (typing, B41/R1-18), shares a ~5 MB budget with
the draft slots, and has no transactions to make "write, then send" atomic with a clear.

```ts
interface OutboxEntry {
  seq: number            // order he made them in, across tabs on this device
  owner: string          // the account the server last answered as ('local' with sign-in off)
  operationId: string    // kept for every send of this entry
  action: Action         // exactly what was first sent; never rewritten
  baseRevision: number   // the revision the tab had when he made it
  label: string          // for the notice: "ticked 'Water the plants'" (§8)
  createdAt: number
  state: 'pending' | 'held'  // held: refused or conflicted, waiting for him (§6)
  reason?: string        // why it is held
}
```

**Written when he makes the change, not when its turn comes.** Today some commands are built inside the queue, from
the workspace every earlier command has landed on (`run(ws => …)`: 7 callers, database changes and adds). A change
queued behind a slow one would then exist only as a closure in memory until its turn, which is exactly what B98 loses.
So `run()` builds every action at once, against the **predicted workspace**: the last server answer with every pending
entry applied by the client's own `applyCommand`, in order. The entry is written then, with `baseRevision` = the
revision of that last server answer.

- Ids: the domain makes some ids itself while applying (`crypto.randomUUID`), so the predicted copy and the server can
  disagree on them. A command that creates something he can act on next must carry the new ids in its action
  (client-made). The PR lists every command changed for this. Where one is missed, a later entry naming an id the
  server never made is refused and held (§6): visible, never silent.

**Kept only once written.** `run()` awaits the IndexedDB `put` (one transaction) before it calls the server. Only a
successful write counts as "kept on this device" (B98 check 10). Measured cost to verify in the PR: one small `put` per
command, expected ~1–5 ms, off the typing path (commands are taps, not keys).

**Store unavailable or full** (`put` throws: private mode, quota, a broken database): the command is still sent exactly
as today, from memory, and the tab is marked **not durable** for the session. Nothing claims it was kept. What he sees
then is Jazz's (§8). `navigator.storage.persist()` is asked once, after the first successful write (Home Screen apps on
iOS are not subject to Safari's 7-day eviction of website storage; a browser tab is).

**Cleared** on the server's answer: a receipt (applied or replayed), or "already applied" (a tombstone), deletes the
entry. A domain refusal holds it (§6). A network failure leaves it pending.

## 5. Sending and replaying

**Live.** As today: `run()` sends with `expectedRevision` = the tab's revision; one at a time, in the tab's queue.
If that is refused only because the revision moved ("Saved elsewhere"), the entry is resent once at once with
`basis: 'rows'` (below) instead of failing into Retry, so a live change and a replayed one follow the same rule. (Lead's
decision: live sends keep today's whole-revision refusal otherwise; §12.)

**Replay** (an entry left from an earlier load, or one whose live send failed on the network) is sent with
`basis: 'rows'`, its original `baseRevision` and `operationId`, and `ownRevisions`: the revisions produced by this
queue's earlier entries since its base (kept on each later entry as they land). The server, in one transaction:

0. **Whose it is:** every send (live or replay) carries `expectedOwner`, the owner recorded on the entry. The server
   compares it with the signed-in owner **before** anything runs and refuses a mismatch (`owner-mismatch`), executing
   nothing (Ratchet 3da5ff6b: a tab of account A still open after another tab signed in as B would otherwise send A's
   change with B's cookie). The entry stays stored for its owner; the tab reloads and drains only its new owner's.
1. **Seen before:** a receipt for `operationId` → return it (applied already; the reply was lost). A tombstone →
   "already applied", treated the same. The browser drops the entry silently.
1a. **Possibly forgotten:** if no receipt or tombstone is found **and** `baseRevision` is below the workspace's
   `receiptsForgottenThrough`, the operation may have been applied and its receipt since dropped. The server can't
   prove it wasn't, so the row check is not used: the whole-revision rule applies (a conflict unless nothing moved),
   and the entry is held for him, never run again. `receiptsForgottenThrough` is set by `compactReceipts` to the
   current revision whenever it drops a tombstone for good, so it bounds every forgotten operation from above. Below
   it, "unknown" is never read as "not applied". That covers a create whose entity was later removed for good: its
   receipt is either still there (answered by it) or possibly forgotten (held).
2. **Nothing moved:** `baseRevision` equals the current revision → apply as a live command.
3. **Row-scoped check:** apply the action to the latest workspace inside the transaction; take its **write set** (the
   rows it changes, from `planWrites`: page, task, deleted, thread and link ids, and `settings` for the workspace's own
   fields). If **any row in the write set was written after `baseRevision` by someone else** (its revision is above the
   base and not in `ownRevisions`) → roll back, answer `conflict` with those rows. Else commit.
   `ownRevisions` is sound: when an earlier entry of the queue wrote a row, any foreign write to that row before it
   would have made that earlier entry conflict, and any foreign write after it leaves a revision not in the list. So a
   tick followed by a rename of the same to-do, both pending, doesn't conflict with itself.
4. **Already holds the intended value:** the action applied to the latest workspace changes nothing (an empty write
   set) → no write; record the receipt; count it as done (Ratchet's exception; nothing is written, so nothing newer is
   overwritten).

So an unrelated edit elsewhere never conflicts (Bumblebee 81c4d49b, Lead ace3f9fa), and open → done → open on the same
task does (the task row was written after the base; Ratchet 957ac045). Value equality is never used.

**Which rows common commands write** (measured on the domain with `planWrites`, a throwaway test whose cases the PR keeps as a test; to be
kept as a test): a tick (`task-status`) writes **only its task row**; a line saved on the same day page writes **only
the page row**; `rename-task` writes the task and the page holding it. So the same-device case "tick a to-do, type a
line on the same page, kill the app, reopen" is not a conflict (Jazz ef6b418a). Known coarse spots: a database cell
edit writes its row's page, so two edits to different cells of one row conflict; a change that recomputes other rows
(an automation, a move that renumbers positions) conflicts with any later write to those rows. Those are recovery
notices, never silent overwrites.

**Limit:** the check is on what the replay **writes**, not what it **read**. Two changes to different rows that only
make sense together are not detected (write skew). No command today is known to depend on another row's value without
writing it; the PR lists any it finds.

### Cost of the row check (Lead ace3f9fa)

- **Postgres:** an additive, nullable `revision integer` column on `pages`, `tasks`, `deleted_tasks`,
  `comment_threads`, `task_links`, and `settings_revision`, `rows_tracked_through`, `rows_untracked_until` and `receipts_forgotten_through` (integers) on `workspaces` (§11), set to the new revision on every row
  the command writes (`planWrites` already lists them). No backfill: null means "not written since the column came",
  which is older than any entry the outbox can hold (the outbox ships with it), so it reads as 0. Migration runs through
  the existing runner; backup first, as for every schema change. Rows a command writes are already being upserted, so
  the extra cost is one integer per written row.
- **SQLite** (local only): a side table `row_revisions(kind, id, revision)` updated in `write()` from the same write
  set; a layout version bump.
- **No retention window:** the check reads the rows' own revisions, not the operation log (which keeps an inverse only
  for the Undo target and prunes after 30 days, so it can't answer this).
- Both stores pass the same repository contract tests for `basis: 'rows'`.
- A row deleted after the base: the domain refuses the action ("not found"), which holds it (§6).

## 6. Order, dependencies and recovery

- **Order:** entries replay in `seq` order, one at a time, through the same queue as live commands.
- **Before the app's own writes on open** (Jazz ef6b418a): after the first successful load, the outbox drains before
  `ensure-day`, the draft slots' re-save and any other write the app makes by itself. Those wait on one
  `outboxSettled` promise (resolved when the queue is empty, held or the network is away).
- **A conflict or a refusal holds that entry and only what depends on it** (Bumblebee d21888b7: stopping everything
  would leave unrelated changes unsent behind one notice, the B98 failure in a new form). Each entry records, when it
  is made, its **predicted write set**: the row ids it writes and creates in the predicted workspace (§4), from the same
  `rowsOf`/`planWrites` the server uses (pure code, shared). A later entry **depends** on a held one when their write
  sets share a row (it edits what the held one made or changed). Dependants are held with it, in order; every other
  entry carries on.
  - Not detected: a later change that only *reads* a held one's row without writing it (the write-skew limit in §5).
    The PR lists any command found to work that way, and holds it with the entry it reads from.
- **Recovery, chosen by him** (what he sees is §8; the notice is not dismissable while anything is held, and shows how
  many changes wait on it):
  - **Discard** drops the held entry; its dependants are re-checked one by one (each may now apply, or be refused or
    conflict and be reported the same way).
  - **Apply mine anyway** (a conflict only, not a refusal): resends it as a live command on the latest revision, by his
    explicit choice. This is the one way a change is applied over a newer write, and only he can take it.
  - A refusal (the row was deleted elsewhere, the action is no longer allowed) can only be discarded.
  A held entry is never rebased or rewritten automatically.
- **The undo slot:** a replayed command becomes the newest operation, as it would live; no Undo toast is shown for it.
  An `undo` entry whose target is no longer the undo slot is refused ("Cannot undo") and held like any refusal.
- **Network away:** entries stay pending; the drain retries on `online`, on return to the tab and on the next open.

## 7. Accounts, tabs, builds and the service worker

- **Owner.** Each entry carries the owner the server last answered as (`workspaceOwner()`; a command can't run before
  the first load, so it is always known). A tab drains **only entries of the owner its own load just reported**;
  others are never sent. The server enforces it too (§5 step 0): a send whose `expectedOwner` isn't the signed-in
  owner is refused before it runs, so a stale tab can't send one account's change into another. A reply that arrives
  after the account changed is ignored, as for the offline copy.
- **Sign-out and Delete account:** if entries of this account are pending, it drains them first when online. Whatever
  is left is deleted with the offline copy (a shared device must not keep someone's changes), after he confirms (§8).
  A session that expires (401 → sign-in) is not a sign-out: entries stay and replay after he signs in as the same
  account.
- **Two tabs.** The drain runs under a Web Lock (`navigator.locks`, `daythread-outbox:<owner>`), so one tab drains at a
  time; where Web Locks are missing, two drains can send the same entry, and the server's receipt answers the second
  (applied once). A live command of tab A is its own entry; tab B opening meanwhile may resend it: same `operationId`,
  applied once. Order across tabs is the order of `seq`, as today's tabs have no order between them at all.
- **Pending changes on screen.** On open, pending entries of this owner are applied to the loaded (or offline) copy with
  the client's `applyCommand` and shown as pending until the drain answers, so a tick he made offline still shows
  ticked after a reload. The server's answer replaces it.
- **Older builds** (the floor 4dcde91a, a rollback) don't know the database and leave it alone; the entries replay when
  a build with the outbox opens again (B98 check 8).
- **New build reloads** (`new-build.ts`) keep waiting for sends in flight; with durable entries they no longer need to
  wait for a failed command (`commandFailed`) unless the tab is not durable. That relaxation is a follow-up, not in v1.
- **Service worker:** unchanged. It passes server functions and every non-GET straight through and never caches them
  (`pwa.md`); it does not read or send the outbox. The rollback tombstone's `reload-when-saved` needs no change: pending
  entries survive its reload.

## 8. What he sees (Jazz)

When the outbox works, he doesn't see it. It adds no "syncing" or "pending" indicator; saving and saved stay silent,
as today (`SaveIndicator`, `app-shell.tsx`). He only hears about it when a change he made did not stick, or could be
lost. Every message reuses a surface that exists today: the save-failed banner (persistent, never a toast, the same
place on every screen, at the top on the phone), the offline banner and the per-cell "Not saved" marks. Nothing new is
added.

### 8.1 Replayed fine (the common case)
- Nothing is said, and no Undo toast is shown for a replayed change (§6).
- **No flicker.** Pending entries are applied to the loaded copy (§7) before the first paint of the page they touch.
  A ticked to-do is ticked from the first frame after a reopen; it is never drawn unticked, then ticked when the
  receipt comes back. This is a check (8.7).

### 8.2 Pending while offline
- Pending changes show as made, with today's marks unchanged: a cell's and a card's "Not saved". They stay true, since
  the change isn't on the server yet.
- The offline banner states what's kept, because that's his data's state (the Quiet Copy Rule) and is now true:
  `Offline · showing what was last loaded · 2 changes will be sent` (singular: `1 change will be sent`). Before the
  outbox that line would have been a promise we couldn't keep; now it's the reassurance Lead's note to him (f7b0e525)
  points to.
- When he's back online and they're sent, the clause goes with the banner. Nothing else is said.

### 8.3 Held (a conflict or a refusal)
Shown in the save-failed banner. It **can't be dismissed**: it stays, across reloads and on every screen, until he
resolves it. A held change that only sits in a notice he closed is the silent disagreement B98 removes (Bumblebee
d21888b7).

**Copy.** `entry.label` is a past-tense verb and the item's name in quotes, the name cut to 40 characters with "…":
`ticked "Water the plants"`, `set Status on "Dune"`, `moved "Book 3"`, `deleted "Old notes"`,
`added "Call mum"`. When there's no name, it falls back to `a change on "{page}"`. The reason is in plain words:

| Server answer | Banner |
|---|---|
| row conflict (§5.3) | `Not saved — ticked "Water the plants" was changed elsewhere · Keep mine · Discard` |
| not found (deleted) | `Not saved — "Water the plants" was deleted elsewhere · Discard` |
| Cannot undo | `Can't undo — changed since · Discard` (today's words) |
| any other refusal | `Not saved — can't do this now: ticked "Water the plants" · Discard` |

- **Keep mine** (conflicts only; §6's "Apply mine anyway"): he chose to put his change on top of the newer one, so it's sent once on the latest
  revision, as a live command he made just now. It's never automatic, and never offered when the row is gone or the
  action is refused, since there's nothing to put it on.
- **Discard** drops the held entry; the page shows the latest from the server. Redoing it by hand is one tap where it
  is.
- **No Retry.** A held change would only be held again.
- **No Keep button.** Leaving the banner up is "keep": the entry stays held until he picks one of the two.
- **Text he typed is never lost to Discard.** If the held action carries text (a cell value, a title, a comment), the
  banner adds `Copy` before `Discard`, and Discard asks nothing more.
- **Show.** The item's name in the banner is a link to it: the page, scrolled to the row or to-do.

**Changes waiting behind it.** Only changes that depend on the held one wait (Lead 87eca3cf): those touching a row it
writes, or using an id it made. Everything else keeps saving. When some do wait, the banner gives the count after the
reason, because that's the part that gets riskier the longer he leaves it: ` · 2 later changes waiting`. Those changes
show on screen with today's pending marks, as when offline. When none wait, the clause is left out. If §6 finds a
dependency the entries can't see and falls back to blocking the whole queue, the same clause carries the count. Either
way, nothing waits silently behind a notice he can close.

One held entry is shown at a time, the oldest. After Keep mine or Discard, the queue moves on, and the next held entry
(if any) replaces it in the same place.

### 8.4 Not durable (storage unavailable or full)
- While commands go through, nothing is said: a tab that can't store anything still saves live, as today.
- If a change is still unsent in a tab that's not durable (offline, or a slow send), the save-failed banner warns
  before something is lost: `Not saved on this device · keep this open until it's sent`. It goes once nothing is
  pending.
- On desktop only, and only in this state, closing or reloading the tab triggers the browser's own leave prompt (§11).
  iOS doesn't fire it reliably, so the banner is the warning there.

### 8.5 Sign out or Delete account with pending changes
- Online: the pending changes are sent first (§7). The Sign out link reads `Signing out…` while they go, then signs out
  as today, asking nothing.
- If some can't be sent (offline, or held), sign-out asks once, in the existing confirm dialog style:
  title `Sign out?`, body `2 changes haven't reached the server. Signing out deletes them from this device.`,
  buttons `Sign out` (Deadline Red) and `Cancel`. Delete account uses the same body above its own confirm.
- An expired session (sent to sign-in) asks nothing: the entries wait for the same account (§7).

### 8.6 What he never sees
Another account's entries, a second tab's drain, a replay answered by a receipt or a tombstone, and an empty write set
(§5.4). All of these are silent.

### 8.7 Checks (Jazz, 390 and 1280, light and dark, Chromium and WebKit)
1. A tick is ticked on the first frame after a reopen (sample the first paint; no unticked frame). Also natively, in
   the Home Screen app (check 7).
2. Offline with 1 and 2 pending: the banner clause, singular and plural; it goes when they're sent.
3. Held: each row of the table above; Keep mine on a conflict applies it on top; Discard shows the latest; Copy on a
   text change; the banner survives a reload and can't be dismissed; a change made after the hold that doesn't depend
   on it still saves; one that does is counted in "later changes waiting".
4. Not durable: the banner appears only while something is unsent; desktop leave prompt only in that state.
5. Sign out offline with pending changes: the confirm and its count; online: `Signing out…`, then no question.

## 9. The Worker when the browser goes away mid-command

Measured locally (Roadbuster, 2026-11-14), not on Cloudflare's network:
- **Local workerd** (wrangler 4.159.0, a minimal Worker that waits 3 s, then calls out): a client that disconnected
  after 1 s did not stop the handler; its second call arrived 3 s later, like the control's.
- **Not verified on production.** Cloudflare's runtime may cancel a request's work when the client goes. The design
  doesn't depend on it: a Postgres transaction either commits or rolls back whole, and the outbox resends either way;
  the receipt (§5.1) answers the case where it did commit.

## 10. Acceptance (B98's checks, made concrete)

Browser checks (`tests/evidence/outbox/`, throwaway stores, WebKit and Chromium unless noted):
1. Tick, a cell edit, a move and a delete, each held in the browser and reloaded: applied on the next open, nothing said.
2. Three queued changes replay in the order made (store revisions in order).
3. A command that committed but whose reply was held: after the reload it is not applied twice (one operation row).
4. A refusal (row deleted elsewhere) → one notice naming it; Discard continues the queue; no `beforeunload` prompt.
5. Account: entries made as A never replay as B, and the server refuses a send whose `expectedOwner` isn't the signed-in owner before running it (a tab of A open while another tab signs in as B); sign-out deletes them after the confirm; an expired session keeps them.
6. Offline → change → reload (offline copy shows it pending) → online: replayed once.
7. Native: tick, swipe the Home Screen app away within a second, reopen: still ticked (iPhone Simulator, Jazz).
8. The floor build opens with entries stored: nothing lost, nothing sent; the next build sends them.
9. Typing and R1-18 at 390 against main, alternating.
10. Storage unavailable (IndexedDB blocked) and full (quota stubbed): sent as today; nothing claims it was kept.
11. Two tabs open on the next load: each entry applied once; the original `operationId` and action on the wire.
12. Same device: tick a to-do and type a line on the same day page, kill, reopen: both kept, no notice (Jazz).
13. Other device: tick on one device, edit another page elsewhere, reopen the first: the tick kept, no notice.
14. open → done → open: an old queued "done" for a task reopened elsewhere after its base is held, not applied.
15. A held entry holds only its dependants (a later edit of the same row); an unrelated later change is applied at once. Discard re-checks the dependants; Apply mine anyway applies a conflicted one on the latest revision; a refusal offers only Discard; the notice can't be dismissed while anything is held.

16. An entry older than every kept receipt (`baseRevision` below `receiptsForgottenThrough`, with its operation unknown) is held, never run again; including a create whose entity was then removed for good.

Unit and contract tests: the outbox state machine against a fake store (write fails, quota, two drains, owner change,
late reply); repository contract tests for `basis: 'rows'` on SQLite and Postgres (replay, tombstone, row conflict,
empty write set, deleted row); `planWrites` write sets for the commands in §5.

Also in the same PR (Lead 37e856f8): `tests/evidence/dashboard/dashboard.mjs` settles before the `goto` after the
`/ finds Database by "dashboard"` step, so WebKit's "access control checks" message (a fetch started during unload,
reported by Playwright as a page error even when caught; Roadbuster dc9541ce) no longer fails "no page errors".

## 11. Release and rollback (Lead 87eca3cf)

- **Migration:** additive and nullable, no backfill, through the existing runner, backup first. The gate rehearses it on
  a copy of his data, and runs the floor build 4dcde91a and the build live at the time against the migrated schema.
- **An old tab open during the deploy** sends commands without `basis`: the server treats them exactly as today
  (whole-revision check) and still stamps the rows they write, so nothing it does escapes the row check later. The
  gate sends such a command from the previous build's bundle against the new server.
- **A rollback, then forward again.** A build without the outbox writes rows but doesn't stamp their `revision`, so on
  the way forward those writes would be invisible to the row check, and a replay could overwrite them. So the new code
  also keeps `workspaces.rows_tracked_through` (the last revision it stamped). When it commits and finds the workspace
  revision ahead of that, an older build wrote in between: it records `rows_untracked_until` = that revision. A replay
  whose `baseRevision` is below `rows_untracked_until` gets the whole-revision rule (a conflict unless nothing moved):
  held, never overwriting. The gate covers it: new → floor (write a row) → new, then replay an entry made before.
- **A rollback while entries are stored:** the older build ignores the database (§7); a new client talking to an older
  server sends `basis`, which the older server's schema strips, so it gets today's whole-revision check: a conflict is
  held, never applied over newer data.

## 12. Decided

- **One rule for live and replayed changes** (Lead 87eca3cf): a live change refused only because the revision moved is
  resent once at once with `basis: 'rows'`.
- **`beforeunload` only when the tab couldn't store anything** (Lead 87eca3cf): while a command is pending that never
  reached IndexedDB; never when storage works.
- **Held changes block only their dependants** (Bumblebee d21888b7, Lead 87eca3cf): rows shared with the held entry,
  which includes ids it created (a created row is in its write set). If the PR finds a dependency the entries can't
  see, it says so here and that command falls back to blocking behind the held entry, with the notice not
  dismissable and its count of waiting changes. Nothing ever waits silently behind a notice he can close.
- Recovery actions (§8.3): **Keep mine** for a conflict (it applies his change on the latest data, by his choice) and
  **Discard**, plus Copy when the change carries text. There's no separate Keep button: leaving the banner up is
  keep, and the banner can't be dismissed.
