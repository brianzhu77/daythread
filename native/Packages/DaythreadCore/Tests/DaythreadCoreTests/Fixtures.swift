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

/// `{"type":"text","text":…,"styles":{}}`
func textRun(_ text: String) -> JSONObject {
  var run = JSONObject()
  run["type"] = .string("text")
  run["text"] = .string(text)
  run["styles"] = .object(JSONObject())
  return run
}
