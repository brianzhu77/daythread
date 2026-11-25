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
