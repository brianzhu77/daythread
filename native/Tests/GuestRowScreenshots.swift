import DaythreadCore
import DaythreadEditor
import UIKit
import XCTest

/// A screenshot host, not a test: the editor's guest rows on the simulator's real screen, in a window of the test
/// host's scene, held there while a shell loop on the Mac takes `xcrun simctl io <udid> screenshot` (it writes
/// `<name>.done` beside the `<name>.ready` this writes, in the folder `GUEST_ROW_SHOTS` names). Runs only when asked:
/// `TEST_RUNNER_GUEST_ROW_SHOTS=<folder> xcodebuild test … -only-testing:DaythreadTests/GuestRowScreenshots`.
@MainActor
final class GuestRowScreenshots: XCTestCase {
  private static let today = "2026-11-26"
  private var folder = ""

  override func setUp() async throws {
    let folder = ProcessInfo.processInfo.environment["GUEST_ROW_SHOTS"] ?? ""
    try XCTSkipIf(folder.isEmpty, "screenshots only when asked")
    self.folder = folder
  }

  func test_guest_rows_among_his_rows() throws {
    let looks: [(name: String, style: UIUserInterfaceStyle, category: UIContentSizeCategory, dimmed: Bool)] = [
      ("light-default", .light, .large, false),
      ("dark-default", .dark, .large, false),
      ("light-ax5", .light, .accessibilityExtraExtraExtraLarge, false),
      ("dark-ax5", .dark, .accessibilityExtraExtraExtraLarge, false),
      ("light-default-dimmed", .light, .large, true),
    ]
    for look in looks {
      let (window, editor) = try show(style: look.style, category: look.category)
      editor.setGuestRows([
        Self.guest("gt", after: "t1", kind: .todo, words: "Book the flights", detail: "Thu 11/19"),
        Self.guest("gb", after: "b1", kind: .bullet, words: "Water the plants", detail: "Tue 11/24"),
        Self.guest("gl", after: "p1", kind: .line, words: "A carried line", detail: "Wed 11/25"),
      ])
      if look.dimmed { editor.actingRow = "gt" }
      window.layoutIfNeeded()
      try shoot(look.name)
      window.isHidden = true
    }
  }

  // MARK: the page

  private static func run(_ words: String) -> JSONValue {
    .array([.object(["type": .string("text"), "text": .string(words), "styles": .object([:])])])
  }

  private static func todoRow(_ id: String, _ taskId: String, _ words: String) -> Block {
    Block(
      id: id, type: "task",
      props: ["taskId": .string(taskId), "role": .string("plan"), "planDate": .string(today)], content: run(words))
  }

  private static func line(_ id: String, _ type: String, _ words: String, props: JSONObject = [:]) -> Block {
    Block(id: id, type: type, props: props, content: run(words))
  }

  /// A to-do guest between two to-do rows, a bullet guest between two bullets, a line guest between two lines.
  private static let blocks = [
    line("h1", "heading", "Today", props: ["level": .number("1")]),
    todoRow("t1", "task-1", "Call the bank"),
    todoRow("t2", "task-2", "Send the invoice"),
    line("b1", "bulletListItem", "A bullet of his"),
    line("b2", "bulletListItem", "Another bullet"),
    line("h2", "heading", "Notes", props: ["level": .number("2")]),
    line("p1", "paragraph", "A line of his own"),
    line("p2", "paragraph", "Another line of his"),
  ]

  private static func guest(_ id: String, after: String, kind: GuestRow.Kind, words: String, detail: String)
    -> GuestRow
  {
    GuestRow(
      id: id, place: .after(lineID: after), kind: kind, words: words, detail: detail, spokenKind: "Suggestion",
      actions: [
        GuestRow.Action(id: "apply", symbol: "checkmark", label: "Apply \(words)", spokenName: "Apply"),
        GuestRow.Action(id: "skip", symbol: "xmark", label: "Skip \(words)", spokenName: "Skip"),
      ])
  }

  private func task(_ id: String, _ title: String, deadline: String? = nil) -> JSONValue {
    .object([
      "id": .string(id), "title": .string(title), "status": .string("open"), "paused": .bool(false),
      "deadlineOn": deadline.map { .string($0) } ?? .null, "attentionOn": .null,
    ])
  }

  /// Today's page in an editor filling a window of the test host's scene, above the app's own.
  private func show(style: UIUserInterfaceStyle, category: UIContentSizeCategory) throws
    -> (UIWindow, DocumentViewController)
  {
    let page: JSONValue = .object([
      "id": .string("day:\(Self.today)"), "type": .string("daily"), "date": .string(Self.today),
      "title": .string(""), "document": .string(Document.write(Self.blocks)),
    ])
    let workspace = try XCTUnwrap(
      Workspace(
        .object([
          "revision": .number("1"), "timezone": .string("UTC"), "pages": .array([page]),
          "tasks": .array([task("task-1", "Call the bank", deadline: "2026-11-27"), task("task-2", "Send the invoice")]),
        ])))
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first, "the test host has a scene")
    let window = UIWindow(windowScene: scene)
    window.frame = scene.screen.bounds
    window.overrideUserInterfaceStyle = style
    window.traitOverrides.preferredContentSizeCategory = category
    let editor = DocumentViewController()
    window.rootViewController = editor
    window.windowLevel = .alert + 1
    window.makeKeyAndVisible()
    editor.today = LocalDate(Self.today)
    editor.edit(page: try XCTUnwrap(workspace.dayPage(try XCTUnwrap(LocalDate(Self.today)))), in: workspace)
    window.layoutIfNeeded()
    return (window, editor)
  }

  private func spin(_ seconds: TimeInterval) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
  }

  private func shoot(_ name: String) throws {
    spin(0.6)
    let ready = URL(fileURLWithPath: "\(folder)/\(name).ready")
    let done = URL(fileURLWithPath: "\(folder)/\(name).done")
    try? FileManager.default.removeItem(at: done)
    try Data().write(to: ready)
    let end = Date().addingTimeInterval(20)
    while !FileManager.default.fileExists(atPath: done.path), Date() < end { spin(0.1) }
    XCTAssertTrue(FileManager.default.fileExists(atPath: done.path), "no screenshot of \(name)")
    try? FileManager.default.removeItem(at: ready)
  }
}
