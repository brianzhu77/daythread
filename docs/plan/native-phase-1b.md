# Native app, phase 1b (Writing): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the native app he types into the lines of a day page; the words are kept on the device at once, saved
on their own, and merged line by line with what changed on the server, without asking.

**Architecture:** `DaythreadCore` gains the page as an editable value (typed runs, the keys' rules, new blocks in
the web's shape), the save command, the content key and a three-way merge. The engine stores a draft per page and
account, sends one save per page at a time through `POST /api/v1/saves`, and holds a draft that is behind the
server's page until it has been merged. The open page's document lives with the screen on the main actor; a line's
words are a `UITextView` in its cell. The server gains one optional field on the saves route.

**Tech Stack:** As 1a: Swift 6 language mode, UIKit, TextKit 2, SwiftData (a second schema version), URLSession,
Observation, Swift Testing, XCTest. TypeScript only in `src/server/api-v1.ts`, its test, and the fixtures script.

**Spec:** `docs/design/native-phase-1.md` §10 (slice 1b), with §5 "Merging, not overwriting" and §7; under
`docs/design/native-app.md` §5 to §9. Executors read §10 in full.

**Status (2026-11-26):** Tasks 1 to 14 built; on the simulator against the seeded local servers, writing, the merge
and Chinese with the Pinyin keyboard pass as UI tests, and the screenshots are in `tests/evidence/native-phase-1b/`.
Task 15, on his data, is his.

## Global Constraints

- **Behaviour tests first (Brian, 2026-11-25).** Each task commits its failing behaviour tests on their own, as
  `test(native): … (red)`, after seeing them fail for the expected reason, and only then the commit that makes them
  pass. The tests state what a person or a client of the code observes.
- **Merging, not overwriting (Brian, 2026-11-26).** Nothing the app does replaces what the server has with what he
  wrote, or what he wrote with what the server has. Where the two can be put together the app does it without
  asking. This binds every task that touches a draft, a save or a load.
- The app holds no TypeScript, no JavaScript engine and no web view. Apple frameworks only.
- Minimum iOS 26 and macOS 26; `// swift-tools-version: 6.2`; Swift 6 language mode with complete concurrency
  checking; no `@unchecked Sendable` or `nonisolated(unsafe)` to quiet the compiler. Mac Catalyst must keep building.
- `DaythreadCore` imports Foundation only. `DaythreadSync` never imports UIKit.
- The server stays the authority. The only server change is the optional `expectedOwner` on `/api/v1/saves`
  (Task 1). A v1 reply or request only ever gains optional fields.
- A block he did not touch is written back exactly as it was read. A block is written with its keys in the order
  `id`, `type`, `props`, `content`, `children`.
- Nothing predicted is stored as the server's. The store holds the server's copy, the outbox and the drafts.
- A draft is never drawn, merged or sent under an account other than the one that wrote it.
- While a text view holds marked text, its row is not reconfigured, reloaded or changed from outside, and its
  text is not read as the document.
- A keystroke awaits nothing: no store write, network call or list reload stands between a key and its character.
- On-screen copy is one of the strings in the spec's §10.6 and §7, verbatim, and is added to
  `docs/design/native-system.md` in the task that first shows it.
- Use the system component with its default appearance; configure, never restyle (`native-app.md` §9).
- Never start anything on, or point a test at, port 3000, and never read `.daythread-local/`. Simulator: only
  `name=iPhone 17,OS=26.5`, never launched against production.
- Commit messages: `feat(native): …`, `test(native): …`, `docs(native): …`, English only.
- CI builds with an older Xcode (26.6) than the Mac the tasks run on. There, `Task.sleep(for:)` cancelled the
  moment it starts aborts the process. Anything that waits and may be cancelled uses `SyncEngine.sleep`
  (`Task.sleep(nanoseconds:)`), in code and in tests.

## Corrections to the spec made by this plan

- None yet. A correction found while building is written here with its reason before the code that follows it.

## Review Focus

1. **Two devices writing the same page.** Each merges against what the other saved. The page settles to one
   version on both, a line both typed in ends as two lines once, and no line is doubled again by a later merge.
   Tests in Task 7 (a merge of a merge) and Task 10.
2. **A save that landed with its answer lost**, then more typing, then a relaunch. The first save is recognised
   as landed, his later words are saved once, and no line appears twice. Tests in Task 9 and Task 10.
3. **Chinese input meeting an outside change.** A load or a save's answer arrives for the row he is composing in:
   the composition is not disturbed, nothing composed is lost or doubled, and the outside change is applied when
   the composition ends. Tests in Task 12.
4. **Another account.** A draft written under one account, then a sign-in as another whose day page has the same
   id and the same template lines: nothing of the draft is drawn, merged or sent; it is still there when the
   first account returns. Tests in Task 8 and Task 10.
5. **A page the app only partly draws** (a database, a synced block, an image among its lines) is typed into and
   saved: every block he did not touch is byte for byte what it was, the server accepts the save, and no key can
   move a line into or out of a block the app does not draw the inside of. Tests in Task 1 (shared case), Task 5
   and Task 6.

---

### Task 1: The server's one change, and the shared cases

**Files:**
- Modify: `src/server/api-v1.ts` (`saveReply`), `src/domain/command-schema.ts` only if the save's request schema
  lives there, `tests/api-v1.test.ts`, `scripts/export-core-fixtures.ts`
- Create (generated): `fixtures/core/content-key/cases.json`, `fixtures/core/saves/*.json`; README regenerated

**Interfaces:**
- Produces, for the server: `POST /api/v1/saves` accepts an optional `expectedOwner: string`. When present and not
  the session's owner the reply is `409 { "error": "owner-mismatch", "owner": "<the session's owner>" }` and
  nothing is written. Absent, the route behaves exactly as before.
- Produces, for Tasks 6, 9 and 10:
  - `content-key/cases.json`: `[{ "name", "document", "key" }]` from `pageContentKey`: an empty page; ASCII;
    Chinese; an emoji outside the basic plane; a page with a synced block (the key is of the stored form).
  - `saves/<name>.json`: `{ "before", "action", "after", "message" }` for a save the server takes, and
    `{ "before", "action", "refused": "<message>" }` for one it refuses; workspaces as the browser gets them.
    Names: `typed-words`; `new-to-do` (a `task` row with words and `taskId` `editor-task:<id>`: `after` has the
    to-do under that id); `new-to-do-without-words` (no to-do made); `to-do-words-deleted` (the title becomes
    `""`); `row-removed` (the to-do goes to `deletedTasks`); `row-removed-kept-elsewhere` (a row on another page:
    with the row in `singleDeleteIds` on today's page the to-do is paused); `untouched-synced-and-database` (a
    page holding both, saved with one paragraph's words changed); `same-operation-twice` (the second answer
    equals the first and `after` is unchanged); `page-changed-elsewhere` and `saved-elsewhere` (refused, with the
    server's exact messages).

- [ ] **Step 1: Write the failing server tests** in `tests/api-v1.test.ts`: a save with the session's own
  `expectedOwner` is applied; with another owner it answers 409 `owner-mismatch` with the session's owner and
  the workspace's revision is unchanged; without the field it behaves as the existing tests say; a non-string
  `expectedOwner` is a 400.
- [ ] **Step 2:** `npm test`. Expected: the new tests fail. Commit `test(native): a save names its owner (red)`.
- [ ] **Step 3:** Implement in `saveReply`, the way `commandReply` learns the owner.
- [ ] **Step 4:** Add the two fixture areas to the script, built by running the domain (`pageContentKey`,
  `applyCommand` through the existing `harness()`), never by hand; the script asserts each refused case throws
  that message and each taken case's `after` holds what its name says. `npm run fixtures`,
  `node scripts/export-core-fixtures.ts --check`, `npm test`, `npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): a save names its owner; shared cases for the content key and for saves`.

### Task 2: Core: blocks as the web writes them

**Files:**
- Modify: `native/Packages/DaythreadCore/Sources/DaythreadCore/Block.swift`, `JSONValue.swift`
- Create: `…/DaythreadCore/NewBlock.swift`
- Test: `…/DaythreadCoreTests/DocumentTests.swift`, `…/NewBlockTests.swift`

**Interfaces:**
- Produces:

```swift
public enum NewBlock {
  public enum Kind: Hashable, Sendable {
    case paragraph, heading(level: Int), bullet, numbered(start: Int?), quote, divider, todo
  }
  /// A lowercase UUID, as the web's block ids are.
  public static func id() -> String
  /// A block as the web's editor writes a new one of that kind (spec §10.2's table). For `.todo`, `taskId` is
  /// `editor-task:<id>`, and `role` / `planDate` are `plan` and the date on a day page, `reference` and `""` else.
  public static func make(_ kind: Kind, id: String, content: JSONValue?, pageDate: LocalDate?) -> Block
}
```

  `Block` is written with `content` before `children` when the node was read without `content` (or made without
  it) and gains it; every other rule of writing back is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `DocumentTests.content_given_to_a_block_that_had_none_is_written_before_children`: the written text has the
    keys in the order `id, type, props, content, children`. (Replaces the test that pins "appended last"; say so.)
  - `NewBlockTests.each_kind_is_written_as_the_web_writes_it`: for each kind, `Document.write([block])` equals the
    exact text of §10.2's table (paragraph, bullet and numbered with the three default props; `numbered(start: 7)`
    with `"start":7` after them; heading with `level` and `isToggleable`; quote; divider with `{}` and no
    `content` key; a to-do on a day page and on a page with no date).
  - `NewBlockTests.an_id_is_a_lowercase_uuid`.
  - `DocumentTests.unedited_blocks_still_write_back_identically` over every fixture document (already true; kept
    as the guard).
- [ ] **Step 2:** `cd native/Packages/DaythreadCore && swift test`. Expected: fail. Commit
  `test(native): a block is written in the web's key order, and a new block in the web's shape (red)`.
- [ ] **Step 3:** Implement. The prop tables are constants, each with a comment naming where it was read
  (BlockNote 0.56's block specs and `tests/evidence/ratchet-b49/candidate/saved.json`).
- [ ] **Step 4:** `swift test` in Core, Sync and Editor. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): blocks are written in the web's key order; new blocks in the web's shape`.

### Task 3: Core: a line's words as runs

**Files:**
- Create: `…/DaythreadCore/InlineContent.swift`
- Test: `…/DaythreadCoreTests/InlineContentTests.swift`

**Interfaces:**
- Produces (offsets are UTF-16 units, as a text view's ranges are; a token is one unit wide):

```swift
public struct InlineContent: Hashable, Sendable {
  public enum Item: Hashable, Sendable {
    case text(String, raw: JSONObject)                    // a text run; styles and unknown fields stay in raw
    case link(items: [Item], raw: JSONObject)             // a link holding runs
    case token(JSONValue)                                 // a date chip, a page reference, anything else
  }
  public private(set) var items: [Item]
  public init(_ content: JSONValue?)                      // absent, a string, an array, or anything else
  public var json: JSONValue?                             // unedited: exactly what was read
  public var length: Int
  public var isEmpty: Bool                                // no words and no token
  public var plain: String                                // a token reads as U+FFFC
  public mutating func replace(_ range: Range<Int>, with text: String)
  public func split(at offset: Int) -> (InlineContent, InlineContent)
  public func appending(_ other: InlineContent) -> InlineContent
}
```

  There is no "words and dates only" form: the spec keeps styles on a to-do's split, where the web drops them.

- [ ] **Step 1: Write the failing tests.**
  - `reading_and_writing_back_changes_nothing` over every `content` in the fixture documents, and for a string
    content, a missing content and a content that is a number.
  - `typing_inside_a_run_keeps_its_styles`, `typing_between_two_runs_takes_the_styles_of_the_one_before`,
    `typing_at_the_start_of_the_line_takes_the_first_runs_styles`, `typing_into_an_empty_line_makes_a_plain_run`
    (`{"type":"text","text":…,"styles":{}}`).
  - `deleting_across_two_runs_leaves_both_runs_remainders_and_drops_an_emptied_run`.
  - `a_token_is_one_position_wide_can_be_deleted_and_cannot_be_typed_into` (typing at either side of it goes into
    the neighbouring run, or a new plain run).
  - `typing_inside_a_link_stays_in_the_link`; `a_link_emptied_of_words_is_dropped`.
  - `split_and_append_are_inverse` at every offset of a line with runs, a link and a token.
  - `offsets_count_utf16_units` with an emoji outside the basic plane and with Chinese.
  - `a_line_break_inside_a_run_is_kept`.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): a line's words as runs that keep what they do not understand (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): a line's words as runs`.

### Task 4: Core: the editable page, typing and Return

**Files:**
- Create: `…/DaythreadCore/EditablePage.swift`, `…/DaythreadCore/EditablePage+Return.swift`
- Test: `…/DaythreadCoreTests/EditablePageTests.swift`, `…/ReturnTests.swift`

**Interfaces:**
- Consumes: `NewBlock`, `InlineContent`.
- Produces:

```swift
public struct EditablePage: Sendable {
  public struct Caret: Hashable, Sendable { public var block: String; public var offset: Int }
  public enum Key: Sendable { case returnKey, backspace, tab, shiftTab }
  public init(document: String, pageDate: LocalDate?, makeID: @escaping @Sendable () -> String = NewBlock.id)
  public var document: String { get }                        // Document.write of the blocks
  public var blocks: [Block] { get }
  /// The rows he removed one at a time, in the web's two cases (spec §10.3).
  public private(set) var singleDeleteIds: [String]
  /// Typing and deleting inside one line. Returns where the caret is afterwards.
  public mutating func replaceText(in block: String, range: Range<Int>, with text: String) -> Caret
  /// A key at a caret. Nil when the key does nothing there.
  public mutating func press(_ key: Key, at caret: Caret) -> Caret?
  public func content(of block: String) -> InlineContent?
  /// Whether a line can hold a caret (a text kind the app draws), in page order.
  public var textBlocks: [String] { get }
}
```

  This task implements `replaceText` (without the typed shortcuts, which are Task 5) and `press(.returnKey, …)`;
  the other keys return nil until Task 5.

- [ ] **Step 1: Write the failing tests**, each from a short document written in the test:
  - `EditablePageTests.typing_changes_only_that_block_in_the_written_document` (every other block's text is
    byte for byte unchanged).
  - `ReturnTests`, one per row of §10.3's Return rows, asserting the written blocks and the caret:
    `in_the_middle_of_a_paragraph_splits_it_and_the_first_half_keeps_its_id`;
    `at_the_end_of_a_bullet_makes_a_bullet`; `of_a_numbered_item_makes_a_numbered_item`;
    `of_a_quote_makes_a_paragraph`; `in_a_heading_makes_a_paragraph_of_the_rest`;
    `nested_lines_go_with_the_second_half`; `at_the_start_of_a_line_with_words_puts_an_empty_line_above`
    (a bullet above a bullet, a paragraph above a paragraph or heading; the line's id and children untouched);
    `on_an_empty_bullet_makes_it_a_paragraph_at_the_same_depth`;
    `on_an_empty_nested_paragraph_moves_it_out_one_level`;
    `on_an_empty_top_level_paragraph_adds_a_paragraph_after_it`;
    `in_a_to_do_makes_a_new_to_do_after_everything_nested_under_it` (new `taskId` `editor-task:<new id>`, the same
    `role` and `planDate`, styles kept in both halves);
    `at_the_start_of_a_to_do_with_words_puts_an_empty_to_do_above_and_leaves_the_to_do_alone`;
    `on_an_empty_to_do_makes_it_a_paragraph`.
  - `ReturnTests.a_new_blocks_props_are_the_webs` (the second half of a split paragraph has the three defaults).
  - `ReturnTests.a_block_the_app_does_not_draw_is_never_changed` (Return next to a database block).
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): typing and Return on the page (red)`.
- [ ] **Step 3:** Implement. The rules are the spec's table; where it is silent, BlockNote 0.56's
  `splitBlock.ts` and the app's handler at `src/components/page-editor.tsx` (the to-do's Return) decide, except
  the one stated difference (Return at the start of a to-do).
- [ ] **Step 4:** `swift test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the page as an editable value: typing and Return`.

### Task 5: Core: Backspace, nesting and the typed shortcuts

**Files:**
- Create: `…/DaythreadCore/EditablePage+Backspace.swift`, `…/EditablePage+Nesting.swift`,
  `…/EditablePage+Shortcuts.swift`
- Test: `…/DaythreadCoreTests/BackspaceTests.swift`, `…/NestingTests.swift`, `…/ShortcutTests.swift`

**Interfaces:**
- Consumes and completes Task 4's `EditablePage`: `press(.backspace | .tab | .shiftTab, …)`, and the typed
  shortcuts inside `replaceText`.

- [ ] **Step 1: Write the failing tests**, one per row of §10.3:
  - `BackspaceTests`: `at_the_start_of_a_bullet_makes_it_a_paragraph_keeping_words_and_nested_lines` (and for a
    numbered item, a quote, a heading, a to-do); `at_the_start_of_a_paragraph_joins_the_line_above` (the upper
    id, type and props stay; the caret is at the joining point; the lower line's nested lines move up a level);
    `into_an_empty_line_of_the_same_kind_keeps_the_lower_lines_id`; `joins_before_it_unnests`;
    `under_a_block_with_no_words_does_nothing_when_it_has_words_and_removes_it_when_empty`;
    `under_a_divider_removes_the_divider_when_it_has_words_and_the_line_when_empty`;
    `under_a_synced_block_or_a_database_does_nothing`;
    `on_an_empty_to_do_removes_the_row_and_names_it` (`singleDeleteIds` gains what the web's handler adds there:
    read `page-editor.tsx` around the Backspace handler and assert that value);
    `turning_the_first_line_from_a_to_do_into_a_paragraph_names_it`;
    `turning_a_later_to_do_into_a_paragraph_names_nothing`;
    `on_the_first_line_of_the_page_with_nothing_above_does_nothing_more_than_make_it_a_paragraph`.
  - `NestingTests`: `tab_moves_a_line_under_the_one_before_with_its_own_nested_lines`;
    `tab_does_nothing_on_a_heading_right_under_a_heading_or_on_the_first_line_of_its_group`;
    `tab_does_nothing_under_a_block_the_app_does_not_draw_the_inside_of` (Review Focus 5: a database, a synced
    block, an image); `shift_tab_moves_a_line_out_and_takes_the_lines_after_it_as_its_own`;
    `shift_tab_does_nothing_at_the_top_level`; `the_caret_keeps_its_place_in_the_words`.
  - `ShortcutTests`: each of `# `, `## `, `### `, `- `, `* `, `1. `, `7. `, `[] `, `> ` typed at the start of a
    paragraph changes its kind and removes the characters, keeping id, depth and nested lines; `---` on a line of
    its own makes a divider and puts the caret in an empty paragraph after it (an existing empty childless one,
    else a new one); `backspace_straight_after_a_shortcut_puts_the_characters_back`;
    `inside_a_to_do_they_are_just_characters`; `not_at_the_start_they_are_just_characters`.
  - `NestingTests.no_key_moves_a_line_into_or_out_of_a_block_the_app_does_not_draw` (Review Focus 5), run over a
    page holding each placeholder kind with every key at every caret of its neighbours.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): Backspace, nesting and the typed shortcuts (red)`.
- [ ] **Step 3:** Implement, from the spec's table and, where it is silent, BlockNote's `mergeBlocks.ts`,
  `nestBlock.ts` and `KeyboardShortcutsExtension.ts`, and the app's `page-editor.tsx`.
- [ ] **Step 4:** `swift test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): Backspace, nesting and the typed shortcuts`.

### Task 6: Core: the content key, the save, and drawing a draft

**Files:**
- Create: `…/DaythreadCore/ContentKey.swift`, `…/DaythreadCore/Draft.swift`
- Modify: `…/DaythreadCore/Command.swift`
- Test: `…/DaythreadCoreTests/ContentKeyTests.swift`, `…/SaveTests.swift`, `Fixtures.swift`

**Interfaces:**
- Consumes: `content-key/`, `saves/` (Task 1).
- Produces:

```swift
public enum ContentKey { public static func of(_ document: String) -> String }   // the web's pageContentKey
extension Command {
  /// Keys in this order: type, pageId, expectedContent, document, singleDeleteIds (left out when empty), today, at.
  public static func saveEditor(pageId: String, expectedContent: String, document: String,
                                singleDeleteIds: [String], today: LocalDate, at: Date) -> JSONValue
}
extension Workspace {
  /// The workspace as drawn while a draft waits: that page's document is the draft's, and each to-do row in it
  /// with words and no to-do in the workspace gets an open to-do under the row's own `taskId`.
  public func drawing(draft document: String, of pageId: String) -> Workspace
}
```

- [ ] **Step 1: Write the failing tests.**
  - `ContentKeyTests.keys_are_the_webs` over every shared case.
  - `SaveTests.the_save_command_is_written_as_the_web_writes_it` (exact text; `at` as the ISO form the server's
    schema takes; `singleDeleteIds` left out when empty).
  - `SaveTests.a_page_typed_into_by_the_app_is_what_the_shared_case_sent`: for `typed-words`, `new-to-do` and
    `untouched-synced-and-database`, replaying the edit on `before`'s page with `EditablePage` gives a document
    equal, block for block as JSON, to the case's `action.document` (for a new block, equal apart from its id).
  - `SaveTests.a_draft_is_drawn_with_its_new_to_dos_open`: the drawn workspace has the draft's document, and a
    to-do for a new row with words whose id is the row's `taskId`, status open; none for a row without words;
    a to-do the workspace already holds is untouched; another page is untouched.
  - `SaveTests.what_the_app_draws_for_a_new_to_do_is_what_the_server_then_makes`: for `new-to-do`, the predicted
    to-do's `id` and `status` equal those of the to-do in `after`.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): the content key, the save command and a drawn draft (red)`.
