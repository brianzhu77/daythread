import Testing

@testable import DaythreadCore

@Suite struct RowFactsTests {
  static func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  static func find(_ id: String, in blocks: [Block]) -> Block? {
    for block in blocks {
      if block.id.hasSameCodeUnits(as: id) { return block }
      if let inner = find(id, in: block.children) { return inner }
    }
    return nil
  }

  /// The facts of the row `blockId` of `pageId`, as a day screen asks for them.
  static func facts(
    _ workspace: Workspace, page pageId: String, block blockId: String, today: LocalDate
  ) throws -> RowFacts? {
    let page = try #require(workspace.page(pageId))
    let block = try #require(find(blockId, in: Document.blocks(page.document)))
    return RowFacts.of(
      row: block, pageDate: page.date, in: workspace, index: TodoIndex(workspace), today: today)
  }

  @Test func facts_are_the_webs() throws {
    let cases = try Fixtures.cases("rows/marks.json")
    #expect(cases.count == 26)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let today = try Self.day(try #require(entry["today"]?.stringValue))
      let facts = try #require(
        try Self.facts(
          workspace, page: try #require(entry["pageId"]?.stringValue),
          block: try #require(entry["blockId"]?.stringValue), today: today),
        "facts: \(name)")
      let marks = try #require(entry["marks"]?.objectValue, "marks: \(name)")

      // §11.2's order: Cancelled, the date tag, Since, the repeat, Reference, Moved to.
      var expected: [RowFacts.Mark] = []
      if let words = marks["cancelled"]?.stringValue {
        #expect(words == "Cancelled")
        expected.append(.cancelled)
      }
      if let tag = marks["dateTag"]?.objectValue {
        expected.append(
          .dateTag(try #require(tag["text"]?.stringValue), passed: try #require(tag["warn"]?.boolValue)))
      }
      if let words = marks["since"]?.stringValue { expected.append(.since(words)) }
      if let words = marks["repeat"]?.stringValue { expected.append(.repeats(name: words)) }
      if let words = marks["reference"]?.stringValue {
        #expect(words == "Reference")
        expected.append(.reference)
      }
      if let words = marks["movedTo"]?.stringValue { expected.append(.movedTo(words)) }

      #expect(facts.marks == expected, "marks: \(name)")
      #expect(facts.blockedBy == marks["blockedBy"]?.stringValue, "blockedBy: \(name)")
      #expect(facts.planForToday == (marks["planForToday"]?.stringValue == "active"), "planForToday: \(name)")
    }
  }

  private static let today = "2026-11-26"

  /// A day page of 2026-11-26 holding one row of `t`, and the workspace around it.
  private func workspace(
    status: String = "open", role: String? = "plan", paused: Bool = false
  ) throws -> Workspace {
    try TestWorkspace.make(
      pages: [TestWorkspace.day(Self.today, rows: [TestWorkspace.row("t", role: role)])],
      tasks: [TestWorkspace.task("t", status: status, paused: paused, createdOn: "2026-11-01")])
  }

  /// The facts of a row of `t` on today's page; the web's block holds `planDate` as a prop, which
  /// `TestWorkspace.row` does not set.
  private func facts(of workspace: Workspace, role: String? = "plan", planDate: String? = RowFactsTests.today) throws
    -> RowFacts
  {
    var props: JSONObject = ["taskId": .string("t")]
    if let role { props["role"] = .string(role) }
    if let planDate { props["planDate"] = .string(planDate) }
    let block = Block(id: "row:t", type: "task", props: props, children: [])
    let today = try Self.day(Self.today)
    return try #require(
      RowFacts.of(row: block, pageDate: today, in: workspace, index: TodoIndex(workspace), today: today))
  }

  @Test func a_done_row_shows_only_reference() throws {
    let reference = try facts(of: try workspace(status: "done", role: "reference"), role: "reference", planDate: "")
    #expect(reference.marks == [.reference])
    #expect(reference.planForToday == false)
    let plan = try facts(of: try workspace(status: "done"))
    #expect(plan.marks == [])
    #expect(plan.menu == nil)
  }

  @Test func a_cancelled_row_shows_cancelled() throws {
    let facts = try facts(of: try workspace(status: "cancelled"))
    #expect(facts.marks == [.cancelled])
    #expect(facts.menu?.groups.flatMap(\.items).map(\.title) == ["Restore"])
  }

  @Test func a_to_do_typed_and_not_saved_shows_no_marks_and_has_its_rows_menu() throws {
    // A drawn draft's new to-do: in the workspace the screen draws, open, planned on today's page, with no dates,
    // repeat or blocker.
    let facts = try facts(of: try workspace())
    #expect(facts.marks == [])
    #expect(facts.blockedBy == nil)
    #expect(facts.planForToday == false)
    #expect(facts.menu?.groups.first?.items.map(\.title) == ["Tomorrow · Fri, Nov 27", "Not today"])
    #expect(facts.spoken(regularWidth: true) == nil)
  }

