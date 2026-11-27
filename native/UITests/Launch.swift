import Foundation
import XCTest

extension XCUIApplication {
  /// The app against `server`, on its own store `store`, in English as written in the United States, so the titles
  /// read the same on every machine.
  static func daythread(server: String, store: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-DaythreadServerURL", server,
      "-DaythreadStoreName", store,
      "-AppleLanguages", "(en)",
      "-AppleLocale", "en_US",
    ]
    return app
  }

  /// The circle of the to-do with these words.
  func circle(_ title: String) -> XCUIElement {
    buttons["Complete \(title)"]
  }

  /// The page's lines (each a text view, its value the line's words), top to bottom as they are on screen.
  var lines: [XCUIElement] {
    // The list keeps some rows it has scrolled past or made ahead of time; only those on the screen count.
    let screen = windows.firstMatch.frame
    return textViews.allElementsBoundByIndex
      .filter { $0.exists && screen.intersects($0.frame) }
      .sorted { $0.frame.minY < $1.frame.minY }
  }

  /// The line with these words.
  func line(_ words: String) -> XCUIElement {
    textViews.matching(NSPredicate(format: "value == %@", words)).firstMatch
  }

  /// Waits up to `timeout` seconds for the line with these words, scrolling down the page for it: the list holds no
  /// row it has not scrolled to.
  func waitForLine(_ words: String, timeout: TimeInterval = 30) -> Bool {
    let line = line(words)
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if line.waitForExistence(timeout: 1) { return true }
      if collectionViews.firstMatch.exists { collectionViews.firstMatch.swipeUp() }
    } while Date() < deadline
    return line.exists
  }

  /// The line that has the keyboard.
  var focusedLine: XCUIElement {
    textViews.matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
  }

  /// Puts the caret on a line of its own at the end of the page, as he would: the page scrolled to its end, a tap in
  /// the space under the last line (or, with no space left above the tab bar, at the end of that line) puts it at that
  /// line's end, and Return there starts a new one when that line has words. Returns the line.
  @discardableResult
  func startLineAtTheEnd(file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
    let list = collectionViews.firstMatch
    var end = lines.last?.frame.maxY
    for _ in 0..<5 {
      list.swipeUp()
      let now = lines.last?.frame.maxY
      if now == end { break }
      end = now
    }
    guard let last = lines.last else {
      XCTFail("the page has no lines", file: file, line: line)
      return focusedLine
    }
    let bottom = tabBars.firstMatch.exists ? tabBars.firstMatch.frame.minY : list.frame.maxY
    if last.frame.maxY + 44 < bottom {
      list.coordinate(withNormalizedOffset: .zero)
        .withOffset(CGVector(dx: list.frame.width / 2, dy: last.frame.maxY - list.frame.minY + 30)).tap()
    } else {
      last.tapAtTheEnd()
    }
    let focused = focusedLine
    XCTAssertTrue(focused.waitForExistence(timeout: 5), "a tap under the last line puts the caret there", file: file, line: line)
    useKeyboard(.english, file: file, line: line)
    if (focused.value as? String).map({ !$0.isEmpty }) == true { focused.typeText("\n") }
    return focusedLine
  }

  /// Scrolls the page back to its top, where the day's header and its status line are: the list keeps no header it
  /// has scrolled away. Dragging the page down also puts the keyboard away, as it does for him.
  func scrollToTheTop() {
    let title = buttons.matching(NSPredicate(format: "label ENDSWITH %@", ". Choose a date")).firstMatch
    for _ in 0..<6 where !(title.exists && title.isHittable) {
      collectionViews.firstMatch.swipeDown()
    }
  }

  /// Taps the software keyboard's keys for `letters`, one by one, so the keyboard's input method composes them.
  func tapKeys(_ letters: String) {
    for letter in letters { keyboards.keys[String(letter)].tap() }
  }

  /// A software keyboard the simulator has (Settings, Keyboards), told apart by its Delete key's name.
  enum Keyboard: String {
    case english = "delete"
    case pinyin = "删除"
  }

  /// Turns the software keyboard to `keyboard` with its globe key. The simulator keeps the last one used, and another
  /// test (or a person) may have left it on another, where words typed in English would be composed into Chinese.
  func useKeyboard(_ keyboard: Keyboard, file: StaticString = #filePath, line: UInt = #line) {
    let delete = keyboards.keys["delete"]
    let globe = buttons["Next keyboard"]
    XCTAssertTrue(globe.waitForExistence(timeout: 5), "the software keyboard is up", file: file, line: line)
    for _ in 0..<4 where !(delete.exists && delete.label == keyboard.rawValue) {
      globe.tap()
    }
    XCTAssertEqual(delete.label, keyboard.rawValue, "the \(keyboard) keyboard", file: file, line: line)
  }
}