- [ ] **Step 3:** Implement. `ContentKey` is a port of `textKey` and `storedDocument`
  (`src/domain/editor-document.ts`, `src/domain/synced.ts`); read them.
- [ ] **Step 4:** `swift test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the content key, the save command, and a draft as drawn`.

### Task 7: Core: the three-way merge

**Files:**
- Create: `…/DaythreadCore/PageMerge.swift`
- Test: `…/DaythreadCoreTests/PageMergeTests.swift`

**Interfaces:**
- Produces:

```swift
public enum PageMerge {
  public struct Merged: Sendable, Equatable {
    public let document: String
    /// Some line was changed by both, differently: his words were put below the server's.
    public let bothChanged: Bool
  }
  /// `base`: the page the draft started from. `mine`: the draft. `theirs`: the page as the server has it now.
  public static func merge(base: String, mine: String, theirs: String,
                           makeID: @Sendable () -> String = NewBlock.id) -> Merged
}
```

- [ ] **Step 1: Write the failing tests.**
  - One per row of §10.6's table: `a_line_only_he_changed_is_his`; `only_the_server_changed_is_theirs`;
    `both_changed_to_the_same_words_is_once`; `both_changed_differently_keeps_theirs_and_puts_his_below` (his
    line has a new id, the same kind, and `bothChanged` is true); `a_line_he_added_goes_after_the_line_it_followed`;
    `…or_after_the_nearest_earlier_line_that_still_exists`; `several_lines_he_added_keep_their_order`;
    `a_line_the_server_added_stays_where_the_server_has_it`; `he_deleted_and_the_server_did_not_touch_is_deleted`;
    `he_deleted_and_the_server_changed_stays`; `the_server_deleted_and_he_did_not_touch_is_deleted`;
    `the_server_deleted_and_he_changed_puts_his_words_back`.
  - To-dos: `a_to_do_both_changed_stays_one_to_do_with_his_words_as_a_line_below` (no second row carries that
    `taskId`); `a_to_do_he_added_comes_back_as_a_to_do_once`; `a_to_dos_row_keeps_its_taskId`.
  - Arrangement: `only_he_nested_lines_keeps_his_arrangement_with_their_words`;
    `only_the_server_moved_lines_keeps_theirs_with_his_words`; `both_rearranged_keeps_theirs_and_his_words`.
  - Blocks the app does not draw: `a_database_or_synced_block_is_always_the_servers` (Review Focus 5).
  - What must always hold, over 200 pages made by a seeded generator applying random edits from `EditablePage`
    to each side: `merging_with_an_unchanged_server_page_gives_his_draft_exactly`;
    `merging_an_unchanged_draft_gives_the_servers_page_exactly`; `the_same_change_on_both_sides_is_that_change`;
    `no_words_either_side_wrote_are_missing` (every line's words that one side wrote and the other did not
    delete are in the result); `no_block_id_appears_twice`; `the_result_parses_and_round_trips`.
  - `a_merge_of_a_merge_settles` (Review Focus 1): devices A and B start from one page, each types in the same
    line and adds a line; A saves; B merges and saves; A merges B's page with its own unchanged draft: both hold
    the same document, the line both typed in is two lines, and merging once more changes nothing.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): his page and the server's are merged line by line (red)`.
