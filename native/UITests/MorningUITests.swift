import XCTest

/// The strip above the page (`native-phase-1.md` §12): the events line, `Due soon` and `Not today · N`, with `Bring
/// back` and `Another day`, on the morning's own seeded server (`native/scripts/ui-test.sh`, port 3743). Each test that
/// acts has a to-do of its own and puts it back aside when it ends, so every test meets the seed as it was:
/// `Not today · 3`. Today is the server's, read from the wrapper.
final class MorningUITests: XCTestCase {
  /// Nothing listens on the discard port, so the app is offline.
  private static let noServer = "http://127.0.0.1:9"
  private static let eventsLine = "Lunch with Kathy · 10:30 AM Standup with Lu, +1 more"
  private static let longTitle = "Call the insurance company about the claim from last spring"

  override func setUp() {
    continueAfterFailure = false
  }

  override func tearDown() {
    XCUIDevice.shared.orientation = .portrait
  }

  // MARK: What shows

  @MainActor
  func test_the_three_parts_show_on_today() throws {
    let app = try open()

    XCTAssertTrue(app.buttons[Self.eventsLine].exists, "the events line, a button: the page has an Events heading")
    XCTAssertTrue(app.staticTexts["Due soon"].exists || app.staticTexts["DUE SOON"].exists, "Due soon's title")
    for row in ["Pay the gas bill, Due today", "Start the essay, Start today", "\(Self.longTitle), Due today"] {
      XCTAssertTrue(app.element(row).exists, "the Due soon row \"\(row)\"")
    }
    XCTAssertFalse(app.element("Return the library books, Was due \(Words.weekday(try Wrapper.today(), adding: -2))").exists,
      "a to-do with a row on today's page is not in today's Due soon")
    let notToday = app.buttons["Not today · 3"]
    XCTAssertTrue(notToday.exists, "Not today, folded")
    XCTAssertFalse(app.buttons["Bring back"].exists, "folded when the page opens")
    keepScreenshot("today", of: app)

    notToday.tap()
    for title in ["Fix the bike", "Bring me back later", "Plan me for later"] {
      XCTAssertTrue(app.element("\(title), Unscheduled").waitForExistence(timeout: 10), "the Not today row \(title)")
      let menu = app.buttons["More for \(title)"]
      XCTAssertTrue(menu.exists, "its menu")
      // A target of its own: a tap that misses its small symbol by a few points must not land on `Bring back`.
      XCTAssertGreaterThanOrEqual(min(menu.frame.width, menu.frame.height), 43.99, "\(title)'s menu: \(menu.frame.size)")
    }
    XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == %@", "Bring back")).count, 3)
    keepScreenshot("not today, open", of: app)
    app.terminate()
  }

