import Testing

@testable import DaythreadCore

@Suite struct RowMenuTests {
  static func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  private func task(status: String = "open") throws -> TodoTask {
    try #require(TodoTask(TestWorkspace.task("t", status: status)))
  }

  private func menu(
    _ status: String = "open", role: RowRole = .plan, planned: String?, pageDate: String?, today: String = "2026-11-26"
  ) throws -> RowMenu? {
    RowMenu.of(
      task: try task(status: status), role: role, planned: try planned.map(Self.day),
      pageDate: try pageDate.map(Self.day), today: try Self.day(today))
  }

  @Test func menus_are_the_webs() throws {
    let cases = try Fixtures.cases("rows/menus.json")
    #expect(cases.count == 19)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let status = try #require(entry["status"]?.stringValue)
      let role = RowRole(entry["role"])
      let menu = try menu(
        status, role: role, planned: entry["planned"]?.stringValue, pageDate: entry["pageDate"]?.stringValue,
        today: try #require(entry["today"]?.stringValue))
      guard let expected = entry["menu"]?.objectValue else {
        #expect(menu == nil, "nothing: \(name)")
        continue
      }
      let menuValue = try #require(menu, "menu: \(name)")

      var groups: [RowMenu.Group] = []
      // A reference row's primary `Plan for today` is a group of its own, ahead of the web's groups.
      if let primary = expected["primary"]?.arrayValue, role == .reference, let first = primary.first?.objectValue {
        groups.append(
          RowMenu.Group(
            title: nil,
            items: [
              RowMenu.Item(title: try #require(first["label"]?.stringValue), action: .bringToToday, destructive: false)
            ]))
      }
      for group in try #require(expected["groups"]?.arrayValue) {
        let group = try #require(group.objectValue)
        var items: [RowMenu.Item] = []
        for item in try #require(group["items"]?.arrayValue) {
          let item = try #require(item.objectValue)
          let intent: JSONObject? =
            item["intent"]?.stringValue == "pick-date" ? ["kind": .string("pick-date")] : item["intent"]?.objectValue
          items.append(
            RowMenu.Item(
              title: try #require(item["label"]?.stringValue), action: try #require(RowAction(intent: intent)),
              destructive: item["danger"]?.boolValue ?? false))
        }
        groups.append(RowMenu.Group(title: group["title"]?.stringValue, items: items))
      }
      #expect(menuValue.groups == groups, "groups: \(name)")
      // The swipe is the web's phone bar; for a past day or a cancelled row, whose bar is empty, it is the one action.
      let primary = (expected["primary"]?.arrayValue ?? []).compactMap { $0.objectValue?["label"]?.stringValue }
      let single = expected["groups"]?.arrayValue?.count == 1
      let swipe =
        primary.isEmpty && single
        ? (expected["groups"]?.arrayValue?.first?.objectValue?["items"]?.arrayValue ?? []).compactMap {
          $0.objectValue?["label"]?.stringValue
        } : primary
      #expect(menuValue.swipe.map(\.title) == swipe, "swipe: \(name)")
      // Every action of the menu is reachable: in the swipe or in More.
      let reachable = (menuValue.swipe + menuValue.more).map(\.action)
      #expect(Set(menuValue.groups.flatMap(\.items).map(\.action)).subtracting(reachable).isEmpty, "reachable: \(name)")
    }
  }

  @Test func another_day_is_the_webs_on_each_weekday() throws {
    let cases = try Fixtures.cases("rows/another-day.json")
    #expect(cases.count == 7)
    for entry in cases {
      let today = try Self.day(try #require(entry["today"]?.stringValue))
      let options = RowMenu.anotherDayOptions(today: today)
      let expected = try #require(entry["options"]?.arrayValue).compactMap(\.objectValue)
      #expect(options.map(\.label) == expected.compactMap { $0["label"]?.stringValue }, "labels: \(today.value)")
      #expect(options.map(\.date.value) == expected.compactMap { $0["date"]?.stringValue }, "dates: \(today.value)")
    }
  }

  @Test func the_swipe_per_kind_of_row() throws {
    func titles(_ items: [RowMenu.Item]) -> [String] { items.map(\.title) }

    // Today's plan row.
    let today = try #require(try menu(planned: "2026-11-26", pageDate: "2026-11-26"))
    #expect(titles(today.swipe) == ["Tomorrow", "Not today"])
    #expect(today.swipe.map(\.action) == [.move(try Self.day("2026-11-27")), .notToday])
    #expect(
      titles(today.more) == ["This weekend · Sat 11/28", "Next week · Mon 11/30", "Pick date…", "Cancel task"])

    // Friday's page: no Tomorrow, the off item is named for the day; Friday itself is not offered.
    let friday = try #require(try menu(planned: "2026-11-27", pageDate: "2026-11-27"))
    #expect(titles(friday.swipe) == ["Not on Fri"])
    #expect(titles(friday.more).first == "This weekend · Sat 11/28")
    #expect(titles(friday.more).suffix(2) == ["Pick date…", "Cancel task"])

    // Saturday's page: the weekend is the page's own day.
    let saturday = try #require(try menu(planned: "2026-11-28", pageDate: "2026-11-28"))
    #expect(titles(saturday.swipe) == ["Not on Sat"])
    #expect(titles(saturday.more).prefix(2) == ["Tomorrow · Fri 11/27", "Next week · Mon 11/30"])

    // A stale row on today's page.
    let stale = try #require(try menu(planned: "2026-11-27", pageDate: "2026-11-26"))
    #expect(titles(stale.swipe) == ["Remove from Thu"])
    #expect(titles(stale.more).first == "Tomorrow · Fri 11/27")

    // A reference row, planned elsewhere and planned today.
    let reference = try #require(try menu(role: .reference, planned: "2026-11-30", pageDate: "2026-11-26"))
    #expect(titles(reference.swipe) == ["Plan for today"])
    #expect(reference.swipe.map(\.action) == [.bringToToday])
    #expect(titles(reference.more).last == "Cancel task")
    let planned = try #require(try menu(role: .reference, planned: "2026-11-26", pageDate: "2026-11-26"))
    #expect(planned.swipe.isEmpty)
    #expect(!planned.more.isEmpty)

    // A past day, and a cancelled row.
    let past = try #require(try menu(planned: "2026-11-20", pageDate: "2026-11-20"))
    #expect(titles(past.swipe) == ["Bring to today"])
    #expect(past.swipe.map(\.action) == [.bringToToday])
    #expect(past.more.isEmpty)
    let cancelled = try #require(try menu("cancelled", planned: nil, pageDate: "2026-11-26"))
    #expect(titles(cancelled.swipe) == ["Restore"])
    #expect(cancelled.swipe.map(\.action) == [.restore])
    #expect(cancelled.more.isEmpty)
  }

  @Test func cancel_task_is_the_one_destructive_item() throws {
    let every = [
      try menu(planned: "2026-11-26", pageDate: "2026-11-26"),
      try menu(role: .reference, planned: nil, pageDate: "2026-11-27"),
      try menu("cancelled", planned: nil, pageDate: "2026-11-26"),
      try menu(planned: "2026-11-20", pageDate: "2026-11-20"),
    ]
    for menu in every.compactMap({ $0 }) {
      let destructive = (menu.groups.flatMap(\.items) + menu.swipe + menu.more).filter(\.destructive)
      #expect(destructive.allSatisfy { $0.title == "Cancel task" && $0.action == .cancel })
    }
    let open = try #require(try menu(planned: "2026-11-26", pageDate: "2026-11-26"))
    #expect(open.groups.flatMap(\.items).filter(\.destructive).map(\.title) == ["Cancel task"])
    #expect(open.more.filter(\.destructive).map(\.title) == ["Cancel task"])
  }

  @Test func a_status_this_build_does_not_know_is_an_open_row() throws {
    // The web asks only for `done` and `cancelled`.
    let other = try #require(try menu("someday", planned: "2026-11-26", pageDate: "2026-11-26"))
    #expect(other.swipe.map(\.title) == ["Tomorrow", "Not today"])
  }

  @Test func a_page_that_is_not_a_day_has_no_menu() throws {
    #expect(try menu(planned: "2026-11-26", pageDate: nil) == nil)
    #expect(try menu("done", planned: nil, pageDate: "2026-11-26") == nil)
  }
}
