import Foundation

@testable import DaythreadCore

/// Reads the shared cases under `fixtures/core` at the repository root.
enum Fixtures {
  struct Missing: Error { let path: String }

  static let documentsDirectory: URL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // DaythreadCoreTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // DaythreadCore
    .deletingLastPathComponent()  // Packages
    .deletingLastPathComponent()  // native
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/core/documents", directoryHint: .isDirectory)

  /// Foundation reads the outer file so the helper does not depend on the code under test.
  static func document(_ name: String) throws -> String {
    let url = documentsDirectory.appending(path: "\(name).json")
    let data = try Data(contentsOf: url)
    guard
      let outer = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let document = outer["document"] as? String
    else { throw Missing(path: url.path) }
    return document
  }

  static func documentNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: documentsDirectory.path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  static func documentStrings() throws -> [String] {
    try documentNames().map(document)
  }
}

extension Fixtures {
  static let root: URL = documentsDirectory
    .deletingLastPathComponent()  // core
    .deletingLastPathComponent()  // fixtures

  static let core: URL = root.appending(path: "core", directoryHint: .isDirectory)

  /// A file under `fixtures/core`, read with the package's own parser so key order is kept.
  static func json(_ path: String) throws -> JSONValue {
    let url = core.appending(path: path)
    return try JSON.parse(String(contentsOf: url, encoding: .utf8))
  }

  static func changeNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: "changes").path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  static func workspaceNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: "workspaces").path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  /// The workspaces the shared cases hold: the standalone ones and every `before` of the changes.
  static func workspaces() throws -> [JSONValue] {
    var all = try workspaceNames().map { try json("workspaces/\($0).json") }
    for name in try changeNames() {
      if let before = try json("changes/\(name).json").objectValue?["before"] { all.append(before) }
    }
    return all
  }
}

/// Equal when both are objects with the same keys and equal values, whatever order the keys came in.
/// Applied to a workspace's own top-level object only; everything below it must match in order too.
func equalIgnoringTopLevelKeyOrder(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
  guard let a = a?.objectValue, let b = b?.objectValue else { return false }
  return Set(a.keys) == Set(b.keys) && a.keys.allSatisfy { a[$0] == b[$0] }
}

/// A JSON literal for a test, parsed by the package.
func json(_ text: String) throws -> JSONValue { try JSON.parse(text) }

/// `{"type":"text","text":…,"styles":{}}`
func textRun(_ text: String) -> JSONObject {
  var run = JSONObject()
  run["type"] = .string("text")
  run["text"] = .string(text)
  run["styles"] = .object(JSONObject())
  return run
}

/// A shared case of `commands/`: one action, the rows the server changed for it, and the workspaces around it.
struct CommandCase {
  var name: String
  var before: JSONValue
  var action: JSONValue
  var taskRows: [String]
  var after: JSONValue
}

extension Fixtures {
  static func commandNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: "commands").path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  static func commandCase(_ name: String) throws -> CommandCase {
    let object = try requireObject(try json("commands/\(name).json"), name)
    guard let before = object["before"], let action = object["action"], let after = object["after"],
      let ids = object["rows"]?.objectValue?["tasks"]?.arrayValue
    else { throw Missing(path: "commands/\(name).json") }
    return CommandCase(
      name: name, before: before, action: action, taskRows: ids.compactMap(\.stringValue), after: after)
  }

  static func commandCases() throws -> [CommandCase] { try commandNames().map(commandCase) }

  private static func requireObject(_ value: JSONValue, _ name: String) throws -> JSONObject {
    guard let object = value.objectValue else { throw Missing(path: "commands/\(name).json") }
    return object
  }
}
