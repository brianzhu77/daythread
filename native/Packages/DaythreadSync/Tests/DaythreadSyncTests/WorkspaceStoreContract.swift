import DaythreadCore
import Foundation
import Testing

@testable import DaythreadSync

/// What a client of the store observes, run against every implementation.
struct StoreCase: Sendable, CustomTestStringConvertible {
  let name: String
  let run: @Sendable (any WorkspaceStore) async throws -> Void
  var testDescription: String { name }
}

enum WorkspaceStoreContract {
  static let cases: [StoreCase] = [
    StoreCase(name: "nothing kept loads as nil", run: nothingKept),
    StoreCase(name: "replace then load gives the same workspace and owner", run: replaceThenLoad),
    StoreCase(name: "a document is kept exactly as the server sent it", run: documentKeptExactly),
    StoreCase(name: "write then load gives the workspace after the changes", run: writeThenLoad),
    StoreCase(name: "write without a workspace kept is refused", run: writeWithoutWorkspace),
    StoreCase(name: "replace under the same owner keeps the outbox", run: sameOwnerKeepsOutbox),
    StoreCase(name: "replace under another owner drops the outbox", run: otherOwnerDropsOutbox),
    StoreCase(name: "entries are the stored owner's, by seq", run: entriesOfTheOwner),
    StoreCase(name: "seq rises and never repeats after remove", run: seqNeverRepeats),
    StoreCase(name: "update keeps state, reason and own revisions", run: updateKeepsState),
    StoreCase(name: "update of an entry that is not there is refused", run: updateOfMissingEntry),
    StoreCase(name: "remove of an entry that is not there does nothing", run: removeOfMissingEntry),
    StoreCase(name: "append without a workspace kept is refused", run: appendWithoutWorkspace),
    StoreCase(name: "erase leaves nothing", run: eraseLeavesNothing),
    StoreCase(name: "2,000 pages of 2 KB are replaced and loaded", run: manyPages),
    StoreCase(name: "acknowledge removes the entry and passes the revision on", run: acknowledgePassesOn),
    StoreCase(name: "acknowledge does not repeat a revision an entry has", run: acknowledgeDoesNotRepeat),
    StoreCase(name: "acknowledge of an entry that is not there does nothing", run: acknowledgeOfMissingEntry),
    StoreCase(name: "acknowledge without a revision only removes", run: acknowledgeWithoutRevision),
    StoreCase(
      name: "acknowledging an entry that is not there changes nothing",
      run: acknowledging_an_entry_that_is_not_there_changes_nothing),
    StoreCase(
      name: "a write that names a row the workspace lacks changes nothing",
      run: a_write_that_names_a_row_the_workspace_lacks_changes_nothing),
    StoreCase(name: "a draft is kept and read back", run: a_draft_is_kept_and_read_back),
    StoreCase(
      name: "putting again replaces that owner's draft of that page",
      run: putting_again_replaces_that_owners_draft_of_that_page),
    StoreCase(
      name: "two owners' drafts of the same page are both kept",
      run: two_owners_drafts_of_the_same_page_are_both_kept),
    StoreCase(name: "replacing the workspace keeps every draft", run: replacing_the_workspace_keeps_every_draft),
    StoreCase(name: "removing a draft leaves the others", run: removing_a_draft_leaves_the_others),
    StoreCase(name: "erase removes drafts", run: erase_removes_drafts),
    StoreCase(
      name: "drafts come oldest first, ties by owner then page", run: drafts_come_oldest_first_then_by_owner_and_page),
  ]

  private static let owner = "user-1"

  private static func firstWorkspace() throws -> Workspace {
    try required(StoreFixtures.workspaces().first)
  }

  static func nothingKept(_ store: any WorkspaceStore) async throws {
    #expect(try await store.load() == nil)
    #expect(try await store.entries().isEmpty)
  }

