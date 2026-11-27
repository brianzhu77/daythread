import DaythreadCore
import DaythreadSync
import Foundation
import Observation
import Synchronization
import Testing
import UIKit

@testable import Daythread
@testable import DaythreadUI

private let today = LocalDate("2026-11-25")!
private let yesterday = LocalDate("2026-11-24")!
private let todayId = "day:2026-11-25"
private let yesterdayId = "day:2026-11-24"

private func line(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"paragraph","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

/// A to-do's row; `planned` as the server writes it back once a save made its to-do.
private func todoLine(_ id: String, _ words: String, planned: Bool = false) -> String {
  let props =
    planned
    ? #"{"taskId":"editor-task:\#(id)","role":"plan","planDate":"2026-11-25"}"# : #"{"taskId":"editor-task:\#(id)"}"#
  let content = words.isEmpty ? "[]" : #"[{"type":"text","text":"\#(words)","styles":{}}]"#
  return #"{"id":"\#(id)","type":"task","props":\#(props),"content":\#(content),"children":[]}"#
}

private func document(_ lines: [String]) -> String { "[\(lines.joined(separator: ","))]" }

private func page(_ date: LocalDate, _ document: String, trashed: Bool = false) -> JSONValue {
  var page: JSONObject = [
    "id": .string("day:\(date.value)"), "type": .string("daily"), "date": .string(date.value),
    "title": .string(""), "document": .string(document),
  ]
  if trashed {
    page["trashedAt"] = .string("2026-11-24T20:00:00.000Z")
    page["trashId"] = .string("batch-1")
  }
  return .object(page)
}

private func todo(_ status: String, version: Int) -> JSONValue {
  .object([
    "id": .string("editor-task:r1"), "title": .string("Buy milk"), "status": .string(status),
    "paused": .bool(false), "version": .number(String(version)),
  ])
}

private func copy(revision: Int = 1, pages: [JSONValue], tasks: [JSONValue] = []) throws -> Workspace {
  try #require(
    Workspace(
      .object([
        "revision": .number(String(revision)), "timezone": .string("UTC"), "pages": .array(pages),
        "tasks": .array(tasks),
      ])))
}

private func changes(from: Int, to revision: Int, pages: [JSONValue] = [], tasks: [JSONValue] = []) throws
  -> WorkspaceChanges
{
  try #require(
    WorkspaceChanges(
      .object([
        "from": .number(String(from)), "revision": .number(String(revision)), "timezone": .string("UTC"),
        "pages": .object(["upsert": .array(pages), "remove": .array([])]),
        "tasks": .object(["upsert": .array(tasks), "remove": .array([])]),
      ])))
}

/// The words of a document's lines, in page order.
private func words(of document: String?) -> [String] {
  guard let document else { return [] }
  let page = EditablePage(document: document, pageDate: nil)
  return page.textBlocks.compactMap { page.content(of: $0)?.plain }
}

/// The page saves the server was sent, in order: the page and the document.
private func saves(_ server: TestServer) async -> [(pageId: String?, document: String?)] {
  await server.sent.compactMap { action in
    guard let object = action.objectValue, object["type"]?.stringValue == "save-editor" else { return nil }
    return (object["pageId"]?.stringValue, object["document"]?.stringValue)
  }
}

/// Waits, a few milliseconds at a time, for an answer only an actor can give; records an issue after two seconds.
@MainActor
private func eventually(
  _ condition: () async -> Bool, sourceLocation: SourceLocation = #_sourceLocation
) async throws {
  for _ in 0..<400 {
    if await condition() { return }
    try await Task.sleep(nanoseconds: 5_000_000)
  }
  Issue.record("Timed out waiting", sourceLocation: sourceLocation)
}

/// Lets the main run loop turn for a while, so the screen acts on whatever it was told; for asserting that something
/// did not happen.
@MainActor
private func turns() async throws {
  try await Task.sleep(nanoseconds: 300_000_000)
}

