import DaythreadCore
import Foundation
import Testing

/// The suites that put a page on screen, run one test at a time. A test that waits for the keyboard lets the run loop
/// turn, and a test run meanwhile would put its own window in front and take the keyboard from it.
@Suite(.serialized) struct OnScreen {}

/// Reads the shared cases under `fixtures/core` at the repository root.
enum EditorFixtures {
  static let core: URL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // DaythreadEditorTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // DaythreadEditor
    .deletingLastPathComponent()  // Packages
    .deletingLastPathComponent()  // native
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/core", directoryHint: .isDirectory)

  /// The workspace `day-with-everything`.
  static func workspace() throws -> Workspace {
    let text = try String(contentsOf: core.appending(path: "workspaces/day-with-everything.json"), encoding: .utf8)
    guard let workspace = Workspace(try JSON.parse(text)) else { throw Unreadable() }
    return workspace
  }

  /// The page `day:2026-10-22`, whose document is the fixture document `day-with-everything`.
  static func dayPage() throws -> Page {
    guard let page = try workspace().page("day:2026-10-22") else { throw Unreadable() }
    return page
  }

  struct Unreadable: Error {}
}

/// A page of the given blocks, in a workspace whose tasks are given.
func makePage(_ blocks: [Block], id: String = "p", date: String? = nil) throws -> Page {
  let dateValue: JSONValue = date.map { .string($0) } ?? .null
  let json: JSONValue = .object([
    "id": .string(id), "type": .string("document"), "date": dateValue, "title": .string("A page"),
    "document": .string(Document.write(blocks)),
  ])
  guard let page = Page(json) else { throw EditorFixtures.Unreadable() }
  return page
}

func makeWorkspace(pages: [Page] = [], tasks: [JSONValue] = []) throws -> Workspace {
  let json: JSONValue = .object([
    "revision": .number("1"), "timezone": .string("UTC"), "pages": .array(pages.map { .object($0.raw) }),
    "tasks": .array(tasks),
  ])
  guard let workspace = Workspace(json) else { throw EditorFixtures.Unreadable() }
  return workspace
}

func taskJSON(_ id: String, status: String, paused: Bool = false) -> JSONValue {
  .object(["id": .string(id), "title": .string("T"), "status": .string(status), "paused": .bool(paused)])
}

func run(_ text: String, _ styles: [String: JSONValue] = [:]) -> JSONValue {
  var object = JSONObject()
  for (key, value) in styles.sorted(by: { $0.key < $1.key }) { object[key] = value }
  return .object(["type": .string("text"), "text": .string(text), "styles": .object(object)])
}

func block(_ id: String, _ type: String, _ props: JSONObject = JSONObject(), text: String? = nil, children: [Block] = []) -> Block {
  Block(id: id, type: type, props: props, content: text.map { .array([run($0)]) }, children: children)
}