  static func replaceThenLoad(_ store: any WorkspaceStore) async throws {
    for workspace in try StoreFixtures.workspaces() {
      try await store.replace(with: workspace, owner: owner)
      let loaded = try required(try await store.load())
      #expect(loaded.owner == owner)
      #expect(loaded.workspace == workspace)
      #expect(loaded.workspace.pages == workspace.pages)
      #expect(loaded.workspace.tasks == workspace.tasks)
      #expect(loaded.workspace.json() == workspace.json())
    }
  }

  static func documentKeptExactly(_ store: any WorkspaceStore) async throws {
    let document = #"[{\"text\":\"caf\u00e9 \\ud83d\\ude00 \\u0000 \\/ \\u00E9\"}]"#
    let text = """
      {"revision":1,"timezone":"UTC","extra":{"a":1.50,"b":1e21},"pages":[{"id":"p","type":"document",\
      "date":null,"title":"T","document":"\(document)"}],"tasks":[]}
      """
    let workspace = try required(Workspace(try JSON.parse(text)))
    try await store.replace(with: workspace, owner: owner)
    let loaded = try required(try await store.load()).workspace
    #expect(loaded.pages.first?.document == workspace.pages.first?.document)
    #expect(JSON.write(loaded.json()) == JSON.write(workspace.json()))
  }