/// The day screen in a phone-sized window, its lines' text views read as he sees them.
@MainActor
private struct DayScreen {
  let window: UIWindow
  let screen: DayViewController

  init(_ model: AppModel) throws {
    screen = DayViewController(model: model)
    window = try testWindow(width: 402)
    window.rootViewController = UINavigationController(rootViewController: screen)
    window.makeKeyAndVisible()
    drawn()
  }

  func drawn() {
    screen.updatePropertiesIfNeeded()
    window.layoutIfNeeded()
  }

  /// The text views of the page's rows, top to bottom.
  var lines: [UITextView] {
    drawn()
    guard let list = screen.list else { return [] }
    return list.subviews.compactMap { $0 as? UICollectionViewCell }.filter { !$0.isHidden }
      .sorted { $0.frame.minY < $1.frame.minY }.compactMap { Self.textView(in: $0) }
  }

  /// What each line shows, top to bottom.
  var words: [String] { lines.map(\.text) }

  var status: String? {
    drawn()
    let label = screen.headerView.statusLabel
    return label.isHidden ? nil : label.text
  }

  func line(_ words: String) throws -> UITextView {
    try #require(lines.first { $0.text == words }, "no line reads \"\(words)\"")
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

  func circle(_ label: String) -> UIButton? {
    drawn()
    return Self.button(label, in: window)
  }

  func close() {
    window.endEditing(true)
    window.isHidden = true
  }

  private static func textView(in view: UIView) -> UITextView? {
    if let view = view as? UITextView { return view }
    return view.subviews.lazy.compactMap { textView(in: $0) }.first
  }

  private static func button(_ label: String, in view: UIView) -> UIButton? {
    if let button = view as? UIButton, button.accessibilityLabel == label { return button }
    return view.subviews.lazy.compactMap { button(label, in: $0) }.first
  }
}

/// Writing on the day screen: what he types reaches the engine in order, a page changed on the server is merged
/// without asking, and the screen says what is not saved.
@MainActor
@Suite struct WritingTests {
  private let base = document([line("a", "Morning"), line("b", "Walk")])

  private func harness(_ pages: [JSONValue]? = nil) async throws -> Harness {
    try await Harness(copy: try copy(pages: pages ?? [page(today, base)]), sleep: neverEnding)
  }

  /// The server's copy at revision 2, with today's page as another device left it and yesterday's as it was.
  private func loaded(_ h: Harness, today document: String) async throws {
    await h.server.add([
      .workspace(.full(try copy(revision: 2, pages: [page(today, document), page(yesterday, base)]), owner: "one"))
    ])
    await h.model.refresh()
  }

  @Test func what_he_types_is_drawn_from_the_engine_after_a_relaunch() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { h.model.state.drafts.map(\.id) == [todayId] }
    day.close()

    // A new engine and model on the same store, with a server that has not answered anything yet.
    let server = TestServer()
    await server.hold()
    let tokens = MemoryTokenStore()
    try tokens.write(one)
    let engine = SyncEngine(transport: server, tokens: tokens, store: h.store, sleep: neverEnding, now: { noon })
    let model = AppModel(engine: engine, now: { noon })
    model.start()
    try await until { model.workspace != nil }
    let again = try DayScreen(model)

    #expect(again.words == ["Morning", "Walk the dog"])
    #expect(await server.sent.isEmpty)
    again.close()
    await server.release()
  }

  @Test func three_quick_changes_reach_the_engine_in_order_and_the_screen_keeps_the_last() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    await h.store.holdPut()
    let walk = try day.type(" t", atEndOf: "Walk")
    await h.store.putHeld()
    walk.insertText("h")
    walk.insertText("e")

