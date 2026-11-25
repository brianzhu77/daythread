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
  static func storeName() -> String { "ui-test-\(UUID().uuidString)" }
}
