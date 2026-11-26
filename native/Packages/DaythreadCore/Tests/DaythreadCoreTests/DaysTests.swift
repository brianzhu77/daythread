import Testing

@testable import DaythreadCore

@Suite struct DaysTests {
  private func workspace(_ value: JSONValue?) throws -> Workspace {
    try #require(value.flatMap(Workspace.init))
  }

  @Test func a_days_page_is_the_live_daily_page_for_the_date() throws {
    let cases = try Fixtures.cases("day-page/cases.json")
    #expect(!cases.isEmpty)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? ""
      let ws = try workspace(entry["workspace"])
      let date = try #require(entry["date"]?.stringValue.flatMap(LocalDate.init))
      #expect(ws.dayPage(date)?.id == entry["live"]?.stringValue, "live: \(name)")
      #expect(ws.trashedDayPage(date)?.id == entry["trashed"]?.stringValue, "trashed: \(name)")
    }
  }

  @Test func written_days_are_the_servers() throws {
    let cases = try Fixtures.cases("written-days/cases.json")
    #expect(!cases.isEmpty)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? ""
      let ws = try workspace(entry["workspace"])
      let expected = try #require(entry["days"]?.arrayValue).compactMap(\.stringValue).sorted()
      #expect(ws.writtenDays().map(\.value).sorted() == expected, "\(name)")
    }
  }

  @Test func a_draft_is_never_a_days_page_or_a_reason_a_day_is_written() throws {
    let ws = try workspace(
      try json(
        """
        {"revision":1,"timezone":"UTC","tasks":[],"pages":[
          {"id":"draft:day:2026-10-21","type":"draft","date":"2026-10-21","title":"","parentId":"day:2026-10-21",
           "document":"{\\"items\\":[]}"},
          {"id":"day:2026-10-21","type":"daily","date":"2026-10-21","title":"2026-10-21","document":"[]"}]}
        """))
    let date = try #require(LocalDate("2026-10-21"))
    #expect(ws.dayPage(date)?.id == "day:2026-10-21")
    var onlyDraft = ws
    onlyDraft.pages.removeAll { $0.type == "daily" }
    #expect(onlyDraft.dayPage(date) == nil)
    #expect(ws.writtenDays().isEmpty)
  }

  /// `JSON.stringify` never writes `\/`, so the shared cases cannot hold this; another writer may.
  @Test func a_file_whose_url_is_written_with_escaped_slashes_is_content() throws {
    let ws = try workspace(
      try json(
        #"""
        {"revision":1,"timezone":"UTC","tasks":[],"pages":[
          {"id":"day:2026-10-21","type":"daily","date":"2026-10-21","title":"2026-10-21",
           "document":"[{\"id\":\"f1\",\"type\":\"file\",\"props\":{\"url\":\"https:\\/\\/example.com\\/a.pdf\",\"name\":\"a.pdf\",\"caption\":\"\"},\"children\":[]}]"}]}
        """#))
    let url = Document.blocks(try #require(ws.pages.first).document).first?.props["url"]
    guard case .verbatim(let text, _)? = url else {
      Issue.record("The url was not read as written: \(String(describing: url))")
      return
    }
    #expect(text == "https://example.com/a.pdf")
    #expect(ws.writtenDays().map(\.value) == ["2026-10-21"])
  }

  @Test func the_week_starts_on_monday_only_when_the_workspace_says_one() throws {
    let monday = try workspace(try json(#"{"revision":1,"timezone":"UTC","tasks":[],"pages":[],"weekStart":1}"#))
    let sunday = try workspace(try json(#"{"revision":1,"timezone":"UTC","tasks":[],"pages":[],"weekStart":0}"#))
    let unset = try workspace(try json(#"{"revision":1,"timezone":"UTC","tasks":[],"pages":[]}"#))
    #expect(monday.weekStartsOnMonday)
    #expect(!sunday.weekStartsOnMonday)
    #expect(!unset.weekStartsOnMonday)
  }
}