  @Test func a_to_do_the_workspace_does_not_hold_has_no_facts() throws {
    let empty = try TestWorkspace.make(pages: [TestWorkspace.day(Self.today, rows: [TestWorkspace.row("t")])])
    let facts = try facts(of: empty)
    #expect(facts.marks == [] && facts.blockedBy == nil && facts.planForToday == false && facts.menu == nil)
  }

  @Test func only_a_task_block_has_facts() throws {
    let workspace = try workspace()
    let paragraph = Block(id: "p", type: "paragraph", props: ["taskId": .string("t")], children: [])
    let today = try Self.day(Self.today)
    #expect(
      RowFacts.of(row: paragraph, pageDate: today, in: workspace, index: TodoIndex(workspace), today: today) == nil)
  }

  @Test func reference_and_moved_to_are_regular_width_only() throws {
    // A history row: the to-do moved on to Friday.
    let moved = try TestWorkspace.make(
      pages: [
        TestWorkspace.day(Self.today, rows: [TestWorkspace.row("t")]),
        TestWorkspace.day("2026-11-27", rows: [TestWorkspace.row("t")]),
      ],
      tasks: [TestWorkspace.task("t")])
    let history = try facts(of: moved)
    #expect(history.marks == [.movedTo("Moved to Fri 11/27")])
    #expect(history.marks(regularWidth: true) == [.movedTo("Moved to Fri 11/27")])
    #expect(history.marks(regularWidth: false) == [])
    #expect(history.spoken(regularWidth: false) == nil)
    #expect(history.spoken(regularWidth: true) == "Moved to Fri 11/27")

    let reference = try facts(of: try workspace(role: "reference"), role: "reference", planDate: "")
    #expect(reference.marks(regularWidth: true) == [.reference])
    #expect(reference.marks(regularWidth: false) == [])
    #expect(reference.planForToday)
  }

  @Test func a_paused_to_do_has_no_mark_of_its_own() throws {
    #expect(try facts(of: try workspace(paused: true)).marks == [])
  }

  @Test func the_spoken_marks_are_one_line_in_order() throws {
    // Due tomorrow, carried since Nov 3 (today's draft applied it, so today's row is no new choice), a weekly
    // repeat, and one blocker.
    var task = try #require(TestWorkspace.task("t", createdOn: "2026-11-03").objectValue)
    task["deadlineOn"] = .string("2026-11-27")
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day(Self.today, rows: [TestWorkspace.row("t"), TestWorkspace.row("b")]),
        TestWorkspace.draft(of: "day:\(Self.today)", applied: ["t"]),
      ],
      tasks: [.object(task), TestWorkspace.task("b", title: "Buy paint", createdOn: "2026-11-03")],
      rest: [
        ("todoRepeats", .array([TestWorkspace.repeatRecord(taskId: "t")])),
        ("links", .array([TestWorkspace.link(blocked: "t", blocker: "b")])),
      ])
    let facts = try facts(of: workspace)
    #expect(facts.marks.map(\.words) == ["Due tomorrow", "Since Nov 3", "Repeats every week"])
    #expect(facts.spoken(regularWidth: false) == "Due tomorrow, Since Nov 3, Repeats every week, Blocked by Buy paint")
  }

  @Test func blocked_by_alone_is_spoken() throws {
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day(Self.today, rows: [TestWorkspace.row("t"), TestWorkspace.row("b")])],
      tasks: [TestWorkspace.task("t"), TestWorkspace.task("b", title: "Buy paint")],
      rest: [("links", .array([TestWorkspace.link(blocked: "t", blocker: "b")]))])
    #expect(try facts(of: workspace).spoken(regularWidth: false) == "Blocked by Buy paint")
  }

  @Test func the_date_tag_of_a_reference_row_is_worded_against_today() throws {
    // `pageDate: planDate || today`: a reference row has no plan day, so a Due date a day past reads "Was due Wed".
    var task = try #require(TestWorkspace.task("t").objectValue)
    task["deadlineOn"] = .string("2026-11-25")
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-30", rows: [TestWorkspace.row("t", role: "reference")])],
      tasks: [.object(task)])
    let facts = try facts(of: workspace, role: "reference", planDate: nil)
    #expect(facts.marks == [.dateTag("Was due Wed", passed: true), .reference])
  }

  @Test func since_and_moved_to_read_the_rows_plan_date_not_the_pages() throws {
    // The page is today's and the to-do is carried, but the row's own `planDate` is not today: no `Since`.
    let carried = try TestWorkspace.make(
      pages: [
        TestWorkspace.day(Self.today, rows: [TestWorkspace.row("t")]),
        TestWorkspace.draft(of: "day:\(Self.today)", applied: ["t"]),
      ],
      tasks: [TestWorkspace.task("t", createdOn: "2026-11-03")])
    #expect(try facts(of: carried).marks == [.since("Since Nov 3")])
    #expect(try facts(of: carried, planDate: "2026-11-25").marks == [])
    #expect(try facts(of: carried, planDate: "").marks == [])
    #expect(try facts(of: carried, planDate: nil).marks == [])

    // A plan row with no plan day of its own is no history row either.
    let moved = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-27", rows: [TestWorkspace.row("t")])], tasks: [TestWorkspace.task("t")])
    #expect(try facts(of: moved, planDate: "").marks == [])
  }
}