- [ ] **Step 3:** Implement. Lines are matched by block id across the three versions; a line is "changed" when
  its written JSON without `children` differs. Keep the algorithm in one file with its rules stated at the top in
  the words of §10.6.
- [ ] **Step 4:** `swift test`. Expected: pass; the generated cases print their seed on failure.
- [ ] **Step 5: Commit** `feat(native): a three-way merge of a page, line by line`.

### Task 8: Sync: drafts in the store

**Files:**
- Create: `native/Packages/DaythreadSync/Sources/DaythreadSync/PageDraft.swift`
- Modify: `WorkspaceStore.swift`, `MemoryWorkspaceStore.swift`, `SwiftDataWorkspaceStore.swift`
- Test: `…/DaythreadSyncTests/WorkspaceStoreContract.swift`, `SwiftDataWorkspaceStoreTests.swift`, the doubles

**Interfaces:**
- Produces:

```swift
public struct PageDraft: Sendable, Equatable {
  public struct Sent: Sendable, Equatable { public var operationId: String; public var document: String }
  public var pageId: String
  public var owner: String
  public var base: String              // the content key of the page it started from
  public var baseDocument: String      // that page's document
  public var document: String
  public var singleDeleteIds: [String]
  public var sent: Sent?               // what is on its way, until it is answered
  public var changedAt: Date
}
extension WorkspaceStore {
  func drafts() async throws -> [PageDraft]                       // every owner's
  func put(_ draft: PageDraft) async throws                       // one per (owner, pageId)
  func removeDraft(pageId: String, owner: String) async throws
}
```

  `replace(with:owner:)` and `write` do not touch drafts. `erase()` removes the drafts too. The SwiftData store
  gains `SchemaV2` (the four models of V1 and `DraftRow`) and a migration stage; a V1 store opens as V2 with its
  workspace and outbox intact.