extension XCUIElement {
  /// A tap at the end of the line's words (a line of one row: its trailing edge).
  func tapAtTheEnd() {
    coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
  }

  /// A tap at the start of the line's words.
  func tapAtTheStart() {
    coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)).tap()
  }
}

extension XCUIElement {
  /// Waits for the element's accessibility value to be `value`.
  @discardableResult
  func waitForValue(_ value: String, timeout: TimeInterval = 30) -> Bool {
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: self)
    return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
  }
}

/// What `native/scripts/ui-test.sh` hands the test runner (`TEST_RUNNER_` variables arrive without the prefix).
enum Wrapper {
  static func value(_ name: String) throws -> String {
    guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else {
      throw XCTSkip("\(name) is not set: run the UI tests through native/scripts/ui-test.sh, which starts the server")
    }
    return value
  }

  /// A store name of its own for each run; the wrapper removes stores named this way when it finishes.
  static func storeName() -> String { "test-\(UUID().uuidString)" }

  /// The seeded server's today, as a date at midnight UTC.
  static func today() throws -> Date {
    let text = try value("DAYTHREAD_TODAY")
    // Set but unreadable is the wrapper's mistake: it fails the test rather than skipping it.
    return try XCTUnwrap(
      try? Date(text + "T00:00:00Z", strategy: .iso8601), "DAYTHREAD_TODAY is not a date: \(text)")
  }
}

/// The day's title as the app writes it in English for the United States ("Wednesday, Nov 25"): `days` after `today`.
func dayTitle(_ today: Date, adding days: Int = 0) -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = .gmt
  let day = calendar.date(byAdding: .day, value: days, to: today)!
  let style = Date.FormatStyle(
    date: .omitted, time: .omitted, locale: Locale(identifier: "en_US"), calendar: calendar, timeZone: .gmt
  )
  .weekday(.wide).month(.abbreviated).day()
  return day.formatted(style)
}

/// The day header's title button as VoiceOver reads it in English for the United States, `days` after `today`: the
/// relative word when there is one, the web's short title ("Wed, Nov 25"), and what the button does.
func dayHeader(_ today: Date, adding days: Int = 0) -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = .gmt
  let day = calendar.date(byAdding: .day, value: days, to: today)!
  let style = Date.FormatStyle(
    date: .omitted, time: .omitted, locale: Locale(identifier: "en_US"), calendar: calendar, timeZone: .gmt
  )
  .weekday(.abbreviated).month(.abbreviated).day()
  let relative = [-1: "Yesterday, ", 0: "Today, ", 1: "Tomorrow, "][days] ?? ""
  return "\(relative)\(day.formatted(style)). Choose a date"
}

/// The seeded server read the way any client reads it; sign-in is off there, so no session is needed.
struct SeededServer {
  let base: String

  /// The status of the to-do with these words on the server now; nil when it has none.
  func status(of title: String) async throws -> String? {
    let url = try XCTUnwrap(URL(string: "\(base)/api/v1/workspace"))
    let (data, _) = try await URLSession.shared.data(from: url)
    let reply = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    let workspace = try XCTUnwrap(reply["workspace"] as? [String: Any])
    let tasks = try XCTUnwrap(workspace["tasks"] as? [[String: Any]])
    return tasks.first { $0["title"] as? String == title }?["status"] as? String
  }

