import DaythreadCore
import Foundation
import SwiftData
import Testing

@testable import DaythreadSync

@Suite struct SwiftDataWorkspaceStoreTests {
  @Test(arguments: WorkspaceStoreContract.cases)
  func keepsTheContract(_ contract: StoreCase) async throws {
    try await contract.run(try SwiftDataWorkspaceStore.open(at: nil))
  }

  /// A directory that is gone when the body returns.
  private func withTemporaryDirectory<T>(_ body: (URL) async throws -> T) async throws -> T {
    let directory = FileManager.default.temporaryDirectory
      .appending(path: "daythread-store-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    return try await body(directory)
  }

  @Test func aSecondStoreAtTheSameURLLoadsWhatTheFirstWrote() async throws {
    try await withTemporaryDirectory { directory in
      let url = directory.appending(path: "nested/store.sqlite")
      let workspace = try required(try StoreFixtures.workspaces().first)
      let kept: OutboxEntry
      do {
        let first = try SwiftDataWorkspaceStore.open(at: url)
        try await first.replace(with: workspace, owner: "user-1")
        kept = try await first.append(newEntry())
      }
      let second = try SwiftDataWorkspaceStore.open(at: url)
      let loaded = try required(try await second.load())
      #expect(loaded.workspace == workspace)
      #expect(loaded.owner == "user-1")
      #expect(try await second.entries() == [kept])
    }
  }

  @Test func seqDoesNotRepeatAcrossReopeningTheStore() async throws {
    try await withTemporaryDirectory { directory in
      let url = directory.appending(path: "store.sqlite")
      let workspace = try required(try StoreFixtures.workspaces().first)
      let highest: Int
      do {
        let first = try SwiftDataWorkspaceStore.open(at: url)
        try await first.replace(with: workspace, owner: "user-1")
        _ = try await first.append(newEntry())
        let last = try await first.append(newEntry(operationId: "op-2"))
        try await first.remove(seq: last.seq)
        highest = last.seq
      }
      let second = try SwiftDataWorkspaceStore.open(at: url)
      let next = try await second.append(newEntry(operationId: "op-3"))
      #expect(next.seq > highest)
    }
  }

  @Test func a_draft_survives_closing_and_opening_the_store() async throws {
    try await withTemporaryDirectory { directory in
      let url = directory.appending(path: "store.sqlite")
      let draft = PageDraft(
        pageId: "p1", owner: "user-1", base: "key", baseDocument: "[\"caf\u{E9} \u{1F600}\"]", document: "[]",
        singleDeleteIds: ["a"],
        sent: .init(
          operationId: "op-1", document: "[\"sent\"]", action: #"{"document":"[\"sent\"]","at":"caf\#u{E9}"}"#),
        changedAt: Date(timeIntervalSince1970: 1_798_194_615.125))
      do {
        let first = try SwiftDataWorkspaceStore.open(at: url)
        try await first.put(draft)
      }
      let second = try SwiftDataWorkspaceStore.open(at: url)
      #expect(try await second.drafts() == [draft])
    }
  }

  @Test func a_store_written_by_the_first_schema_opens_with_everything_in_it() async throws {
    try await withTemporaryDirectory { directory in
      let url = directory.appending(path: "store.sqlite")
      let text = """
        {"revision":4,"timezone":"UTC","pages":[{"id":"p1","type":"document","date":null,"title":"One",\
        "document":"[]"},{"id":"p2","type":"document","date":null,"title":"Two","document":"[1]"}],\
        "tasks":[{"id":"t1","title":"a","status":"open","paused":false}]}
        """
      let workspace = try required(Workspace(try JSON.parse(text)))
      let entryTime = Date(timeIntervalSince1970: 1_798_194_615.125)
      do {
        let schema = Schema(versionedSchema: SchemaV1.self)
        let container = try ModelContainer(
          for: schema, configurations: [ModelConfiguration(schema: schema, url: url)])
        let context = ModelContext(container)
        var rest = try required(workspace.json().objectValue)
        rest["pages"] = .array([])
        rest["tasks"] = .array([])
        for (position, page) in workspace.pages.enumerated() {
          context.insert(SchemaV1.PageRow(id: page.id, position: position, json: JSON.write(.object(page.raw))))
        }
        for (position, task) in workspace.tasks.enumerated() {
          context.insert(SchemaV1.TaskRow(id: task.id, position: position, json: JSON.write(.object(task.raw))))
        }
        context.insert(
          SchemaV1.MetaRow(owner: "user-1", revision: 4, restJSON: JSON.write(.object(rest)), nextSeq: 3))
        for seq in 1...2 {
          context.insert(
            SchemaV1.OutboxRow(
              seq: seq, kind: "command", owner: "user-1", operationId: "op-\(seq)",
              actionJSON: #"{"type":"tickTask","taskId":"t1"}"#, baseRevision: 4, ownRevisionsJSON: "[3]",
              label: "Tick \(seq)", createdAt: entryTime, state: "pending", reason: nil))
        }
        try context.save()
      }

      let store = try SwiftDataWorkspaceStore.open(at: url)
      let loaded = try required(try await store.load())
      #expect(loaded.owner == "user-1")
      #expect(loaded.workspace.json() == workspace.json())
      #expect(loaded.workspace.pages.map(\.id) == ["p1", "p2"])
      let entries = try await store.entries()
      #expect(entries.map(\.operationId) == ["op-1", "op-2"])
      #expect(entries.map(\.ownRevisions) == [[3], [3]])
      #expect(entries.map(\.createdAt) == [entryTime, entryTime])
      #expect(try await store.append(newEntry(operationId: "op-3")).seq == 3)

      let draft = PageDraft(
        pageId: "p1", owner: "user-1", base: "k", baseDocument: "[]", document: "[1]", singleDeleteIds: [],
        sent: nil, changedAt: entryTime)
      try await store.put(draft)
      #expect(try await store.drafts() == [draft])
    }
  }

  @Test func storesInMemoryAreIndependent() async throws {
    let one = try SwiftDataWorkspaceStore.open(at: nil)
    let other = try SwiftDataWorkspaceStore.open(at: nil)
    try await one.replace(with: try required(StoreFixtures.workspaces().first), owner: "user-1")
    #expect(try await other.load() == nil)
  }

  @Test func writeLeavesTheRowsTheChangesDoNotNameAlone() async throws {
    let change = try required(StoreFixtures.changes().first { $0.name == "task-ticked" })
    let store = try SwiftDataWorkspaceStore.open(at: nil)
    try await store.replace(with: change.before, owner: "user-1")
    let afterReplace = await store.rowWrites
    #expect(afterReplace >= change.before.pages.count + change.before.tasks.count)

    let after = try required(change.before.applying(change.changes))
    try await store.write(after, changed: change.changes)
    let named = change.changes.upsertedPageIds.count + change.changes.upsertedTaskIds.count
    #expect(named > 0)
    #expect(await store.rowWrites - afterReplace == named)
  }

  @Test func writeRewritesPositionsOnlyWhenTheListsMoved() async throws {
    let change = try required(StoreFixtures.changes().first { $0.name == "page-removed" })
    let store = try SwiftDataWorkspaceStore.open(at: nil)
    try await store.replace(with: change.before, owner: "user-1")
    let afterReplace = await store.rowWrites
    let after = try required(change.before.applying(change.changes))
    try await store.write(after, changed: change.changes)
    let shifted = change.before.pages.count - after.pages.count
    #expect(shifted > 0)
    // Only rows behind the removed page move up; those in front are not rewritten.
    let rewritten = await store.rowWrites - afterReplace
    #expect(rewritten <= after.pages.count + change.changes.upsertedTaskIds.count)
  }

  @Test func acknowledgeIsOneSave() async throws {
    let store = try SwiftDataWorkspaceStore.open(at: nil)
    try await store.replace(with: try required(StoreFixtures.workspaces().first), owner: "user-1")
    let acknowledged = try await store.append(newEntry(operationId: "op-1"))
    _ = try await store.append(newEntry(operationId: "op-2"))
    _ = try await store.append(newEntry(operationId: "op-3"))
    let before = await store.saves

    try await store.acknowledge(seq: acknowledged.seq, revision: 9)

    #expect(await store.saves - before == 1)
    #expect(try await store.entries().map(\.ownRevisions) == [[9], [9]])
  }

  @Test func storedRowsThatCannotBeReadAreNotLoadedPartly() async throws {
    let store = try SwiftDataWorkspaceStore.open(at: nil)
    try await store.replace(with: try required(StoreFixtures.workspaces().first), owner: "user-1")
    try await store.corruptAPage()
    await #expect(throws: StoreError.unreadable) { try await store.load() }
  }
}

extension SwiftDataWorkspaceStore {
  /// Replaces one page's stored JSON with text that is not JSON.
  fileprivate func corruptAPage() throws {
    var descriptor = FetchDescriptor<PageRow>()
    descriptor.fetchLimit = 1
    let row = try required(try modelContext.fetch(descriptor).first)
    row.json = "{not json"
    try modelContext.save()
  }
}
