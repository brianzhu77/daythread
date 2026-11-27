import Testing

@testable import DaythreadCore

@Suite struct TodoIndexTests {
  static func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  @Test func planned_days_are_the_webs() throws {
    let cases = try Fixtures.cases("rows/marks.json")
    #expect(cases.count == 26)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let planned = try #require(entry["planned"]?.objectValue, "planned: \(name)")
      let index = TodoIndex(workspace)
      for task in workspace.tasks {
        #expect(index.plannedOn(task.id)?.value == planned[task.id]?.stringValue, "plannedOn \(task.id): \(name)")
      }
      for id in planned.keys {
        #expect(index.plannedOn(id)?.value == planned[id]?.stringValue, "plannedOn \(id): \(name)")
      }
    }
  }

  @Test func marks_of_a_row_follow_the_webs() throws {
    for entry in try Fixtures.cases("rows/marks.json") {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let pageId = try #require(entry["pageId"]?.stringValue, "pageId: \(name)")
      let page = try #require(workspace.page(pageId), "page: \(name)")
      let blockId = try #require(entry["blockId"]?.stringValue)
      let block = try #require(Self.find(blockId, in: Document.blocks(page.document)), "block: \(name)")
      let taskId = try #require(block.props["taskId"]?.stringValue, "taskId: \(name)")
      let marks = try #require(entry["marks"]?.objectValue, "marks: \(name)")
      let index = TodoIndex(workspace)
      let today = try Self.day(try #require(entry["today"]?.stringValue))

      #expect(index.repeatRule(of: taskId)?.markName == marks["repeat"]?.stringValue, "repeat: \(name)")
      #expect(Blockers.words(index.blockers(of: taskId)) == marks["blockedBy"]?.stringValue, "blockedBy: \(name)")
      // `since` is drawn on a plan row of today's page only: the row's gate is `RowFacts`'s own.
      let facts = RowFacts.of(row: block, pageDate: page.date, in: workspace, index: index, today: today)
      let since = facts?.marks.compactMap { mark -> String? in
        if case .since(let words) = mark { words } else { nil }
      }.first
      #expect(since == marks["since"]?.stringValue, "since: \(name)")
    }
  }

  private static func find(_ id: String, in blocks: [Block]) -> Block? {
    for block in blocks {
      if block.id.hasSameCodeUnits(as: id) { return block }
      if let inner = find(id, in: block.children) { return inner }
    }
    return nil
  }

  @Test func rows_on_trash_a_template_or_a_draft_plan_nothing() throws {
    let rows = [TestWorkspace.row("t")]
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-20", rows: rows, trashedAt: "2026-11-21T00:00:00.000Z"),
      TestWorkspace.page("template", type: "template", document: Document.write(rows)),
      TestWorkspace.page(
        "draft:day:2026-11-22", type: "draft", date: "2026-11-22", document: Document.write(rows)),
    ])
    let index = TodoIndex(workspace)
    #expect(index.plannedOn("t") == nil)
    #expect(index.rows(of: "t").isEmpty)
  }

  @Test func a_page_with_an_empty_trashed_stamp_is_live() throws {
    // The web's `Boolean(p.trashedAt)`: an empty string is no stamp.
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-20", rows: [TestWorkspace.row("t")], trashedAt: "")
    ])
    #expect(TodoIndex(workspace).plannedOn("t")?.value == "2026-11-20")
  }

  @Test func the_newest_day_wins() throws {
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-20", rows: [TestWorkspace.row("t")]),
      TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")]),
      TestWorkspace.day("2026-11-22", rows: [TestWorkspace.row("t")]),
    ])
    let index = TodoIndex(workspace)
    #expect(index.plannedOn("t")?.value == "2026-11-26")
    // Page order, not date order.
    #expect(index.rows(of: "t").map(\.pageId) == ["day:2026-11-20", "day:2026-11-26", "day:2026-11-22"])
    #expect(index.rows(of: "t").map { $0.day?.value } == ["2026-11-20", "2026-11-26", "2026-11-22"])
  }

  @Test func a_reference_row_plans_nothing() throws {
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day(
        "2026-11-26", rows: [TestWorkspace.row("a", role: "reference"), TestWorkspace.row("b", role: nil)]),
      TestWorkspace.day("2026-11-20", rows: [TestWorkspace.row("a")]),
    ])
    let index = TodoIndex(workspace)
    #expect(index.plannedOn("a")?.value == "2026-11-20")
    #expect(index.plannedOn("b") == nil)
    #expect(index.rows(of: "b").map(\.role) == [.reference])
  }

  @Test func a_role_that_is_not_exactly_plan_reads_as_a_reference() {
    #expect(RowRole(.string("plan")) == .plan)
    #expect(RowRole(.string("Plan")) == .reference)
    #expect(RowRole(.string("reference")) == .reference)
    #expect(RowRole(.number("1")) == .reference)
    #expect(RowRole(.null) == .reference)
    #expect(RowRole(nil) == .reference)
  }

  @Test func rows_come_in_document_order_nested_ones_after_their_parent() throws {
    let nested = TestWorkspace.row("parent", children: [TestWorkspace.row("child", role: "reference")])
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-26", rows: [nested, TestWorkspace.row("child")]),
      TestWorkspace.page("note", document: Document.write([TestWorkspace.row("child", role: "reference")])),
    ])
    let index = TodoIndex(workspace)
    let rows = index.rows(of: "child")
    #expect(rows.map(\.pageId) == ["day:2026-11-26", "day:2026-11-26", "note"])
    #expect(rows.map(\.role) == [.reference, .plan, .reference])
    #expect(rows.map { $0.day?.value } == ["2026-11-26", "2026-11-26", nil])
    #expect(index.rows(of: "parent").map(\.blockId) == ["row:parent:plan"])
  }

  @Test func a_plan_row_on_an_ordinary_page_plans_nothing() throws {
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.page("note", document: Document.write([TestWorkspace.row("t")]))
    ])
    #expect(TodoIndex(workspace).plannedOn("t") == nil)
    #expect(TodoIndex(workspace).rows(of: "t").count == 1)
  }

  @Test func a_document_that_does_not_parse_contributes_nothing() throws {
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.page("broken", type: "daily", date: "2026-11-25", document: "{not json"),
      TestWorkspace.page("object", type: "daily", date: "2026-11-24", document: #"{"a":1}"#),
      TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")]),
    ])
    let index = TodoIndex(workspace)
    #expect(index.plannedOn("t")?.value == "2026-11-26")
    #expect(index.rows(of: "t").count == 1)
  }

  @Test func ids_are_compared_by_code_units() throws {
    let composed = "caf\u{E9}", decomposed = "cafe\u{301}"
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row(composed)])
    ])
    let index = TodoIndex(workspace)
    #expect(index.plannedOn(composed)?.value == "2026-11-26")
    #expect(index.plannedOn(decomposed) == nil)
    #expect(index.rows(of: decomposed).isEmpty)
  }

  @Test func an_index_of_a_drawn_draft_sees_its_rows() throws {
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("today-one")]),
      TestWorkspace.day("2026-11-27", rows: []),
    ])
    let drawn = workspace.drawing(
      draft: Document.write([
        Block(
          id: "typed", type: "task",
          props: ["taskId": .string("fresh"), "role": .string("plan")],
          content: .array([.object(textRun("Fresh words"))]))
      ]), of: "day:2026-11-27")
    #expect(TodoIndex(drawn).plannedOn("fresh")?.value == "2026-11-27")
    #expect(TodoIndex(workspace).plannedOn("fresh") == nil)
  }
}