- [ ] **Step 1: Write the failing tests.**
  - Contract, both stores: `a_draft_is_kept_and_read_back`; `putting_again_replaces_that_owners_draft_of_that_page`;
    `two_owners_drafts_of_the_same_page_are_both_kept` (Review Focus 4); `replacing_the_workspace_keeps_every_draft`;
    `removing_a_draft_leaves_the_others`; `erase_removes_drafts`.
  - `SwiftDataWorkspaceStoreTests.a_store_written_by_the_first_schema_opens_with_everything_in_it`: build a store
    with `SchemaV1` alone (a workspace of two pages and two outbox entries), close it, open it through
    `SwiftDataWorkspaceStore.open`, and read the same workspace, owner, entries and next number; then a draft can
    be put and read.
  - `a_draft_survives_closing_and_opening_the_store`.
- [ ] **Step 2:** `cd native/Packages/DaythreadSync && swift test`. Expected: fail. Commit
  `test(native): the store keeps a draft per page and account, and opens what 1a wrote (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test`; then the app's unit tests (they open the store). Expected: pass.
- [ ] **Step 5: Commit** `feat(native): drafts in the store`.

### Task 9: Sync: a draft is kept, and saved on its own

**Files:**
- Modify: `ServerTransport.swift`, `URLSessionTransport.swift`, `SyncEngine.swift`, `SyncState.swift`
- Create: `SyncEngine+Drafts.swift`
- Test: `URLSessionTransportTests.swift`, `SyncEngineDraftTests.swift`, `FakeTransport.swift`

