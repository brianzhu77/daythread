import Testing

@testable import DaythreadCore

@Suite struct DraftPlanningTests {
  @Test func planning_is_the_webs() throws {
    let cases = try Fixtures.cases("draft/planning.json")
    #expect(cases.count == 13)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let blocks = Document.blocks(try #require(entry["document"]?.stringValue, "document: \(name)"))
      let tasks = Set((entry["tasks"]?.arrayValue ?? []).compactMap(\.stringValue).map(CodeUnitKey.init))
      let range = DraftPlanning.range(of: blocks)
      #expect(range.lowerBound == entry["range"]?.objectValue?["start"]?.intValue, "start: \(name)")
      #expect(range.upperBound == entry["range"]?.objectValue?["end"]?.intValue, "end: \(name)")
      let end = DraftPlanning.end(of: blocks, tasks: tasks)
      #expect(end == entry["planningEnd"]?.intValue, "planningEnd: \(name)")
      #expect(
        DraftPlanning.moreOpenAfter(in: blocks, planningEnd: end) == entry["moreOpenAfter"]?.intValue,
        "moreOpenAfter: \(name)")
    }
  }

  @Test func same_words_are_the_webs() throws {
    let cases = try Fixtures.cases("draft/same-words.json")
    #expect(cases.count == 15)
    for (number, entry) in cases.enumerated() {
      let name = "case \(number)"
      let text = try #require(entry["text"]?.stringValue, "text: \(name)")
      let expected = try #require(entry["words"]?.stringValue, "words: \(name)")
      // Swift's `==` would take a decomposed `é` for a composed one; the web's `===` does not.
      #expect(
        sameWords(text).hasSameCodeUnits(as: expected),
        "sameWords: \(name), \(text.debugDescription) gave \(sameWords(text).debugDescription)")
    }
  }

  // MARK: Where an item sits

  private static func item(
    _ anchor: String, place: String = "after", taskId: String? = nil, block: String? = nil, id: String = "i",
    state: String = "open", row: String? = nil
  ) throws -> DayDraft.Item {
    var fields = [#""id":"\#(id)""#, #""anchor":"\#(anchor)""#, #""place":"\#(place)""#, #""state":"\#(state)""#]
    if let taskId { fields.append(#""taskId":"\#(taskId)""#) }
    if let block { fields.append(#""block":\#(block)"#) }
    if let row { fields.append(#""row":"\#(row)""#) }
    let draft = try #require(DayDraft(document: #"{"status":"ready","items":[{\#(fields.joined(separator: ","))}]}"#))
    return try #require(draft.items.first)
  }

  private static func lineBlock(_ type: String, _ words: String = "A line") -> String {
    #"{"id":"n","type":"\#(type)","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
  }

  private static func heading(_ id: String, level: Int = 2) -> Block {
    Block(id: id, type: "heading", props: ["level": .number(String(level))])
  }

  private static func plain(_ id: String, _ type: String, words: String = "") -> Block {
    Block(id: id, type: type, content: .array([.object(textRun(words))]))
  }

  private static func row(_ id: String, task: String, words: String = "") -> Block {
    Block(
      id: id, type: "task", props: ["taskId": .string(task), "role": .string("plan")],
      content: .array([.object(textRun(words))]))
  }

  /// A planning section and a reflection section after it.
  private static let page: [Block] = [
    heading("plan"), row("empty-row", task: "t1"), row("worded-row", task: "t2", words: "Pay rent"),
    plain("empty-paragraph", "paragraph"), plain("empty-bullet", "bulletListItem"), row("empty-row-2", task: "t3"),
    heading("reflection"), plain("note", "paragraph", words: "Went well"),
  ]
  private static let tasks = Set(["t1", "t2", "t3"].map(CodeUnitKey.init))

  private static func place(_ item: DayDraft.Item, in blocks: [Block] = page) -> DraftPlacement? {
    DraftPlanning.place(item, in: blocks, tasks: tasks)
  }

  @Test func an_item_fills_only_an_empty_slot_of_its_kind() throws {
    let todo = { (anchor: String) in try Self.item(anchor, place: "fill", taskId: "t9") }
    #expect(Self.place(try todo("empty-row")) == DraftPlacement(kind: .fill, index: 1, anchorId: "empty-row"))
    #expect(Self.place(try todo("worded-row")) == DraftPlacement(kind: .after, index: 3, anchorId: "worded-row"))
    #expect(Self.place(try todo("empty-paragraph")) == DraftPlacement(kind: .after, index: 4, anchorId: "empty-paragraph"))

    let newTodo = try Self.item("empty-row-2", place: "fill", block: Self.lineBlock("task", "Call"))
    #expect(Self.place(newTodo) == DraftPlacement(kind: .fill, index: 5, anchorId: "empty-row-2"))

    let line = { (anchor: String) in try Self.item(anchor, place: "fill", block: Self.lineBlock("paragraph")) }
    #expect(Self.place(try line("empty-bullet")) == DraftPlacement(kind: .fill, index: 4, anchorId: "empty-bullet"))
    #expect(Self.place(try line("empty-paragraph")) == DraftPlacement(kind: .fill, index: 3, anchorId: "empty-paragraph"))
    #expect(Self.place(try line("empty-row")) == DraftPlacement(kind: .after, index: 2, anchorId: "empty-row"))

    let after = try Self.item("empty-bullet", place: "after", block: Self.lineBlock("paragraph"))
    #expect(Self.place(after) == DraftPlacement(kind: .after, index: 5, anchorId: "empty-bullet"), "place after never fills")
  }

  @Test func no_anchor_a_gone_anchor_or_one_outside_go_to_the_planning_end() throws {
    // The planning end: after the heading and the run of rows of known to-dos directly under it.
    let expected = DraftPlacement(kind: .after, index: 3, anchorId: "worded-row")
    for anchor in ["", "gone", "note", "reflection"] {
      #expect(Self.place(try Self.item(anchor, taskId: "t9")) == expected, "anchor: \(anchor.debugDescription)")
    }
    let unknownRow = [Self.heading("plan"), Self.row("r", task: "unknown")]
    let end = DraftPlanning.place(try Self.item("gone", taskId: "t9"), in: unknownRow, tasks: Self.tasks)
    #expect(end == DraftPlacement(kind: .after, index: 1, anchorId: "plan"), "an unknown to-do's row is not passed")
  }

  @Test func nothing_safe_is_nil() throws {
    // A heading whose level is not a number is never the outermost: the planning part is empty, and the end falls
    // outside it.
    let blocks = [Self.heading("odd", level: 1), Self.row("r", task: "t1")]
    var odd = blocks
    odd[0].props["level"] = .string("x")
    #expect(DraftPlanning.range(of: odd) == 0..<0)
    #expect(DraftPlanning.place(try Self.item("gone", taskId: "t1"), in: odd, tasks: Self.tasks) == nil)
  }

  @Test func a_heading_level_reads_as_javascripts_number() {
    // The next heading, of level 2, closes the first one's section only when its level is at least 2.
    func rangeEnd(_ level: JSONValue?) -> Int {
      var first = Block(id: "a", type: "heading")
      if let level { first.props["level"] = level }
      let blocks = [
        first, Block(id: "r", type: "task", props: ["taskId": .string("t")]),
        Block(id: "b", type: "heading", props: ["level": .number("2")]), Block(id: "c", type: "paragraph"),
      ]
      return DraftPlanning.range(of: blocks).upperBound
    }
    let open = 4, closed = 2, none = 0
    #expect(rangeEnd(nil) == open, "absent is 1")
    #expect(rangeEnd(.null) == open)
    #expect(rangeEnd(.string("2")) == closed, "a string is a number")
    #expect(rangeEnd(.string(" 0x2 ")) == closed)
    #expect(rangeEnd(.string("0b11")) == closed)
    #expect(rangeEnd(.string("1e1")) == closed)
    #expect(rangeEnd(.string(".5e1")) == closed)
    #expect(rangeEnd(.string("Infinity")) == none, "no level is below Infinity, so no heading starts it")
    #expect(rangeEnd(.string("-Infinity")) == open)
    #expect(rangeEnd(.string("")) == open, "an empty string is 0")
    #expect(rangeEnd(.bool(false)) == open)
    #expect(rangeEnd(.bool(true)) == open)
    #expect(rangeEnd(.array([])) == open)
    #expect(rangeEnd(.array([.number("3")])) == closed)
    #expect(rangeEnd(.array([.number("3"), .number("4")])) == none, "NaN is never the outermost")
    #expect(rangeEnd(.object(JSONObject())) == none)
    #expect(rangeEnd(.string("abc")) == none)
    #expect(rangeEnd(.string("1_0")) == none)
    #expect(rangeEnd(.string("0x")) == none)
    #expect(rangeEnd(.string("inf")) == none)
  }

  @Test func the_empty_line_and_the_row_are_the_webs() {
    let text = JSONValue.array([.object(textRun("  "))])
    #expect(Block(id: "a", type: "paragraph", content: text).isEmptyLine)
    #expect(Block(id: "a", type: "paragraph", content: .array([])).isEmptyLine)
    #expect(Block(id: "a", type: "paragraph").isEmptyLine)
    #expect(!Block(id: "a", type: "paragraph", content: .array([.object(textRun("x"))])).isEmptyLine)
    #expect(!Block(id: "a", type: "heading").isEmptyLine)
    #expect(!Block(id: "a", type: "image").isEmptyLine)
    #expect(!Block(id: "a", type: "paragraph", children: [Block(id: "b", type: "paragraph")]).isEmptyLine)
    #expect(!Block(id: "a", type: "paragraph", content: .array([.object(["type": .string("pageRef")])])).isEmptyLine)
    #expect(!Block(id: "a", type: "paragraph", content: .array([.array([])])).isEmptyLine, "an array is an object to `typeof`")
    #expect(Block(id: "a", type: "paragraph", content: .array([.null, .string("")])).isEmptyLine)
    #expect(Block(id: "a", type: "task", props: ["taskId": .string("")]).isTaskRow)
    #expect(!Block(id: "a", type: "task", props: ["taskId": .number("1")]).isTaskRow)
    #expect(!Block(id: "a", type: "paragraph", props: ["taskId": .string("x")]).isTaskRow)
    let nested = Block(id: "a", type: "bulletListItem", children: [Block(id: "b", type: "task", children: [Block(id: "c", type: "paragraph")])])
    #expect(nested.flattened.map(\.id) == ["a", "b", "c"])
  }

  // MARK: Among the rows applied

  @Test func an_applied_item_goes_in_the_order_offered() throws {
    // Three items on one anchor; the first and the third are applied and the second goes between them.
    let rowOne = Block(
      id: "row-1", type: "task", props: ["taskId": .string("t1")], content: .array([.object(textRun("One"))]))
    let rowThree = Block(id: "typed", type: "paragraph", content: .array([.object(textRun("Three."))]))
    let blocks = [Self.heading("plan"), Self.plain("anchor", "paragraph", words: "x"), rowOne, rowThree]
    let draft = try #require(
      DayDraft(
        document: """
          {"status":"ready","items":[\
          {"id":"a","anchor":"anchor","state":"applied","taskId":"t1","row":"row-1"},\
          {"id":"b","anchor":"anchor","state":"open","taskId":"t2"},\
          {"id":"c","anchor":"anchor","state":"applied","block":\(Self.lineBlock("paragraph", "three"))}]}
          """))
    let item = draft.items[1]
    let placed = try #require(Self.place(item, in: blocks))
    #expect(placed == DraftPlacement(kind: .after, index: 2, anchorId: "anchor"))
    let among = DraftPlanning.amongApplied(item, at: placed, in: blocks, draft: draft)
    #expect(among == DraftPlacement(kind: .after, index: 3, anchorId: "row-1"), "after row-1, before the typed line")
  }

  @Test func an_empty_slot_is_filled_only_by_the_first_of_the_group() throws {
    let blocks = [
      Self.heading("plan"), Self.plain("slot", "paragraph"),
      Block(id: "row-1", type: "task", props: ["taskId": .string("t1")], content: .array([.object(textRun("One"))])),
    ]
    let draft = try #require(
      DayDraft(
        document: """
          {"status":"ready","items":[\
          {"id":"a","anchor":"slot","state":"applied","taskId":"t1","row":"row-1"},\
          {"id":"b","anchor":"slot","place":"fill","state":"open","block":\(Self.lineBlock("paragraph", "two"))}]}
          """))
    let item = draft.items[1]
    let placed = try #require(Self.place(item, in: blocks))
    #expect(placed.kind == .fill)
    let among = DraftPlanning.amongApplied(item, at: placed, in: blocks, draft: draft)
    #expect(among == DraftPlacement(kind: .after, index: 3, anchorId: "row-1"))

    let alone = try #require(DayDraft(document: #"{"status":"ready","items":[]}"#))
    #expect(DraftPlanning.amongApplied(item, at: placed, in: blocks, draft: alone) == placed, "nothing applied: the slot")
  }

  // MARK: What a to-do is, and where it is planned

  @Test func is_planned_after_reads_plan_rows_of_later_day_pages() throws {
    let day = try #require(LocalDate("2026-11-26"))
    func planned(_ pages: [JSONValue]) throws -> Bool {
      TodoIndex(try TestWorkspace.make(pages: pages, tasks: [TestWorkspace.task("t")])).isPlanned("t", after: day)
    }
    #expect(try planned([TestWorkspace.day("2026-11-27", rows: [TestWorkspace.row("t")])]))
    #expect(try !planned([TestWorkspace.day("2026-11-27", rows: [TestWorkspace.row("t", role: "reference")])]))
    #expect(try !planned([TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")])]))
    #expect(try !planned([TestWorkspace.day("2026-11-25", rows: [TestWorkspace.row("t")])]))
    #expect(
      try !planned([
        TestWorkspace.day("2026-11-27", rows: [TestWorkspace.row("t")], trashedAt: "2026-11-28T00:00:00.000Z")
      ]))
    #expect(try !planned([TestWorkspace.day("2026-11-27", rows: [TestWorkspace.row("other")])]))
    #expect(try !planned([]))
  }

  @Test func a_to_do_is_eligible_when_open_and_not_set_aside() throws {
    func eligible(status: String, paused: Bool) throws -> Bool {
      let workspace = try TestWorkspace.make(tasks: [TestWorkspace.task("t", status: status, paused: paused)])
      return try #require(workspace.task("t")).eligibleForADraft
    }
    #expect(try eligible(status: "open", paused: false))
    #expect(try !eligible(status: "open", paused: true))
    #expect(try !eligible(status: "done", paused: false))
    #expect(try !eligible(status: "cancelled", paused: false))
  }
}
