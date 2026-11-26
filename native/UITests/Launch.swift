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
}