**Interfaces:**
- Consumes: `PageDraft`, the store's draft methods, `ContentKey`, `Command.saveEditor`, `Workspace.drawing`.
- Produces:

```swift
public enum SaveOutcome: Sendable {
  case applied(receipt: JSONValue, changes: WorkspaceChanges, owner: String)
  case refused(message: String)                      // 409 { error: "refused" }
  case ownerMismatch(owner: String)                  // 409 { error: "owner-mismatch" }
}
extension ServerTransport {
  func save(token: String?, operationId: String, expectedRevision: Int, expectedOwner: String,
            action: JSONValue) async throws -> SaveOutcome          // a 400 throws .refused(status: 400, …)
}
public struct DraftStatus: Sendable, Equatable, Identifiable {
  public enum State: Sendable, Equatable { case waiting, sending, offline, retrying, behind, stuck(String) }
  public let id: String                // the page
  public let state: State
}
public struct SyncState { public var drafts: [DraftStatus] }      // the signed-in account's only
extension SyncEngine {
  /// Stores the draft at once and publishes a state that draws it; the save goes 450 ms after the last call.
  /// The first call for a page records the page as the copy has it then as the draft's base.
  public func keepDraft(pageId: String, document: String, singleDeleteIds: [String]) async throws
  /// Sends what is waiting now (leaving the day, leaving the foreground).
  public func saveNow() async
}
```

  This task builds the path where the server takes the save: `waiting`, `sending`, `offline`, `retrying`.
  `behind` and `stuck` are Task 10; until then a refusal leaves the draft `waiting` and unsent.

