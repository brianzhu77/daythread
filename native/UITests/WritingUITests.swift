import XCTest

/// A page's text and the key the Core gives it (`ContentKey.of`), held to the same value by
/// `DaythreadTests/SeededContentKeyTests`: the UI tests cannot import the Core.
let seededContentKeyText =
  #"[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"café 今天 😀","styles":{}}],"children":[]}]"#
let seededContentKey = "d:116:dfbd672cde24dcdbbce455a0224dab9f"

/// Writing on today's page, seen on the screen and on the server. The seed is shared by every test and never reset, so
/// each test types words of its own and reads only them back; a test that needs a fresh line makes one at the end of
/// the page, under Notes.
final class WritingUITests: XCTestCase {
  /// Nothing listens on the discard port, so the app is offline.
  private static let noServer = "http://127.0.0.1:9"
  private static let offlineWithWords = "Offline · saves when you're back"

  override func setUp() {
    continueAfterFailure = false
  }

  private func todayPage() throws -> String {
    let today = try Wrapper.today()
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let parts = calendar.dateComponents([.year, .month, .day], from: today)
    return String(format: "day:%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
  }

  /// The app on `server` with today's page drawn and its lines ready to be typed into.
  @MainActor
  private func open(server: String, store: String) throws -> XCUIApplication {
    let app = XCUIApplication.daythread(server: server, store: store)
    app.launch()
    XCTAssertTrue(app.buttons[dayHeader(try Wrapper.today())].waitForExistence(timeout: 30), "today's title")
    XCTAssertTrue(app.line("Water the plants").waitForExistence(timeout: 30), "today's page")
    return app
  }

  @MainActor
  func test_a_line_typed_is_on_the_server() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let page = try todayPage()
    let words = "Picked up the parcel"
    let app = try open(server: base, store: Wrapper.storeName())

    app.startLineAtTheEnd().typeText(words)
    XCTAssertTrue(app.line(words).waitForExistence(timeout: 2), "on screen as typed")

    try await server.waitForLines(of: page, "holding the line typed") { $0.contains { $0.words == words } }
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Not saved")).firstMatch.exists)
    app.terminate()
  }

  @MainActor
  func test_return_and_backspace() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let page = try todayPage()
    let (first, second) = ("Bread and", "cheese")
    let app = try open(server: base, store: Wrapper.storeName())

    let line = app.startLineAtTheEnd()
    line.typeText(first + "\n" + second)
    XCTAssertTrue(app.line(first).waitForExistence(timeout: 2), "the first half")
    XCTAssertTrue(app.line(second).waitForExistence(timeout: 2), "the second half, a line of its own")
    try await server.waitForLines(of: page, "two lines, one after the other") { lines in
      guard let index = lines.firstIndex(where: { $0.words == first }), index + 1 < lines.count else { return false }
      return lines[index + 1].words == second && lines[index + 1].type == "bulletListItem"
    }

