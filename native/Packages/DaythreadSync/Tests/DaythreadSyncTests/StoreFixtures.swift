import DaythreadCore
import Foundation

@testable import DaythreadSync

/// Reads the shared cases under `fixtures/core` at the repository root.
enum StoreFixtures {
  static let core: URL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // DaythreadSyncTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // DaythreadSync
    .deletingLastPathComponent()  // Packages
    .deletingLastPathComponent()  // native
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/core", directoryHint: .isDirectory)

  static func json(_ path: String) throws -> JSONValue {
    try JSON.parse(String(contentsOf: core.appending(path: path), encoding: .utf8))
  }

  static func names(in folder: String) throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: folder).path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  /// The standalone workspaces and every `before` and `after` of the changes.
  static func workspaces() throws -> [Workspace] {
    var all: [JSONValue] = try names(in: "workspaces").map { try json("workspaces/\($0).json") }
    for name in try names(in: "changes") {
      let file = try json("changes/\(name).json").objectValue
      for key in ["before", "after"] { if let value = file?[key] { all.append(value) } }
    }
    return try all.map { try required(Workspace($0)) }
  }

  struct Change {
    let name: String
    let before: Workspace
    let changes: WorkspaceChanges
    let after: JSONValue
  }

  /// The changes that apply to their `before`.
  static func changes() throws -> [Change] {
    try names(in: "changes").compactMap { name in
      let file = try required(try json("changes/\(name).json").objectValue)
      let before = try required(Workspace(try required(file["before"])))
      let changes = try required(WorkspaceChanges(try required(file["changes"])))
      guard before.applying(changes) != nil else { return nil }
      return Change(name: name, before: before, changes: changes, after: try required(file["after"]))
    }
  }

  /// A workspace of `count` pages whose documents are `size` characters each.
  static func large(pages count: Int, size: Int) throws -> Workspace {
    let document = String(repeating: "x", count: size)
    let pages = (0..<count).map { index in
      #"{"id":"page-\#(index)","type":"document","date":null,"title":"Page \#(index)","document":"\#(document)"}"#
    }
    let text =
      #"{"revision":7,"timezone":"UTC","pages":[\#(pages.joined(separator: ","))],"tasks":[]}"#
    return try required(Workspace(try JSON.parse(text)))
  }
}

struct Unreadable: Error {}

func required<T>(_ value: T?) throws -> T {
  guard let value else { throw Unreadable() }
  return value
}

func newEntry(
  owner: String = "user-1", operationId: String = "op-1", label: String = "Tick a task"
) -> NewOutboxEntry {
  NewOutboxEntry(
    kind: .command, owner: owner, operationId: operationId,
    action: .object(["type": .string("tickTask"), "taskId": .string("editor-task:r1")]),
    baseRevision: 5, ownRevisions: [], label: label,
    createdAt: Date(timeIntervalSince1970: 1_798_194_615.125), state: .pending, reason: nil)
}
