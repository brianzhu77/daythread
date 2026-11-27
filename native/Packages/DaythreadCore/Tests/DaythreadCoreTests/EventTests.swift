import Testing

@testable import DaythreadCore

@Suite struct EventTests {
  /// What a case file says an event is: the web's `DayEvent` without its task.
  static func expected(_ value: JSONValue) throws -> DayEvent {
    let object = try #require(value.objectValue)
    let line = try #require(object["line"]?.objectValue)
    return DayEvent(
      id: try #require(object["id"]?.stringValue), title: try #require(object["title"]?.stringValue),
      date: try #require(object["date"]?.stringValue.flatMap(LocalDate.init)),
      time: object["time"]?.stringValue,
      pageId: try #require(line["pageId"]?.stringValue), lineId: try #require(line["lineId"]?.stringValue))
  }

  static func chip(_ eventId: String?, date: String = "2026-11-26", time: String? = nil) -> JSONValue {
    var props: JSONObject = ["date": .string(date)]
    if let eventId { props["eventId"] = .string(eventId) }
    if let time { props["time"] = .string(time) }
    return .object(["type": .string("dateMention"), "props": .object(props)])
  }

  static func line(_ id: String, _ content: [JSONValue]) -> Block {
    Block(id: id, type: "bulletListItem", content: .array(content))
  }

  static func run(_ text: String) -> JSONValue { .object(textRun(text)) }

  @Test func events_are_the_webs() throws {
    let cases = try Fixtures.cases("events/cases.json")
    #expect(cases.count == 13)
    for entry in cases where entry["unreadablePageId"]?.stringValue == nil {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let day = try #require(entry["day"]?.stringValue.flatMap(LocalDate.init), "day: \(name)")
      let events = try #require(entry["events"]?.arrayValue, "events: \(name)").map(Self.expected)
      #expect(TodoIndex(workspace).events(on: day) == events, "events: \(name)")
    }
  }

  @Test func the_app_reads_no_event_of_a_page_it_cannot_read() throws {
    let odd = try #require(
      try Fixtures.cases("events/cases.json").first { $0["unreadablePageId"]?.stringValue != nil })
    let name = odd["name"]?.stringValue ?? "?"
    let pageId = try #require(odd["unreadablePageId"]?.stringValue)
    let workspace = try #require(odd["workspace"].flatMap(Workspace.init), "workspace: \(name)")
    let day = try #require(odd["day"]?.stringValue.flatMap(LocalDate.init))
    let web = try #require(odd["events"]?.arrayValue).map(Self.expected)
    let app = web.filter { $0.pageId != pageId }
    #expect(app.count < web.count, "the case holds an event of the page the app cannot read: \(name)")
    #expect(TodoIndex(workspace).events(on: day) == app, "\(name)")
  }

  @Test func a_chip_with_no_event_id_is_no_event_and_one_space_in_a_title() throws {
    let content = [Self.run("Call"), Self.chip(nil), Self.run("Lu"), Self.chip("e1", time: "09:00")]
    let page = TestWorkspace.page("doc", document: Document.write([Self.line("l1", content)]))
    let day = try #require(LocalDate("2026-11-26"))
    let events = try TodoIndex(TestWorkspace.make(pages: [page])).events(on: day)
    #expect(events.map(\.title) == ["Call Lu"])
    #expect(events.map(\.id) == ["e1"])
  }

  @Test func javascript_space_is_not_swifts() {
    #expect(InlineText.collapsingJavaScriptSpace(" \u{a0}a\t\u{3000}b\u{feff}\u{2028}c ") == "a b c")
    #expect(InlineText.collapsingJavaScriptSpace("a\u{85}b\u{200b}c") == "a\u{85}b\u{200b}c")
    #expect(Workspace.isBlankInJavaScript("\u{3000} "))
    #expect(!Workspace.isBlankInJavaScript("\u{85}"))
  }