  /// Waits up to `timeout` seconds for the server to hold the to-do with that status.
  func waitForStatus(
    of title: String, _ status: String, timeout: TimeInterval = 5, file: StaticString = #filePath, line: UInt = #line
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    var last: String?
    repeat {
      last = try await self.status(of: title)
      if last == status { return }
      try await Task.sleep(for: .milliseconds(200))
    } while Date() < deadline
    XCTFail("the server has \"\(title)\" \(last ?? "missing"), not \(status)", file: file, line: line)
  }

  /// The to-do with these words on the server now.
  func task(_ title: String) async throws -> [String: Any] {
    let workspace = try await workspace().workspace
    let tasks = try XCTUnwrap(workspace["tasks"] as? [[String: Any]])
    return try XCTUnwrap(tasks.first { $0["title"] as? String == title }, "the server has no to-do \"\(title)\"")
  }

  /// The day the to-do with these words is planned on, as the server has it now (the web's `plannedOn`): the newest day
  /// page holding a plan row of it. Nil when none does.
  func plannedDay(of title: String) async throws -> String? {
    let task = try await task(title)
    let taskId = try XCTUnwrap(task["id"] as? String)
    let workspace = try await workspace().workspace
    let pages = try XCTUnwrap(workspace["pages"] as? [[String: Any]])
    func holdsPlanRow(_ blocks: [[String: Any]]) -> Bool {
      blocks.contains { block in
        let props = block["props"] as? [String: Any]
        if block["type"] as? String == "task", props?["taskId"] as? String == taskId, props?["role"] as? String == "plan" {
          return true
        }
        return holdsPlanRow(block["children"] as? [[String: Any]] ?? [])
      }
    }
    let days = try pages.compactMap { page -> String? in
      guard page["type"] as? String == "daily", page["trashedAt"] == nil || page["trashedAt"] is NSNull,
        let date = page["date"] as? String, let document = page["document"] as? String
      else { return nil }
      let blocks = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(document.utf8)) as? [[String: Any]])
      return holdsPlanRow(blocks) ? date : nil
    }
    return days.max()
  }

  /// Waits up to `timeout` seconds for the server to plan the to-do with these words on `day` (nil: on no day).
  func waitForPlannedDay(
    of title: String, _ day: String?, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    var last: String?
    repeat {
      last = try await plannedDay(of: title)
      if last == day { return }
      try await Task.sleep(nanoseconds: 200_000_000)
    } while Date() < deadline
    XCTFail("the server plans \"\(title)\" on \(last ?? "no day"), not \(day ?? "no day")", file: file, line: line)
  }

  /// Waits up to `timeout` seconds for the server to hold the to-do with these words set aside (`paused`).
  func waitForPaused(
    _ title: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
      if try await task(title)["paused"] as? Bool == true { return }
      try await Task.sleep(nanoseconds: 200_000_000)
    } while Date() < deadline
    XCTFail("the server does not hold \"\(title)\" set aside", file: file, line: line)
  }

  /// A line of a page as the server stores it: the block's id, its type and its words.
  struct Line: Equatable, Sendable, CustomStringConvertible {
    let id: String
    let type: String
    let words: String
    var description: String { "\(type) \"\(words)\"" }
  }

  /// The workspace as the server has it now, and the account it belongs to.
  func workspace() async throws -> (workspace: [String: Any], owner: String) {
    let url = try XCTUnwrap(URL(string: "\(base)/api/v1/workspace"))
    let (data, _) = try await URLSession.shared.data(from: url)
    let reply = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    return (try XCTUnwrap(reply["workspace"] as? [String: Any]), try XCTUnwrap(reply["owner"] as? String))
  }

  /// The document of the page with this id, as the server stores it.
  func document(of pageId: String) async throws -> String {
    let workspace = try await workspace().workspace
    let pages = try XCTUnwrap(workspace["pages"] as? [[String: Any]])
    let page = try XCTUnwrap(pages.first { $0["id"] as? String == pageId }, "the server has no page \(pageId)")
    return try XCTUnwrap(page["document"] as? String)
  }

  /// The page's lines in page order, nested lines after the line they are under.
  func lines(of pageId: String) async throws -> [Line] {
    let document = try await document(of: pageId)
    let blocks = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(document.utf8)) as? [[String: Any]])
    return Self.lines(in: blocks)
  }

  private static func lines(in blocks: [[String: Any]]) -> [Line] {
    blocks.flatMap { block -> [Line] in
      let runs = block["content"] as? [[String: Any]] ?? []
      let words = runs.compactMap { $0["text"] as? String }.joined()
      let line = Line(id: block["id"] as? String ?? "", type: block["type"] as? String ?? "", words: words)
      return [line] + lines(in: block["children"] as? [[String: Any]] ?? [])
    }
  }

  /// Waits up to `timeout` seconds for the page's lines on the server to satisfy `condition`, reading them every
  /// 200 ms; fails with the last lines read.
  func waitForLines(
    of pageId: String, timeout: TimeInterval = 5, _ what: String, file: StaticString = #filePath, line: UInt = #line,
    until condition: @Sendable ([Line]) -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    var last: [Line] = []
    repeat {
      last = try await lines(of: pageId)
      if condition(last) { return }
      try await Task.sleep(nanoseconds: 200_000_000)
    } while Date() < deadline
    XCTFail("the server's page, after \(timeout) s, not \(what): \(last)", file: file, line: line)
  }

  /// Saves the page with `document` the way the app saves one (`POST /api/v1/saves`, a `save-editor`), on the page as
  /// the server has it now: its revision and its content key read first, so the server's own rules apply.
  func save(pageId: String, document: String, file: StaticString = #filePath, line: UInt = #line) async throws {
    let (workspace, owner) = try await workspace()
    let revision = try XCTUnwrap(workspace["revision"] as? Int)
    let stored = try await self.document(of: pageId)
    let body: [String: Any] = [
      "operationId": "ui-test-save-\(UUID().uuidString.lowercased())",
      "expectedRevision": revision,
      "expectedOwner": owner,
      "action": [
        "type": "save-editor", "pageId": pageId, "expectedContent": Self.contentKey(stored),
        "document": document,
      ],
    ]
    var request = URLRequest(url: try XCTUnwrap(URL(string: "\(base)/api/v1/saves")))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, reply) = try await URLSession.shared.data(for: request)
    let status = (reply as? HTTPURLResponse)?.statusCode
    XCTAssertEqual(status, 200, "the save: \(String(decoding: data, as: UTF8.self))", file: file, line: line)
  }

  /// The web's `pageContentKey` (`textKey` in `src/domain/editor-document.ts`) of a page with no synced block, whose
  /// stored text is its document: the test's own copy, so the key the app sends is not checked against itself.
  static func contentKey(_ text: String) -> String {
    var h1: UInt32 = 1_779_033_703
    var h2: UInt32 = 3_144_134_277
    var h3: UInt32 = 1_013_904_242
    var h4: UInt32 = 2_773_480_762
    let units = Array(text.utf16)
    for unit in units {
      let k = UInt32(unit)
      h1 = h2 ^ ((h1 ^ k) &* 597_399_067)
      h2 = h3 ^ ((h2 ^ k) &* 2_869_860_233)
      h3 = h4 ^ ((h3 ^ k) &* 951_274_213)
      h4 = h1 ^ ((h4 ^ k) &* 2_716_044_179)
    }
    h1 = (h3 ^ (h1 >> 18)) &* 597_399_067
    h2 = (h4 ^ (h2 >> 22)) &* 2_869_860_233
    h3 = (h1 ^ (h3 >> 17)) &* 951_274_213
    h4 = (h2 ^ (h4 >> 19)) &* 2_716_044_179
    h1 ^= h2 ^ h3 ^ h4
    h2 ^= h1
    h3 ^= h1
    h4 ^= h1
    let hex = [h1, h2, h3, h4].map { String(repeating: "0", count: 8 - String($0, radix: 16).count) + String($0, radix: 16) }
    return "d:\(units.count):\(hex.joined())"
  }
}
