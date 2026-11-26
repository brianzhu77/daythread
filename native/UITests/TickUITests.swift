import XCTest

/// A tap on a to-do's circle, seen on the screen and on the server. Each test ticks a to-do of its own from the seed,
/// so no other test reads one it changed.
final class TickUITests: XCTestCase {
  /// Nothing listens on the discard port, so the app is offline.
  private static let noServer = "http://127.0.0.1:9"
  private static let offlineLine = "Offline · showing what was last loaded"
  private static let oneToSend = "Offline · showing what was last loaded · 1 change will be sent"

  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func test_a_tap_ticks_and_a_second_tap_unticks() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let title = "Tick me twice"
    let app = XCUIApplication.daythread(server: base, store: Wrapper.storeName())
    app.launch()

    let circle = app.circle(title)
    XCTAssertTrue(circle.waitForExistence(timeout: 30), "the seeded to-do")
    XCTAssertEqual(circle.value as? String, "not done")

    circle.tap()
    XCTAssertTrue(circle.waitForValue("done", timeout: 2), "ticked at once")
    try await server.waitForStatus(of: title, "done")

    circle.tap()
    XCTAssertTrue(circle.waitForValue("not done", timeout: 2), "unticked at once")
    try await server.waitForStatus(of: title, "open")
    app.terminate()
  }

  @MainActor
  func test_a_tick_made_offline_survives_a_relaunch_and_is_sent() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let title = "Tick me offline"
    let store = Wrapper.storeName()

    let online = XCUIApplication.daythread(server: base, store: store)
    online.launch()
    XCTAssertTrue(online.circle(title).waitForValue("not done"), "the seeded to-do, kept on the device")
    online.terminate()

    let offline = XCUIApplication.daythread(server: Self.noServer, store: store)
    offline.launch()
    XCTAssertTrue(offline.staticTexts[Self.offlineLine].waitForExistence(timeout: 30), "the offline line")
    let circle = offline.circle(title)
    XCTAssertTrue(circle.waitForValue("not done"))
    circle.tap()
    XCTAssertTrue(circle.waitForValue("done", timeout: 2), "ticked with no server")
    XCTAssertTrue(offline.staticTexts[Self.oneToSend].waitForExistence(timeout: 10), "the change waiting")
    offline.terminate()

    let again = XCUIApplication.daythread(server: Self.noServer, store: store)
    again.launch()
    XCTAssertTrue(again.circle(title).waitForValue("done"), "still ticked after a relaunch")
    XCTAssertTrue(again.staticTexts[Self.oneToSend].waitForExistence(timeout: 30), "still waiting")
    again.terminate()

    let back = XCUIApplication.daythread(server: base, store: store)
    back.launch()
    XCTAssertTrue(back.circle(title).waitForValue("done"), "ticked when the server is back")
    try await server.waitForStatus(of: title, "done", timeout: 30)
    let line = back.navigationBars.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Offline")).firstMatch
    XCTAssertTrue(line.waitForNonExistence(timeout: 10), "no line once sent")
    XCTAssertEqual(back.circle(title).value as? String, "done")
    back.terminate()
  }
}