  @MainActor
  func test_the_events_line_scrolls_to_the_events_heading() throws {
    let app = try open()
    let heading = app.line("Events")
    let bar = app.navigationBars.firstMatch

    app.buttons[Self.eventsLine].tap()
    // The scroll is animated: the heading's line settles at the top of the page, under the navigation bar.
    let atTop = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        heading.exists && abs(heading.frame.minY - bar.frame.maxY) < 30
      }, object: nil)
    XCTAssertEqual(
      XCTWaiter.wait(for: [atTop], timeout: 15), .completed,
      "the Events heading at the top: \(heading.exists ? "\(heading.frame)" : "not on screen") under \(bar.frame)")
    let events = app.buttons[Self.eventsLine]
    XCTAssertFalse(events.exists && events.isHittable, "the strip scrolled away with the header")
    app.terminate()
  }

  @MainActor
  func test_a_long_title_puts_its_tag_under_it() throws {
    let app = try open()
    let row = app.element("\(Self.longTitle), Due today")
    XCTAssertTrue(row.exists)
    let words = row.staticTexts[Self.longTitle]
    let tag = row.staticTexts["Due today"]
    XCTAssertTrue(words.exists && tag.exists, "the row draws its words and its tag")
    XCTAssertGreaterThanOrEqual(tag.frame.minY, words.frame.maxY - 1, "the tag under the words: \(tag.frame), \(words.frame)")
    XCTAssertEqual(tag.frame.minX, words.frame.minX, accuracy: 1, "at the words' leading edge")
    // A short title keeps its tag on its line, at the end.
    let short = app.element("Pay the gas bill, Due today")
    XCTAssertEqual(short.staticTexts["Due today"].frame.midY, short.staticTexts["Pay the gas bill"].frame.midY, accuracy: 4)
    app.terminate()
  }

  @MainActor
  func test_yesterday_shows_due_soon_only() throws {
    let today = try Wrapper.today()
    let app = try open()
    app.navigationBars.buttons["Previous day"].tap()
    XCTAssertTrue(app.buttons[dayHeader(today, adding: -1)].waitForExistence(timeout: 30), "yesterday")

    let due = app.element("Return the library books, Was due \(Words.weekday(today, adding: -2))")
    XCTAssertTrue(due.waitForExistence(timeout: 30), "yesterday's Due soon: due the day before, its row on today")
    XCTAssertFalse(app.element("Pay the gas bill, Due today").exists, "due today is not due by yesterday")
    XCTAssertFalse(app.staticTexts["+1 more"].exists, "no events line")
    XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Not today")).firstMatch.exists,
      "no Not today")
    keepScreenshot("yesterday", of: app)
    app.terminate()
  }

  // MARK: The actions

  @MainActor
  func test_bring_back() async throws {
    let server = try morningServer()
    let today = try Wrapper.today()
    let title = "Fix the bike"
    putAsideWhenDone(title, on: server)
    let app = try open()

    app.buttons["Not today · 3"].tap()
    try bringBack(title, in: app).tap()
    let undo = app.buttons["Undo"]
    XCTAssertTrue(undo.waitForExistence(timeout: 30), "the notice offers Undo")
    XCTAssertTrue(app.staticTexts["On today"].exists, "the notice")
    // Taken while the notice shows (6 seconds); everything else is read after.
    keepScreenshot("on today, with undo", of: app)

    XCTAssertTrue(app.buttons["Not today · 2"].waitForExistence(timeout: 30), "it leaves Not today")
    XCTAssertTrue(app.waitForLine(title), "its row on today's page")
    let paused = try await server.paused(title)
    XCTAssertFalse(paused, "not set aside on the server")
    try await server.waitForPlannedDay(of: title, Words.iso(today), timeout: 30)
    app.terminate()
  }

  @MainActor
  func test_undo_a_bring_back() async throws {
    let server = try morningServer()
    let title = "Bring me back later"
    putAsideWhenDone(title, on: server)
    let app = try open()

    app.buttons["Not today · 3"].tap()
    try bringBack(title, in: app).tap()
    // The notice lives 6 seconds: Undo is tapped as soon as it is there, and the server is read afterwards.
    let undo = app.buttons["Undo"]
    XCTAssertTrue(undo.waitForExistence(timeout: 30), "offered while the server's slot is this action's")
    undo.tap()

    XCTAssertTrue(app.showsNotice("Undone", timeout: 30), "the notice")
    try await server.waitForPaused(title, timeout: 30)
    XCTAssertTrue(app.element("\(title), Unscheduled").waitForExistence(timeout: 30), "listed again")
    XCTAssertTrue(app.buttons["Not today · 3"].exists)
    app.terminate()
  }

  @MainActor
  func test_another_day() async throws {
    let server = try morningServer()
    let today = try Wrapper.today()
    let title = "Plan me for later"
    putAsideWhenDone(title, on: server)
    let app = try open()

    app.buttons["Not today · 3"].tap()
    let more = app.buttons["More for \(title)"]
    XCTAssertTrue(more.waitForExistence(timeout: 10))
    more.tap()
    let tomorrow = app.buttons["Tomorrow · \(Words.shortLabel(today, adding: 1))"]
    XCTAssertTrue(tomorrow.waitForExistence(timeout: 10), "the menu")
    XCTAssertTrue(app.staticTexts["Another day"].exists, "the group's title")
    XCTAssertTrue(app.buttons["Pick date…"].exists)
    keepScreenshot("menu", of: app)
    tomorrow.tap()

    XCTAssertTrue(app.showsNotice("Moved to \(Words.shortLabel(today, adding: 1))", timeout: 30), "the short notice")
    XCTAssertTrue(app.buttons["Not today · 2"].waitForExistence(timeout: 30), "it leaves Not today")
    try await server.waitForPlannedDay(of: title, Words.iso(today, adding: 1), timeout: 30)
    let paused = try await server.paused(title)
    XCTAssertFalse(paused)
    app.terminate()
  }

  /// `Pick date…` opens the calendar a row's does; today can be picked, and then it is `Bring back`.
  @MainActor
  func test_pick_date_from_the_menu() async throws {
    let server = try morningServer()
    let today = try Wrapper.today()
    let title = "Plan me for later"
    putAsideWhenDone(title, on: server)
    let app = try open()

    app.buttons["Not today · 3"].tap()
    let more = app.buttons["More for \(title)"]
    XCTAssertTrue(more.waitForExistence(timeout: 10))
    more.tap()
    let pick = app.buttons["Pick date…"]
    XCTAssertTrue(pick.waitForExistence(timeout: 10))
    pick.tap()
    let day = app.buttons.matching(
      NSPredicate(format: "label ENDSWITH %@", ", \(Words.calendarLabel(today, adding: 0))")).firstMatch
    XCTAssertTrue(day.waitForExistence(timeout: 10), "the calendar, today in it")
    keepScreenshot("calendar", of: app)
    day.tap()

    XCTAssertTrue(app.showsNotice("On today", timeout: 30), "today picked is Bring back")
    try await server.waitForPlannedDay(of: title, Words.iso(today), timeout: 30)
    app.terminate()
  }

  /// A strip action needs a connection (§12.4): offline it is not sent, nothing changes, and the notice says so.
  @MainActor
  func test_bring_back_with_no_server_is_not_done() throws {
    let store = Wrapper.storeName()
    try open(store: store).terminate()

    let app = XCUIApplication.daythread(server: Self.noServer, store: store)
    app.launch()
    XCTAssertTrue(app.staticTexts["Offline · showing what was last loaded"].waitForExistence(timeout: 30))
    app.buttons["Not today · 3"].tap()
    try bringBack("Fix the bike", in: app).tap()
    XCTAssertTrue(app.showsNotice("Not done · your text is kept", timeout: 60), "the notice")
    XCTAssertFalse(app.buttons["Undo"].exists, "nothing to undo")
    keepScreenshot("not done", of: app)
    XCTAssertTrue(app.element("Fix the bike, Unscheduled").exists, "still set aside")
    XCTAssertTrue(app.buttons["Not today · 3"].exists)
    app.terminate()
  }

  // MARK: How it looks

  /// Dark mode, and the largest accessibility text size, where `+N more` goes on a line of its own under the events
  /// line's words. The simulator's appearance is put back as it was.
  @MainActor
  func test_the_strip_in_dark_mode_and_at_the_largest_text_size() throws {
    let appearance = XCUIDevice.shared.appearance
    defer { XCUIDevice.shared.appearance = appearance }
    XCUIDevice.shared.appearance = .dark
    let dark = try open()
    keepScreenshot("today, dark", of: dark)
    dark.terminate()
    XCUIDevice.shared.appearance = appearance

    let largest = XCUIApplication.daythread(server: try morningServer().base, store: Wrapper.storeName())
    largest.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    largest.launch()
    let events = largest.buttons[Self.eventsLine]
    XCTAssertTrue(events.waitForExistence(timeout: 30), "the events line")
    let words = events.staticTexts["Lunch with Kathy · 10:30 AM Standup with Lu"]
    let more = events.staticTexts["+1 more"]
    XCTAssertGreaterThanOrEqual(more.frame.minY, words.frame.maxY - 1, "+1 more under the words")
    XCTAssertLessThanOrEqual(events.frame.maxX, largest.windows.firstMatch.frame.maxX, "not past the side")
    keepScreenshot("today, largest text", of: largest)
    largest.terminate()
  }

  @MainActor
  func test_the_strip_in_landscape() throws {
    let app = try open()
    let events = app.buttons[Self.eventsLine]
    let upright = events.frame.width
    XCUIDevice.shared.orientation = .landscapeLeft
    // Turned, the header is wider by far more than the side's safe areas take back: the line's width is past the
    // upright screen's, which also waits out the frames over which the rotation settles.
    let turned = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in events.frame.width > app.windows.firstMatch.frame.width }, object: nil)
    if XCTWaiter.wait(for: [turned], timeout: 15) != .completed {
      throw XCTSkip(
        "the simulator did not turn the app to landscape (the events line is \(events.frame.width) wide, \(upright) upright); the strip's width at each width is held by the app's unit test the_strip_takes_the_headers_width_inside_the_rows_margins")
    }
    // The app's own screenshot is taken in its upright frame and comes out cut; the screen's is the device's.
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = "today, landscape"
    attachment.lifetime = .keepAlways
    add(attachment)
    app.terminate()
  }

  /// `Due soon` has no fold (Corrections): with twenty rows the page starts below the screen's bottom. For the owner's
  /// judgement; the seventeen added are cancelled when the test ends, so they leave `Due soon`.
  @MainActor
  func test_twenty_due_soon_rows() async throws {
    let server = try morningServer()
    let today = try Wrapper.today()
    let titles = (1...17).map { "Due soon, \($0)" }
    addTeardownBlock {
      for title in titles {
        let task = try await server.task(title)
        try await server.send(["type": "task-status", "taskId": task["id"] as? String ?? "", "status": "cancelled"])
      }
    }
    // On a page of their own, three days back, so their rows (cancelled at the end) are on no page another test looks at.
    try await server.send(["type": "ensure-day", "date": Words.iso(today, adding: -3)])
    for title in titles {
      try await server.send([
        "type": "add-task", "pageId": "day:\(Words.iso(today, adding: -3))", "title": title,
        "deadlineOn": Words.iso(today),
      ])
    }
    let app = try open()
    let rows = app.otherElements.matching(NSPredicate(format: "label ENDSWITH %@", ", Due today"))
    let twenty = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in rows.count == 19 }, object: nil)
    // Nineteen `Due today` and `Start the essay`'s `Start today`.
    XCTAssertEqual(XCTWaiter.wait(for: [twenty], timeout: 30), .completed, "\(rows.count) rows due today")
    let firstRow = app.line("Return the library books")
    XCTAssertFalse(firstRow.exists && firstRow.isHittable, "the page starts below the screen's bottom")
    keepScreenshot("twenty due soon", of: app)
    app.terminate()
  }

  // MARK: Helpers

  @MainActor
  private func morningServer() throws -> SeededServer {
    SeededServer(base: try Wrapper.value("DAYTHREAD_MORNING_SERVER_URL"))
  }

  /// The app on the morning's server with today's strip drawn.
  @MainActor
  @discardableResult
  private func open(store: String = Wrapper.storeName()) throws -> XCUIApplication {
    let app = XCUIApplication.daythread(server: try morningServer().base, store: store)
    app.launch()
    XCTAssertTrue(app.buttons[dayHeader(try Wrapper.today())].waitForExistence(timeout: 30), "today's title")
    XCTAssertTrue(app.buttons[Self.eventsLine].waitForExistence(timeout: 30), "today's strip")
    return app
  }

  /// When the test ends, sets the to-do with these words aside again if it is not, so the next test meets the seed.
  private func putAsideWhenDone(_ title: String, on server: SeededServer) {
    addTeardownBlock {
      try await server.setAside(title, today: Words.iso(try Wrapper.today()))
    }
  }

  /// The `Bring back` button of the `Not today` row with these words: the first under its words.
  @MainActor
  private func bringBack(_ title: String, in app: XCUIApplication) throws -> XCUIElement {
    let row = app.element("\(title), Unscheduled")
    XCTAssertTrue(row.waitForExistence(timeout: 10), "the Not today row \(title)")
    let buttons = app.buttons.matching(NSPredicate(format: "label == %@", "Bring back")).allElementsBoundByIndex
    return try XCTUnwrap(
      buttons.filter { $0.frame.minY >= row.frame.maxY - 1 }.min { $0.frame.minY < $1.frame.minY },
      "the row's Bring back")
  }

  /// The screen as it is now, kept in the test's results under `name` (the evidence of `tests/evidence/`).
  @MainActor
  private func keepScreenshot(_ name: String, of app: XCUIApplication) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

extension XCUIApplication {
  /// The strip's row that VoiceOver reads as `label`, one element of its words and its tag. A row of the page reads
  /// the same words (`Pay the gas bill, Due today` on yesterday's page) but is a cell, never matched here.
  fileprivate func element(_ label: String) -> XCUIElement {
    otherElements.matching(NSPredicate(format: "label == %@", label)).firstMatch
  }
}
