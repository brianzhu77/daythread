import DaythreadCore
import DaythreadSync
import Foundation
import Testing
import UIKit

@testable import DaythreadEditor
@testable import DaythreadUI

/// The day the fixtures' plan rows are planned on unless told otherwise: Thursday, as the screens' tests run.
private let today = LocalDate("2026-11-26")!

func line(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"paragraph","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

/// A to-do's row: a plan row on `planDate`, or a reference row with no plan day.
func row(_ id: String, _ taskId: String, _ words: String, reference: Bool = false, on planDate: LocalDate = today)
  -> String
{
  let props =
    reference
    ? #"{"taskId":"\#(taskId)","role":"reference","planDate":""}"#
    : #"{"taskId":"\#(taskId)","role":"plan","planDate":"\#(planDate.value)"}"#
  let content = words.isEmpty ? "[]" : #"[{"type":"text","text":"\#(words)","styles":{}}]"#
  return #"{"id":"\#(id)","type":"task","props":\#(props),"content":\#(content),"children":[]}"#
}

/// A `@date` chip, as an inline item of a line's content: the event `eventId` on `date`, at `time` (`10:30`), or all
/// day when `time` is empty.
func chip(_ eventId: String, on date: LocalDate, at time: String = "") -> String {
  #"{"type":"dateMention","props":{"eventId":"\#(eventId)","date":"\#(date.value)","time":"\#(time)"}}"#
}

func page(_ date: LocalDate, _ lines: [String]) -> JSONValue {
  .object([
    "id": .string("day:\(date.value)"), "type": .string("daily"), "date": .string(date.value), "title": .string(""),
    "document": .string("[\(lines.joined(separator: ","))]"),
  ])
}

/// `start` is the to-do's Start date (`attentionOn`); `paused`, set aside with Not today.
func task(
  _ id: String, _ title: String, status: String = "open", due: LocalDate? = nil, version: Int = 1,
  paused: Bool = false, start: LocalDate? = nil
) -> JSONValue {
  .object([
    "id": .string(id), "title": .string(title), "status": .string(status), "paused": .bool(paused),
    "version": .number(String(version)), "deadlineOn": due.map { .string($0.value) } ?? .null,
    "attentionOn": start.map { .string($0.value) } ?? .null,
  ])
}

/// The server's Undo slot for `operationId` at `revision`, as the workspace carries it.
func marker(_ operationId: String, _ revision: Int) -> JSONValue {
  .object(["operationId": .string(operationId), "revision": .number(String(revision))])
}

func copy(revision: Int = 1, pages: [JSONValue], tasks: [JSONValue], undo: JSONValue? = nil) throws
  -> Workspace
{
  var object: JSONObject = [
    "revision": .number(String(revision)), "timezone": .string("UTC"), "pages": .array(pages), "tasks": .array(tasks),
  ]
  if let undo { object["undo"] = undo }
  return try #require(Workspace(.object(object)))
}

/// From `from` to `revision`, writing `pages` and `tasks`; the slot is this command's when `undo` names it.
func changes(
  from: Int, to revision: Int, pages: [JSONValue] = [], tasks: [JSONValue] = [], undo operationId: String? = nil
) throws -> WorkspaceChanges {
  var object: JSONObject = [
    "from": .number(String(from)), "revision": .number(String(revision)), "timezone": .string("UTC"),
    "pages": .object(["upsert": .array(pages), "remove": .array([])]),
    "tasks": .object(["upsert": .array(tasks), "remove": .array([])]),
  ]
  object["undo"] = operationId.map { marker($0, revision) } ?? .null
  return try #require(WorkspaceChanges(.object(object)))
}

func applied(_ changes: WorkspaceChanges, receipt: JSONValue = .object(["message": .string("Done")]))
  -> TestServer.Reply
{
  .outcome(.applied(receipt: receipt, changes: changes, owner: "one"))
}

func savedAs(_ changes: WorkspaceChanges) -> TestServer.Reply {
  .saved(.applied(receipt: .object(["revision": .number(String(changes.revision))]), changes: changes, owner: "one"))
}

/// The words of a document's lines, in page order.
func words(of document: String?) -> [String] {
  guard let document else { return [] }
  let page = EditablePage(document: document, pageDate: nil)
  return page.textBlocks.compactMap { page.content(of: $0)?.plain }
}

/// Waits, a few milliseconds at a time, for `condition`; records an issue after ten seconds. The deadline is long
/// because the wait is not what is measured: CI's machines are several times slower than this one.
@MainActor
func soon(_ condition: () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async throws {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: .seconds(10))
  while !condition() {
    guard clock.now < deadline else {
      Issue.record("Timed out waiting", sourceLocation: sourceLocation)
      return
    }
    try await Task.sleep(nanoseconds: 5_000_000)
  }
}

/// `soon` for an answer only an actor can give.
@MainActor
func eventually(_ condition: () async -> Bool, sourceLocation: SourceLocation = #_sourceLocation)
  async throws
{
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: .seconds(10))
  while !(await condition()) {
    guard clock.now < deadline else {
      Issue.record("Timed out waiting", sourceLocation: sourceLocation)
      return
    }
    try await Task.sleep(nanoseconds: 5_000_000)
  }
}

/// Lets the main run loop turn for a while, so the screen acts on whatever it was told; for asserting that something
/// did not happen.
@MainActor
func turns() async throws {
  try await Task.sleep(nanoseconds: 300_000_000)
}

/// The day screen in a phone-sized window (or `width` points wide), its rows read and acted on as he does: a swipe's
/// action, an item of the circle's menu, a tap on a button. Its notice never leaves on its own, so a test reads it at
/// leisure. `size`: the reader's text size, when not the default.
@MainActor
struct RowScreen {
  let window: UIWindow
  let screen: DayViewController

  init(_ model: AppModel, on day: LocalDate? = nil, width: CGFloat = 402, size: UIContentSizeCategory? = nil) throws {
    screen = DayViewController(model: model, noticeSleep: neverEnding)
    window = try testWindow(width: width)
    let navigation = UINavigationController(rootViewController: screen)
    if let size { navigation.traitOverrides.preferredContentSizeCategory = size }
    window.rootViewController = navigation
    window.makeKeyAndVisible()
    if let day { screen.open(day) }
    drawn()
  }

  func drawn() {
    screen.updatePropertiesIfNeeded()
    window.layoutIfNeeded()
  }

  var editor: DocumentViewController {
    screen.children.compactMap { $0 as? DocumentViewController }.first!
  }

  var notice: Notice? { screen.notice.shown }

  /// What the strip above the page shows.
  var facts: DayFacts { screen.factsModel.facts }

  var factsModel: DayFactsModel { screen.factsModel }

  /// The strip's view, in the day's header.
  var factsView: UIView { screen.factsView }

  /// The rows' cells, top to bottom.
  private var cells: [UICollectionViewCell] {
    drawn()
    guard let list = screen.list else { return [] }
    return list.visibleCells.filter { !$0.isHidden }.sorted { $0.frame.minY < $1.frame.minY }
  }

  var lines: [UITextView] { cells.compactMap { Self.textView(in: $0) } }

  /// What each line shows, top to bottom.
  var words: [String] { lines.map(\.text) }

  func line(_ words: String) throws -> UITextView {
    try #require(lines.first { $0.text == words }, "no line reads \"\(words)\"")
  }

  func cell(_ words: String) throws -> UICollectionViewCell {
    try #require(cells.first { Self.textView(in: $0)?.text == words }, "no row reads \"\(words)\"")
  }

  /// Puts the caret at the end of the line that reads `words` and types `text` there, as the keyboard does.
  @discardableResult
  func type(_ text: String, atEndOf words: String) throws -> UITextView {
    let line = try line(words)
    #expect(line.becomeFirstResponder())
    line.selectedRange = NSRange(location: (line.text as NSString).length, length: 0)
    line.insertText(text)
    return line
  }

  /// The trailing swipe the list offers for the row, as the system asks for it.
  func swipe(_ words: String) throws -> UISwipeActionsConfiguration? {
    let list = try #require(screen.list)
    let indexPath = try #require(list.indexPath(for: try cell(words)))
    return editor.listConfiguration.trailingSwipeActionsConfigurationProvider?(indexPath)
  }

  func swipeTitles(_ words: String) throws -> [String] {
    try swipe(words)?.actions.compactMap(\.title) ?? []
  }

  /// Taps the swipe's action named `title` on the row.
  func swipe(_ words: String, _ title: String) throws {
    let action = try #require(try swipe(words)?.actions.first { $0.title == title }, "no swipe \(title) on \(words)")
    action.handler(action, UIView(), { _ in })
  }

  /// Picks the item `title` of the row's circle menu (a touch and hold on the circle).
  func menu(_ words: String, _ title: String) throws {
    let circle = try #require(Self.button(in: try cell(words)) { $0.accessibilityLabel == "Complete \(words)" })
    let items = (circle.menu?.children ?? []).flatMap { ($0 as? UIMenu)?.children ?? [$0] }
    let item = try #require(items.compactMap { $0 as? UIAction }.first { $0.title == title }, "no \(title)")
    item.performWithSender(nil, target: nil)
  }

  func tick(_ words: String) throws {
    let circle = try #require(Self.button(in: try cell(words)) { $0.accessibilityLabel == "Complete \(words)" })
    circle.sendActions(for: .primaryActionTriggered)
  }

  /// The reference row's own `Plan for today` button.
  func planForToday(_ words: String) throws {
    let button = try #require(Self.button(in: try cell(words)) { $0.configuration?.title == "Plan for today" })
    button.sendActions(for: .primaryActionTriggered)
  }

  /// Chooses `title` in the action sheet showing: the sheet goes, then its action's handler runs, as the system does
  /// on a tap. The handler is read by key: UIKit gives a test no other way to run it.
  func choose(_ title: String) throws {
    typealias Handler = @convention(block) (UIAlertAction) -> Void
    let sheet = try #require(screen.presentedViewController as? UIAlertController, "no sheet")
    let action = try #require(sheet.actions.first { $0.title == title }, "no \(title)")
    let handler = try #require(action.value(forKey: "handler") as AnyObject?)
    sheet.dismiss(animated: false)
    unsafeBitCast(handler, to: Handler.self)(action)
  }

  /// The notice's `Undo`, tapped.
  func undo() throws {
    let button = try #require(Self.button(in: screen.notice) { $0.configuration?.title == "Undo" }, "no Undo")
    button.sendActions(for: .primaryActionTriggered)
  }

  /// The row's marks line, as the list draws it under the words.
  func marks(_ words: String) throws -> String? {
    (try cell(words).contentConfiguration as? UIListContentConfiguration)?.secondaryAttributedText?.string
  }

  /// Whether the row's words are drawn dimmed, as while its action is out.
  func dimmed(_ words: String) throws -> Bool {
    let line = try line(words)
    return line.attributedText.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == .tertiaryLabel
  }

  func close() {
    screen.presentedViewController?.dismiss(animated: false)
    window.endEditing(true)
    window.isHidden = true
  }

  private static func textView(in view: UIView) -> UITextView? {
    if let view = view as? UITextView { return view }
    return view.subviews.lazy.compactMap { textView(in: $0) }.first
  }

  private static func button(in view: UIView, where matches: (UIButton) -> Bool) -> UIButton? {
    if let button = view as? UIButton, matches(button) { return button }
    for subview in view.subviews {
      if let found = button(in: subview, where: matches) { return found }
    }
    return nil
  }
}