    // Backspace at the start of a bullet makes it a paragraph, as on the web; a second one joins it to the line above.
    app.line(second).tapAtTheStart()
    app.focusedLine.typeText(XCUIKeyboardKey.delete.rawValue)
    try await server.waitForLines(of: page, "the second line a paragraph") { lines in
      lines.contains { $0.words == second && $0.type == "paragraph" }
    }
    app.focusedLine.typeText(XCUIKeyboardKey.delete.rawValue)
    XCTAssertTrue(app.line(first + second).waitForExistence(timeout: 2), "joined on screen")
    try await server.waitForLines(of: page, "the two lines joined") { lines in
      lines.contains { $0.words == first + second } && !lines.contains { $0.words == second || $0.words == first }
    }
    app.terminate()
  }

  @MainActor
  func test_typed_offline_survives_a_relaunch_and_is_saved() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let page = try todayPage()
    let words = "Written on the train"
    let store = Wrapper.storeName()

    let online = try open(server: base, store: store)
    online.terminate()

    let offline = try open(server: Self.noServer, store: store)
    offline.startLineAtTheEnd().typeText(words)
    XCTAssertTrue(offline.line(words).waitForExistence(timeout: 2), "typed with no server")
    offline.scrollToTheTop()
    XCTAssertTrue(offline.staticTexts[Self.offlineWithWords].waitForExistence(timeout: 10), "his words waiting")
    offline.terminate()

    let again = XCUIApplication.daythread(server: Self.noServer, store: store)
    again.launch()
    XCTAssertTrue(again.staticTexts[Self.offlineWithWords].waitForExistence(timeout: 30), "still waiting")
    XCTAssertTrue(again.waitForLine(words), "still there after a relaunch")
    again.terminate()

    let back = XCUIApplication.daythread(server: base, store: store)
    back.launch()
    XCTAssertTrue(back.waitForLine(words), "on screen when the server is back")
    try await server.waitForLines(of: page, timeout: 30, "holding the line typed offline") {
      $0.contains { $0.words == words }
    }
    back.scrollToTheTop()
    let status = back.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Offline")).firstMatch
    XCTAssertTrue(status.waitForNonExistence(timeout: 10), "no line once saved")
    back.terminate()
  }

  @MainActor
  func test_a_to_do_typed_and_ticked() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let words = "Buy oat milk"
    let app = try open(server: base, store: Wrapper.storeName())

    // The empty to-do the template leaves under TODO: the line with no words right above the Events heading, after
    // the seeded to-dos (more than a screen of them, so the page is scrolled to it first).
    XCTAssertTrue(app.waitForLine("Events"), "the Events heading")
    let events = app.line("Events").frame.minY
    let empty = try XCTUnwrap(
      app.lines.last { $0.frame.minY < events && ($0.value as? String) == "" }, "the template's empty to-do")
    empty.tap()
    app.useKeyboard(.english)
    app.focusedLine.typeText(words)

    let circle = app.circle(words)
    XCTAssertTrue(circle.waitForExistence(timeout: 2), "a circle for the to-do typed")
    XCTAssertEqual(circle.value as? String, "not done")
    XCTAssertTrue(circle.wait(for: \.isEnabled, toEqual: true, timeout: 5), "the circle can be ticked")
    circle.tap()
    XCTAssertTrue(circle.waitForValue("done", timeout: 2), "ticked at once")
    try await server.waitForStatus(of: words, "done", timeout: 10)
    app.terminate()
  }

  @MainActor
  func test_a_page_changed_on_the_server_while_he_typed_is_merged() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let page = try todayPage()
    let mine = "Typed on the plane"
    let theirs = "Added on the laptop"
    let store = Wrapper.storeName()

    let online = try open(server: base, store: store)
    online.terminate()

    let offline = try open(server: Self.noServer, store: store)
    offline.startLineAtTheEnd().typeText(mine)
    offline.scrollToTheTop()
    XCTAssertTrue(offline.staticTexts[Self.offlineWithWords].waitForExistence(timeout: 10), "his words kept")
    offline.terminate()

    // Meanwhile another device saves the page: a line of its own under Events.
    let stored = try await server.document(of: page)
    var blocks = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(stored.utf8)) as? [[String: Any]])
    let events = try XCTUnwrap(blocks.firstIndex { ($0["id"] as? String)?.hasSuffix(":h1") == true }, "Events")
    blocks.insert(
      [
        "id": UUID().uuidString.lowercased(), "type": "paragraph", "props": [String: Any](),
        "content": [["type": "text", "text": theirs, "styles": [String: Any]()]], "children": [[String: Any]](),
      ], at: events + 1)
    let changed = String(decoding: try JSONSerialization.data(withJSONObject: blocks), as: UTF8.self)
    try await server.save(pageId: page, document: changed)

    let back = XCUIApplication.daythread(server: base, store: store)
    back.launch()
    // Under Events, below the seeded to-dos: the page is scrolled to it.
    XCTAssertTrue(back.waitForLine(theirs, timeout: 30), "the other device's line")
    XCTAssertTrue(back.waitForLine(mine, timeout: 10), "his line, kept")
    try await server.waitForLines(of: page, timeout: 30, "holding both lines") { lines in
      lines.filter { $0.words == mine }.count == 1 && lines.filter { $0.words == theirs }.count == 1
    }
    // And still once each a moment later: no second merge or save adds another.
    try await Task.sleep(nanoseconds: 1_000_000_000)
    let later = try await server.lines(of: page)
    XCTAssertEqual(later.filter { $0.words == mine }.count, 1, "his line, once: \(later)")
    XCTAssertEqual(later.filter { $0.words == theirs }.count, 1, "their line, once: \(later)")
    back.scrollToTheTop()
    XCTAssertTrue(
      back.buttons[dayHeader(try Wrapper.today())].waitForExistence(timeout: 5), "the day's header, with its status line")
    XCTAssertFalse(
      back.staticTexts["Latest loaded · your changes are below their lines"].exists, "no line both changed, nothing said")
    back.terminate()
  }

  /// The tests' own copy of the content key (`SeededServer.contentKey`) gives the key the app's Core gives for the
  /// same text: `DaythreadTests/SeededContentKeyTests` holds the Core to the same value.
  func test_the_seeded_servers_content_key_is_the_cores() {
    XCTAssertEqual(
      SeededServer.contentKey(seededContentKeyText), seededContentKey,
      "SeededServer.contentKey no longer gives the Core's key (see DaythreadTests/SeededContentKeyTests)")
  }

  /// Chinese typed with the simulator's Pinyin keyboard: "jintian", then Space for the first candidate, on a new line and
  /// on a new to-do. Nothing is split, doubled or lost, on screen or on the server.
  @MainActor
  func test_chinese_with_the_pinyin_keyboard() async throws {
    let base = try Wrapper.value("DAYTHREAD_SERVER_URL")
    let server = SeededServer(base: base)
    let page = try todayPage()
    let today = "今天"
    let app = try open(server: base, store: Wrapper.storeName())
    defer {
      // The simulator keeps the keyboard last used; the other tests type in English.
      if app.buttons["Next keyboard"].exists { app.useKeyboard(.english) }
      app.terminate()
    }

    app.startLineAtTheEnd()
    app.useKeyboard(.pinyin)
    // Key by key on the keyboard: `typeText` puts the letters in as they are, past the input method.
    app.tapKeys("jintian")
    XCTAssertFalse(app.line(today).exists, "what is composed is not yet his words")
    app.keyboards.keys["space"].tap()
    XCTAssertTrue(app.line(today).waitForExistence(timeout: 2), "the first candidate, committed")
    try await server.waitForLines(of: page, "holding the line once, whole") { lines in
      lines.filter { $0.words == today && $0.type == "bulletListItem" }.count == 1
        && !lines.contains { $0.words.contains("jin") || $0.words.contains("tian") }
    }

    // A new to-do after one of the seed's ("Tick me" is left for looking by hand).
    app.scrollToTheTop()
    app.line("Tick me").tapAtTheEnd()
    app.focusedLine.typeText("\n")
    app.tapKeys("jintian")
    app.keyboards.keys["space"].tap()
    XCTAssertTrue(app.circle(today).waitForExistence(timeout: 2), "a to-do with the words committed")
    XCTAssertEqual(app.focusedLine.value as? String, today, "the to-do holds the words, whole")
    try await server.waitForLines(of: page, "holding the to-do once, whole") { lines in
      lines.filter { $0.words == today && $0.type == "task" }.count == 1 && lines.filter { $0.words == today }.count == 2
    }
    try await server.waitForStatus(of: today, "open", timeout: 10)
  }
}