    await h.store.releaseOnePut()
    // The first state the engine publishes draws the first change; the screen keeps what he typed since.
    try await until { h.model.state.workspace?.page(todayId).map { words(of: $0.document) } == ["Morning", "Walk t"] }
    #expect(day.words == ["Morning", "Walk the"])
    await h.store.putHeld()
    #expect(day.words == ["Morning", "Walk the"])
    await h.store.releasePut()
    try await until {
      h.model.state.workspace?.page(todayId).map { words(of: $0.document) } == ["Morning", "Walk the"]
    }
    #expect(day.words == ["Morning", "Walk the"])
    // The two waiting while the first was stored went as one, the last.
    #expect(await h.store.puts.map { words(of: $0.document) } == [["Morning", "Walk t"], ["Morning", "Walk the"]])
    day.close()
  }

  @Test func a_page_changed_on_the_server_while_he_typed_is_merged_and_saved_without_asking() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }

    // Another device added a line before his words were saved.
    await h.server.holdSaves()
    try await loaded(h, today: document([line("a", "Morning"), line("b", "Walk"), line("c", "Call mum")]))
    try await eventually { await h.server.waitingCalls == 1 }

    let merged = ["Morning", "Walk the dog", "Call mum"]
    #expect(day.words == merged)
    let save = try #require(await saves(h.server).last)
    #expect(save.pageId == todayId)
    #expect(words(of: save.document) == merged)
    #expect(day.screen.presentedViewController == nil, "he is not asked")
    #expect(day.status == nil, "nothing to say: only his line and only theirs changed")
    day.close()
    await h.server.release()
  }

  @Test func a_line_both_changed_shows_both_and_says_so() async throws {
    let h = try await harness([page(today, base), page(yesterday, base)])
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }

    await h.server.holdSaves()
    try await loaded(h, today: document([line("a", "Morning"), line("b", "Walk the cat")]))
    try await eventually { await h.server.waitingCalls == 1 }

    let merged = ["Morning", "Walk the cat", "Walk the dog"]
    #expect(day.words == merged)
    #expect(words(of: await saves(h.server).last?.document) == merged)
    #expect(day.status == "Latest loaded · your changes are below their lines")

    // A new state that changes nothing of this page keeps saying it. (A refresh would wait behind the pass whose save
    // the server holds; words kept for another day publish a state at once.)
    h.model.wrote(
      pageId: yesterdayId, document: document([line("a", "Morning"), line("b", "Walk on")]), singleDeleteIds: [],
      startedFrom: base)
    try await until { h.model.state.drafts.count == 2 }
    #expect(day.status == "Latest loaded · your changes are below their lines", "until he types again")
    #expect(day.words == merged)

    try day.type("!", atEndOf: "Walk the dog")
    try await until { day.status == nil }
    day.close()
    await h.server.release()
  }

  @Test func a_merge_waits_for_composition_to_end() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    let morning = try day.line("Morning")
    #expect(morning.becomeFirstResponder())
    morning.selectedRange = NSRange(location: 7, length: 0)
    morning.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))

    await h.server.holdSaves()
    try await loaded(h, today: document([line("a", "Morning"), line("b", "Walk"), line("c", "Call mum")]))
    try await until { h.model.state.drafts.first?.state == .behind }
    try await turns()

    // Nothing is merged while he composes: the line keeps what he is composing, and no row is added.
    #expect(morning.markedTextRange != nil)
    #expect(day.words == ["Morning今", "Walk the dog"])
    #expect(await saves(h.server).isEmpty)

    morning.unmarkText()

    let merged = ["Morning今", "Walk the dog", "Call mum"]
    try await until { day.words == merged }
    try await eventually { await h.server.waitingCalls == 1 }
    #expect(words(of: await saves(h.server).last?.document) == merged)
    day.close()
    await h.server.release()
  }

  @Test func a_merge_waits_for_a_composition_that_ends_with_nothing_typed() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    let morning = try day.line("Morning")
    #expect(morning.becomeFirstResponder())
    morning.selectedRange = NSRange(location: 7, length: 0)
    morning.setMarkedText("n", selectedRange: NSRange(location: 1, length: 0))

    await h.server.holdSaves()
    try await loaded(h, today: document([line("a", "Morning"), line("b", "Walk"), line("c", "Call mum")]))
    try await until { h.model.state.drafts.first?.state == .behind }
    try await turns()
    #expect(day.words == ["Morningn", "Walk the dog"])

    // He takes the composition back: nothing is typed, and nothing reports a change.
    morning.setMarkedText("", selectedRange: NSRange(location: 0, length: 0))
    morning.unmarkText()

    let merged = ["Morning", "Walk the dog", "Call mum"]
    try await until { day.words == merged }
    try await eventually { await h.server.waitingCalls == 1 }
    #expect(words(of: await saves(h.server).last?.document) == merged)
    day.close()
    await h.server.release()
  }

  @Test func a_draft_of_a_day_that_is_not_open_is_merged_too() async throws {
    let h = try await harness([page(today, "[]"), page(yesterday, base)])

    // No screen shows yesterday: the model alone has its draft.
    h.model.wrote(
      pageId: yesterdayId, document: document([line("a", "Morning"), line("b", "Walk the dog")]),
      singleDeleteIds: [], startedFrom: base)
    try await until { h.model.state.drafts.map(\.id) == [yesterdayId] }

    await h.server.holdSaves()
    await h.server.add([
      .workspace(
        .full(
          try copy(
            revision: 2,
            pages: [page(today, "[]"), page(yesterday, document([line("a", "Morning"), line("b", "Walk"), line("c", "Call mum")]))]),
          owner: "one"))
    ])
    await h.model.refresh()
    try await eventually { await h.server.waitingCalls == 1 }

    let save = try #require(await saves(h.server).last)
    #expect(save.pageId == yesterdayId)
    #expect(words(of: save.document) == ["Morning", "Walk the dog", "Call mum"])
    // Once, not again and again: the keep, then one merged draft (the other put records the save on its way).
    try await turns()
    #expect(
      await h.store.puts.filter { $0.sent == nil }.map { words(of: $0.document) } == [
        ["Morning", "Walk the dog"], ["Morning", "Walk the dog", "Call mum"],
      ])
    #expect(await saves(h.server).count == 1)
    await h.server.release()
  }

  @Test func a_row_removed_before_a_merge_is_still_named_in_the_save_after_it() async throws {
    let h = try await harness([page(today, document([line("a", "Morning"), todoLine("t", ""), line("b", "Walk")]))])
    let day = try DayScreen(h.model)
    // Backspace on the empty to-do removes its row, one at a time.
    let empty = try day.line("")
    #expect(empty.becomeFirstResponder())
    empty.selectedRange = NSRange(location: 0, length: 0)
    empty.deleteBackward()
    try await until { h.model.state.drafts.map(\.id) == [todayId] }
    // Once the row's removal has been animated.
    try await until { day.words == ["Morning", "Walk"] }

    await h.server.holdSaves()
    try await loaded(
      h, today: document([line("a", "Morning"), todoLine("t", ""), line("b", "Walk"), line("c", "Call mum")]))
    try await eventually { await h.server.waitingCalls == 1 }

    try await until { day.words == ["Morning", "Walk", "Call mum"] }
    let action = try #require(await h.server.sent.last?.objectValue)
    #expect(words(of: action["document"]?.stringValue) == ["Morning", "Walk", "Call mum"])
    #expect(action["singleDeleteIds"] == .array([.string("t")]), "the save after the merge still names the row")
    day.close()
    await h.server.release()
  }

  @Test func a_merged_draft_of_a_day_that_is_not_open_names_only_the_rows_still_gone() async throws {
    let before = document([line("a", "Morning"), todoLine("t", "Tea"), todoLine("u", "Call"), line("b", "Walk")])
    let h = try await harness([page(today, "[]"), page(yesterday, before)])

    // He removed both to-dos' rows one at a time on yesterday's page, which no screen shows now.
    h.model.wrote(
      pageId: yesterdayId, document: document([line("a", "Morning"), line("b", "Walk")]), singleDeleteIds: ["t", "u"],
      startedFrom: before)
    try await until { h.model.state.drafts.map(\.id) == [yesterdayId] }

    // Another device changed the second to-do's words: its row stays, and the save must not name it.
    await h.server.holdSaves()
    let theirs = document([
      line("a", "Morning"), todoLine("t", "Tea"), todoLine("u", "Call mum"), line("b", "Walk"), line("c", "Read"),
    ])
    await h.server.add([
      .workspace(.full(try copy(revision: 2, pages: [page(today, "[]"), page(yesterday, theirs)]), owner: "one"))
    ])
    await h.model.refresh()
    try await eventually { await h.server.waitingCalls == 1 }

    let action = try #require(await h.server.sent.last?.objectValue)
    #expect(action["pageId"]?.stringValue == yesterdayId)
    #expect(words(of: action["document"]?.stringValue) == ["Morning", "Call mum", "Walk", "Read"])
    #expect(action["singleDeleteIds"] == .array([.string("t")]))
    await h.server.release()
  }

  @Test func a_to_do_typed_offline_can_be_ticked_and_both_arrive_in_order() async throws {
    let h = try await harness([page(today, document([line("a", "Morning"), todoLine("r1", "")]))])
    let day = try DayScreen(h.model)
    try day.type("Buy milk", atEndOf: "")
    try await until { h.model.workspace?.task("editor-task:r1")?.status == .open }

    let circle = try #require(day.circle("Complete Buy milk"), "the new to-do can be ticked")
    circle.sendActions(for: .primaryActionTriggered)
    #expect(h.model.workspace?.task("editor-task:r1")?.status == .done)

    // Offline: the save does not go, so neither does the tick.
    await h.model.saveNow().value
    #expect(h.model.state.offline)
    #expect(await h.server.sent.filter { $0.objectValue?["type"]?.stringValue == "task-status" }.isEmpty)

    // Back online: the save, then the tick on the to-do it makes.
    let savedPage = page(today, document([line("a", "Morning"), todoLine("r1", "Buy milk", planned: true)]))
    await h.server.add([
      .saved(
        .applied(
          receipt: .object(["revision": .number("2")]),
          changes: try changes(from: 1, to: 2, pages: [savedPage], tasks: [todo("open", version: 1)]), owner: "one")),
      .outcome(
        .applied(
          receipt: .object([:]), changes: try changes(from: 2, to: 3, tasks: [todo("done", version: 2)]), owner: "one")),
    ])
    await h.model.saveNow().value
    await h.engine.settled()

    let sent = await h.server.sent
    #expect(sent.last == Command.taskStatus(taskId: "editor-task:r1", status: .done, today: today))
    #expect(sent.dropLast().last?.objectValue?["type"]?.stringValue == "save-editor")
    #expect(words(of: sent.dropLast().last?.objectValue?["document"]?.stringValue) == ["Morning", "Buy milk"])
    #expect(sent.filter { $0.objectValue?["type"]?.stringValue == "task-status" }.count == 1)
    try await until { h.model.state.workspace?.task("editor-task:r1")?.status == .done }
    #expect(h.model.state.drafts.isEmpty)
    #expect(day.words == ["Morning", "Buy milk"])
    day.close()
  }

  @Test func leaving_the_day_and_leaving_the_foreground_save_now() async throws {
    let h = try await harness([page(today, base), page(yesterday, base)])
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    try await turns()
    #expect(await saves(h.server).isEmpty, "the wait after his change has not run out")

    // Leaving the day sends it at once.
    day.screen.open(yesterday)
    day.drawn()
    try await eventually { await saves(h.server).count == 1 }
    #expect(words(of: await saves(h.server).last?.document) == ["Morning", "Walk the dog"])

    // Leaving the foreground: a new change, sent at once, with the app held awake until the engine is done. Today's
    // save, which went first and found no network, lands this time.
    let savedToday = page(today, document([line("a", "Morning"), line("b", "Walk the dog")]))
    await h.server.add([
      .saved(
        .applied(
          receipt: .object(["revision": .number("2")]), changes: try changes(from: 1, to: 2, pages: [savedToday]),
          owner: "one"))
    ])
    try day.type(" again", atEndOf: "Walk")
    try await until { h.model.state.drafts.map(\.id).contains(yesterdayId) }
    let time = TestBackgroundTime()
    _ = SavingInBackground(model: h.model, time: time)
    #expect(time.begun == 1)
    try await eventually { await saves(h.server).contains { $0.pageId == yesterdayId } }
    try await until { time.ended == [7] }
    try await turns()
    #expect(time.ended == [7], "ended once")
    day.close()
  }

  @Test func the_background_task_ends_once_when_time_is_up() async throws {
    let h = try await harness()
    await h.server.holdSaves()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    let time = TestBackgroundTime()
    _ = SavingInBackground(model: h.model, time: time)
    try await eventually { await h.server.waitingCalls == 1 }

    time.expire()
    #expect(time.ended == [7])
    await h.server.release()
    await h.engine.settled()
    try await turns()
    #expect(time.ended == [7], "not ended again when the save is done")
    day.close()
  }

  @Test func typing_after_a_save_landed_is_not_merged() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    let saved = document([line("a", "Morning"), line("b", "Walk the dog")])
    await h.server.add([
      .saved(
        .applied(
          receipt: .object(["revision": .number("2")]),
          changes: try changes(from: 1, to: 2, pages: [page(today, saved)]), owner: "one"))
    ])
    await h.model.saveNow().value
    try await until { h.model.state.drafts.isEmpty }
    day.drawn()

    // He goes on typing in the same line once the save has landed.
    await h.server.holdSaves()
    try day.type(" again", atEndOf: "Walk the dog")
    try await until { !h.model.state.drafts.isEmpty }
    #expect(h.model.state.drafts.first?.state != .behind, "the draft starts from the page that was saved")
    let saving = h.model.saveNow()
    try await eventually { await h.server.waitingCalls == 1 }

    #expect(day.words == ["Morning", "Walk the dog again"])
    #expect(day.status == nil)
    let action = try #require(await h.server.sent.last?.objectValue)
    #expect(action["expectedContent"]?.stringValue == ContentKey.of(saved))
    #expect(words(of: action["document"]?.stringValue) == ["Morning", "Walk the dog again"])
    day.close()
    await h.server.release()
    await saving.value
  }

  @Test func a_keystroke_on_its_way_when_a_save_landed_is_typed_onto_what_was_saved() async throws {
    let h = try await harness([page(today, base), page(yesterday, base)])
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    let saved = document([line("a", "Morning"), line("b", "Walk the dog")])
    await h.server.add([
      .saved(
        .applied(
          receipt: .object(["revision": .number("2")]),
          changes: try changes(from: 1, to: 2, pages: [page(today, saved)]), owner: "one"))
    ])
    await h.server.holdSaves()
    let saving = h.model.saveNow()
    try await eventually { await h.server.waitingCalls == 1 }

    // His next keystroke waits in the model behind words for another day, whose store write is held.
    await h.store.holdPut()
    h.model.wrote(
      pageId: yesterdayId, document: document([line("a", "Morning"), line("b", "Walk on")]), singleDeleteIds: [],
      startedFrom: base)
    await h.store.putHeld()
    try day.type("!", atEndOf: "Walk the dog")

    // The save's answer comes first and removes the draft; then the keystroke reaches the engine.
    await h.server.release()
    try await turns()
    await h.store.releasePut()
    await saving.value
    try await until { h.model.state.drafts.contains { $0.id == todayId } }
    try await turns()

    #expect(day.words == ["Morning", "Walk the dog!"])
    #expect(day.status == nil)
    #expect(h.model.state.drafts.first { $0.id == todayId }?.state == .waiting, "nothing to merge")
    #expect(await saves(h.server).count == 1, "no merged page was saved")
    day.close()
  }

  @Test func a_state_that_changes_only_his_words_leaves_the_list_alone() async throws {
    let todoRow =
      #"{"id":"t","type":"task","props":{"taskId":"t-open"},"content":[{"type":"text","text":"Water the plants","styles":{}}],"children":[]}"#
    let task: JSONValue = .object([
      "id": .string("t-open"), "title": .string("Water the plants"), "status": .string("open"),
      "paused": .bool(false), "doneOn": .null, "version": .number("1"),
    ])
    let h = try await Harness(
      copy: try copy(pages: [page(today, document([line("a", "Morning"), line("b", "Walk"), todoRow]))], tasks: [task]),
      sleep: neverEnding)
    let day = try DayScreen(h.model)
    await h.store.holdPut()
    let walk = try day.type(" t", atEndOf: "Walk")
    await h.store.putHeld()
    walk.insertText("h")
    let replaced = day.screen.replacedDocuments.count

    // The engine publishes his changes, the first while the second waits: they differ only in his own words.
    await h.store.releasePut()
    try await until {
      h.model.state.workspace?.page(todayId).map { words(of: $0.document) } == ["Morning", "Walk th", "Water the plants"]
    }
    day.drawn()
    #expect(day.screen.replacedDocuments.count == replaced, "the list is not replaced with its own words")

    // A to-do's status changes: the list is redrawn once, with his words.
    let circle = try #require(day.circle("Complete Water the plants"))
    circle.sendActions(for: .primaryActionTriggered)
    try await until { h.model.state.pending == 1 }
    day.drawn()
    #expect(day.screen.replacedDocuments.count == replaced + 1)
    #expect(words(of: day.screen.replacedDocuments.last) == ["Morning", "Walk th", "Water the plants"])
    day.close()
  }

  @Test func typing_in_a_to_do_only_the_draft_makes_replaces_the_list_once() async throws {
    let h = try await harness([page(today, document([line("a", "Morning"), todoLine("r1", "")]))])
    let day = try DayScreen(h.model)
    func stored(_ words: String) async throws {
      try await until { h.model.state.workspace?.task("editor-task:r1")?.title == words }
      day.drawn()
    }

    // The first word makes the to-do: the list is handed it, so its circle can be ticked.
    let row = try day.type("B", atEndOf: "")
    try await stored("B")
    #expect(day.screen.replacedDocuments.count == 1)

    // Each later keystroke renames the to-do the engine draws; the list draws no title, so it is left alone.
    for (typed, words) in [("uy", "Buy"), (" milk", "Buy milk"), ("!", "Buy milk!")] {
      row.insertText(typed)
      try await stored(words)
    }
    #expect(day.screen.replacedDocuments.count == 1)

    let circle = try #require(day.circle("Complete Buy milk!"))
    circle.sendActions(for: .primaryActionTriggered)
    // The tick waits for the save that makes its to-do.
    try await until { h.model.state.waiting == 1 }
    day.drawn()
    #expect(day.screen.replacedDocuments.count == 2, "a tick is drawn")
    day.close()
  }

  @Test func saving_now_does_not_hold_up_what_he_types_next() async throws {
    let h = try await harness([page(today, base), page(yesterday, base)])
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    await h.server.holdSaves()
    let saving = h.model.saveNow()
    try await eventually { await h.server.waitingCalls == 1 }

    // While the save waits for the network, his words on another day are stored at once.
    h.model.wrote(
      pageId: yesterdayId, document: document([line("a", "Morning"), line("b", "Walk on")]), singleDeleteIds: [],
      startedFrom: base)
    try await eventually { await h.store.puts.contains { $0.pageId == yesterdayId } }
    #expect(await h.server.waitingCalls == 1, "the save is still on its way")
    day.close()
    await h.server.release()
    await saving.value
  }

  @Test func discarding_the_open_pages_draft_shows_the_servers_page() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }

    await h.model.discardDraft(pageId: todayId)

    try await until { day.words == ["Morning", "Walk"] }
    try day.type("!", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    #expect(h.model.state.drafts.first?.state != .behind, "the next change starts from the server's page")
    day.close()
  }

  @Test func the_screen_hears_when_a_pages_last_call_is_answered() async throws {
    let h = try await harness()
    let heard = Heard()
    withObservationTracking {
      _ = h.model.answeredWrites
    } onChange: {
      heard.value.withLock { $0 = true }
    }

    h.model.wrote(
      pageId: todayId, document: document([line("a", "Morning"), line("b", "Walk on")]), singleDeleteIds: [],
      startedFrom: base)

    try await until { heard.value.withLock { $0 } }
    #expect(!h.model.isWriting(todayId))
  }

  @Test func a_merge_refused_because_the_page_moved_again_keeps_their_lines_on_screen() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")
    try await until { !h.model.state.drafts.isEmpty }
    let morning = try day.line("Morning")
    #expect(morning.becomeFirstResponder())
    morning.selectedRange = NSRange(location: 7, length: 0)
    morning.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
    try await loaded(h, today: document([line("a", "Morning"), line("b", "Walk"), line("c", "Call mum")]))
    try await until { h.model.state.drafts.first?.state == .behind }

    // The page moves again: that load waits at the server.
    await h.server.add([
      .workspace(
        .full(
          try copy(
            revision: 3,
            pages: [
              page(today, document([line("a", "Morning"), line("b", "Walk"), line("c", "Call mum"), line("d", "Call dad")]))
            ]), owner: "one"))
    ])
    await h.server.hold()
    let refreshing = Task { [model = h.model] in await model.refresh() }
    try await eventually { await h.server.waitingCalls == 1 }

    // His composition ends: its keep waits in the store, and the merge with the first move is handed over behind it.
    await h.store.holdPut()
    morning.unmarkText()
    try await until { day.words == ["Morning今", "Walk the dog", "Call mum"] }
    await h.server.release()
    try await eventually { await h.server.loadsAnswered == 3 }
    try await turns()
    await h.store.releasePut()

    try await until { day.words == ["Morning今", "Walk the dog", "Call mum", "Call dad"] }
    await refreshing.value
    #expect(
      await !h.store.puts.contains { words(of: $0.document) == ["Morning今", "Walk the dog", "Call mum"] },
      "the first merge was refused")
    let merged = day.screen.replacedDocuments.drop { !words(of: $0).contains("Call mum") }
    #expect(!merged.isEmpty)
    #expect(merged.allSatisfy { words(of: $0).contains("Call mum") }, "their line never left the screen")
    day.close()
  }

  @Test func signing_out_with_a_draft_asks_first() async throws {
    let h = try await harness()
    let day = try DayScreen(h.model)
    try day.type(" the dog", atEndOf: "Walk")

    // At once, before the engine has stored the change.
    let signOut = try #require(
      day.screen.accountMenu().compactMap { $0 as? UIAction }.first { $0.title == "Sign out" })
    signOut.performWithSender(nil, target: nil)

    try await until { day.screen.presentedViewController is UIAlertController }
    let alert = try #require(day.screen.presentedViewController as? UIAlertController)
    #expect(alert.title == "1 change not sent")
    #expect(alert.actions.map(\.title) == ["Sign out and discard", "Cancel"])
    #expect(h.model.state.phase == .ready, "nobody was signed out")
    day.screen.dismiss(animated: false)
    day.close()
  }
}

/// Set from an observation's change handler, which may run on any thread.
private final class Heard: Sendable {
  let value = Mutex(false)
}

/// Background time the test owns: each task it begins is 7, and the test says when time is up.
@MainActor
private final class TestBackgroundTime: BackgroundTime {
  private(set) var begun = 0
  private(set) var ended: [Int] = []
  private var expired: (@MainActor @Sendable () -> Void)?

  func begin(expired: @escaping @MainActor @Sendable () -> Void) -> UIBackgroundTaskIdentifier {
    begun += 1
    self.expired = expired
    return UIBackgroundTaskIdentifier(rawValue: 7)
  }

  func end(_ task: UIBackgroundTaskIdentifier) {
    ended.append(task.rawValue)
  }

  func expire() {
    expired?()
  }
}
