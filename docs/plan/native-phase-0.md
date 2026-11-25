# Native app, phase 0 (Ground): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brian's real workspace opens in a native Swift app on his iPhone, read only, offline too, with every one of
his documents passing the round-trip check.

**Architecture:** The server gains a small JSON API under `/api/v1`, authenticated by a bearer token, over the
functions the web app already calls. The app is four Swift packages (`DaythreadCore`, `DaythreadSync`,
`DaythreadEditor`, `DaythreadUI`) and a thin UIKit app target; it keeps the workspace on the device, shows it from
there, and sends changes through an outbox that follows `docs/design/outbox.md`. Shared JSON test cases, written by a
script from the TypeScript domain, hold the Swift core to the server's rules.

**Status (2026-11-25):** Tasks 1 to 11 built and reviewed; Task 12 steps 1 and 2 written; step 3 (his phone, his data) waits for his Apple Developer team id.

**Tech Stack:** Server: the existing TanStack Start, zod, `node --test`. App: Swift 6 language mode, UIKit, SwiftUI
(sign-in form only), SwiftData, URLSession, Security, Network, Observation, Swift Testing, XCTest. No third-party
packages.

**Spec:** `docs/design/native-app.md` (approved 2026-11-25). Executors read both.

## Global Constraints

- **Behaviour tests first (Brian, 2026-11-25).** Each task commits its failing behaviour tests on their own, as
  `test(native): … (red)`, after seeing them fail for the expected reason, and only then the commit that makes them
  pass. The tests state what a person or a client of the code observes, not how the code is arranged.
- The app holds no TypeScript, no JavaScript engine and no web view.
- Apple frameworks only; no third-party Swift packages, and no project generator checked in.
- Minimum iOS 26 and macOS 26. Packages declare `// swift-tools-version: 6.2` and Swift 6 language mode with
  complete concurrency checking.
- UIKit owns the app delegate, scenes and navigation. SwiftUI appears only inside `UIHostingController` for a form.
- `DaythreadCore` imports Foundation only. `DaythreadSync` never imports UIKit.
- The server stays the authority. Nothing in this phase changes `applyCommand`, the stored records or the cookie
  path of the web app. Cookie requests must be checked exactly as before.
- A page's `document` string is kept exactly as the server sent it. An unedited document re-encodes to the identical
  string.
- On-screen copy follows the Quiet Copy Rule: it states data or state. The offline line is the web's:
  "Offline · showing what was last loaded".
- Commit messages follow the repo's style (`feat(native): …`, `test(native): …`, `docs(native): …`), English only.
- Bundle id `app.daythread.Daythread`. Tint: Thread Blue `#0090ff` as the asset catalog's AccentColor.
- Mac Catalyst is a build destination from the first app task and must keep building; it is not polished here.

## Corrections to the design made by this plan

- **Files.** The design's `/api/files/:id` "accepting the bearer token" moves to phase 2 as `/api/v1/files/:id`. The
  gate reads a bearer on `/api/v1/` paths only and a cookie everywhere else, so one path never has two ways in.
- **Synced blocks.** The server sends pages without their synced lines (`forBrowser`); the web expands them
  (`expandedWorkspace`). Phase 0 keeps pages as sent and shows a synced block as a placeholder. The expansion is
  ported in phase 2.
- **Screens.** Phase 0 shows one screen, Today, in a navigation controller. The tab bar arrives with phase 1's
  screens.

## Review Focus

1. **A document shape the parser has not met** (` `, an escaped quote in CJK text, a lone surrogate, a number
   with an exponent, twenty levels of children): an unedited document re-encodes to the identical string; one that
   fails to parse reads as an empty page, is listed by the audit, and is never crashed on. Tests in Task 5.
2. **Another account on the same device, or a session ended by the server:** nothing of the first account is shown
   or sent after the second signs in; a reply that names another owner is dropped; a 401 shows sign-in and keeps the
   copy only until the next owner is known. Tests in Task 9.
3. **The app killed between writing an outbox entry and its reply:** the entry is sent again with the same
   operation id and lands once. Test in Task 9.
4. **A reply whose changes start from another revision than the device holds:** the workspace is loaded whole;
   changes are never applied to the wrong base. Tests in Tasks 6 and 9.
5. **The device in another time zone than the account:** Today is the account's day, not the device's. Test in
   Task 6.

---

## Part A: the server (TypeScript, on the web side)

### Task 1: The gate lets an app in by bearer token on `/api/v1/`

**Files:**
- Modify: `src/server/auth/server.ts` (`publicPaths`, `tokenOf`, `sameOrigin`, `checkRequest`)
- Test: `tests/auth.test.ts`

**Interfaces:**
- Produces: `export const isAppPath = (path: string): boolean` (true for paths starting `/api/v1/`);
  `export function tokenOf(request: Request): string | undefined` (now exported).

- [ ] **Step 1: Write the failing tests** in `tests/auth.test.ts`:

```ts
const req = (path: string, headers: Record<string, string> = {}, method = 'POST') => new Request(`https://daythread.test${path}`, { method, headers })