- [ ] **Step 1: Write the failing tests.**
  - Transport (with the URL stub): the request's body is `{operationId, expectedRevision, expectedOwner, action}`
    in that order; 200 parses; 409 `refused` gives `.refused(message)`; 409 `owner-mismatch` gives
    `.ownerMismatch`; 400 throws.
  - `a_draft_is_in_the_store_before_the_call_returns_and_drawn`: the published workspace has the draft's document
    for that page and `drafts == [.waiting]`; the copy in the store is still the server's.
  - `a_draft_is_drawn_by_a_new_engine_on_the_same_store`.
  - `the_save_goes_450_ms_after_the_last_change`: three `keepDraft` calls; the test's clock was asked for 450 ms
    each time and only the last wait's end sends; one save, of the last document, with `expectedContent` the key
    of the base and `expectedRevision` the copy's revision then.
  - `saveNow_sends_without_the_wait`.
  - `the_answer_removes_the_draft_and_the_page_is_the_servers`.
  - `typing_while_a_save_is_on_its_way_waits_for_its_answer_then_goes_as_the_next_save`: one save in flight per
    page; after the answer the draft's base is the key of the server's page and a second save carries the newer
    document under a new operation id.
  - `a_save_that_was_not_answered_goes_again_as_it_was` (Review Focus 2): the transport fails after receiving;
    he types more; the retry carries the first document and the first operation id; only after its answer does
    the newer document go.
  - `with_no_connection_the_draft_waits_and_is_retried_on_the_schedule` (`.offline`, then the waits of §5), and
    `the_network_coming_back_sends_it`.
  - `a_tick_on_a_to_do_typed_into_a_draft_is_sent_after_that_drafts_save`: the tick is drawn (the to-do is done
    in the published workspace), counted as waiting, and reaches the transport only after the save was answered.
  - `nothing_is_sent_or_kept_once_a_sign_out_that_erases_has_begun`; `keepDraft_before_a_copy_is_shown_throws`.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): a draft is kept at once and saved on its own (red)`.
- [ ] **Step 3:** Implement. Saves are sent in a pass after the pending outbox entries; an outbox entry whose
  to-do exists only in a draft waits for that draft's save. Every existing engine invariant stands (publishes
  inside a store section; one pass at a time; nothing sent once an erasing sign-out has begun).
- [ ] **Step 4:** `swift test`; build the app. Expected: pass; `BUILD SUCCEEDED`.
- [ ] **Step 5: Commit** `feat(native): the engine keeps a draft and saves it on its own`.

### Task 10: Sync: a draft behind the server's page, refusals, and accounts

**Files:**
- Modify: `SyncEngine+Drafts.swift`, `SyncEngine.swift`, `SyncState.swift`
- Test: `SyncEngineDraftTests.swift`

**Interfaces:**
- Produces:

```swift
extension SyncEngine {
  /// After the screen merged: the draft now starts from `baseDocument` (the server's page it was merged with),
  /// holds `document`, has no rows named, and is saved at once. Refused when the copy's page is no longer that one.
  @discardableResult
  public func rebaseDraft(pageId: String, baseDocument: String, document: String) async throws -> Bool
  public func discardDraft(pageId: String) async
  public func draft(of pageId: String) async -> PageDraft?        // the signed-in account's
}
```

  A draft is `behind` when the copy's page for it has a content key other than the draft's `base`, and is then
  never sent. `stuck(reason)` when the page is gone or in Trash, or the server refused the document itself.
  `signOut(discardingUnsent: false)` counts a draft as a change not sent.

- [ ] **Step 1: Write the failing tests.**
  - `a_load_that_changes_the_page_puts_its_draft_behind_and_sends_nothing`.
  - `page_changed_elsewhere_is_followed_by_a_load_and_the_draft_is_behind` (the server's message from the shared
    case `page-changed-elsewhere`).
  - `saved_elsewhere_with_the_page_as_it_was_sends_the_same_save_once_more` (same operation id, the new
    revision; a second "Saved elsewhere" leaves it waiting for the retry schedule, not a third send in the pass);
    `saved_elsewhere_with_the_page_changed_puts_the_draft_behind`.
  - `rebasing_a_draft_sends_it_on_the_servers_page`: after `rebaseDraft` the save's `expectedContent` is the key
    of `baseDocument`; `rebaseDraft` answers false and changes nothing when the copy's page moved again.
  - `an_answer_that_comes_back_to_newer_words_leaves_them_and_puts_the_draft_behind_when_the_server_changed_what_was_sent`
    (the server's page differs from the sent document, as when it marks a new to-do's row): the draft's base
    document is what was sent, so the screen's merge of base, his newer words and the server's page is a real
    three-way merge.
  - `a_save_whose_answer_was_lost_then_a_relaunch_is_recognised` (Review Focus 2): a new engine on the same store
    sends the recorded document under the recorded operation id first.
  - `the_page_in_trash_or_gone_holds_the_draft` (`stuck`, nothing sent); `a_document_the_server_refuses_holds_the_draft`.
  - `discardDraft_removes_it_and_the_page_is_the_servers_again`.
  - `another_accounts_draft_is_not_drawn_not_sent_and_still_there` (Review Focus 4): sign out with the draft kept
    (the copy hidden, as after a session ends), sign in as another owner whose day page has the same id and the
    same key: `drafts` is empty, the page is the server's, no save is sent; sign back in as the first: the draft
    is drawn again.
  - `an_owner_mismatch_on_a_save_loads_and_stops`.
  - `signing_out_with_a_draft_asks_first`; with `true` the draft is erased.
  - `two_devices` (Review Focus 1), with two engines and one scripted server state held by the test, using
    `PageMerge` as the screen would: both type in one line and add a line; after each has merged and saved, both
    copies hold the same page and neither draft remains.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit
  `test(native): a draft behind the server's page waits to be merged; drafts keep to their account (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): drafts behind the server's page, refusals, and accounts`.

### Task 11: Editor: a line's words in a text view

**Files:**
- Create: `native/Packages/DaythreadEditor/Sources/DaythreadEditor/Cells/LineTextView.swift`,
  `…/DaythreadEditor/InlineTextStorage.swift`
- Modify: `Cells/TextBlockCell.swift`, `Cells/TodoBlockCell.swift`, `Cells/BlockCell.swift`,
  `DocumentViewController.swift`, `BlockRow.swift`, `BlockRows.swift`
- Test: `…/DaythreadEditorTests/EditingTests.swift`, `DocumentViewControllerTests.swift`

**Interfaces:**
- Consumes: `EditablePage`, `InlineContent`.
- Produces:

```swift
extension DocumentViewController {
  /// Shows a page for editing. `page` is the workspace's (the draft's document when it has one).
  public func edit(page: Page, in workspace: Workspace)
  /// Called on the main actor after each change he makes, with the page's document and the rows he removed.
  public var onChange: ((_ document: String, _ singleDeleteIds: [String]) -> Void)? { get set }
  /// The page as it is on screen now.
  public var document: String? { get }
  /// True while some line holds marked text.
  public var isComposing: Bool { get }
  /// Replaces the page from outside (a merge, a load) keeping the caret where its line still exists.
  /// Deferred until composition ends when `isComposing`.
  public func replace(document: String, in workspace: Workspace)
}
```

  A text row's words are a `UITextView` (TextKit 2, not scrolling, no insets beyond the row's own) added to the
  cell as the circle is. The attributed text is built from the line's `InlineContent`; a token is a text
  attachment that draws the chip's words as phase 0 drew them. Bullets, numbers, the quote bar and the circle
  are unchanged. `show(page:in:)` stays for a page that is not editable.

- [ ] **Step 1: Write the failing tests** (UIKit; a controller in a window):
  - `typing_in_a_line_changes_the_document_and_reports_it` (`insertText` on the row's text view; `onChange` is
    called once with a document in which only that block changed).
  - `typing_reconfigures_no_row` (no snapshot is applied for a keystroke; the other rows' cells are the same
    objects).
  - `a_line_that_grows_to_two_lines_makes_its_row_taller_and_moves_the_rows_below`.
  - `styles_are_drawn_and_kept`: a run that is bold is drawn bold, and typing inside it writes the character
    into that run.
  - `a_chip_is_one_position_and_typing_beside_it_does_not_change_it`.
  - `a_tap_puts_the_caret_in_that_line` (the text view becomes first responder); a row the app does not draw,
    a divider and a placeholder take no caret.
  - `a_page_edited_from_outside_keeps_the_caret_in_its_line` (`replace` with one other line changed; the first
    responder and its selected range are unchanged; only the changed row is redrawn).
  - `the_largest_text_size_and_landscape_keep_the_words_clear_of_the_bullet_and_the_circle` (as 1a's layout tests).
  - `the_line_being_typed_is_not_under_the_keyboard`: with a keyboard frame given through the keyboard layout
    guide, the caret's rect is inside the list's visible area.
  - Every 1a test of `DocumentViewControllerTests` that reads a row's text reads it from the text view; none is
    deleted.
- [ ] **Step 2:** `xcodebuild test -scheme DaythreadEditor -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5'`.
  Expected: fail. Commit `test(native): a line's words are typed into, one row at a time (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` and the `xcodebuild test` above. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): a line's words in a text view`.

### Task 12: Editor: the keys, the caret between lines, and input methods

**Files:**
- Modify: `Cells/LineTextView.swift`, `DocumentViewController.swift`
- Test: `…/DaythreadEditorTests/KeyTests.swift`, `InputMethodTests.swift`

**Interfaces:**
- Consumes: `EditablePage.press`, Task 11.

