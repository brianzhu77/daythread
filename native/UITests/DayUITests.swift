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
    let title = dayHeader(try Wrapper.today())
    let store = Wrapper.storeName()

    let online = XCUIApplication.daythread(server: server, store: store)
    online.launch()
    XCTAssertTrue(online.buttons[title].waitForExistence(timeout: 30), "today's title")
    XCTAssertTrue(online.cells["Water the plants"].waitForExistence(timeout: 30), "the seeded to-do")
    XCTAssertFalse(online.staticTexts[Self.offlineLine].exists)
    XCTAssertFalse(online.buttons["More"].exists, "a server with sign-in off has no one to sign out")
    online.terminate()

    let offline = XCUIApplication.daythread(server: Self.noServer, store: store)
    offline.launch()
    XCTAssertTrue(offline.cells["Water the plants"].waitForExistence(timeout: 30), "the copy on the device")
    XCTAssertTrue(offline.staticTexts[Self.offlineLine].waitForExistence(timeout: 30), "the offline line")
    XCTAssertTrue(offline.buttons[title].exists, "today's title")
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
  func test_previous_and_next_at_the_top_the_picker_from_the_title_and_the_today_tab() throws {
    let server = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let today = try Wrapper.today()
    let app = XCUIApplication.daythread(server: server, store: Wrapper.storeName())
    app.launch()

    XCTAssertTrue(app.buttons[dayHeader(today)].waitForExistence(timeout: 30), "today's title")
    // Previous and next are quiet buttons in the navigation bar; the bottom is the system tab bar.
    let bar = app.navigationBars.firstMatch
    let next = bar.buttons["Next day"]
    XCTAssertTrue(bar.buttons["Previous day"].exists)
    XCTAssertFalse(next.isEnabled, "no next day from today")
    XCTAssertFalse(app.toolbars.buttons["Previous day"].exists)
    XCTAssertFalse(bar.buttons["Today"].exists, "the phone goes back to today with the Today tab")
    let todayTab = app.tabBars.buttons["Today"]
    XCTAssertTrue(todayTab.exists)

    bar.buttons["Previous day"].tap()
    XCTAssertTrue(app.buttons[dayHeader(today, adding: -1)].waitForExistence(timeout: 10), "yesterday")
    XCTAssertTrue(next.isEnabled)

    next.tap()
    XCTAssertTrue(app.buttons[dayHeader(today)].waitForExistence(timeout: 10), "today again")
    XCTAssertFalse(next.isEnabled)

    // A day of today's month that is neither today nor yesterday: of three days three apart, one always is.
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let day = try XCTUnwrap([10, 13, 16].first { abs($0 - calendar.component(.day, from: today)) > 1 })
    var parts = calendar.dateComponents([.year, .month], from: today)
    parts.day = day
    let pickedDay = calendar.date(from: parts)!
    app.buttons[dayHeader(today)].tap()
    // The calendar's own label for a day: "Tuesday, November 10" (with "Today, " before the system's today).
    let month = pickedDay.formatted(
      Date.FormatStyle(locale: Locale(identifier: "en_US"), calendar: calendar, timeZone: .gmt).month(.wide))
    let cell = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", ", \(month) \(day)")).firstMatch
    XCTAssertTrue(cell.waitForExistence(timeout: 10), "the calendar")
    cell.tap()
    let days = calendar.dateComponents([.day], from: today, to: pickedDay).day!
    XCTAssertTrue(app.buttons[dayHeader(today, adding: days)].waitForExistence(timeout: 10), "the day picked")

    todayTab.tap()
    XCTAssertTrue(app.buttons[dayHeader(today)].waitForExistence(timeout: 10), "back to today")
    app.terminate()
  }

  @MainActor
  func test_a_place_not_in_the_app_yet_says_so() throws {
    let server = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let today = try Wrapper.today()
    let app = XCUIApplication.daythread(server: server, store: Wrapper.storeName())
    app.launch()
    XCTAssertTrue(app.buttons[dayHeader(today)].waitForExistence(timeout: 30), "today's title")

    app.tabBars.buttons["Tasks"].tap()
    XCTAssertTrue(app.staticTexts["Not in the app yet"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons[dayHeader(today)].exists)

    app.tabBars.buttons["Today"].tap()
    XCTAssertTrue(app.buttons[dayHeader(today)].waitForExistence(timeout: 10), "the day again")
    app.terminate()
  }

  @MainActor
  func test_a_past_day_with_no_page_can_be_added() throws {
    let server = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let today = try Wrapper.today()
    let app = XCUIApplication.daythread(server: server, store: Wrapper.storeName())
    app.launch()

    XCTAssertTrue(app.buttons[dayHeader(today)].waitForExistence(timeout: 30), "today's title")
    // Two days back: no other test opens it, and nothing in the seed is there.
    app.navigationBars.buttons["Previous day"].tap()
    app.navigationBars.buttons["Previous day"].tap()
    let header = dayHeader(today, adding: -2)
    XCTAssertTrue(app.buttons[header].waitForExistence(timeout: 10))
    // The empty state's sentence keeps the day's long form.
    let title = dayTitle(today, adding: -2)
    let empty = app.staticTexts["No page for \(title)"]
    XCTAssertTrue(empty.waitForExistence(timeout: 10), "what a day without a page says")

    app.buttons["Add page"].tap()
    XCTAssertTrue(empty.waitForNonExistence(timeout: 30), "the day's page")
    XCTAssertFalse(app.buttons["Add page"].exists)
    XCTAssertTrue(app.buttons[header].exists, "the same day")
    app.terminate()
  }
}