test('app paths: a write with no Origin and no Sec-Fetch-Site passes; a browser from another site is still refused', () => {
  assert.equal(sameOrigin(req('/api/v1/commands')), true)
  assert.equal(sameOrigin(req('/api/v1/commands', { origin: 'https://evil.example' })), false)
  assert.equal(sameOrigin(req('/api/v1/commands', { 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(sameOrigin(req('/api/v1/commands', { 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(sameOrigin(req('/api/auth/sign-in')), false, 'every other path: unchanged')
})

test('app paths read the token from Authorization only; every other path from the cookie only', () => {
  const cookie = { cookie: '__Host-daythread_session=fromcookie' }
  assert.equal(tokenOf(req('/api/v1/workspace', { authorization: 'Bearer frombearer' }, 'GET')), 'frombearer')
  assert.equal(tokenOf(req('/api/v1/workspace', cookie, 'GET')), undefined)
  assert.equal(tokenOf(req('/pages', { authorization: 'Bearer frombearer' }, 'GET')), undefined)
  assert.equal(tokenOf(req('/pages', cookie, 'GET')), 'fromcookie')
  assert.equal(tokenOf(req('/api/v1/workspace', { authorization: 'Basic abc' }, 'GET')), undefined)
})
```

- [ ] **Step 2: Run** `node --test tests/auth.test.ts`. Expected: the two new tests fail (`tokenOf` is not exported;
  `sameOrigin` returns false for the first assertion).
- [ ] **Step 3: Implement.** `isAppPath`; `tokenOf` branches on it (`Bearer ` prefix, case-insensitive scheme, the
  rest trimmed); `sameOrigin` returns true for a non-GET on an app path when both `sec-fetch-site` and `origin` are
  absent, and applies today's rule when either is present; `publicPaths` gains `/api/v1/auth/sign-in`;
  `checkRequest` appends the renewed `set-cookie` only when the path is not an app path. Rewrite the comment above
  `sameOrigin` to say why an app path may pass with neither header: a browser always sends one on a write, so a
  request with neither is not a browser, and an app path honours no cookie.
- [ ] **Step 4: Run** `node --test tests/auth.test.ts`. Expected: all pass, including every test that was there.
- [ ] **Step 5: Commit** `feat(native): the gate lets an app in by bearer token on /api/v1`.

### Task 2: Sign-in, sign-out and the account for the app

**Files:**
- Modify: `src/server/auth/server.ts` (split `handleSignIn`'s body into a shared function; add two handlers)
- Create: `src/routes/api/v1/auth/sign-in.ts`, `src/routes/api/v1/auth/sign-out.ts`, `src/routes/api/v1/account.ts`
- Modify: `src/routeTree.gen.ts` (regenerated by `npm run build`; commit the result)
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `tokenOf`, `isAppPath` (Task 1); `accountOf`, `sessions()`, `admit` (existing).
- Produces, as HTTP:
  - `POST /api/v1/auth/sign-in` body `{ email, password, timezone? }` → 200
    `{ token: string, expiresAt: string (ISO), owner: string }`; refusals are the web's statuses and bodies (401
    `wrong`, 401 `unconfirmed`, 403 `not-invited`, 429 with the wait, 503). **Never sets a cookie.**
  - `POST /api/v1/auth/sign-out` → 200 `{ ok: true }`; deletes the bearer's session.
  - `GET /api/v1/account` → 200 `{ owner: string, email: string | null, signIn: boolean }`. With sign-in off:
    `{ owner: 'local', email: null, signIn: false }`.
- Produces, as functions: `handleAppSignIn(request: Request): Promise<Response>`,
  `handleAppSignOut(request: Request): Promise<Response>`, `handleAppAccount(request: Request): Promise<Response>`.

- [ ] **Step 1: Write the failing test**, beside the existing sign-in test at `tests/auth.test.ts:239` and using its
  stores and Supabase stub:

```ts
test('app sign-in: the token comes back in the body and no cookie is set; as a bearer it is that account; sign-out ends it', async () => {
  // …the existing test's setup: PGlite, useWorkspaceStore, useSessionStore, useAccountStore, useSupabase, an invited address
  const res = await handleAppSignIn(new Request('https://daythread.test/api/v1/auth/sign-in', { method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'pw', timezone: 'America/Vancouver' }) }))
  assert.equal(res.status, 200); assert.equal(res.headers.get('set-cookie'), null)
  const { token, owner, expiresAt } = await res.json()
  assert.match(token, /^[\w-]{40,}$/); assert.equal(owner, userId); assert.ok(Date.parse(expiresAt) > Date.now())
  const asApp = (path: string, method = 'GET') => new Request(`https://daythread.test${path}`, { method, headers: { authorization: `Bearer ${token}` } })
  assert.deepEqual(await (await handleAppAccount(asApp('/api/v1/account'))).json(), { owner: userId, email: 'owner@example.com', signIn: true })
  assert.equal((await handleAppSignOut(asApp('/api/v1/auth/sign-out', 'POST'))).status, 200)
  assert.equal(await sessions().check(token), null)
  const wrong = await handleAppSignIn(new Request('https://daythread.test/api/v1/auth/sign-in', { method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'no' }) }))
  assert.equal(wrong.status, 401); assert.equal(wrong.headers.get('set-cookie'), null)
})
```

- [ ] **Step 2: Run** `node --test tests/auth.test.ts`. Expected: fails, `handleAppSignIn` is not exported.
- [ ] **Step 3: Implement.** Move everything in `handleSignIn` before its last line into
  `signInAttempt(request): Promise<Response | { token: string; expiresAt: Date; userId: string }>`; `handleSignIn`
  wraps it with the cookie as today, `handleAppSignIn` with the JSON body and `noStore`. The three route files
  follow `src/routes/api/auth/sign-in.ts`.
- [ ] **Step 4: Run** `node --test tests/auth.test.ts && npm run typecheck && npm run build`. Expected: pass; the
  build regenerates `src/routeTree.gen.ts` with the three routes.
- [ ] **Step 5: Commit** `feat(native): sign-in, sign-out and the account for the app`.

### Task 3: The workspace, commands and saves for the app

**Files:**
- Create: `src/server/api-v1.ts`, `src/routes/api/v1/workspace.ts`, `src/routes/api/v1/commands.ts`,
  `src/routes/api/v1/saves.ts`
- Modify: `src/domain/command-schema.ts` (export the outbox body's schema), `src/server/functions.ts:44-52` (use it),
  `src/routeTree.gen.ts`
- Test: `tests/api-v1.test.ts`

**Interfaces:**
- Consumes: `runOutbox` and `OutboxOutcome` (`src/server/outbox-command.ts`), `forBrowser`, `ServerRepository`,
  `commandSchema`.
- Produces, in `src/domain/command-schema.ts`: `export const outboxCommandSchema` (the `commandSchema.extend({
  expectedOwner, basis })` now inline in `runOutboxCommand`).
- Produces, in `src/server/api-v1.ts`:
  - `workspaceReply(repo: ServerRepository, owner: string, have: number | null): Promise<{ unchanged: true; revision: number; owner: string } | { workspace: Workspace; owner: string }>`
  - `commandReply(repo: ServerRepository, owner: string, body: unknown): Promise<{ status: 200; body: OutboxOutcome } | { status: 400; body: { error: 'bad-request' } }>`
  - `saveReply(repo: ServerRepository, owner: string, body: unknown): Promise<{ status: 200; body: { receipt: Receipt; changes: WorkspaceChanges; owner: string } } | { status: 400; body: { error: 'bad-request' } } | { status: 409; body: { error: 'refused'; message: string } }>`
  - `handleWorkspace`, `handleCommand`, `handleSave` `(request: Request) => Promise<Response>`: read `currentOwner() ?? 'local'` and `getRepository()`, call the three above, answer with `cache-control: no-store`.
- Produces, as HTTP: `GET /api/v1/workspace?have=<revision>`, `POST /api/v1/commands`, `POST /api/v1/saves`.
  `saves` accepts `save-editor` only; any other action is 400. A `DomainError` from the store is 409 with its
  message; anything else throws (500).

- [ ] **Step 1: Write the failing tests** in `tests/api-v1.test.ts`, on the SQLite store fixture that
  `tests/outbox-replay.test.ts` builds (reuse its `create()`):

```ts
test('workspace: whole when the app has nothing or another revision, "unchanged" when it has this one; never the receipts or the undo copy', async () => {
  const repo = create(); await repo.execute({ operationId: 'day', expectedRevision: 0, action: { type: 'ensure-day', date: '2026-10-22' } })
  const full = await workspaceReply(repo, 'local', null)
  assert.ok('workspace' in full); assert.equal(full.workspace.revision, 1); assert.deepEqual(full.workspace.receipts, {}); assert.equal(full.owner, 'local')
  assert.deepEqual(await workspaceReply(repo, 'local', 1), { unchanged: true, revision: 1, owner: 'local' })
  assert.ok('workspace' in await workspaceReply(repo, 'local', 0))
})

test('commands: the outbox rule and its outcomes; a body that is not a command is 400', async () => {
  const repo = create(); await repo.execute({ operationId: 'day', expectedRevision: 0, action: { type: 'ensure-day', date: '2026-10-22' } })
  const body = { operationId: 'add', action: { type: 'add-task', pageId: 'day:2026-10-22', title: 'Water the plants' }, expectedOwner: 'local', basis: { baseRevision: 1, ownRevisions: [], readsBeyond: false } }
  const first = await commandReply(repo, 'local', body)
  assert.equal(first.status, 200); assert.equal(first.body.status, 'applied'); assert.equal(first.body.changes.from, 1)
  assert.equal((await commandReply(repo, 'local', body)).body.status, 'applied', 'a replay answers with its receipt')
  assert.equal((await commandReply(repo, 'someone-else', body)).body.status, 'owner-mismatch')
  assert.deepEqual(await commandReply(repo, 'local', { nonsense: true }), { status: 400, body: { error: 'bad-request' } })
})

test('saves: save-editor only, checked against the whole revision; a stale one is 409 with the domain\'s words', async () => {
  const repo = create(); await repo.execute({ operationId: 'day', expectedRevision: 0, action: { type: 'ensure-day', date: '2026-10-22' } })
  const page = (await repo.load()).pages[0]!
  const save = (expectedRevision: number, operationId: string) => ({ operationId, expectedRevision, action: { type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: page.document } })
  assert.equal((await saveReply(repo, 'local', save(1, 's1'))).status, 200)
  await repo.execute({ operationId: 'next-day', expectedRevision: (await repo.load()).revision, action: { type: 'ensure-day', date: '2026-10-23' } })
  const stale = await saveReply(repo, 'local', save(1, 's2'))
  assert.equal(stale.status, 409); assert.match(stale.body.message, /Saved elsewhere/)
  assert.equal((await saveReply(repo, 'local', { operationId: 'x', expectedRevision: 2, action: { type: 'ensure-day', date: '2026-10-23' } })).status, 400)
})
```

- [ ] **Step 2: Run** `node --test tests/api-v1.test.ts`. Expected: fails, module not found.
- [ ] **Step 3: Implement** the schema export, `src/server/api-v1.ts`, the three route files, and point
  `runOutboxCommand`'s validator at `outboxCommandSchema`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: all pass.
- [ ] **Step 5: Check it end to end.** Run `npm run dev`, then
  `curl -s -X POST http://127.0.0.1:3000/api/v1/commands -H 'content-type: application/json' -d '{}'` → `{"error":"bad-request"}` with 400;
  `curl -s http://127.0.0.1:3000/api/v1/workspace | head -c 80` → starts `{"workspace":{`;
  `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/api/v1/commands -H 'origin: https://evil.example' -d '{}'` → `403`.
- [ ] **Step 6: Commit** `feat(native): the workspace, commands and saves over /api/v1`.

### Task 4: The shared test cases, and CI that keeps them honest

**Files:**
- Create: `scripts/export-core-fixtures.ts`, `fixtures/core/documents/*.json`, `fixtures/core/inline-text/cases.json`,
  `fixtures/core/changes/*.json`, `fixtures/core/today/cases.json`, `fixtures/core/README.md`,
  `.github/workflows/native.yml`
- Modify: `.github/workflows/cloudflare.yml:17` (`paths-ignore` gains `'native/**'` and `'fixtures/**'`),
  `.github/workflows/ci.yml` (one step), `package.json` (script `fixtures`)

**Interfaces:**
- Produces: `node scripts/export-core-fixtures.ts` writes the files; `--check` writes nothing and exits 1, naming
  each file that would differ. `npm run fixtures` runs the first.
- Produces, file shapes (every later Swift task reads these):
  - `documents/<name>.json`: `{ "document": string }`, the page's stored string.
  - `inline-text/cases.json`: `[{ "content": <json>, "pageDate": string | null, "text": string }]` from `inlineText`.
  - `changes/<name>.json`: `{ "before": Workspace, "changes": WorkspaceChanges, "after": Workspace }`, where `before`
    and `after` are as the app holds them (`forBrowser`, pages without synced lines).
  - `today/cases.json`: `[{ "timezone": string, "at": string (ISO), "day": string }]` from `localDay`'s rule.

- [ ] **Step 1: Write the script.** It builds its workspaces with `tests/v2-helpers.ts` (`harness`, `todo`,
  `bullet`, `para`, `heading`, `chip`, `pageRef`, `card`). One document is named `day-with-everything.json` (later
  tasks read it by that name): a day page for 2026-10-22 holding at least one of each kind below that a day page
  can hold, with a top-level paragraph, a numbered run broken by a bullet, a done to-do, an open one, and a to-do
  row whose task is not in the workspace. Its workspace is written beside it as
  `fixtures/core/workspaces/day-with-everything.json` (`forBrowser`'s form). The documents must between them hold: every line type the
  `/` menu and the Aa panel make (paragraph, three heading levels, bullet, numbered, quote, separator, to-do row
  with role `plan` and with role `reference`), nesting three deep, a `dateMention` with and without a time, a
  `pageRef`, a link, each text style, a `pageLink` card, a `database` block, a synced block, a `button`, a
  `smartNote`, an image and a file block, an empty document, Chinese text, an emoji outside the BMP, a `"` and a `\`
  in text, and the characters U+2028 and U+0007. The `changes` cases: a task ticked; a task added (page and task
  upserted); a page removed; a reorder that sets `order`; one whose `from` is not `before.revision`, with
  `"after": null`. The `today` cases: `America/Vancouver` and `Asia/Shanghai` at 2026-10-22T06:30:00Z,
  2026-10-22T07:00:00Z (Vancouver's midnight), 2026-10-22T16:00:00Z (Shanghai's midnight), and
  2026-03-08T09:59:00Z and 10:00:00Z (Vancouver's clock change).
- [ ] **Step 2: Run** `node scripts/export-core-fixtures.ts && node scripts/export-core-fixtures.ts --check`.
  Expected: files written; the check exits 0. Edit one file by hand, run `--check`: exits 1 and names it. Restore it.
- [ ] **Step 3: CI.** In `ci.yml`, after the tests: `node scripts/export-core-fixtures.ts --check`. Create
  `native.yml`: on `pull_request` and `push` to main with `paths: ['native/**', 'fixtures/**', '.github/workflows/native.yml']`,
  `runs-on: macos-latest`, steps: checkout; `sudo xcode-select -s` to the newest Xcode on the image; `swift test`
  in `native/Packages/DaythreadCore` and `native/Packages/DaythreadSync` (the two that build without UIKit);
  `xcodebuild test` for the `Daythread` scheme on an iOS Simulator and `xcodebuild build` for Mac Catalyst once
  `native/Daythread.xcodeproj` exists. Guard each with `if [ -d … ]` so this task's PR is green. If the image's
  newest Xcode cannot build for iOS 26, say so in the PR; the job then runs the two `swift test` steps only until
  the image catches up.
- [ ] **Step 4: Commit** `test(native): shared core cases from the domain, checked in CI`.

---

## Part B: the app (Swift)

Layout, all created by the tasks below:

```text
native/
├── Daythread.xcodeproj
├── App/                       AppDelegate.swift, SceneDelegate.swift, Info.plist, Assets.xcassets
└── Packages/
    ├── DaythreadCore/         Sources/DaythreadCore, Tests/DaythreadCoreTests
    ├── DaythreadSync/         Sources/DaythreadSync, Tests/DaythreadSyncTests
    ├── DaythreadEditor/       Sources/DaythreadEditor, Tests/DaythreadEditorTests
    └── DaythreadUI/           Sources/DaythreadUI
```

Every package's tests find the cases at `../../../fixtures/core` from the package root, through one helper
(`Fixtures.url(_ path: String) -> URL`, built from `#filePath`) in each test target.

### Task 5: `DaythreadCore`: JSON that survives, and the document

**Files:**
- Create: `native/Packages/DaythreadCore/Package.swift`, `Sources/DaythreadCore/JSONValue.swift`,
  `Sources/DaythreadCore/JSONParser.swift`, `Sources/DaythreadCore/JSONWriter.swift`,
  `Sources/DaythreadCore/Block.swift`, `Sources/DaythreadCore/Document.swift`
- Test: `Tests/DaythreadCoreTests/JSONRoundTripTests.swift`, `Tests/DaythreadCoreTests/DocumentTests.swift`

**Interfaces:**
- Produces:

```swift
public enum JSONValue: Hashable, Sendable {
  case null, bool(Bool), string(String)
  case number(String)                         // the token as written, so it is written back the same
  case array([JSONValue])
  case object(JSONObject)
  public var stringValue: String? { get }; public var arrayValue: [JSONValue]? { get }; public var objectValue: JSONObject? { get }
  public var intValue: Int? { get }; public var boolValue: Bool? { get }
}
public struct JSONObject: Hashable, Sendable {   // keys in the order they were read
  public private(set) var keys: [String]
  public subscript(key: String) -> JSONValue? { get set }   // a new key is appended; nil removes
}
public enum JSON {
  public static func parse(_ text: String) throws -> JSONValue
  public static func write(_ value: JSONValue) -> String    // as JSON.stringify writes: no spaces; escapes only ", \, and below U+0020 (\b \t \n \f \r, else \u00XX); a lone surrogate as \uDXXX
}
public struct Block: Hashable, Sendable, Identifiable {
  public var id: String
  public var type: String
  public var props: JSONObject
  public var content: JSONValue?            // absent, an array of inline items, or anything else: kept as is
  public var children: [Block]
  public var raw: JSONObject                // the node as read; fields this struct does not name are written back from here, in place
}
public enum Document {
  public static func blocks(_ document: String) -> [Block]          // a string that fails to parse reads as []
  public static func parses(_ document: String) -> Bool
  public static func write(_ blocks: [Block]) -> String
}
```

- [ ] **Step 1: Write the failing tests.** `Fixtures.documentStrings()` and `Fixtures.document(_ name:)` read
  `fixtures/core/documents`; `textRun(_:)` is a test helper making `{"type":"text","text":…,"styles":{}}`.

```swift
@Test(arguments: try Fixtures.documentStrings())
func unedited_document_writes_back_identically(_ s: String) throws {
  #expect(JSON.write(try JSON.parse(s)) == s)
  #expect(Document.write(Document.blocks(s)) == s)
}
@Test func editing_one_block_leaves_every_other_block_as_it_was() throws {
  let s = try Fixtures.document("day-with-everything"); var blocks = Document.blocks(s)
  let i = try #require(blocks.firstIndex { $0.type == "paragraph" })
  blocks[i].content = .array([.object(textRun("changed"))])
  let before = try JSON.parse(s).arrayValue!, after = try JSON.parse(Document.write(blocks)).arrayValue!
  for j in before.indices where j != i { #expect(before[j] == after[j]) }
  #expect(before[i] != after[i])
}
@Test func writer_matches_JSON_stringify_on_the_hard_characters() throws {
  #expect(JSON.write(.string("a\"b\\c\u{07}\u{2028}中😀\n")) == #""a\"b\\c\u0007\#u{2028}中😀\n""#)
  #expect(JSON.write(try JSON.parse(#"{"b":1e21,"a":-0.5,"c":[]}"#)) == #"{"b":1e21,"a":-0.5,"c":[]}"#)
}
@Test func a_document_that_is_not_JSON_reads_as_empty_and_says_so() {
  #expect(Document.blocks("{not json").isEmpty); #expect(!Document.parses("{not json")); #expect(Document.parses("[]"))
}
@Test func twenty_levels_of_children_survive() throws { /* build 20 nested nodes as a string; write(blocks(s)) == s */ }
```

- [ ] **Step 2: Run** `cd native/Packages/DaythreadCore && swift test`. Expected: does not compile (no sources).
- [ ] **Step 3: Implement** the parser (recursive descent over the string's UTF-8; `\uXXXX` pairs joined into one
  scalar, a lone surrogate kept as the escape it was), the writer, `Block` (read from and written through `raw`, so
  key order and unknown fields are untouched), and `Document`.
- [ ] **Step 4: Run** `swift test`. Expected: all pass, on every file in `fixtures/core/documents`.
- [ ] **Step 5: Commit** `feat(native): the core reads and writes a document without changing it`.

### Task 6: `DaythreadCore`: the workspace, its changes, and what Today reads

**Files:**
- Create: `Sources/DaythreadCore/Workspace.swift`, `Sources/DaythreadCore/WorkspaceChanges.swift`,
  `Sources/DaythreadCore/LocalDate.swift`, `Sources/DaythreadCore/InlineText.swift`,
  `Sources/DaythreadCore/DateMention.swift`, `Sources/DaythreadCore/Audit.swift`
- Test: `Tests/DaythreadCoreTests/WorkspaceTests.swift`, `ChangesTests.swift`, `InlineTextTests.swift`,
  `TodayTests.swift`

**Interfaces:**
- Consumes: `JSONValue`, `JSONObject`, `JSON`, `Block`, `Document` (Task 5).
- Produces:

```swift
public struct LocalDate: Hashable, Comparable, Sendable { public let value: String   // "2026-10-22"
  public init?(_ value: String); public static func today(in timezone: String, at: Date) -> LocalDate }
public struct Page: Hashable, Sendable, Identifiable {
  public let id: String; public let type: String; public let date: LocalDate?; public let title: String
  public let parentId: String?; public let trashedAt: String?; public let document: String
  public let raw: JSONObject                       // everything the server sent, for fields later phases read
  public init?(_ json: JSONValue) }
public struct TodoTask: Hashable, Sendable, Identifiable {   // `Task` in the domain; renamed, Swift has its own Task
  public enum Status: String, Sendable { case open, done, cancelled }
  public let id: String; public let title: String; public let status: Status; public let paused: Bool
  public let deadlineOn: LocalDate?; public let attentionOn: LocalDate?; public let raw: JSONObject
  public init?(_ json: JSONValue) }
public struct Workspace: Hashable, Sendable {
  public var revision: Int; public var timezone: String; public var pages: [Page]; public var tasks: [TodoTask]
  public var rest: JSONObject                       // every other top-level field, as sent
  public init?(_ json: JSONValue); public func json() -> JSONValue
  public func page(_ id: String) -> Page?; public func task(_ id: String) -> TodoTask?
  public func dayPage(_ date: LocalDate) -> Page?   // id "day:<date>"
}
public struct WorkspaceChanges: Sendable {
  public let from: Int; public let revision: Int
  public let upsertedPageIds: [String]; public let removedPageIds: [String]; public let pagesReordered: Bool
  public let upsertedTaskIds: [String]; public let removedTaskIds: [String]; public let tasksReordered: Bool
  public init?(_ json: JSONValue) }
extension Workspace { public func applying(_ changes: WorkspaceChanges) -> Workspace? }   // nil: not the copy they start from
public enum InlineText { public static func plain(_ content: JSONValue?, pageDate: LocalDate?) -> String }
public enum Audit { public static func pagesThatDoNotRoundTrip(_ workspace: Workspace) -> [String] }   // page ids
```

- `applying` ports `applyChanges` in `src/domain/workspace-changes.ts` without its last step (`expandedWorkspace`):
  `pages` and `tasks` by `upsert`/`remove`/`order`; `timezone`, `weekStart`, `todoAutomationsUnreadable` and `undo`
  set or removed as there; `deletedTasks`, `synced`, `smartNotes`, `threads`, `links`, `todoRepeats` and
  `todoAutomations` replaced whole when present, with its rules for an empty list and for `todoAutomations: null`.
- `InlineText.plain` ports `inlineText` in `src/domain/editor-document.ts` and `mentionText` in
  `src/domain/date-chip.ts`.
- `LocalDate.today` is the account's day (`localDay` in `src/domain/workspace.ts:865`), never the device's.

- [ ] **Step 1: Write the failing tests.** Each reads its cases from `fixtures/core`:
  - `ChangesTests`: for every file in `changes/`, `Workspace(before)!.applying(WorkspaceChanges(changes)!)?.json() == after`
    (compared as `JSONValue`; `nil == null` for the wrong-base case).
  - `InlineTextTests`: every case's `plain(content, pageDate:) == text`.
  - `TodayTests`: every case's `LocalDate.today(in: timezone, at: at).value == day`; plus one with the process's
    default time zone set to `Asia/Tokyo` and the account's `America/Vancouver`, asserting Vancouver's day.
  - `WorkspaceTests`: `Workspace(json)!.json() == json` for every `before`; `dayPage` finds `day:2026-10-22`; a page
    missing `id` makes `Page(_:)` nil and the workspace nil; `Audit.pagesThatDoNotRoundTrip` is empty for every
    fixture workspace and returns the id of a page whose `document` is `"{not json"`.
- [ ] **Step 2: Run** `swift test`. Expected: does not compile.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `swift test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): the workspace, its changes and the day in the core`.

### Task 7: `DaythreadSync`: the server client and the token

**Files:**
- Create: `native/Packages/DaythreadSync/Package.swift`, `Sources/DaythreadSync/ServerTransport.swift`,
  `Sources/DaythreadSync/URLSessionTransport.swift`, `Sources/DaythreadSync/TokenStore.swift`,
  `Sources/DaythreadSync/KeychainTokenStore.swift`
- Test: `Tests/DaythreadSyncTests/URLSessionTransportTests.swift`, `TokenStoreTests.swift`

**Interfaces:**
- Consumes: `Workspace`, `WorkspaceChanges`, `JSONValue`, `JSON` (Tasks 5, 6); the HTTP shapes of Tasks 2 and 3.
- Produces:

```swift
public struct Session: Sendable, Equatable { public let token: String; public let owner: String; public let expiresAt: Date }
public struct Account: Sendable, Equatable { public let owner: String; public let email: String?; public let signIn: Bool }
public enum TransportError: Error, Equatable { case offline, signedOut, refused(status: Int, reason: String?), wait(seconds: Int), server(status: Int), unreadable }
public enum WorkspaceReply: Sendable { case unchanged(revision: Int, owner: String), full(Workspace, owner: String) }
public struct OutboxBasis: Sendable, Equatable { public var baseRevision: Int; public var ownRevisions: [Int]; public var readsBeyond: Bool }
public enum CommandOutcome: Sendable {
  case applied(receipt: JSONValue, changes: WorkspaceChanges, owner: String)
  case held(reason: String, rows: [String], stale: Bool, owner: String)
  case alreadyApplied(owner: String), refused(message: String, owner: String), ownerMismatch(owner: String)
}
public protocol ServerTransport: Sendable {
  func signIn(email: String, password: String, timezone: String) async throws -> Session
  func signOut(token: String) async throws
  func account(token: String?) async throws -> Account
  func workspace(token: String?, have: Int?) async throws -> WorkspaceReply
  func send(token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis) async throws -> CommandOutcome
}
public struct URLSessionTransport: ServerTransport { public init(baseURL: URL, session: URLSession = .shared) }
public protocol TokenStore: Sendable { func read() throws -> Session?; func write(_ session: Session) throws; func clear() throws }
public final class KeychainTokenStore: TokenStore { public init(service: String = "app.daythread.Daythread") }
public final class MemoryTokenStore: TokenStore { public init() }
```

- Errors map: `URLError` of the network kinds (`notConnectedToInternet`, `networkConnectionLost`, `timedOut`,
  `cannotFindHost`, `cannotConnectToHost`, `dataNotAllowed`) → `.offline`; 401 `{error:'signed-out'}` → `.signedOut`;
  401 or 403 from sign-in → `.refused(status, reason)` with the body's reason (`wrong`, `unconfirmed`,
  `not-invited`); 429 → `.wait`; 5xx → `.server`; a 2xx body that does not read → `.unreadable`.
- The Keychain item is a generic password, `kSecAttrAccessibleAfterFirstUnlock`, holding the session as JSON.

- [ ] **Step 1: Write the failing tests** with a `URLProtocol` stub that records each request and answers from a
  table: the sign-in request is `POST /api/v1/auth/sign-in` with a JSON body and no `Authorization`; every other
  request with a token carries `Authorization: Bearer <token>`; no request carries a `Cookie`; `workspace(have: 7)`
  asks `?have=7` and reads both replies; each outcome of `/api/v1/commands` decodes to its case; each error in the
  map above. `TokenStoreTests` runs write, read, clear on `MemoryTokenStore`, and on `KeychainTokenStore` under a
  random service name (skipped where the Keychain is unavailable).
- [ ] **Step 2: Run** `cd native/Packages/DaythreadSync && swift test`. Expected: does not compile.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `swift test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): the server client and the session in the Keychain`.

### Task 8: `DaythreadSync`: the store on the device

**Files:**
- Create: `Sources/DaythreadSync/WorkspaceStore.swift`, `Sources/DaythreadSync/MemoryWorkspaceStore.swift`,
  `Sources/DaythreadSync/SwiftDataWorkspaceStore.swift`, `Sources/DaythreadSync/OutboxEntry.swift`
- Test: `Tests/DaythreadSyncTests/WorkspaceStoreContract.swift` (the cases, generic over the store),
  `MemoryWorkspaceStoreTests.swift`, `SwiftDataWorkspaceStoreTests.swift`

**Interfaces:**
- Produces:

```swift
public struct OutboxEntry: Sendable, Equatable, Identifiable {
  public enum Kind: String, Sendable { case command, save }        // one queue for both (design §7); only `command` is sent in phase 0
  public enum State: String, Sendable { case pending, held }
  public var id: Int { seq }
  public let seq: Int; public let kind: Kind; public let owner: String; public let operationId: String
  public let action: JSONValue; public let baseRevision: Int; public var ownRevisions: [Int]
  public let label: String; public let createdAt: Date; public var state: State; public var reason: String?
}
public struct NewOutboxEntry: Sendable { /* OutboxEntry without seq */ }
public protocol WorkspaceStore: Sendable {
  func load() async throws -> (workspace: Workspace, owner: String)?
  func replace(with workspace: Workspace, owner: String) async throws          // another owner's rows and outbox entries go first
  func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws   // only the rows the changes name
  func entries() async throws -> [OutboxEntry]                                  // by seq
  func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry
  func update(_ entry: OutboxEntry) async throws
  func remove(seq: Int) async throws
  func erase() async throws
}
public actor MemoryWorkspaceStore: WorkspaceStore { public init() }
@ModelActor public actor SwiftDataWorkspaceStore: WorkspaceStore { public static func open(at url: URL?) throws -> SwiftDataWorkspaceStore }   // nil: in memory
```

- SwiftData models (internal): `PageRow(id, position, json)`, `TaskRow(id, position, json)`,
  `MetaRow(owner, revision, restJSON)`, `OutboxRow(seq, …)`. `json` is `JSON.write` of the row as the server sent it.

- [ ] **Step 1: Write the contract** as functions taking `any WorkspaceStore`, run by both test files: nothing kept
  loads as nil; `replace` then `load` gives an equal workspace and owner, pages and tasks in order; `write` with a
  fixture's changes then `load` equals the fixture's `after`; `replace` under another owner drops the first owner's
  outbox entries; `append` gives rising `seq` that never repeats after `remove`; `update` keeps `state` and `reason`;
  `erase` leaves nothing; and, for SwiftData only, a second store opened at the same URL loads what the first wrote.
- [ ] **Step 2: Run** `swift test`. Expected: does not compile.
- [ ] **Step 3: Implement** both stores.
- [ ] **Step 4: Run** `swift test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): the workspace and the outbox kept on the device`.

### Task 9: `DaythreadSync`: the engine

**Files:**
- Create: `Sources/DaythreadSync/SyncEngine.swift`, `Sources/DaythreadSync/SyncState.swift`
- Test: `Tests/DaythreadSyncTests/SyncEngineTests.swift`, `Tests/DaythreadSyncTests/FakeTransport.swift`

**Interfaces:**
- Consumes: `ServerTransport`, `TokenStore`, `WorkspaceStore`, `OutboxEntry` (Tasks 7, 8).
- Produces:

```swift
public struct SyncState: Sendable, Equatable {
  public enum Phase: Sendable, Equatable { case starting, signedOut, ready }
  public var phase: Phase
  public var workspace: Workspace?
  public var offline: Bool            // the last try to reach the server failed for lack of network
  public var held: Int                // outbox entries waiting for him
}
public actor SyncEngine {
  public init(transport: any ServerTransport, tokens: any TokenStore, store: any WorkspaceStore, now: @escaping @Sendable () -> Date = Date.init)
  public nonisolated var states: AsyncStream<SyncState> { get }      // the current state at once, then each change
  public func start() async                    // the device's copy first, then the server
  public func signIn(email: String, password: String, timezone: String) async throws
  public func signOut() async
  public func refresh() async                  // ask the server; opening, returning to the app, pull to refresh
  public func enqueue(action: JSONValue, label: String) async     // written to the store before anything is sent
}
```

- Rules, each from `docs/design/outbox.md` and `docs/design/pwa.md` and each a test below:
  - `start` publishes the stored workspace before any request, then calls `account`, then `refresh`.
  - With no token: `account(token: nil)`; `signIn: false` (the Mac's server) → ready as owner `local`;
    `.signedOut` → phase `signedOut`.
  - `refresh` sends `have:` the held revision; `.unchanged` writes nothing.
  - A reply under an owner other than the store's: `replace`, which drops the other owner's entries.
  - On opening, when the account's today (`LocalDate.today(in: workspace.timezone, at: now())`) has no day page,
    enqueue `{"type":"ensure-day","date":<today>}` once.
  - The outbox drains in `seq` order, one at a time, `basis.baseRevision` = the entry's, `readsBeyond: true`
    (stated conservatively until a command's reads are ported, design §6).
  - `.applied`: `applying(changes)`; nil (another base) → a full load; then `store.write`, remove the entry, add the
    new revision to each later entry's `ownRevisions`.
  - `.alreadyApplied`: remove the entry and load whole. `.held` and `.refused`: the entry becomes `held` with the
    reason and stays; later entries still go. `.ownerMismatch`: stop, load whole under the new owner.
  - `.offline`: `offline = true`, the entry stays `pending`, nothing is dropped. `.signedOut`: phase `signedOut`;
    the copy and the outbox stay until the next sign-in names its owner.
  - `signOut`: the server is told, then `store.erase()` and `tokens.clear()` whatever the server answered.

- [ ] **Step 1: Write the failing tests** against `FakeTransport` (a scripted list of replies, recording calls) and
  `MemoryWorkspaceStore`, one per rule above, by name:
  `shows_the_stored_copy_before_the_first_request`, `local_server_needs_no_sign_in`,
  `no_session_is_signed_out`, `unchanged_reply_writes_nothing`, `another_owner_replaces_everything_and_drops_their_outbox`,
  `ensures_today_in_the_accounts_zone_once`, `drains_in_order_with_the_entrys_base`,
  `applied_changes_are_written_and_later_entries_learn_the_revision`,
  `changes_from_another_base_load_the_workspace_whole`, `held_entry_stays_and_later_ones_still_go`,
  `offline_keeps_everything_and_says_so`, `a_401_shows_sign_in_and_keeps_the_copy_until_the_next_owner`,
  `sign_out_erases_even_when_the_server_is_unreachable`,
  `an_entry_written_but_never_answered_is_sent_again_with_the_same_operation_id` (make an engine, enqueue, let the
  transport hang; make a second engine on the same store; it sends the same `operationId`).
- [ ] **Step 2: Run** `swift test`. Expected: does not compile.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `swift test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): the engine that keeps the device, the outbox and the server in step`.

### Task 10: `DaythreadEditor`: a page, drawn, read only

**Files:**
- Create: `native/Packages/DaythreadEditor/Package.swift`, `Sources/DaythreadEditor/DocumentViewController.swift`,
  `Sources/DaythreadEditor/BlockRow.swift`, `Sources/DaythreadEditor/BlockRows.swift`,
  `Sources/DaythreadEditor/InlineAttributedText.swift`, `Sources/DaythreadEditor/Cells/TextBlockCell.swift`,
  `Cells/TodoBlockCell.swift`, `Cells/SeparatorBlockCell.swift`, `Cells/PlaceholderBlockCell.swift`
- Test: `Tests/DaythreadEditorTests/BlockRowsTests.swift`, `InlineAttributedTextTests.swift`

**Interfaces:**
- Consumes: `Block`, `Document`, `Workspace`, `TodoTask`, `InlineText`, `LocalDate` (Tasks 5, 6).
- Produces:

```swift
public struct BlockRow: Hashable, Sendable, Identifiable {
  public enum Kind: Hashable, Sendable {
    case text(style: TextStyle)                          // paragraph, heading(1...3), bullet, numbered(Int), quote
    case todo(status: TodoTask.Status?, paused: Bool)    // nil: a row whose task the workspace does not hold yet
    case separator
    case placeholder(name: String)                       // a block this version does not draw
  }
  public let id: String; public let kind: Kind; public let depth: Int; public let content: JSONValue?
}
public enum BlockRows { public static func rows(for page: Page, in workspace: Workspace) -> [BlockRow] }
public enum InlineAttributedText { public static func make(_ content: JSONValue?, pageDate: LocalDate?, in workspace: Workspace) -> AttributedString }
@MainActor public final class DocumentViewController: UIViewController {
  public init(); public func show(page: Page, in workspace: Workspace)     // diffed; scroll position kept
}
```

- `rows` flattens the document depth first, a child one deeper than its parent; numbered items count from 1 within a
  run of siblings. A to-do row's status is its task's (`props.taskId`), never the row's. Placeholder names, as shown:
  `database` → "Database", `pageLink` → "Page", `image` → "Image", `file` → "File", `button` → "Button",
  `smartNote` → "Smart note", a synced block → "Synced block", `table` → "Table", `codeBlock` → "Code", anything
  else → "Block".
- `InlineAttributedText`: bold, italic, underline, strike and code from a text run's `styles`; a link keeps its
  text with the link attribute; a `dateMention` reads as `InlineText` gives it; a `pageRef` reads as the page's
  title, or "Untitled".
- `DocumentViewController`: a `UICollectionView` with a list layout (plain appearance, no separators), a diffable
  data source over `BlockRow`, system text styles (`.title1`, `.title2`, `.title3`, `.body`), the system's
  checkmark symbols for a to-do (`circle`, `checkmark.circle.fill`), `.secondaryLabel` and a strikethrough for a
  done title, 20 pt of indent per depth, and Dynamic Type throughout. Nothing is tappable in this phase.

- [ ] **Step 1: Write the failing tests** on the fixture documents: the rows of `day-with-everything` in order, by
  kind and depth; numbering restarts after a non-numbered sibling; a to-do row takes `done` from its task and `nil`
  when the task is absent; each placeholder name; a `dateMention` and a `pageRef` inside a bold run produce the
  expected string and attributes.
- [ ] **Step 2: Run** `xcodebuild test -scheme DaythreadEditor -destination 'platform=iOS Simulator,name=iPhone 17'`
  from the package directory. Expected: does not compile.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): a page drawn from its document, read only`.

### Task 11: The app: sign in, and Today

**Files:**
- Create: `native/Daythread.xcodeproj` (one app target, `Daythread`, destinations iPhone, iPad and Mac Catalyst;
  the four local packages linked; a UI test target `DaythreadUITests`), `native/App/AppDelegate.swift`,
  `native/App/SceneDelegate.swift`, `native/App/Info.plist`, `native/App/Assets.xcassets` (AccentColor `#0090ff`,
  the app icon from `public/icon-512.png`'s source via `scripts/render-icons.mjs`),
  `native/Packages/DaythreadUI/Package.swift`, `Sources/DaythreadUI/AppModel.swift`,
  `Sources/DaythreadUI/RootViewController.swift`, `Sources/DaythreadUI/TodayViewController.swift`,
  `Sources/DaythreadUI/SignInView.swift`, `Sources/DaythreadUI/DayTitle.swift`,
  `native/UITests/TodayUITests.swift`, `native/README.md`

**Interfaces:**
- Consumes: `SyncEngine`, `SyncState`, `URLSessionTransport`, `KeychainTokenStore`, `SwiftDataWorkspaceStore`
  (Tasks 7 to 9); `DocumentViewController` (Task 10); `Audit` (Task 6).
- Produces:

```swift
@MainActor @Observable public final class AppModel {
  public private(set) var state: SyncState
  public init(engine: SyncEngine); public func start()             // follows engine.states
  public func signIn(email: String, password: String) async -> SignInFailure?
  public func signOut() async; public func refresh() async
}
public enum SignInFailure: Equatable { case wrong, unconfirmed, notInvited, wait(seconds: Int), offline, unavailable }
public enum DayTitle { public static func text(for date: LocalDate, locale: Locale = .current) -> String }   // "Thursday, Oct 22"
```

- The server: `Info.plist` key `DaythreadServerURL`. Debug: `http://127.0.0.1:3000`, with
  `NSAllowsLocalNetworking`. Release: `https://daythread.dogrod.com`. A launch argument `-DaythreadServerURL <url>`
  overrides both, for UI tests.
- `RootViewController` shows nothing while `starting` and a stored workspace is absent, `SignInView` in a
  `UIHostingController` when `signedOut`, and a `UINavigationController` holding `TodayViewController` when ready.
- `SignInView`: the title "Daythread", an email field, a password field, a "Sign in" button; the failure line under
  the button uses the web's words (`src/routes/sign-in.tsx`). Nothing else on the screen.
- `TodayViewController`: a large title from `DayTitle`; its child is `DocumentViewController` showing the account's
  today; pull to refresh calls `refresh`; while `state.offline`, the navigation item's prompt reads
  "Offline · showing what was last loaded"; the account's address and "Sign out" are in a menu on a trailing bar
  button (`person.crop.circle`). It refreshes when the scene comes to the foreground and when the day changes
  (`UIApplication.significantTimeChangeNotification`).
- In Debug builds, after each full load, `Audit.pagesThatDoNotRoundTrip` runs off the main actor and logs the count
  and the ids with `os.Logger` (subsystem `app.daythread.Daythread`, category `audit`); the account menu gains a
  disabled first row, "Round trip · N of M pages fail", shown only when N > 0.
- `native/README.md`: how to build, run against `npm run dev`, run the tests, and read the audit.

- [ ] **Step 1: Write the failing tests.** `DayTitle` unit tests ("Thursday, Oct 22" for `2026-10-22` in `en_US`).
  UI test `TodayUITests.test_today_opens_from_the_server_and_again_with_no_server`: start `npm run dev` on a
  throwaway SQLite directory (as `scripts/sqlite-browser-smoke.mjs` does) seeded through `/api/v1/commands` with an
  `ensure-day` and an `add-task` titled "Water the plants"; launch with `-DaythreadServerURL`; assert the title is
  today's and a cell reads "Water the plants"; terminate; stop the server; launch again; assert the same cell and
  the offline line.
- [ ] **Step 2: Run** `xcodebuild test -project native/Daythread.xcodeproj -scheme Daythread -destination 'platform=iOS Simulator,name=iPhone 17'`.
  Expected: fails (no project).
- [ ] **Step 3: Implement.** The project uses file-system-synchronised groups, so files added under `native/App`
  and `native/UITests` need no project edit.
- [ ] **Step 4: Run** the tests, then
  `xcodebuild build -project native/Daythread.xcodeproj -scheme Daythread -destination 'platform=macOS,variant=Mac Catalyst'`.
  Expected: tests pass; the Mac build succeeds.
- [ ] **Step 5: Look at it.** In the iPhone 17 Simulator, against `npm run dev` on a copy of Brian's local data:
  Today in light and dark, at the default and the largest accessibility text size; the sign-in screen against a
  server with sign-in on (`scripts/fake-supabase-auth.mjs`). Save the screenshots under
  `tests/evidence/native-phase-0/` and list in the PR anything that reads wrong.
- [ ] **Step 6: Commit** `feat(native): the app signs in and shows Today from the device`.

### Task 12: On his phone, on his data

Needs from Brian: his Apple Developer team id, set as the target's team (design §12). Nothing in this task is code.

- [ ] **Step 1:** Record what phase 0 holds in `docs/plan/native-parity.md` (created here): one row per web screen
  and block kind, each `built`, `placeholder` or `absent`.
- [ ] **Step 2:** Update `PRODUCT.md` (Platform: `web, ios, macos`; Operating Context gains the native app and what
  it does today) and add `docs/design/native-system.md` with the tint, the mark, the voice and the list of views
  built under the design's rule 3 (so far: the editor's cells).
- [ ] **Step 3:** After the server tasks are live, install a Release build on Brian's iPhone. He signs in.
  Done when: Today shows his day; with Airplane Mode on, a relaunch shows it again with the offline line; and a
  Debug build pointed at production reports "0 of N pages fail" in the audit log. Any page that fails is a bug in
  Task 5, fixed with its document's shape added to the script in Task 4 before phase 1 starts.
- [ ] **Step 4: Commit** `docs(native): phase 0 results, the parity list and the app's design notes`.

## Order and independence

- Tasks 1 to 3 are one PR to the server and deploy on merge; they change nothing the web app does. Task 4 is its
  own PR.
- Tasks 5 and 6 depend only on Task 4's files. Task 7 needs 5 and 6 and the shapes of 2 and 3. Tasks 8 and 9
  follow 7. Task 10 needs only 5 and 6, so it can run beside 7 to 9. Task 11 needs all of them.
- After Task 11, phase 1's design is written against what exists: the editor's editing, prediction, the save path
  and the day draft.

## Carried to phase 1 (from the reviews, 2026-11-25)

Every task was reviewed on its own, then the whole branch once. What those reviews found and did not fix here, by
the point at which it has to be settled. Nothing on this list is needed for phase 0 to be safe to merge.

**Before the app sends a page save**
- `/api/v1/saves` has no `expectedOwner`; a save made under one account and sent under another is stopped only by
  the content and revision checks.
- A block key the app adds lands after `children`; the web's order is id, type, props, content, children.

**Before the app can make an edit**
- Sign-out with unsent changes erases them without draining or warning.
- A copy without its session is hidden and kept. With an empty outbox there is nothing to protect, and erasing on
  a definite signed-out answer would suit a shared device better.
- A store that cannot open falls back to memory with only a log line, so the outbox would not survive a relaunch.
- No test forces a failure inside a store transaction to prove the rollback.
- A held `ensure-day` is never asked again that day, and nothing on screen shows a held change.
- A new value in a server enum (a task status, say) makes the whole workspace unreadable on an installed app.
  Either enums never grow, or the readers become lenient per row.

**With phase 1's screens**
- Rows on a page are 44 pt apart; date chips and page references draw as plain text.
- The engine does not publish the account's address, so the menu shows it only after a sign-in on that launch.
- The account menu is rebuilt on every state change; two fast phase changes overlap their dissolves. (A tap on
  the account button "not opening its menu" right after sign-in, seen while taking the screenshots, was looked
  into and is not this: the system's "Save Password?" sheet is over the app then. No state change arrives
  during those taps, and with the sheet answered the menu opens on the first tap, three times out of three.)
- Cell polish: the hairline's height, markers and right-to-left, the marker column past "99.", an empty paragraph's
  height, the divider and quote bar against safe-area margins.
- The day-change refresh follows the device's midnight, not the account's.
- A time zone name the server accepts and Foundation does not (lower case, "+05:30") reads as GMT.

**With the next route or the next fixtures change**
- The test that every v1 route uses `appRoute` should call each handler with a non-app path, not scan the source.
- `workspaceReply` loads the whole workspace to answer "unchanged".
- `write(_:changed:)` serialises every row on each acknowledged command although it writes only the named ones.
- The fixtures script's own check compares pages only; its README says "no undo copy" where the marker is present.
- The server origin's slug can make two contrived origins collide (`localhost:3741`, `localhost-3741`).

**Cannot be known until it happens**
- `native.yml` first ran on a hosted runner on the pull request and passed (Xcode 26.6: the three packages, the
  page view's simulator suite, the app's unit tests, the Mac Catalyst build).
- Production with the new routes: after the deploy, a cookie alone on `/api/v1/account` must get 401, a foreign
  `Origin` on a v1 write 403, and a v1 write without `Content-Type: application/json` 415.
- Whether every row of Brian's real workspace reads: Task 12. A row that does not is named in the sync log.
