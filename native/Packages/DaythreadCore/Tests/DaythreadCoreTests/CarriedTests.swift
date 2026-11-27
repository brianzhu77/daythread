import Testing

@testable import DaythreadCore

@Suite struct CarriedTests {
  @Test func since_is_the_webs() throws {
    let cases = try Fixtures.cases("carried/cases.json")
    #expect(cases.count == 9)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let task = try #require(workspace.task(try #require(entry["taskId"]?.stringValue)), "task: \(name)")
      let today = try #require(entry["today"]?.stringValue.flatMap(LocalDate.init), "today: \(name)")
      let since = TodoIndex(workspace).carriedSince(task, today: today)
      #expect(since?.value == entry["since"]?.stringValue, "since: \(name)")
      let label = since.map { "Since " + DayWords.sinceLabel($0, today: today) }
      #expect(label == entry["label"]?.stringValue, "label: \(name)")
    }
  }

  private static let today = LocalDate("2026-11-26")!

  private static func workspace(draft: JSONValue?) throws -> Workspace {
    var pages = [
      TestWorkspace.day("2026-11-10", rows: [TestWorkspace.row("t")]),
      TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")]),
    ]
    if let draft { pages.append(draft) }
    return try TestWorkspace.make(pages: pages, tasks: [TestWorkspace.task("t", createdOn: "2026-11-01")])
  }

  private func since(_ workspace: Workspace) throws -> String? {
    TodoIndex(workspace).carriedSince(try #require(workspace.task("t")), today: Self.today)?.value
  }

  @Test func a_plan_typed_on_a_day_counts_from_it() throws {
    #expect(try since(Self.workspace(draft: nil)) == "2026-11-10")
  }

  @Test func a_day_whose_draft_applied_it_does_not_count() throws {
    let draft = TestWorkspace.draft(of: "day:2026-11-10", applied: ["t"])
    #expect(try since(Self.workspace(draft: draft)) == "2026-11-01")
  }

  @Test func a_draft_in_trash_or_of_another_day_holds_nothing_back() throws {
    let trashed = TestWorkspace.draft(of: "day:2026-11-10", applied: ["t"], trashedAt: "2026-11-11T00:00:00.000Z")
    #expect(try since(Self.workspace(draft: trashed)) == "2026-11-10")
    let other = TestWorkspace.draft(of: "day:2026-11-09", applied: ["t"])
    #expect(try since(Self.workspace(draft: other)) == "2026-11-10")
  }

  @Test func a_draft_that_does_not_read_holds_nothing_back() throws {
    for document in ["not json", "null", #"{"items":3}"#, #"{"items":[1,{"taskId":"t"},null]}"#] {
      let draft = TestWorkspace.page("draft:day:2026-11-10", type: "draft", document: document)
      #expect(try since(Self.workspace(draft: draft)) == "2026-11-10", "document: \(document)")
    }
  }

  @Test func a_to_do_without_a_created_day_counts_from_its_first_plan_row() throws {
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-10", rows: [TestWorkspace.row("t")]),
        TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")]),
      ],
      tasks: [TestWorkspace.task("t")])
    #expect(try since(workspace) == "2026-11-10")
  }

  @Test func a_to_do_with_no_words_reads_nothing() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")])],
      tasks: [TestWorkspace.task("t", title: " \u{A0}", createdOn: "2026-11-01")])
    #expect(try since(workspace) == nil)
  }
}
