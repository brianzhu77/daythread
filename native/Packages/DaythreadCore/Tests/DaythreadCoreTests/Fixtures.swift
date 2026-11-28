import Foundation
import Testing

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

/// A shared case of `saves/`: one `save-editor` action and what the server did with it.
struct SaveCase {
  var name: String
  var before: Workspace
  var action: JSONObject
  var after: Workspace?
  var refused: String?

  var pageId: String { action["pageId"]?.stringValue ?? "" }
  var document: String { action["document"]?.stringValue ?? "" }
  var beforePage: Page? { before.page(pageId) }
}

extension Fixtures {
  static func saveNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: "saves").path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  static func saveCase(_ name: String) throws -> SaveCase {
    let object = try #require(try json("saves/\(name).json").objectValue)
    return SaveCase(
      name: name,
      before: try #require(object["before"].flatMap(Workspace.init)),
      action: try #require(object["action"]?.objectValue),
      after: object["after"].flatMap(Workspace.init),
      refused: object["refused"]?.stringValue)
  }
}

extension Fixtures {
  /// The entries of a shared case file whose cases are an array of objects.
  static func cases(_ path: String) throws -> [JSONObject] {
    try #require(try json(path).arrayValue).compactMap(\.objectValue)
  }

  /// A case's `workspace`, read as the app reads one from the server.
  static func workspace(of entry: JSONObject, _ name: String) throws -> Workspace {
    try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
  }

  /// A case's list of `yyyy-MM-dd` strings, each a calendar day.
  static func days(_ value: JSONValue?, _ name: String) throws -> [LocalDate] {
    try (value?.arrayValue ?? []).map { try #require($0.stringValue.flatMap(LocalDate.init), "a day: \(name)") }
  }
}

/// A shared case of `actions/`: one row command and what the server answered, or refused.
struct ActionCase {
  var name: String
  var before: Workspace
  /// The web's `RowIntent`; nil for Undo.
  var intent: JSONObject?
  var taskId: String?
  var day: String?
  var today: String
  var action: JSONValue
  var receipt: JSONValue?
  var after: Workspace?
  var plannedAfter: String?
  var notice: String
  var refused: String?
}

extension Fixtures {
  static func actionNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: "actions").path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  static func actionCase(_ name: String) throws -> ActionCase {
    let object = try #require(try json("actions/\(name).json").objectValue)
    return ActionCase(
      name: name,
      before: try #require(object["before"].flatMap(Workspace.init), "before: \(name)"),
      intent: object["intent"]?.objectValue,
      taskId: object["taskId"]?.stringValue,
      day: object["day"]?.stringValue,
      today: try #require(object["today"]?.stringValue, "today: \(name)"),
      action: try #require(object["action"], "action: \(name)"),
      receipt: object["receipt"],
      after: object["after"].flatMap(Workspace.init),
      plannedAfter: object["plannedAfter"]?.stringValue,
      notice: try #require(object["notice"]?.stringValue, "notice: \(name)"),
      refused: object["refused"]?.stringValue)
  }
}

extension RowAction {
  /// The action a shared case's web intent stands for; `button` is the reference row's own `Plan for today`.
  init?(intent: JSONObject?, button: Bool = false) {
    switch intent?["kind"]?.stringValue {
    case "move":
      guard let date = intent?["date"]?.stringValue.flatMap(LocalDate.init) else { return nil }
      self = .move(date)
    case "pick-date": self = .pickDate
    case "bring-today": self = button ? .planForTodayButton : .bringToToday
    case "not-today": self = .notToday
    case "cancel": self = .cancel
    case "restore": self = .restore
    default: return nil
    }
  }
}

/// A shared case of `facts-actions/`: the strip's `Bring back` or `Another day` for a to-do set aside, and what the
/// server answered.
struct FactsActionCase {
  var name: String
  var before: Workspace
  var taskId: String
  var date: LocalDate
  var today: LocalDate
  var action: JSONValue
  var after: Workspace
  var notice: String
}

extension Fixtures {
  static func factsActionNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: "facts-actions").path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  static func factsActionCase(_ name: String) throws -> FactsActionCase {
    let object = try #require(try json("facts-actions/\(name).json").objectValue)
    return FactsActionCase(
      name: name,
      before: try #require(object["before"].flatMap(Workspace.init), "before: \(name)"),
      taskId: try #require(object["taskId"]?.stringValue, "taskId: \(name)"),
      date: try #require(object["date"]?.stringValue.flatMap(LocalDate.init), "date: \(name)"),
      today: try #require(object["today"]?.stringValue.flatMap(LocalDate.init), "today: \(name)"),
      action: try #require(object["action"], "action: \(name)"),
      after: try #require(object["after"].flatMap(Workspace.init), "after: \(name)"),
      notice: try #require(object["notice"]?.stringValue, "notice: \(name)"))
  }
}

/// A shared case of `draft/actions/`: one draft command and what the server answered, or refused.
struct DraftActionCase {
  var name: String
  var before: Workspace
  var pageId: String
  var itemIds: [String]
  var today: LocalDate
  var action: JSONValue
  var receipt: JSONValue?
  var refusal: String?
  var after: Workspace
  /// The skip's ticket as the web wrote it; nil for every other command.
  var ticket: JSONObject?

  var type: String { Command.type(of: action) ?? "" }
}

extension Fixtures {
  static func draftActionNames() throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: core.appending(path: "draft/actions").path)
      .filter { $0.hasSuffix(".json") }
      .map { String($0.dropLast(".json".count)) }
      .sorted()
  }

  static func draftActionCase(_ name: String) throws -> DraftActionCase {
    let object = try #require(try json("draft/actions/\(name).json").objectValue)
    return DraftActionCase(
      name: name,
      before: try #require(object["before"].flatMap(Workspace.init), "before: \(name)"),
      pageId: try #require(object["pageId"]?.stringValue, "pageId: \(name)"),
      itemIds: try #require(object["itemIds"]?.arrayValue, "itemIds: \(name)").compactMap(\.stringValue),
      today: try #require(object["today"]?.stringValue.flatMap(LocalDate.init), "today: \(name)"),
      action: try #require(object["action"], "action: \(name)"),
      receipt: object["receipt"].flatMap { $0 == .null ? nil : $0 },
      refusal: object["refusal"]?.stringValue,
      after: try #require(object["after"].flatMap(Workspace.init), "after: \(name)"),
      ticket: object["ticket"]?.objectValue)
  }
}
