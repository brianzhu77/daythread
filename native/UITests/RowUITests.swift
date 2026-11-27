import XCTest

/// A to-do's row on today's page (`native-phase-1.md` §11): its marks, its actions from the swipe, `More` and the
/// circle's menu, the notice, and Undo, seen on the screen and on the server. The seed (`native/scripts/ui-test.sh`)
/// gives each test that acts a to-do of its own, so no test reads a row another changed; they are written for one run
/// per seeded server.
final class RowUITests: XCTestCase {
  /// Nothing listens on the discard port, so the app is offline.
  private static let noServer = "http://127.0.0.1:9"

  override func setUp() {
    continueAfterFailure = false
  }

  override func tearDown() {
    XCUIDevice.shared.orientation = .portrait
  }

  // MARK: The marks

  @MainActor
  func test_the_seeded_rows_show_their_marks() throws {
    let today = try Wrapper.today()
    let app = try open()

    XCTAssertEqual(try marks(of: "Renew the passport", in: app), "Since \(Words.monthDay(today, adding: -8))")
    XCTAssertEqual(try marks(of: "Pay the rent", in: app), "Due tomorrow")
    XCTAssertEqual(try marks(of: "File the return", in: app), "Was due \(Words.weekday(today, adding: -3))")
    XCTAssertEqual(
      try marks(of: "Book the venue", in: app),
      "Start \(Words.weekday(today, adding: 4)) · Due \(Words.shortLabel(today, adding: 10))")
    // The repeat mark is a symbol: UI automation reads no words from it (VoiceOver's `Repeats every week` is the
    // marks element's, held by the editor's `RowMarksTests`); it is drawn, under the words.
    let fern = try row("Water the fern", in: app)
    let symbol = try XCTUnwrap(fern.staticTexts.allElementsBoundByIndex.dropFirst().first, "the repeat mark is drawn")
    XCTAssertGreaterThan(symbol.frame.width, 0)
    XCTAssertGreaterThan(symbol.frame.minY, app.line("Water the fern").frame.maxY - 1, "under the words")
    XCTAssertEqual(try marks(of: "Paint the fence", in: app), "Blocked by Buy paint")
    XCTAssertEqual(try marks(of: "Return the parcel", in: app), "Cancelled")
    XCTAssertEqual(app.circle("Return the parcel").value as? String, "cancelled")
    XCTAssertNil(try marks(of: "Buy paint", in: app), "a to-do with nothing to say has no marks line")
    keepScreenshot("marks, scrolled", of: app)

    app.scrollToTheTop()
    keepScreenshot("marks", of: app)
    app.terminate()
  }