- [ ] **Step 1: Write the failing tests** (driven through the text view's own input calls: `insertText("\n")`,
  `deleteBackward()`, `UIKeyCommand`s for Tab and Shift-Tab, `setMarkedText`, `unmarkText`):
  - `return_splits_the_line_and_the_caret_is_at_the_start_of_the_new_line` (the new row's text view is first
    responder); `return_in_a_to_do_makes_a_new_circle`.
  - `backspace_at_the_start_joins_the_line_above_and_the_caret_is_at_the_joining_point`;
    `backspace_on_an_empty_to_do_removes_the_row_and_the_caret_is_at_the_end_of_the_line_above`.
  - `tab_and_shift_tab_nest_and_unnest_and_the_caret_stays_in_its_words`; a Tab that does nothing changes nothing.
  - `a_typed_shortcut_changes_the_rows_kind_and_keeps_the_caret`.
  - `the_arrow_keys_move_from_the_last_line_of_one_row_to_the_next_row` (up and down, with a hardware key command).
  - `a_tap_under_the_last_line_puts_the_caret_at_its_end`, or in a new paragraph when the page ends with a block
    that holds no words.
  - `InputMethodTests` (Review Focus 3): `marked_text_is_not_the_document` (`onChange` is not called while text
    is marked, and `document` is as before); `return_while_marked_only_commits` (no split);
    `backspace_while_marked_only_edits_the_marked_text`; `no_shortcut_is_looked_for_while_marked`;
    `committing_reads_the_line_once` (one `onChange`, with the committed characters, nothing doubled, with
    "今天买菜" committed in two steps); `an_outside_change_to_the_composing_row_waits_until_composition_ends`
    (`replace` during marked text leaves the text view's text and marked range untouched; after `unmarkText` the
    outside change is there and so are the committed characters, once);
    `an_outside_change_to_another_row_is_applied_during_composition`;
    `composing_on_an_empty_new_line_stays_on_that_line` (the web's B49).
  - `structure_changes_clear_the_text_views_own_undo` (after a split, the text view's undo manager cannot undo).
- [ ] **Step 2:** The `xcodebuild test` of Task 11. Expected: fail. Commit
  `test(native): the keys on the page, and input methods left alone (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` and the `xcodebuild test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): Return, Backspace, Tab and the shortcuts on the page; input methods left alone`.

### Task 13: UI: writing a day

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/AppModel.swift`, `DayViewController.swift`,
  `StatusLine.swift`, `HeldMenu.swift`, `native/App/SceneDelegate.swift`, `docs/design/native-system.md`
- Create: `…/DaythreadUI/DraftMerging.swift`
- Test: `native/Tests/WritingTests.swift`, `StatusLineTests.swift`, `HeldMenuTests.swift`

**Interfaces:**
- Consumes: Tasks 7, 9, 10, 11, 12.
- Produces:

```swift
extension AppModel {
  /// Hands the engine the open page's document after a change. Never awaited by the caller.
  public func wrote(pageId: String, document: String, singleDeleteIds: [String])
  public func saveNow()
  public func discardDraft(pageId: String) async
  /// The stored draft's document, for "Copy draft".
  public func draftText(of pageId: String) async -> String?
}
enum DraftMerging {
  /// What to do for a draft that is behind: the merged document and whether to say so.
  static func merged(draft: PageDraft, mine: String, theirs: String) -> PageMerge.Merged
}
```

  The day screen edits the day's page when it is a page (`DocumentViewController.edit`). When the engine says a
  draft is behind: for the open page the screen merges its document as it is then, at a moment when nothing is
  being composed, replaces the page on screen, and calls `rebaseDraft`; for a page that is not open the model
  merges the stored draft. The status line and the "Not saved" menu gain the strings of §10.6. The app saves now
  when the day changes on screen and when the scene leaves the foreground, holding a background task until the
  engine has settled.

- [ ] **Step 1: Write the failing tests** (hosted, with the test server whose replies the test releases):
  - `what_he_types_is_drawn_from_the_engine_after_a_relaunch` (a new model and engine on the same store show the
    typed line before any reply).
  - `a_page_changed_on_the_server_while_he_typed_is_merged_and_saved_without_asking`: his line and the server's
    new line are both on screen and in the save that follows; nothing was presented.
  - `a_line_both_changed_shows_both_and_says_so`: the status line reads
    `Latest loaded · your changes are below their lines` until the next keystroke.
  - `a_merge_waits_for_composition_to_end` (Review Focus 3).
  - `a_draft_of_a_day_that_is_not_open_is_merged_too`.
  - `a_to_do_typed_offline_can_be_ticked_and_both_arrive_in_order`.
  - `leaving_the_day_and_leaving_the_foreground_save_now`.
  - `StatusLineTests`: `Offline · saves when you're back` (and with a pending count, both said);
    `Not saved yet · trying again`; `Couldn't save · draft kept`; the order against 1a's lines.
  - `HeldMenuTests`: a stuck draft is a section titled with the day and the reason, holding "Copy draft" and
    "Discard draft" (destructive); copying puts the draft's plain text on the pasteboard.
  - `signing_out_with_a_draft_asks_first` (the alert's count includes it).
- [ ] **Step 2:** The app unit test command. Expected: fail. Commit `test(native): writing a day, merged and saved without asking (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The app unit tests and the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): writing a day`.

### Task 14: On the simulator, the feel, and the record

**Files:**
- Modify: `native/scripts/ui-test.sh`, `native/UITests/Launch.swift`, `native/README.md`,
  `docs/plan/native-parity.md`, `docs/design/native-system.md`, `docs/plan/native-phase-1b.md` (status),
  `PRODUCT.md`
- Create: `native/UITests/WritingUITests.swift`, `native/Tests/TypingFeelTests.swift`,
  `tests/evidence/native-phase-1b/*.png`

- [ ] **Step 1: Write the failing UI tests.**
  - `a_line_typed_is_on_the_server`: type into the empty bullet under Notes; within 5 s the server's page has it.
  - `return_and_backspace`: two lines typed with Return between them are two blocks on the server; Backspace at
    the start joins them.
  - `typed_offline_survives_a_relaunch_and_is_saved`: as 1a's offline test, with a typed line.
  - `a_to_do_typed_and_ticked`: a to-do typed under TODO has a circle that can be ticked, and the server has the
    to-do done.
  - `a_page_changed_on_the_server_while_he_typed_is_merged`: type offline; change the page on the seeded server
    over HTTP with a `save-editor` of its own; relaunch online: both lines are on screen and on the server.
  - `chinese_with_the_pinyin_keyboard`, if a UI test can drive the simulator's Pinyin keyboard (add it with
    `xcrun simctl spawn … defaults write` or the Settings app's own UI; try for one hour): "jintian" then the
    first candidate on a new empty line, then on a to-do. If it cannot be driven, leave the test out, say so in
    the report with what was tried, and write the manual check into Task 15.
- [ ] **Step 2:** `native/scripts/ui-test.sh -only-testing:DaythreadUITests`. Expected: the new tests fail.
  Commit `test(native): writing on the simulator (red)`.
- [ ] **Step 3:** Make them pass; a defect found in an earlier task's code is fixed with its own failing unit
  test first.
- [ ] **Step 4: The feel.** `TypingFeelTests`: on a page of 300 lines, 50 characters typed into the 150th line,
  measured with `XCTClockMetric` and `XCTOSSignpostMetric.scrollDecelerationMetric`-style hitch metrics where
  the simulator gives them. Run it five times, write the measured median into the spec's §10.7 by reporting it
  (the controller edits the spec), and set the test's baseline to one and a half times that.
- [ ] **Step 5:** `native/scripts/ui-test.sh` in full. Screenshots on the seeded data: typing with the keyboard
  up (light, dark, largest text, landscape), a to-do typed and ticked, the merged page with
  `Latest loaded · your changes are below their lines`, `Offline · saves when you're back`, a stuck draft's menu.
  Look at each. Update the documents: every string in `native-system.md`; `native-parity.md` (editing rows, the
  commands the app sends, and where the app differs from the web: the merge, Return at the start of a to-do,
  styles kept on a to-do's split, a to-do ticked before its save); `PRODUCT.md`; the README.
  Commit `docs(native): what phase 1b holds, with screenshots`.

### Task 15: On his data

Nothing in this task is code, and Brian does the typing: the app writes to his real workspace.

- [ ] A Debug build on the simulator or his phone against production, signed in by him. He types a line on
  today's page in the app: it is on the web after a reload. He types one on the web: it is in the app after
  pull to refresh. He types in both without refreshing either: both lines are on both.
- [ ] Chinese: 「今天买菜 / 明天开会」 with the Pinyin keyboard, on a new line and in a to-do: nothing split,
  doubled or lost. (A UI test types "jintian" and the first candidate on a new line and on a new to-do on the
  simulator; this is the same on his phone, with his keyboard's own candidates and longer phrases.)
- [ ] By hand, what no test drives:
  - Dictation: a sentence dictated into a line goes in as words, once, and is saved.
  - Arrow keys from a hardware keyboard (or the Mac): Up and Down in the middle of a wrapped line move within it;
    at its first or last visual row they move to the line above or below, near the same place across.
  - `[] ` typed at the start of an empty line near the bottom of a page scrolled down: the line becomes a to-do,
    stays above the keyboard and keeps the caret.
  - The software keyboard's Backspace at the start of a line (a bullet, then a paragraph): the first makes it a
    paragraph, the second joins it to the line above, the caret at the join.
- [ ] The audit still reports "0 of N pages fail". Record the results here and set the status line.

## Order and independence

- Task 1 first (the cases the Core tasks fail against, and the route the engine posts to; it deploys on merge and
  changes nothing for the web, which does not send the field).
- Tasks 2 to 7 are Core, in order; 7 needs 4 and 5 for its generated pages.
- Tasks 8, 9, 10 are the engine, in order; 9 needs 6.
- Tasks 11 and 12 are the editor; they need 3, 4 and 5 and can follow 10.
- Task 13 needs 7, 10 and 12. Task 14 needs all.
- Two pull requests: Task 1 alone (it touches the server), then the rest.

## Decisions made while building (2026-11-26)

The calls I made on Brian's behalf while the plan ran, in the order they were made, each with what it costs if
it is wrong. The design (`native-phase-1.md` §10) holds the ones that changed what the app does.

| Decision | Why | If it is wrong |
|---|---|---|
| Shift-Tab keeps BlockNote's behaviour (the lines after it at its old level come under it) | the design says "as on the web" | nothing unless he prefers the other |
| An unreadable page gives back its stored string and takes no edit | one bad page must not be rewritten as empty | a page he cannot type in until it is fixed elsewhere |
| Backspace on an empty row leaves its nested lines in its place (the web deletes them) | nothing he wrote is removed by a Backspace on an empty line | a stray nested line where the web would have deleted it |
| The content key of a page with nothing to strip is the key of the string as stored | the app must not depend on its writer matching `JSON.stringify` to key a page it did not change | a page stored in a non-canonical spelling would be refused as changed on every save |
| A to-do's row the server deleted and he changed comes back as a plain line | one to-do must not become two, and a to-do removed elsewhere must not come back | he makes that line a to-do again by hand |
| A line is merged field by field (kind, each property, words); a stamp on a link is not a change of words | the server changes what he sends while he keeps typing; a whole-line comparison doubled his words under a to-do he had just typed | two changes to different properties of one line are combined without being shown |
| A line added next to a line the other side nested follows it into the nesting | the page order is kept | one Shift-Tab |
| A save in flight is recorded as the whole action first sent, and resent as recorded | the server recognises a repeated operation only when its action is the same | none known; `SchemaV2` was amended for it before anything shipped |
| A save's answer teaches only the queued changes that waited for it, and only the save's own revision | otherwise a change made elsewhere in between could slip past the server's check | a tick held for nothing after a replayed save |
| A draft's first page is the one the screen typed on, told by the screen (`startedFrom`) | a load racing the first keystroke let his page replace another device's | an extra merge at the first keystroke after a load |
| A sign-out never removes another account's drafts | words nobody was asked about are not erased | an account that never returns leaves its unsent words on the device, neither drawn nor sent |
| A page in Trash or gone holds its draft, even with a save on its way | he cannot see the page he would be saving into | the draft waits in the "Not saved" menu until he restores the page or discards it |
| Every call from the screen to the engine names the account it was made under, and the engine refuses another's | a call already on its way when the account changed was stored under the new one | a keystroke typed in the instant of an account change is dropped |
| The screen keeps its own words until the engine's state that holds them has arrived, counted, not assumed from order | on CI's slower machine the engine's answer arrived before its state and the screen took back a keystroke | none known |
| A keystroke on its way when a save landed starts from what that save sent | otherwise the line he is typing in was merged with itself and doubled | a needless merge in a case the memory does not cover |
| The rows he removed one at a time stay named across a redraw and a merge | the server settles them as removed one at a time only if the save says so | a harmless extra id in a later save |
| The tab bar holds four places and Search; Tags has no tab | the system's bar holds five items on a phone | one line of code; his to decide |
| The stuck-draft menu section is titled `<day> · <reason>` | the design gave no words | a wording change |
| The feel budget (one and a half times 7.0 ms and 2.7 ms) is enforced only where the machine is known | CI's machines are slower and vary | a regression in feel is caught locally, not on CI |
| Parked for the next slice: `savesRetrying` is not cleared when the engine changes account on its own | there is one fix wave | "Not saved yet · trying again" for about two seconds on the other account's same day page |

What the reviews found that the tests had not, for the record: a resent save the server would have refused
(the timestamp was rebuilt); typing, pausing, typing doubling a line (three variants, the last found by the
whole-branch review); a first keystroke racing a load; one account's words under another's (two variants); a
stale line written back over the page; the keyboard taken back after he dismissed it mid-composition; and, on
CI only, the screen taking back a keystroke.
