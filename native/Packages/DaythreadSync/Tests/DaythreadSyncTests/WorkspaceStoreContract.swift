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