  /// The reference row's `Plan for today` in landscape, where the phone's safe area is at the sides: its title ends
  /// at the row's trailing margin, where the other rows' words end, and the words end before it.
  @MainActor
  func test_plan_for_today_keeps_to_the_rows_margin_in_landscape() throws {
    let app = try open()
    let other = app.line("Renew the passport")
    XCTAssertTrue(other.waitForExistence(timeout: 10))
    // The window reports its upright frame in landscape too, and the margins match upright as well, so the turn is
    // seen as the other rows' words leaving the margin they have upright.
    let upright = other.frame.maxX
    XCUIDevice.shared.orientation = .landscapeLeft
    let turned = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in abs(other.frame.maxX - upright) > 1 }, object: nil)
    if XCTWaiter.wait(for: [turned], timeout: 15) != .completed {
      throw XCTSkip(
        "the simulator did not turn the app to landscape (the other row's words still end at \(other.frame.maxX), window \(app.windows.firstMatch.frame)); the button's margin on its side is held by the editor's unit test plan_for_today_ends_at_the_rows_trailing_margin")
    }
    app.scrollToTheTop()
    let words = app.line("Water the plants")
    XCTAssertTrue(words.waitForExistence(timeout: 10))
    let row = try self.row("Water the plants", in: app)
    let button = row.buttons["Plan for today"]
    XCTAssertTrue(button.waitForExistence(timeout: 10), "an open reference row has the button")
    // Rotation settles over a few frames; the frames are read once it has.
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in abs(button.frame.maxX - other.frame.maxX) <= 1 }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed,
      "the title ends where the other rows' words end: \(button.frame) against \(other.frame)")
    XCTAssertLessThanOrEqual(words.frame.maxX, button.frame.minX + 1, "the words end before the button")
    XCTAssertLessThan(button.frame.maxX, app.windows.firstMatch.frame.maxX - 44, "clear of the side's safe area")
    // The app's own screenshot is taken in its upright frame and comes out cut; the screen's is the device's.
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = "marks, landscape"
    attachment.lifetime = .keepAlways
    add(attachment)
    app.terminate()
  }

  /// The marks in dark mode, and at the largest accessibility text size, where the marks line wraps and nothing is
  /// cut. The simulator's appearance is put back as it was.
  @MainActor
  func test_the_marks_in_dark_mode_and_at_the_largest_text_size() throws {
    let appearance = XCUIDevice.shared.appearance
    defer { XCUIDevice.shared.appearance = appearance }
    XCUIDevice.shared.appearance = .dark
    let dark = try open()
    XCTAssertEqual(try marks(of: "Pay the rent", in: dark), "Due tomorrow")
    // Scrolled so the repeat mark under "Water the fern" is clear of the tab bar.
    dark.scrollToTheTop()
    try reveal("Water the fern", in: dark)
    keepScreenshot("marks, dark", of: dark)
    dark.terminate()
    XCUIDevice.shared.appearance = appearance

    let largest = XCUIApplication.daythread(server: try Wrapper.value("DAYTHREAD_SERVER_URL"), store: Wrapper.storeName())
    largest.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    largest.launch()
    XCTAssertTrue(largest.line("Renew the passport").waitForExistence(timeout: 30), "today's page")
    let since = "Since \(Words.monthDay(try Wrapper.today(), adding: -8))"
    XCTAssertEqual(try marks(of: "Renew the passport", in: largest), since)
    let words = largest.line("Book the venue")
    XCTAssertTrue(largest.waitForLine("Book the venue"))
    let venue = try row("Book the venue", in: largest)
    let tag = try XCTUnwrap(
      venue.staticTexts.allElementsBoundByIndex.first { $0.label.hasPrefix("Start") }, "the date tag at that size")
    XCTAssertGreaterThanOrEqual(tag.frame.minY, words.frame.maxY - 1, "under the words")
    XCTAssertLessThanOrEqual(tag.frame.maxX, largest.windows.firstMatch.frame.maxX, "not cut at the side")
    keepScreenshot("marks, largest text", of: largest)
    largest.terminate()
  }

  // MARK: The actions

  @MainActor
  func test_move_to_tomorrow_from_the_swipe() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let today = try Wrapper.today()
    let title = "Move me"
    let app = try open()

    let line = try reveal(title, in: app)
    line.swipeLeft()
    let tomorrow = app.buttons["Tomorrow"]
    XCTAssertTrue(tomorrow.waitForExistence(timeout: 10), "the swipe's first action on today's plan row")
    XCTAssertTrue(app.buttons["Not today"].exists)
    XCTAssertTrue(app.buttons["More"].exists)
    keepScreenshot("swipe", of: app)
    tomorrow.tap()

    XCTAssertTrue(
      app.showsNotice("Moved to \(Words.longLabel(today, adding: 1))", timeout: 30), "the notice")
    XCTAssertTrue(line.waitForNonExistence(timeout: 10), "the row leaves today's page")
    try await server.waitForPlannedDay(of: title, Words.iso(today, adding: 1))

    try pickInTheHeader(today, adding: 1, in: app)
    XCTAssertTrue(app.waitForLine(title), "on tomorrow's page")
    app.terminate()
  }

  @MainActor
  func test_not_today() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let title = "Set me aside"
    let app = try open()

    try reveal(title, in: app).swipeLeft()
    let off = app.buttons["Not today"]
    XCTAssertTrue(off.waitForExistence(timeout: 10))
    off.tap()

    XCTAssertTrue(app.showsNotice("Not today — won’t carry over", timeout: 30), "the notice")
    XCTAssertTrue(app.line(title).waitForNonExistence(timeout: 10), "the row leaves today's page")
    try await server.waitForPaused(title)
    app.terminate()
  }

  @MainActor
  func test_cancel_and_restore() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let title = "Cancel me"
    let app = try open()

    let line = try reveal(title, in: app)
    line.swipeLeft()
    let more = app.buttons["More"]
    XCTAssertTrue(more.waitForExistence(timeout: 10))
    more.tap()
    let cancel = app.buttons["Cancel task"]
    XCTAssertTrue(cancel.waitForExistence(timeout: 10), "More holds Cancel task")
    keepScreenshot("More", of: app)
    cancel.tap()

    XCTAssertTrue(app.showsNotice("Cancelled", timeout: 30), "the notice")
    XCTAssertTrue(app.circle(title).waitForValue("cancelled", timeout: 10), "the row drawn cancelled")
    XCTAssertEqual(try marks(of: title, in: app), "Cancelled")
    try await server.waitForStatus(of: title, "cancelled", timeout: 10)

    line.swipeLeft()
    let restore = app.buttons["Restore"]
    XCTAssertTrue(restore.waitForExistence(timeout: 10), "a cancelled row's one action")
    XCTAssertFalse(app.buttons["More"].exists, "and nothing more")
    restore.tap()
    XCTAssertTrue(app.showsNotice("Restored", timeout: 30), "the notice")
    XCTAssertTrue(app.circle(title).waitForValue("not done", timeout: 10), "open again")
    try await server.waitForStatus(of: title, "open", timeout: 10)
    app.terminate()
  }

  @MainActor
  func test_undo() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let today = try Wrapper.today()
    let title = "Undo me"
    let app = try open()

    try reveal(title, in: app).swipeLeft()
    let tomorrow = app.buttons["Tomorrow"]
    XCTAssertTrue(tomorrow.waitForExistence(timeout: 10))
    tomorrow.tap()
    // The notice lives 8 seconds: Undo is tapped as soon as it is there, and the server is read afterwards.
    let undo = app.buttons["Undo"]
    XCTAssertTrue(undo.waitForExistence(timeout: 30), "offered while the server's slot is this move's")
    // A phone draws no `Moved to` mark, so these words are the notice's.
    let words = app.staticTexts["Moved to \(Words.longLabel(today, adding: 1))"]
    XCTAssertTrue(words.exists, "the notice")
    undo.tap()

    XCTAssertTrue(app.showsNotice("Undone", timeout: 30), "the notice")
    XCTAssertTrue(app.waitForLine(title), "back on today's page")
    try await server.waitForPlannedDay(of: title, Words.iso(today))
    app.terminate()
  }

  /// On a phone the notice sits under the status bar: with the page at its top, the day's title is not under it.
  /// The row acted on is on the screen with the page unscrolled, so nothing stands between the notice and the look.
  @MainActor
  func test_the_notice_leaves_the_days_title_uncovered() throws {
    let today = try Wrapper.today()
    let title = "Show the notice"
    let app = try open()
    let line = app.line(title)
    XCTAssertTrue(line.isHittable, "on the screen with the page at its top")

    line.swipeLeft()
    let off = app.buttons["Not today"]
    XCTAssertTrue(off.waitForExistence(timeout: 10))
    off.tap()
    XCTAssertTrue(app.buttons["Undo"].waitForExistence(timeout: 30), "the notice, with Undo")
    // Read while the notice shows (8 seconds), then the look kept.
    let words = app.staticTexts["Not today — won’t carry over"]
    let header = app.buttons[dayHeader(today)]
    XCTAssertTrue(words.exists && header.exists)
    XCTAssertLessThan(words.frame.maxY, header.frame.minY, "the title is not under the notice")
    XCTAssertGreaterThan(words.frame.minY, app.windows.firstMatch.frame.minY + 44, "under the status bar")
    keepScreenshot("notice with Undo", of: app)
    app.terminate()
  }

  @MainActor
  func test_pick_date() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let today = try Wrapper.today()
    let title = "Pick a day for me"
    let app = try open()

    let line = try reveal(title, in: app)
    line.swipeLeft()
    let more = app.buttons["More"]
    XCTAssertTrue(more.waitForExistence(timeout: 10))
    more.tap()
    let pick = app.buttons["Pick date…"]
    XCTAssertTrue(pick.waitForExistence(timeout: 10), "More holds Pick date…")
    pick.tap()
    let day = try calendarDay(today, adding: 3, in: app)
    keepScreenshot("calendar", of: app)
    day.tap()

    XCTAssertTrue(
      app.showsNotice("Moved to \(Words.longLabel(today, adding: 3))", timeout: 30), "the notice")
    XCTAssertTrue(line.waitForNonExistence(timeout: 10), "the row leaves today's page")
    try await server.waitForPlannedDay(of: title, Words.iso(today, adding: 3))
    app.terminate()
  }

  /// A touch and hold on the circle opens every action of the row, in the web's order; a tap still ticks (the tick
  /// tests).
  @MainActor
  func test_the_circles_menu_holds_every_action() throws {
    let today = try Wrapper.today()
    let app = try open()
    let title = "Pay the rent"
    _ = try reveal(title, in: app)

    app.circle(title).press(forDuration: 1.2)
    let expected =
      ["Tomorrow · \(Words.longLabel(today, adding: 1))", "Not today"]
      + Words.anotherDay(today).map { "\($0.label) · \(Words.shortLabel(today, adding: $0.days))" }
      + ["Pick date…", "Cancel task"]
    let first = app.buttons[expected[0]]
    XCTAssertTrue(first.waitForExistence(timeout: 10), "the circle's menu")
    let items = app.buttons.allElementsBoundByIndex
      .filter { expected.contains($0.label) }
      .sorted { $0.frame.minY < $1.frame.minY }
      .map(\.label)
    XCTAssertEqual(items, expected)
    XCTAssertTrue(app.staticTexts["Another day"].exists, "the group's title")
    XCTAssertEqual(app.circle(title).value as? String, "not done", "a touch and hold does not tick")
    keepScreenshot("circle menu", of: app)

    // Put away as he would: a tap outside it, on the empty end of the day's header.
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.19)).tap()
    XCTAssertTrue(first.waitForNonExistence(timeout: 10), "the menu put away")
    XCTAssertEqual(app.circle(title).value as? String, "not done")
    app.terminate()
  }

  /// A row action needs a connection (§11.4): offline it is not sent, nothing changes, and the notice says so.
  @MainActor
  func test_an_action_with_no_server_is_not_done() throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let store = Wrapper.storeName()
    let title = "Pay the rent"
    let online = try open(server: base, store: store)
    online.terminate()

    let app = XCUIApplication.daythread(server: Self.noServer, store: store)
    app.launch()
    XCTAssertTrue(app.staticTexts["Offline · showing what was last loaded"].waitForExistence(timeout: 30))
    try reveal(title, in: app).swipeLeft()
    let tomorrow = app.buttons["Tomorrow"]
    XCTAssertTrue(tomorrow.waitForExistence(timeout: 10))
    tomorrow.tap()
    XCTAssertTrue(app.showsNotice("Not done · your text is kept", timeout: 60), "the notice")
    XCTAssertFalse(app.buttons["Undo"].exists, "nothing to undo")
    keepScreenshot("not done", of: app)
    XCTAssertTrue(app.line(title).exists, "the row stays")
    XCTAssertEqual(try marks(of: title, in: app), "Due tomorrow")
    app.terminate()
  }

  // MARK: Helpers

  /// The app on the seeded server with today's page drawn.
  @MainActor
  private func open(server: String? = nil, store: String = Wrapper.storeName()) throws -> XCUIApplication {
    let app = XCUIApplication.daythread(server: try server ?? Wrapper.value("DAYTHREAD_SERVER_URL"), store: store)
    app.launch()
    XCTAssertTrue(app.buttons[dayHeader(try Wrapper.today())].waitForExistence(timeout: 30), "today's title")
    XCTAssertTrue(app.line("Renew the passport").waitForExistence(timeout: 30), "today's page")
    return app
  }

  /// The list's cell holding the line with these words.
  @MainActor
  private func row(_ words: String, in app: XCUIApplication) throws -> XCUIElement {
    XCTAssertTrue(app.waitForLine(words), "the row \"\(words)\"")
    let predicate = NSPredicate(
      format: "elementType == %d AND value == %@", XCUIElement.ElementType.textView.rawValue, words)
    let cell = app.cells.containing(predicate).firstMatch
    XCTAssertTrue(cell.exists, "the row's cell")
    return cell
  }

  /// The words of the row's marks line as drawn (the list content's line under the words); nil when there is none.
  /// UI automation reads the drawn line rather than the marks' VoiceOver element: it builds a list cell's elements
  /// from its views, not from the cell's `accessibilityElements`.
  @MainActor
  private func marks(of words: String, in app: XCUIApplication) throws -> String? {
    let texts = try row(words, in: app).staticTexts.allElementsBoundByIndex
      .filter { $0.exists && $0.label != words }
      .sorted { $0.frame.minY < $1.frame.minY }
    return texts.isEmpty ? nil : texts.map(\.label).joined(separator: "\n")
  }

  /// Scrolls the page until the line with these words is wholly in view, clear of the navigation and tab bars and of
  /// the notice, so a swipe on it starts on it. The page is scrolled by short drags: a swipe would fling past it.
  @MainActor
  @discardableResult
  private func reveal(_ words: String, in app: XCUIApplication) throws -> XCUIElement {
    let line = app.line(words)
    let list = app.collectionViews.firstMatch
    let top = app.navigationBars.firstMatch.frame.maxY + 80
    let bottom = (app.tabBars.firstMatch.exists ? app.tabBars.firstMatch.frame.minY : list.frame.maxY) - 40
    for _ in 0..<20 {
      if line.exists, line.isHittable, line.frame.minY > top, line.frame.maxY < bottom { return line }
      let up = line.exists && line.frame.minY <= top
      let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: up ? 200 : -200)))
    }
    XCTFail("the row \"\(words)\" could not be brought into view")
    return line
  }

  /// The day `days` after `today` in the open calendar, the month turned forward to it when needed.
  @MainActor
  private func calendarDay(_ today: Date, adding days: Int, in app: XCUIApplication) throws -> XCUIElement {
    // The calendar's own label for a day: "Monday, November 30" (with "Today, " before the system's today).
    let cell = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", ", \(Words.calendarLabel(today, adding: days))"))
      .firstMatch
    let next = app.buttons["Next Month"]
    XCTAssertTrue(next.waitForExistence(timeout: 10), "the calendar")
    for _ in 0..<2 where !cell.waitForExistence(timeout: 2) {
      next.tap()
    }
    XCTAssertTrue(cell.exists, "the day in the calendar")
    return cell
  }

  /// Opens the day `days` after `today` from the header's calendar.
  @MainActor
  private func pickInTheHeader(_ today: Date, adding days: Int, in app: XCUIApplication) throws {
    app.scrollToTheTop()
    app.buttons[dayHeader(today)].tap()
    try calendarDay(today, adding: days, in: app).tap()
    XCTAssertTrue(app.buttons[dayHeader(today, adding: days)].waitForExistence(timeout: 30), "the day picked")
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
  /// Waits up to `timeout` seconds for the notice to say `words`: words outside the page's rows, so a row's own
  /// `Cancelled` mark is not taken for the notice.
  @MainActor
  func showsNotice(_ words: String, timeout: TimeInterval) -> Bool {
    let everywhere = staticTexts.matching(NSPredicate(format: "label == %@", words))
    let inRows = collectionViews.firstMatch.staticTexts.matching(NSPredicate(format: "label == %@", words))
    let shown = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in everywhere.count > inRows.count }, object: nil)
    return XCTWaiter.wait(for: [shown], timeout: timeout) == .completed
  }
}
