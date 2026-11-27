import DaythreadCore
import DaythreadSync
import Foundation
import UIKit
import XCTest

@testable import Daythread
import DaythreadEditor
@testable import DaythreadUI

/// How typing feels on a long page (`native-phase-1.md` §10.7): the time from a keystroke to the list having laid
/// itself out again, for 50 characters typed into the 150th line of a page of 300, with the engine and a store on
/// disk real and a server that never answers, so no save's answer lands while it is measured. The same on a page of
/// 10 lines says what the page's length costs.
///
/// Each test types five runs and prints each run's time per keystroke and their median. Between keystrokes the
/// engine's state with the last one is drawn, as between his; the time to that is printed too, and not budgeted.
/// The budget holds only on the machine it was measured on: with `DAYTHREAD_FEEL_BUDGET=1` given to the test runner
/// (`TEST_RUNNER_DAYTHREAD_FEEL_BUDGET=1 xcodebuild test …`), a median over one and a half times the one measured
/// fails; otherwise the numbers are only printed, since CI's machines are slower and vary.
@MainActor
final class TypingFeelTests: XCTestCase {
  /// The medians measured on the machine that set the budget (Apple silicon, the iPhone 17 simulator on iOS 26.5,
  /// a Debug build), in milliseconds per keystroke: the median of five runs of this test, 2026-11-26.
  private static let measuredMedian = (longPage: 7.040, shortPage: 2.671)
  private static let keystrokes = 50
  private static let runs = 5
  /// Words and spaces, so the line's text view breaks and wraps them as it would his.
  private static let typing = Array(" and then")
  private static let today = LocalDate("2026-11-25")!

  private var storeURL: URL?
  private var server: TestServer?