  @Test func a_page_with_a_plan_row_and_a_chip_gives_both() throws {
    let blocks = [
      TestWorkspace.row("t1"), Self.line("l1", [Self.run("Lunch "), Self.chip("e1", time: "12:00")]),
    ]
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: blocks)], tasks: [TestWorkspace.task("t1")])
    let index = TodoIndex(workspace)
    let day = try #require(LocalDate("2026-11-26"))
    #expect(index.plannedOn("t1") == day)
    #expect(index.events(on: day).map(\.title) == ["Lunch"])
  }

  // Branches the shared cases do not reach.

  @Test func a_title_reads_each_kind_of_item_as_the_web_does() {
    let titles = ["p1": "Review", "5": "Five"]
    func title(_ content: JSONValue?) -> String { InlineText.eventTitle(content, pageTitle: { titles[$0] }) }
    func ref(_ pageId: JSONValue?) -> JSONValue {
      var props = JSONObject()
      if let pageId { props["pageId"] = pageId }
      return .object(["type": .string("pageRef"), "props": .object(props)])
    }
    #expect(title(.string("  a   b ")) == "a b")
    #expect(title(nil) == "")
    #expect(title(.number("3")) == "")
    #expect(title(.array([Self.run("a"), ref(.string("p1")), Self.run("b")])) == "aReviewb")
    #expect(title(.array([Self.run("a "), ref(.string("none")), Self.run(" b")])) == "a b")
    #expect(title(.array([Self.run("a"), ref(nil), Self.run("b")])) == "ab")
    #expect(title(.array([Self.run("a"), ref(.null), Self.run("b")])) == "ab")
    // `String(5)` is "5" in JavaScript, so a number reads the page with that id.
    #expect(title(.array([ref(.number("5"))])) == "Five")
    let link = JSONValue.object(["type": .string("link"), "content": .array([Self.run("click")])])
    let linkOfString = JSONValue.object(["type": .string("link"), "content": .string("str")])
    let linkOfNumber = JSONValue.object(["type": .string("link"), "content": .number("5")])
    #expect(title(.array([link, .string("skipped"), .null, .array([]), linkOfString, linkOfNumber])) == "clickstr")
    let numberText = JSONValue.object(["type": .string("text"), "text": .number("7")])
    let nullText = JSONValue.object(["type": .string("text"), "text": .null])
    #expect(title(.array([numberText, nullText])) == "7null")
    // A malformed chip is still one space.
    #expect(title(.array([Self.run("a"), Self.chip(nil), Self.run("b")])) == "a b")
  }

  @Test func a_page_ref_to_a_page_in_trash_reads_its_title() throws {
    let blocks = [
      Block(
        id: "l1", type: "bulletListItem",
        content: .array([
          .object(["type": .string("pageRef"), "props": .object(["pageId": .string("gone")])]),
          Self.run(" sync "), Self.chip("e1"),
        ]))
    ]
    var gone = try #require(
      TestWorkspace.page("gone", trashedAt: "2026-11-01T00:00:00.000Z", document: "[]").objectValue)
    gone["title"] = .string("Old plan")
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.page("doc", document: Document.write(blocks)), .object(gone),
    ])
    let events = TodoIndex(workspace).events(on: try #require(LocalDate("2026-11-26")))
    #expect(events.map(\.title) == ["Old plan sync"])
  }

  @Test func a_line_with_two_chips_of_one_id_is_one_event_and_all_day_comes_first() throws {
    let blocks = [
      Self.line("l1", [Self.run("A"), Self.chip("e1", time: "15:00"), Self.chip("e1", time: "16:00")]),
      Self.line("l2", [Self.run("B"), Self.chip("e2", time: "09:00")]),
      Self.line("l3", [Self.run("C"), Self.chip("e3")]),
      Self.line("l4", [Self.run("D"), Self.chip("e4", time: "09:00")]),
    ]
    let workspace = try TestWorkspace.make(pages: [TestWorkspace.page("doc", document: Document.write(blocks))])
    let events = TodoIndex(workspace).events(on: try #require(LocalDate("2026-11-26")))
    #expect(events.map(\.id) == ["e3", "e2", "e4", "e1"])
    #expect(events.last?.time == "15:00")
  }

  @Test func a_chip_inside_a_link_is_not_read() throws {
    let link = JSONValue.object(["type": .string("link"), "content": .array([Self.chip("e1")])])
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.page("doc", document: Document.write([Self.line("l1", [link])]))
    ])
    #expect(TodoIndex(workspace).events(on: try #require(LocalDate("2026-11-26"))).isEmpty)
  }

  @Test func the_newest_day_page_holds_an_event_whatever_the_page_order() throws {
    let older = TestWorkspace.day("2026-11-20", rows: [Self.line("a", [Self.run("Old "), Self.chip("e1")])])
    let newer = TestWorkspace.day("2026-11-22", rows: [Self.line("b", [Self.run("New "), Self.chip("e1")])])
    let doc = TestWorkspace.page(
      "doc", document: Document.write([Self.line("c", [Self.run("Doc "), Self.chip("e1")])]))
    let day = try #require(LocalDate("2026-11-26"))
    for pages in [[doc, newer, older], [older, newer, doc], [newer, doc, older]] {
      let events = try TodoIndex(TestWorkspace.make(pages: pages)).events(on: day)
      #expect(events.map(\.title) == ["New"])
      #expect(events.first?.pageId == "day:2026-11-22")
    }
  }
}
