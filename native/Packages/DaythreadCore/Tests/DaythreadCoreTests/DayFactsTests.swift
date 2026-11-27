import Testing

@testable import DaythreadCore

@Suite struct DayFactsTests {
  static func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  static func facts(_ workspace: Workspace, day: String, today: String) throws -> DayFacts {
    DayFacts.of(day: try Self.day(day), in: workspace, index: TodoIndex(workspace), today: try Self.day(today))
  }

  /// A to-do with the dates a strip reads.
  static func task(
    _ id: String, title: String = "A to-do", due: String? = nil, start: String? = nil, paused: Bool = false,
    status: String = "open"
  ) -> JSONValue {
    var object = TestWorkspace.task(id, title: title, status: status, paused: paused).objectValue ?? [:]
    object["deadlineOn"] = due.map { .string($0) } ?? .null
    object["attentionOn"] = start.map { .string($0) } ?? .null
    return .object(object)
  }

  static func rows(_ rows: [DayFacts.Row]) -> [[String]] { rows.map { [$0.taskId, $0.words, $0.tag ?? ""] } }

  @Test func facts_are_the_webs() throws {
    let cases = try Fixtures.cases("facts/cases.json")
    #expect(cases.count == 9)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let facts = try Self.facts(
        workspace, day: try #require(entry["date"]?.stringValue), today: try #require(entry["today"]?.stringValue))
      guard let web = entry["facts"]?.objectValue else {
        #expect(facts == .none, "none: \(name)")
        continue
      }
      let events = web["events"]?.objectValue
      #expect(facts.events?.text == events?["text"]?.stringValue, "events text: \(name)")
      #expect(facts.events?.more == events?["more"]?.stringValue, "events more: \(name)")
      #expect(facts.eventsHeadingId == events?["headingId"]?.stringValue, "heading: \(name)")
      func webRows(_ rows: JSONValue?) -> [[String]] {
        (rows?.arrayValue ?? []).compactMap(\.objectValue).map {
          [$0["taskId"]?.stringValue ?? "?", $0["words"]?.stringValue ?? "?", $0["tag"]?.stringValue ?? "?"]
        }
      }
      #expect(Self.rows(facts.dueSoon) == webRows(web["dueSoon"]), "due soon: \(name)")
      let notToday = web["notToday"]?.objectValue
      #expect(facts.notToday?.title == notToday?["title"]?.stringValue, "not today title: \(name)")
      #expect(Self.rows(facts.notToday?.rows ?? []) == webRows(notToday?["rows"]), "not today rows: \(name)")
      #expect((facts.notToday == nil) == (notToday == nil), "not today: \(name)")
      #expect(facts.isEmpty == (events == nil && facts.dueSoon.isEmpty && notToday == nil), "isEmpty: \(name)")
    }
  }

  @Test func a_later_day_without_a_page_has_no_facts() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: [])],
      tasks: [Self.task("t", title: "Due soon", due: "2026-11-26")])
    #expect(try Self.facts(workspace, day: "2026-11-27", today: "2026-11-26") == .none)
    #expect(DayFacts.none.isEmpty)
  }

  @Test func a_later_day_with_a_page_has_due_soon_only() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: []), TestWorkspace.day("2026-11-28", rows: [])],
      tasks: [
        Self.task("due", title: "File the taxes", due: "2026-11-27"),
        Self.task("aside", title: "Fix the bike", due: "2026-11-27", paused: true),
        Self.task("plain", title: "Mend the fence", paused: true),
      ])
    let facts = try Self.facts(workspace, day: "2026-11-28", today: "2026-11-26")
    #expect(facts.events == nil)
    #expect(facts.notToday == nil)
    #expect(facts.dueSoon.map(\.taskId) == ["due", "aside"])
  }

  @Test func a_to_do_set_aside_reads_not_today_in_due_soon() throws {
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-26", rows: []),
        TestWorkspace.day("2026-11-25", rows: [TestWorkspace.row("b")]),
      ],
      tasks: [
        Self.task("a", title: "Fix the bike", due: "2026-11-26", paused: true),
        Self.task("b", title: "Sort the shed", due: nil, start: "2026-11-20", paused: true),
      ])
    let rows = try Self.facts(workspace, day: "2026-11-26", today: "2026-11-26").dueSoon
    // `b` has only a Start date in the past: its tag is empty, and the row reads `Not today` alone.
    #expect(rows.map(\.tag) == ["Not today · Due today", "Not today"])
  }

  @Test func a_row_with_an_empty_tag_has_none() throws {
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-26", rows: []),
        TestWorkspace.day("2026-11-25", rows: [TestWorkspace.row("shed")]),
      ],
      tasks: [Self.task("shed", title: "Sort the shed", start: "2026-11-20", paused: true)])
    let facts = try Self.facts(workspace, day: "2026-11-26", today: "2026-11-26")
    let row = try #require(facts.notToday?.rows.first)
    #expect(row.tag == nil)
    #expect(row.spoken == "Sort the shed")
  }

  @Test func a_title_blank_only_in_javascripts_sense_is_not_listed() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: [])],
      tasks: [
        Self.task("ideographic", title: "\u{3000} ", due: "2026-11-26"),
        Self.task("nextline", title: "\u{85}", due: "2026-11-26"),
      ])
    #expect(try Self.facts(workspace, day: "2026-11-26", today: "2026-11-26").dueSoon.map(\.taskId) == ["nextline"])
  }

  @Test func only_open_to_dos_are_listed() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: [])],
      tasks: [
        Self.task("done", due: "2026-11-26", status: "done"),
        Self.task("cancelled", due: "2026-11-26", status: "cancelled"),
        Self.task("open", due: "2026-11-26"),
      ])
    #expect(try Self.facts(workspace, day: "2026-11-26", today: "2026-11-26").dueSoon.map(\.taskId) == ["open"])
  }

  @Test func a_row_on_the_page_at_any_depth_or_role_holds_the_to_do_back() throws {
    let nested = TestWorkspace.row("parent", children: [TestWorkspace.row("deep", role: "reference")])
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-26", rows: [nested]),
        TestWorkspace.day("2026-11-25", rows: [TestWorkspace.row("elsewhere")]),
      ],
      tasks: ["parent", "deep", "elsewhere", "nowhere"].map { Self.task($0, due: "2026-11-26") })
    // A row on another day's page does not hold a to-do back from this one.
    #expect(
      try Self.facts(workspace, day: "2026-11-26", today: "2026-11-26").dueSoon.map(\.taskId)
        == ["elsewhere", "nowhere"])
  }

  @Test func a_page_with_an_empty_trash_stamp_is_the_live_page_as_on_the_web() throws {
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.page(
          "day:2026-11-26", type: "daily", date: "2026-11-26", trashedAt: "",
          document: Document.write([TestWorkspace.row("t")]))
      ],
      tasks: [Self.task("t", due: "2026-11-26"), Self.task("u", due: "2026-11-26")])
    #expect(try Self.facts(workspace, day: "2026-11-26", today: "2026-11-26").dueSoon.map(\.taskId) == ["u"])
  }

  @Test func the_spoken_words() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: [])],
      tasks: [
        Self.task("t", title: "File the taxes", due: "2026-11-26"),
        Self.task("b", title: "Fix the bike", due: "2026-11-26", paused: true),
      ])
    let facts = try Self.facts(workspace, day: "2026-11-26", today: "2026-11-26")
    #expect(facts.dueSoon[0].spoken == "File the taxes, Due today")
    #expect(facts.dueSoon[1].menuLabel == "More for Fix the bike")
  }

  @Test func the_another_day_menu_on_each_weekday() throws {
    let cases = try Fixtures.cases("rows/another-day.json")
    #expect(cases.count == 7)
    for entry in cases {
      let today = try #require(entry["today"]?.stringValue)
      let workspace = try TestWorkspace.make(
        pages: [TestWorkspace.day(today, rows: [])], tasks: [Self.task("t", paused: true)])
      let menu = try #require(try Self.facts(workspace, day: today, today: today).notToday?.menu, "\(today)")
      #expect(menu.title == "Another day", "title: \(today)")
      let options = try #require(entry["options"]?.arrayValue).compactMap(\.objectValue)
      var expected = try options.map { option -> [String] in
        let date = try Self.day(try #require(option["date"]?.stringValue))
        return [
          "\(option["label"]?.stringValue ?? "?") · \(DayWords.shortLabel(date))", "\(RowAction.move(date))",
        ]
      }
      expected.append(["Pick date…", "\(RowAction.pickDate)"])
      #expect(menu.items.map { [$0.title, "\($0.action)"] } == expected, "items: \(today)")
      #expect(menu.items.allSatisfy { !$0.destructive }, "destructive: \(today)")
    }
  }

  @Test func the_strips_notices_are_the_webs() throws {
    let cases = try Fixtures.cases("notices/strip.json")
    #expect(cases.count == 5)
    for entry in cases {
      let date = try Self.day(try #require(entry["date"]?.stringValue))
      let today = try Self.day(try #require(entry["today"]?.stringValue))
      #expect(DayFacts.planNotice(date: date, today: today) == entry["text"]?.stringValue, "\(date.value)")
    }
  }
}