  /// The server is never released: once the engine's save of what was typed is waiting on it, the engine touches the
  /// store no more, and the store goes.
  override func tearDown() async throws {
    await server?.callHeld()
    if let storeURL {
      for suffix in ["", "-shm", "-wal"] {
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: storeURL.path + suffix))
      }
    }
  }

  func test_typing_into_the_150th_line_of_300() async throws {
    let median = try await measureTyping(lines: 300, into: 150)
    try checkBudget(median, against: Self.measuredMedian.longPage)
  }

  func test_typing_into_the_5th_line_of_10() async throws {
    let median = try await measureTyping(lines: 10, into: 5)
    try checkBudget(median, against: Self.measuredMedian.shortPage)
  }

  private func checkBudget(_ median: Double, against measured: Double) throws {
    guard ProcessInfo.processInfo.environment["DAYTHREAD_FEEL_BUDGET"] == "1" else { return }
    let budget = try XCTUnwrap(measured > 0 ? measured * 1.5 : nil, "no median measured yet to hold the budget to")
    XCTAssertLessThanOrEqual(median, budget, "ms per keystroke, against one and a half times the \(measured) measured")
  }

  /// Types `keystrokes` characters at the end of line `target` (1-based) of a page of `count` lines, `runs` times, and
  /// returns the median of the runs' milliseconds per keystroke to the list laid out.
  private func measureTyping(lines count: Int, into target: Int) async throws -> Double {
    let model = try await model(page: count)
    let screen = DayViewController(model: model)
    let window = try feelWindow()
    window.rootViewController = UINavigationController(rootViewController: screen)
    window.makeKeyAndVisible()
    defer { window.isHidden = true }
    screen.updatePropertiesIfNeeded()
    window.layoutIfNeeded()

    let list = try XCTUnwrap(screen.list)
    let editor = try XCTUnwrap(screen.children.compactMap { $0 as? DocumentViewController }.first)
    XCTAssertEqual(editor.today, Self.today, "the rows' facts are read, as on the day screen")
    list.scrollToItem(at: IndexPath(item: target - 1, section: 0), at: .centeredVertically, animated: false)
    window.layoutIfNeeded()
    let words = Self.words(of: target)
    let line = try XCTUnwrap(
      list.visibleCells.lazy.compactMap { Self.textView(in: $0) }.first { $0.text == words }, "line \(target)")
    XCTAssertTrue(line.becomeFirstResponder())
    window.layoutIfNeeded()

    var runs: [Double] = []
    var drawnRuns: [Double] = []
    var typed = words
    var stored = try XCTUnwrap(model.workspace?.dayPage(Self.today)?.document.utf8.count)
    let clock = ContinuousClock()
    for _ in 0..<Self.runs {
      line.selectedRange = NSRange(location: (line.text as NSString).length, length: 0)
      var laidOut = Duration.zero
      var drawn = Duration.zero
      for index in 0..<Self.keystrokes {
        let character = String(Self.typing[index % Self.typing.count])
        let start = clock.now
        line.insertText(character)
        window.layoutIfNeeded()
        laidOut += clock.now - start
        typed += character
        // As between his keystrokes, the engine's state with this one is drawn before the next. Each character typed
        // is one byte of the document; its length is read, not its text searched, so the wait costs the main actor
        // nothing that would be counted against the app.
        stored += 1
        let expected = stored
        try await until { model.workspace?.dayPage(Self.today)?.document.utf8.count == expected }
        window.layoutIfNeeded()
        drawn += clock.now - start
      }
      runs.append(laidOut / .milliseconds(1) / Double(Self.keystrokes))
      drawnRuns.append(drawn / .milliseconds(1) / Double(Self.keystrokes))
    }
    XCTAssertEqual(line.text, typed, "every character typed is in the line")

    let median = Self.median(runs)
    print(
      "TypingFeel: \(count) lines, line \(target), ms per keystroke to the list laid out: runs \(Self.shown(runs)),",
      "median \(Self.shown([median])); to the engine's state drawn (not budgeted): runs \(Self.shown(drawnRuns)),",
      "median \(Self.shown([Self.median(drawnRuns)]))")
    window.endEditing(true)
    return median
  }

  private static func median(_ values: [Double]) -> Double { values.sorted()[values.count / 2] }

  private static func shown(_ values: [Double]) -> String {
    values.map { String(format: "%.3f", $0) }.joined(separator: " ")
  }

  /// Waits, a millisecond at a time, for `condition`, the main actor's other work running meanwhile; fails after
  /// thirty seconds. The wait is long because it is not what is measured: on CI's machines one keystroke's state
  /// has taken more than two seconds to be drawn on the 300-line page, which failed the run without any defect.
  private func until(_ condition: () -> Bool) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(30))
    while !condition(), clock.now < deadline {
      try await Task.sleep(nanoseconds: 1_000_000)
    }
    XCTAssertTrue(condition(), "the engine's state reached the screen")
  }

  // MARK: The page

  private static func words(of line: Int) -> String { "Line \(line) of the day, with a few words in it" }

  /// A model signed in as `one`, on a store on disk holding today's page of `count` lines, its engine past its first
  /// pass; from then on the server holds every call, saves included, and answers none.
  /// Every third line of the page (the first, the fourth, …) is a to-do due tomorrow, so its row draws a marks line;
  /// the lines typed into (the 150th, the 5th) are not. The workspace holds 3,000 to-dos in all: the rest are
  /// planned on the 30 days before, 100 a day, so the rows' facts read an index of a workspace that size.
  private func model(page count: Int) async throws -> AppModel {
    func todo(_ id: String) -> JSONValue {
      .object([
        "id": .string(id), "title": .string("A to-do"), "status": .string("open"), "paused": .bool(false),
        "version": .number("1"), "deadlineOn": .string("2026-11-26"), "attentionOn": .null,
      ])
    }
    func todoRow(_ id: String, _ taskId: String, on day: LocalDate, words: String) -> String {
      #"{"id":"\#(id)","type":"task","props":{"taskId":"\#(taskId)","role":"plan","planDate":"\#(day.value)"},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
    }
    func dayPage(_ day: LocalDate, _ lines: [String]) -> JSONValue {
      .object([
        "id": .string("day:\(day.value)"), "type": .string("daily"), "date": .string(day.value),
        "title": .string(""), "document": .string("[\(lines.joined(separator: ","))]"),
      ])
    }
    var tasks: [JSONValue] = []
    let lines = (1...count).map { index in
      guard index % 3 == 1 else {
        return #"{"id":"line-\#(index)","type":"paragraph","props":{},"content":[{"type":"text","text":"\#(Self.words(of: index))","styles":{}}],"children":[]}"#
      }
      tasks.append(todo("todo-\(index)"))
      return todoRow("line-\(index)", "todo-\(index)", on: Self.today, words: Self.words(of: index))
    }
    var pages = [dayPage(Self.today, lines)]
    var day = Self.today
    while tasks.count < 3_000 {
      day = try XCTUnwrap(day.adding(days: -1))
      let rows = (0..<min(100, 3_000 - tasks.count)).map { index in
        let id = "past-\(day.value)-\(index)"
        tasks.append(todo(id))
        return todoRow(id, id, on: day, words: "Something to do")
      }
      pages.append(dayPage(day, rows))
    }
    let copy = try XCTUnwrap(
      Workspace(
        .object([
          "revision": .number("1"), "timezone": .string("UTC"), "pages": .array(pages), "tasks": .array(tasks),
        ])))

    let url = FileManager.default.temporaryDirectory.appendingPathComponent("typing-feel-\(UUID().uuidString).store")
    storeURL = url
    let store = try SwiftDataWorkspaceStore.open(at: url)
    try await store.replace(with: copy, owner: "one")
    let server = TestServer([
      .account(Account(owner: "one", email: "one@example.com", signIn: true)),
      .workspace(.unchanged(revision: copy.revision, owner: "one")),
    ])
    self.server = server
    let tokens = MemoryTokenStore()
    try tokens.write(one)
    let engine = SyncEngine(transport: server, tokens: tokens, store: store, sleep: SyncEngine.sleep, now: { noon })
    let model = AppModel(engine: engine, now: { noon })
    model.start()
    try await until { model.state.phase == .ready && model.workspace != nil }
    await engine.settled()
    await server.hold()
    return model
  }

  private func feelWindow() throws -> UIWindow {
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first, "the test host has a scene")
    let window = UIWindow(windowScene: scene)
    window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
    return window
  }

  private static func textView(in view: UIView) -> UITextView? {
    if let view = view as? UITextView { return view }
    return view.subviews.lazy.compactMap { textView(in: $0) }.first
  }
}
