import Testing

@testable import DaythreadCore

@Suite struct CarriedTests {
  @Test func since_is_the_webs() throws {
    let cases = try Fixtures.cases("carried/cases.json")
    #expect(cases.count == 9)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let taskId = try #require(entry["taskId"]?.stringValue, "taskId: \(name)")
      let task = try #require(workspace.task(taskId), "task: \(name)")
      let today = try #require(entry["today"]?.stringValue.flatMap(LocalDate.init), "today: \(name)")
      let since = TodoIndex(workspace).carriedSince(task, today: today)
      #expect(since?.value == entry["since"]?.stringValue, "since: \(name)")
      let label = since.map { "Since " + DayWords.sinceLabel($0, today: today) }
      #expect(label == entry["label"]?.stringValue, "label: \(name)")
    }
  }

  private static let today = LocalDate("2026-11-26")!

  /// A to-do planned on the 10th and on today, as carry-over leaves it: today's draft applied it, so today is not a
  /// day it was chosen for. `extra` is another page of the workspace.
  private static func workspace(extra: JSONValue? = nil, title: String = "A to-do", createdOn: String? = "2026-11-01")
    throws -> Workspace
  {
    var pages = [
      TestWorkspace.day("2026-11-10", rows: [TestWorkspace.row("t")]),
      TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")]),
      TestWorkspace.draft(of: "day:2026-11-26", applied: ["t"]),
    ]
    if let extra { pages.append(extra) }
    return try TestWorkspace.make(pages: pages, tasks: [TestWorkspace.task("t", title: title, createdOn: createdOn)])
  }

  private static func since(_ workspace: Workspace) -> String? {
    guard let task = workspace.task("t") else { return nil }
    return TodoIndex(workspace).carriedSince(task, today: today)?.value
  }

  @Test func a_plan_typed_on_a_day_counts_from_it() throws {
    #expect(Self.since(try Self.workspace()) == "2026-11-10")
  }

  @Test func a_day_whose_draft_applied_it_does_not_count() throws {
    let draft = TestWorkspace.draft(of: "day:2026-11-10", applied: ["t"])
    #expect(Self.since(try Self.workspace(extra: draft)) == "2026-11-01")
  }

  @Test func a_plan_row_on_today_counts_unless_its_draft_applied_it() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")])],
      tasks: [TestWorkspace.task("t", createdOn: "2026-11-01")])
    #expect(Self.since(workspace) == nil)
  }

  @Test func a_draft_in_trash_or_of_another_day_holds_nothing_back() throws {
    let trashed = TestWorkspace.draft(of: "day:2026-11-10", applied: ["t"], trashedAt: "2026-11-11T00:00:00.000Z")
    #expect(Self.since(try Self.workspace(extra: trashed)) == "2026-11-10")
    let other = TestWorkspace.draft(of: "day:2026-11-09", applied: ["t"])
    #expect(Self.since(try Self.workspace(extra: other)) == "2026-11-10")
  }

  @Test func a_draft_that_does_not_read_holds_nothing_back() throws {
    for document in ["not json", "null", #"{"items":3}"#, #"{"items":[1,{"taskId":"t"},null]}"#] {
      let draft = TestWorkspace.page("draft:day:2026-11-10", type: "draft", document: document)
      #expect(Self.since(try Self.workspace(extra: draft)) == "2026-11-10", "document: \(document)")
    }
  }

  @Test func a_to_do_without_a_created_day_counts_from_its_first_plan_row() throws {
    #expect(Self.since(try Self.workspace(createdOn: nil)) == "2026-11-10")
  }

  @Test func a_to_do_with_no_words_reads_nothing() throws {
    #expect(Self.since(try Self.workspace(title: " \u{A0}")) == nil)
  }
}
