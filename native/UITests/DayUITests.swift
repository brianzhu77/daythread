import XCTest

/// One day on the screen: today from the server and from the device's copy, and the ways to other days.
final class DayUITests: XCTestCase {
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
    XCTAssertFalse(online.buttons["Account"].exists, "a server with sign-in off has no one to sign out")
    online.terminate()

    let offline = XCUIApplication.daythread(server: Self.noServer, store: store)
    offline.launch()
    XCTAssertTrue(offline.cells["Water the plants"].waitForExistence(timeout: 30), "the copy on the device")
    XCTAssertTrue(offline.staticTexts[Self.offlineLine].waitForExistence(timeout: 30), "the offline line")
    XCTAssertTrue(offline.navigationBars[title].exists, "today's title")
    offline.terminate()
  }

  @MainActor
  func test_with_no_server_and_nothing_stored_it_could_not_load_and_offers_retry() throws {
    _ = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let app = XCUIApplication.daythread(server: Self.noServer, store: Wrapper.storeName())
    app.launch()

    XCTAssertTrue(app.staticTexts["Couldn't load"].waitForExistence(timeout: 30), "the reason")
    let retry = app.buttons["Retry"]
    XCTAssertTrue(retry.exists, "one way on")
    retry.tap()
    XCTAssertTrue(app.staticTexts["Couldn't load"].waitForExistence(timeout: 30), "still no server")
    XCTAssertTrue(app.buttons["Retry"].waitForExistence(timeout: 30))
    app.terminate()
  }

  @MainActor
  func test_previous_next_calendar_and_today() throws {
    let server = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let today = try Wrapper.today()
    let app = XCUIApplication.daythread(server: server, store: Wrapper.storeName())
    app.launch()

    XCTAssertTrue(app.navigationBars[dayTitle(today)].waitForExistence(timeout: 30), "today's title")
    let next = app.buttons["Next day"]
    XCTAssertFalse(next.isEnabled, "no next day from today")
    XCTAssertFalse(app.buttons["Today"].exists)

    app.buttons["Previous day"].tap()
    XCTAssertTrue(app.navigationBars[dayTitle(today, adding: -1)].waitForExistence(timeout: 10), "yesterday")
    XCTAssertTrue(app.buttons["Today"].exists, "a way back")
    XCTAssertTrue(next.isEnabled)

    next.tap()
    XCTAssertTrue(app.navigationBars[dayTitle(today)].waitForExistence(timeout: 10), "today again")
    XCTAssertFalse(next.isEnabled)
    XCTAssertFalse(app.buttons["Today"].exists)

    // A day of today's month that is neither today nor yesterday.
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let day = [10, 11, 12].first { abs($0 - calendar.component(.day, from: today)) > 1 }!
    var parts = calendar.dateComponents([.year, .month], from: today)
    parts.day = day
    let pickedDay = calendar.date(from: parts)!
    app.buttons["Calendar"].tap()
    let cell = app.collectionViews.buttons.matching(
      NSPredicate(format: "label CONTAINS %@", " \(day),")
    ).firstMatch
    XCTAssertTrue(cell.waitForExistence(timeout: 10), "the calendar")
    cell.tap()
    let pickedTitle = dayTitle(pickedDay)
    XCTAssertTrue(app.navigationBars[pickedTitle].waitForExistence(timeout: 10), "the day picked")

    app.buttons["Today"].tap()
    XCTAssertTrue(app.navigationBars[dayTitle(today)].waitForExistence(timeout: 10), "back to today")
    XCTAssertFalse(app.buttons["Today"].exists)
    app.terminate()
  }

  @MainActor
  func test_a_past_day_with_no_page_can_be_started() throws {
    let server = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let today = try Wrapper.today()
    let app = XCUIApplication.daythread(server: server, store: Wrapper.storeName())
    app.launch()

    XCTAssertTrue(app.navigationBars[dayTitle(today)].waitForExistence(timeout: 30), "today's title")
    // Two days back: no other test opens it, and nothing in the seed is there.
    app.buttons["Previous day"].tap()
    app.buttons["Previous day"].tap()
    let title = dayTitle(today, adding: -2)
    XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
    let empty = app.staticTexts["No page for \(title) yet"]
    XCTAssertTrue(empty.waitForExistence(timeout: 10), "what a day without a page says")

    app.buttons["Start this page"].tap()
    XCTAssertTrue(empty.waitForNonExistence(timeout: 30), "the day's page")
    XCTAssertFalse(app.buttons["Start this page"].exists)
    XCTAssertTrue(app.navigationBars[title].exists, "the same day")
    app.terminate()
  }
}