  static func writeThenLoad(_ store: any WorkspaceStore) async throws {
    for change in try StoreFixtures.changes() {
      try await store.replace(with: change.before, owner: owner)
      let after = try required(change.before.applying(change.changes))
      try await store.write(after, changed: change.changes)
      let loaded = try required(try await store.load())
      #expect(loaded.owner == owner, "\(change.name)")
      // `==` also compares the object a workspace was read from, whose revision `applying` leaves as it was.
      #expect(loaded.workspace.json() == after.json(), "\(change.name)")
      #expect(loaded.workspace.revision == after.revision, "\(change.name)")
      #expect(loaded.workspace.pages == after.pages, "\(change.name)")
      #expect(loaded.workspace.tasks == after.tasks, "\(change.name)")
      #expect(loaded.workspace.pages.map(\.id) == after.pages.map(\.id), "\(change.name)")
      #expect(loaded.workspace.tasks.map(\.id) == after.tasks.map(\.id), "\(change.name)")
      #expect(
        equalIgnoringTopLevelKeyOrder(loaded.workspace.json(), change.after), "\(change.name)")
    }
  }

  static func writeWithoutWorkspace(_ store: any WorkspaceStore) async throws {
    let change = try required(StoreFixtures.changes().first)
    let after = try required(change.before.applying(change.changes))
    await #expect(throws: StoreError.self) { try await store.write(after, changed: change.changes) }
    #expect(try await store.load() == nil)
  }

  static func sameOwnerKeepsOutbox(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let kept = try await store.append(newEntry())
    try await store.replace(with: try firstWorkspace(), owner: owner)
    #expect(try await store.entries() == [kept])
  }

  static func otherOwnerDropsOutbox(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    _ = try await store.append(newEntry())
    _ = try await store.append(newEntry(operationId: "op-2"))
    try await store.replace(with: try firstWorkspace(), owner: "user-2")
    #expect(try await store.entries().isEmpty)
    #expect(try await store.load()?.owner == "user-2")
    // Going back does not bring them back.
    try await store.replace(with: try firstWorkspace(), owner: owner)
    #expect(try await store.entries().isEmpty)
  }

  static func entriesOfTheOwner(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    _ = try await store.append(newEntry(operationId: "op-a"))
    _ = try await store.append(newEntry(owner: "user-2", operationId: "op-other"))
    _ = try await store.append(newEntry(operationId: "op-b"))
    let entries = try await store.entries()
    #expect(entries.map(\.operationId) == ["op-a", "op-b"])
    #expect(entries.map(\.seq) == entries.map(\.seq).sorted())
  }

  static func seqNeverRepeats(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let one = try await store.append(newEntry(operationId: "op-1"))
    let two = try await store.append(newEntry(operationId: "op-2"))
    #expect(one.seq < two.seq)
    try await store.remove(seq: two.seq)
    let three = try await store.append(newEntry(operationId: "op-3"))
    #expect(three.seq > two.seq)
    try await store.remove(seq: one.seq)
    try await store.remove(seq: three.seq)
    let four = try await store.append(newEntry(operationId: "op-4"))
    #expect(four.seq > three.seq)
    #expect(try await store.entries() == [four])
  }

  static func updateKeepsState(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let other = try await store.append(newEntry(operationId: "op-other"))
    var entry = try await store.append(newEntry())
    entry.state = .held
    entry.reason = "The server refused it"
    entry.ownRevisions = [6, 7]
    try await store.update(entry)
    #expect(try await store.entries() == [other, entry])

    // Kept again on a later revision, as Keep mine does.
    entry.baseRevision = 9
    entry.ownRevisions = []
    try await store.update(entry)
    #expect(try await store.entries() == [other, entry])
    entry.ownRevisions = [6, 7]

    entry.state = .pending
    entry.reason = nil
    try await store.update(entry)
    let back = try required(try await store.entries().last)
    #expect(back.state == .pending)
    #expect(back.reason == nil)
    #expect(back.ownRevisions == [6, 7])
    #expect(back.action == entry.action)
    #expect(back.createdAt == entry.createdAt)
  }

  static func updateOfMissingEntry(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let entry = try await store.append(newEntry())
    try await store.remove(seq: entry.seq)
    await #expect(throws: StoreError.self) { try await store.update(entry) }
    #expect(try await store.entries().isEmpty)
  }

  static func removeOfMissingEntry(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let entry = try await store.append(newEntry())
    try await store.remove(seq: entry.seq + 100)
    #expect(try await store.entries() == [entry])
  }

  static func appendWithoutWorkspace(_ store: any WorkspaceStore) async throws {
    await #expect(throws: StoreError.self) { try await store.append(newEntry()) }
    #expect(try await store.entries().isEmpty)
  }

  static func eraseLeavesNothing(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    _ = try await store.append(newEntry())
    try await store.erase()
    #expect(try await store.load() == nil)
    #expect(try await store.entries().isEmpty)
    try await store.erase()
  }

  private static func entry(_ operationId: String, owner: String = owner, own: [Int] = []) -> NewOutboxEntry {
    NewOutboxEntry(
      kind: .command, owner: owner, operationId: operationId, action: .object(["type": .string("tick")]),
      baseRevision: 5, ownRevisions: own, label: operationId, createdAt: Date(timeIntervalSince1970: 0),
      state: .pending, reason: nil)
  }

  static func acknowledgePassesOn(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let earlier = try await store.append(entry("op-earlier", own: [3]))
    let acknowledged = try await store.append(entry("op-acknowledged"))
    let theirs = try await store.append(entry("op-theirs", owner: "user-2"))
    var later = try await store.append(entry("op-later", own: [6]))

    try await store.acknowledge(seq: acknowledged.seq, revision: 7)

    later.ownRevisions = [6, 7]
    #expect(try await store.entries() == [earlier, later])
    // Another owner's entry is left as it was.
    try await store.replace(with: try firstWorkspace(), owner: "user-2")
    #expect(try await store.entries() == [theirs])
  }

  static func acknowledgeDoesNotRepeat(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let acknowledged = try await store.append(entry("op-acknowledged"))
    let later = try await store.append(entry("op-later", own: [7]))

    try await store.acknowledge(seq: acknowledged.seq, revision: 7)

    #expect(try await store.entries() == [later])
  }

  static func acknowledgeOfMissingEntry(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let gone = try await store.append(entry("op-gone"))
    let later = try await store.append(entry("op-later"))
    try await store.remove(seq: gone.seq)

    try await store.acknowledge(seq: gone.seq, revision: 7)
    try await store.acknowledge(seq: later.seq + 100, revision: 8)

    #expect(try await store.entries() == [later])
  }

  static func acknowledgeWithoutRevision(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let acknowledged = try await store.append(entry("op-acknowledged"))
    let later = try await store.append(entry("op-later", own: [4]))

    try await store.acknowledge(seq: acknowledged.seq, revision: nil)

    #expect(try await store.entries() == [later])
  }

  static func acknowledging_an_entry_that_is_not_there_changes_nothing(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let earlier = try await store.append(entry("op-earlier", own: [3]))
    let gone = try await store.append(entry("op-gone"))
    let later = try await store.append(entry("op-later", own: [6]))
    try await store.remove(seq: gone.seq)

    try await store.acknowledge(seq: gone.seq, revision: 7)

    #expect(try await store.entries() == [earlier, later], "no other entry gains the revision")
  }

  /// The input: changes that remove the kept to-do `a` and write a to-do `ghost` the workspace given lacks. The
  /// store removes before it writes, so a store that is not one transaction would lose `a`.
  static func a_write_that_names_a_row_the_workspace_lacks_changes_nothing(_ store: any WorkspaceStore) async throws {
    let row = #"{"id":"a","title":"a","status":"open","paused":false}"#
    let ghost = #"{"id":"ghost","title":"ghost","status":"open","paused":false}"#
    let before = try required(
      Workspace(try JSON.parse(#"{"revision":5,"timezone":"UTC","pages":[],"tasks":[\#(row)]}"#)))
    let lacking = try required(Workspace(try JSON.parse(#"{"revision":6,"timezone":"UTC","pages":[],"tasks":[]}"#)))
    let changes = try required(
      WorkspaceChanges(
        try JSON.parse(
          #"{"from":5,"revision":6,"timezone":"UTC","pages":{"upsert":[],"remove":[]},"#
            + #""tasks":{"upsert":[\#(ghost)],"remove":["a"]}}"#)))
    try await store.replace(with: before, owner: owner)

    await #expect(throws: StoreError.self) { try await store.write(lacking, changed: changes) }

    let loaded = try required(try await store.load())
    #expect(loaded.workspace.json() == before.json())
    #expect(loaded.workspace.tasks == before.tasks)
  }

  /// A document with non-ASCII text, escapes and quotes, as the server would send it. (A document is JSON text, so
  /// a NUL in it is the escape `\u0000`, never the character.)
  private static let awkwardDocument =
    #"[{"id":"b","content":[{"type":"text","text":"café 😀 \u0000 \\ \/ \"q\" 你好"}]}]"#
    + " \u{1F600} caf\u{E9}"

  /// A save's action as first sent, holding the awkward document, as `JSON.write` gives it.
  private static let awkwardAction = JSON.write(
    .object([
      "type": .string("save-editor"), "pageId": .string("p2"), "document": .string(awkwardDocument),
      "today": .string("2026-11-25"),
    ]))

  private static func draft(
    _ pageId: String = "p1", owner: String = owner, document: String = "[]", changedAt: Double = 1_798_194_615.125,
    sent: PageDraft.Sent? = nil
  ) -> PageDraft {
    PageDraft(
      pageId: pageId, owner: owner, base: "key-\(pageId)", baseDocument: awkwardDocument, document: document,
      singleDeleteIds: ["x", "y"], sent: sent, changedAt: Date(timeIntervalSince1970: changedAt))
  }

  static func a_draft_is_kept_and_read_back(_ store: any WorkspaceStore) async throws {
    #expect(try await store.drafts().isEmpty)
    let sent = PageDraft.Sent(operationId: "op-9", document: awkwardDocument, action: awkwardAction)
    let plain = draft("p1", document: awkwardDocument)
    let sending = draft("p2", document: awkwardDocument, changedAt: 1_798_194_616.5, sent: sent)
    try await store.put(plain)
    try await store.put(sending)
    #expect(try await store.drafts() == [plain, sending])
    #expect(try await store.drafts().last?.sent?.document == awkwardDocument)
    #expect(try await store.drafts().last?.sent?.action.utf8.elementsEqual(awkwardAction.utf8) == true)
  }

  static func putting_again_replaces_that_owners_draft_of_that_page(_ store: any WorkspaceStore) async throws {
    try await store.put(draft(document: "[1]"))
    let later = draft(
      document: "[2]", changedAt: 1_798_194_700,
      sent: .init(operationId: "op", document: "[1]", action: #"{"document":"[1]"}"#))
    try await store.put(later)
    #expect(try await store.drafts() == [later])
  }

  static func two_owners_drafts_of_the_same_page_are_both_kept(_ store: any WorkspaceStore) async throws {
    let mine = draft(owner: "user-1", document: "[1]")
    let theirs = draft(owner: "user-2", document: "[2]")
    try await store.put(mine)
    try await store.put(theirs)
    #expect(try await store.drafts() == [mine, theirs])
    try await store.removeDraft(pageId: "p1", owner: "user-1")
    #expect(try await store.drafts() == [theirs])
  }

  static func replacing_the_workspace_keeps_every_draft(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    let mine = draft(owner: "user-1")
    let theirs = draft("p2", owner: "user-2", changedAt: 1_798_194_700)
    try await store.put(mine)
    try await store.put(theirs)
    try await store.replace(with: try firstWorkspace(), owner: "user-2")
    #expect(try await store.drafts() == [mine, theirs])
    try await store.replace(with: try firstWorkspace(), owner: "user-1")
    #expect(try await store.drafts() == [mine, theirs])
  }

  static func removing_a_draft_leaves_the_others(_ store: any WorkspaceStore) async throws {
    let one = draft("p1", changedAt: 1)
    let two = draft("p2", changedAt: 2)
    let three = draft("p3", changedAt: 3)
    for each in [one, two, three] { try await store.put(each) }
    try await store.removeDraft(pageId: "p2", owner: owner)
    #expect(try await store.drafts() == [one, three])
    // Nothing there: nothing happens, and nothing is thrown.
    try await store.removeDraft(pageId: "p2", owner: owner)
    try await store.removeDraft(pageId: "p1", owner: "user-2")
    #expect(try await store.drafts() == [one, three])
  }

  static func erase_removes_drafts(_ store: any WorkspaceStore) async throws {
    try await store.replace(with: try firstWorkspace(), owner: owner)
    try await store.put(draft(owner: "user-1"))
    try await store.put(draft(owner: "user-2"))
    try await store.erase()
    #expect(try await store.drafts().isEmpty)
  }

  static func drafts_come_oldest_first_then_by_owner_and_page(_ store: any WorkspaceStore) async throws {
    let newest = draft("c", owner: "user-1", changedAt: 30)
    let tieB = draft("b", owner: "user-1", changedAt: 20)
    let tieA = draft("a", owner: "user-1", changedAt: 20)
    let tieOwner = draft("a", owner: "user-0", changedAt: 20)
    let oldest = draft("z", owner: "user-9", changedAt: 10)
    for each in [newest, tieB, oldest, tieA, tieOwner] { try await store.put(each) }
    #expect(try await store.drafts() == [oldest, tieOwner, tieA, tieB, newest])
  }

  static func manyPages(_ store: any WorkspaceStore) async throws {
    let workspace = try StoreFixtures.large(pages: 2_000, size: 2_048)
    let clock = ContinuousClock()
    let elapsed = try await clock.measure {
      try await store.replace(with: workspace, owner: owner)
      let loaded = try required(try await store.load())
      #expect(loaded.workspace.pages.count == 2_000)
      #expect(loaded.workspace.pages == workspace.pages)
    }
    print("replace and load of 2,000 pages of 2 KB took \(elapsed)")
  }
}

/// Equal when both are objects with the same keys and equal values, whatever order the keys came in.
func equalIgnoringTopLevelKeyOrder(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
  guard let a = a?.objectValue, let b = b?.objectValue else { return false }
  return Set(a.keys) == Set(b.keys) && a.keys.allSatisfy { a[$0] == b[$0] }
}
