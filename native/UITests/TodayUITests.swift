import XCTest

final class TodayUITests: XCTestCase {
  private static let offlineLine = "Offline · showing what was last loaded"
  /// Nothing listens on the discard port, so the app is offline.
  private static let noServer = "http://127.0.0.1:9"

  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func test_today_opens_from_the_server_and_again_with_no_server() throws {
    let server = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let title = try Wrapper.value("DAYTHREAD_TODAY_TITLE")
    let store = Wrapper.storeName()

    let online = XCUIApplication.daythread(server: server, store: store)
    online.launch()
    XCTAssertTrue(online.navigationBars[title].waitForExistence(timeout: 30), "today's title")
    XCTAssertTrue(online.cells["Water the plants"].waitForExistence(timeout: 30), "the seeded to-do")
    XCTAssertFalse(online.staticTexts[Self.offlineLine].exists)
    online.terminate()

    let offline = XCUIApplication.daythread(server: Self.noServer, store: store)
    offline.launch()
    XCTAssertTrue(offline.cells["Water the plants"].waitForExistence(timeout: 30), "the copy on the device")
    XCTAssertTrue(offline.staticTexts[Self.offlineLine].waitForExistence(timeout: 30), "the offline line")
    XCTAssertTrue(offline.navigationBars[title].exists, "today's title")
    offline.terminate()
  }
}
