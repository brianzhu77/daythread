import Testing

@testable import DaythreadCore

@Suite struct DraftViewTests {
  // MARK: The shared cases

  @Test func views_are_the_webs() throws {
    let cases = try Fixtures.cases("draft/views.json")
    #expect(cases.count == 53)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try Fixtures.workspace(of: entry, name)
      let pageId = try #require(entry["pageId"]?.stringValue, "pageId: \(name)")
      let page = try #require(workspace.page(pageId), "page: \(name)")
      let view = DraftView.of(page: page, in: workspace, index: TodoIndex(workspace))
      guard let expected = entry["view"]?.objectValue else {
        #expect(view == nil, "no view: \(name)")
        continue
      }
      let read = try #require(view, "view: \(name)")
      #expect(read.status == Self.status(expected["status"]), "status: \(name)")
      let items = (expected["items"]?.arrayValue ?? []).compactMap(\.objectValue)
      #expect(read.suggestions.map(\.id) == items.map { $0["id"]?.stringValue ?? "" }, "ids: \(name)")
      for (suggestion, item) in zip(read.suggestions, items) {
        let label = "\(name) / \(suggestion.id)"
        let block = try #require(item["block"]?.objectValue, "block: \(label)")
        #expect(suggestion.kind == (item["kind"]?.stringValue == "fill" ? .fill : .after), "kind: \(label)")
        #expect(suggestion.anchorId == item["anchorId"]?.stringValue, "anchorId: \(label)")
        #expect(suggestion.mark == Self.mark(block["type"]), "mark: \(label)")
        #expect(
          suggestion.words.hasSameCodeUnits(as: InlineText.plain(block["content"], pageDate: nil)), "words: \(label)")
        #expect(suggestion.taskId == item["taskId"]?.stringValue, "taskId: \(label)")
        #expect(suggestion.since?.value == item["since"]?.stringValue, "since: \(label)")
        #expect(suggestion.skipped == (try Fixtures.days(item["skipped"], label)), "skipped: \(label)")
      }
      let moreOpen = (expected["moreOpen"]?.arrayValue ?? []).compactMap(\.objectValue)
      #expect(read.moreOpen.map(\.taskId) == moreOpen.map { $0["taskId"]?.stringValue ?? "" }, "moreOpen: \(name)")
      #expect(read.moreOpen.map(\.title) == moreOpen.map { $0["title"]?.stringValue ?? "" }, "moreOpen titles: \(name)")
      #expect(
        read.moreOpen.map(\.since?.value) == moreOpen.map { $0["since"]?.stringValue }, "moreOpen since: \(name)")
      #expect(read.planningEndId == expected["planningEndId"]?.stringValue, "planningEndId: \(name)")
      #expect(read.moreOpenAfterId == expected["moreOpenAfterId"]?.stringValue, "moreOpenAfterId: \(name)")
    }
  }

  @Test func skipped_days_are_the_webs() throws {
    let cases = try Fixtures.cases("draft/skipped.json")
    #expect(cases.count == 10)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try Fixtures.workspace(of: entry, name)
      let day = try #require(entry["day"]?.stringValue.flatMap(LocalDate.init), "day: \(name)")
      var expected: [CodeUnitKey: [LocalDate]] = [:]
      for pair in entry["skipped"]?.arrayValue ?? [] {
        let taskId = try #require(pair.arrayValue?.first?.stringValue, "taskId: \(name)")
        expected[CodeUnitKey(taskId)] = try Fixtures.days(pair.arrayValue?.last, name)
      }
      #expect(skippedDays(in: workspace, index: TodoIndex(workspace), before: day) == expected, "skipped: \(name)")
    }
  }

  @Test func skipped_labels_are_the_webs() throws {
    let cases = try Fixtures.cases("draft/skipped-labels.json")
    #expect(cases.count == 7)
    for entry in cases {
      let days = try Fixtures.days(entry["days"], "days")
      let name = days.map(\.value).joined(separator: ", ")
      let on = try #require(entry["on"]?.stringValue.flatMap(LocalDate.init), "on: \(name)")
      let label = SkippedLabel.of(days, on: on)
      #expect(label.text == entry["text"]?.stringValue, "text: \(name) on \(on.value)")
      #expect(label.full == entry["full"]?.stringValue, "full: \(name) on \(on.value)")
    }
  }

  // MARK: What a suggestion says

  @Test func a_suggestions_detail_and_spoken_words() throws {
    let today = "day:2026-11-26"
    let skip = #"{"status":"ready","items":[{"id":"s","anchor":"","taskId":"ferns","state":"skipped"}],"moreOpen":[]}"#
    let items = """
      {"status":"ready","items":[\
      {"id":"a","anchor":"h","place":"after","taskId":"dentist","state":"open"},\
      {"id":"b","anchor":"h","place":"after","taskId":"ferns","state":"open"},\
      {"id":"c","anchor":"h","place":"after","state":"open",\
      "block":{"id":"n","type":"bulletListItem","props":{},\
      "content":[{"type":"text","text":"Pack the charger","styles":{}}],"children":[]}}],"moreOpen":[]}
      """
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-21", rows: [Self.heading("h21")]),
        TestWorkspace.page("draft:day:2026-11-21", type: "draft", parentId: "day:2026-11-21", document: skip),
        TestWorkspace.day("2026-11-22", rows: [Self.heading("h22")]),
        TestWorkspace.page("draft:day:2026-11-22", type: "draft", parentId: "day:2026-11-22", document: skip),
        TestWorkspace.day("2026-11-26", rows: [Self.heading("h")]),
        TestWorkspace.page("draft:\(today)", type: "draft", parentId: today, document: items),
      ],
      tasks: [
        TestWorkspace.task("dentist", title: "Call the dentist", createdOn: "2026-11-19"),
        TestWorkspace.task("ferns", title: "Water the ferns", createdOn: "2026-11-01"),
      ])
    let page = try #require(workspace.page(today))
    let view = try #require(DraftView.of(page: page, in: workspace, index: TodoIndex(workspace)))
    #expect(view.suggestions.map(\.id) == ["a", "b", "c"])

    let dentist = view.suggestions[0]
    #expect(dentist.detail == "Thu 11/19")
    #expect(dentist.spokenDetail == nil, "the age is read as shown")
    #expect(dentist.spoken == "Suggestion, Call the dentist, Thu 11/19")

    let ferns = view.suggestions[1]
    #expect(ferns.skipped.map(\.value) == ["2026-11-21", "2026-11-22"])
    #expect(ferns.detail == "skipped Sat, Sun")
    #expect(ferns.spokenDetail == "skipped Sat 11/21, Sun 11/22")
    #expect(ferns.spoken == "Suggestion, Water the ferns, skipped Sat 11/21, Sun 11/22")

    let charger = view.suggestions[2]
    #expect(charger.mark == .bullet)
    #expect(charger.since == nil)
    #expect(charger.detail == nil)
    #expect(charger.spokenDetail == nil)
    #expect(charger.spoken == "Suggestion, Pack the charger")
    #expect(charger.applyLabel == "Apply Pack the charger")
    #expect(charger.skipLabel == "Skip Pack the charger")
  }

  @Test func a_draft_on_a_drawn_page_reads_his_unsaved_words() throws {
    let today = "day:2026-11-26"
    let items = """
      {"status":"ready","items":[\
      {"id":"a","anchor":"anchor","place":"after","taskId":"t","state":"open"},\
      {"id":"b","anchor":"anchor","place":"after","state":"open",\
      "block":{"id":"n","type":"bulletListItem","props":{},\
      "content":[{"type":"text","text":"Stretch","styles":{}}],"children":[]}}],"moreOpen":[]}
      """
    let anchor = Block(id: "anchor", type: "paragraph", content: .array([.object(textRun("Morning"))]))
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-26", rows: [Self.heading("h"), anchor]),
        TestWorkspace.page("draft:\(today)", type: "draft", parentId: today, document: items),
      ],
      tasks: [TestWorkspace.task("t", title: "Call the bank", createdOn: "2026-11-20")])
    let storedPage = try #require(workspace.page(today))
    let stored = try #require(DraftView.of(page: storedPage, in: workspace, index: TodoIndex(workspace)))
    #expect(stored.suggestions.map(\.id) == ["a", "b"])

    let typedLine = Block(id: "typed", type: "paragraph", content: .array([.object(textRun("Coffee"))]))
    let typedRow = Block(
      id: "row", type: "task", props: ["taskId": .string("t"), "role": .string("plan")],
      content: .array([.object(textRun("Call the bank"))]))
    let drawn = workspace.drawing(draft: Document.write([Self.heading("h"), typedLine, anchor, typedRow]), of: today)
    let drawnPage = try #require(drawn.page(today))
    let view = try #require(DraftView.of(page: drawnPage, in: drawn, index: TodoIndex(drawn)))
    #expect(view.suggestions.map(\.id) == ["b"], "the to-do he typed a row of is not suggested")
    #expect(view.suggestions.first?.kind == .after)
    #expect(view.suggestions.first?.anchorId == "anchor", "a typed line above the anchor moves nothing else")
    #expect(view.planningEndId == stored.planningEndId)
  }

  // MARK: Branches no shared case reaches

  @Test func a_line_carried_from_the_row_a_decided_item_became_is_decided_while_it_reads_its_words() throws {
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-25", rows: [Self.heading("h25")]),
      Self.draftPage(of: "day:2026-11-25", [Self.line("x", "Pack the bags", state: "applied", extra: #","row":"b1""#)]),
      TestWorkspace.day("2026-11-26", rows: [Self.heading("h")]),
      Self.draftPage(
        of: "day:2026-11-26",
        [
          Self.line("same", "Pack the  bags.", extra: #","from":"b1""#),
          Self.line("other", "Call the bank", extra: #","from":"b1""#),
        ]),
    ])
    #expect(try Self.shown(in: workspace) == ["other"], "the row no longer reads the decided item's words")
  }

  @Test func an_older_recipes_line_is_known_by_its_words_against_a_line_that_could_have_been_in_its_draft() throws {
    // Today's draft is of recipe 2: its lines say nowhere where they came from. The decided lines do.
    let workspace = try TestWorkspace.make(pages: [
      Self.page("notes-early", type: "document", createdAt: "2026-11-20T08:00:00.000Z", blocks: ["early"]),
      Self.page("notes-late", type: "document", createdAt: "2026-11-27T08:00:00.000Z", blocks: ["late"]),
      Self.page("day:2026-11-24", type: "daily", date: "2026-11-24", blocks: ["same-day"]),
      Self.page("day:2026-11-27", type: "daily", date: "2026-11-27", blocks: ["next-day"]),
      TestWorkspace.day("2026-11-25", rows: [Self.heading("h25")]),
      Self.draftPage(
        of: "day:2026-11-25",
        [
          Self.line("x1", "Pack the bags", state: "skipped", extra: #","from":"gone""#),
          Self.line("x2", "Call the bank", state: "skipped", extra: #","from":"late""#),
          Self.line("x3", "Water the ferns", state: "skipped", extra: #","from":"early""#),
          Self.line("x4", "Book the flights", state: "skipped", extra: #","from":"same-day""#),
          Self.line("x5", "Pay the rent", state: "skipped", extra: #","from":"next-day""#),
        ]),
      TestWorkspace.day("2026-11-26", rows: [Self.heading("h")]),
      Self.draftPage(
        of: "day:2026-11-26", recipe: 2,
        [
          Self.line("i1", "Pack the bags"), Self.line("i2", "Call the bank"), Self.line("i3", "Water the ferns"),
          Self.line("i4", "Book the flights"), Self.line("i5", "Pay the rent"),
        ]),
    ])
    #expect(
      try Self.shown(in: workspace) == ["i2", "i5"],
      "a source no page holds counts as before; a page that is not a day's reads its creation day")
  }

  @Test func a_line_known_by_where_it_came_from_meets_an_older_recipes_decision_by_its_words() throws {
    // The decided items are of recipe 4 and have no `from`: known by their words, against today's carried lines.
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-25", rows: [Self.heading("h25")]),
      Self.draftPage(of: "day:2026-11-25", recipe: 4, [Self.line("x1", "Call the bank", state: "skipped")]),
      // Its day page is gone: the day it was made for is unknown.
      Self.draftPage(of: "day:2026-11-24", recipe: 4, [Self.line("x2", "Pack the bags", state: "skipped")]),
      Self.page("day:2026-11-26", type: "daily", date: "2026-11-26", blocks: ["h", "b1", "b2"]),
      Self.draftPage(
        of: "day:2026-11-26",
        [
          Self.line("i1", "Pack the bags", extra: #","from":"b1""#),
          Self.line("i2", "Call the bank", extra: #","from":"b2""#),
        ]),
    ])
    #expect(
      try Self.shown(in: workspace) == ["i2"],
      "a line written on today's page could not have been in yesterday's draft; a draft of no known day could")
  }

  @Test func decided_elsewhere_reads_an_item_as_an_older_recipes_when_the_page_has_no_draft_of_its_own() throws {
    let decided = Self.draftPage(
      of: "day:2026-11-25", recipe: 2,
      [
        Self.line("x", "Pack the bags", state: "skipped"),
        Self.line("y", "Call the bank", state: "skipped", extra: #","from":"b1""#),
      ])
    let item = try #require(
      DayDraft(document: #"{"status":"ready","recipe":5,"items":[\#(Self.line("i", "Pack the bags"))]}"#)?.items.first)
    // Carried from the line `y` was: without a block it still is not decided elsewhere.
    let wordless = try #require(
      DayDraft(document: #"{"status":"ready","items":[{"id":"w","state":"open","from":"b1"}]}"#)?.items.first)
    func decidedElsewhere(withOwnDraft: Bool) throws -> (DayDraft.Item) -> Bool {
      var pages = [TestWorkspace.day("2026-11-26", rows: []), decided]
      if withOwnDraft { pages.append(Self.draftPage(of: "day:2026-11-26", [])) }
      let workspace = try TestWorkspace.make(pages: pages)
      let page = try #require(workspace.page("day:2026-11-26"))
      return DaythreadCore.decidedElsewhere(in: workspace, index: TodoIndex(workspace), dayPage: page)
    }
    #expect(try decidedElsewhere(withOwnDraft: false)(item), "no draft of its own: known by its words")
    #expect(try !decidedElsewhere(withOwnDraft: true)(item), "its own draft's recipe 5: known by where it came from")
    #expect(try !decidedElsewhere(withOwnDraft: false)(wordless), "an item with no block is never decided elsewhere")
  }

  @Test func only_a_stored_ready_or_failed_draft_takes_items_over() throws {
    func draft(_ day: String, _ status: String, took: String) -> JSONValue {
      TestWorkspace.page(
        "draft:day:\(day)", type: "draft", parentId: "day:\(day)",
        document: #"{"status":"\#(status)","items":[{"id":"i","state":"open","took":["\#(took)"]}]}"#)
    }
    let workspace = try TestWorkspace.make(pages: [
      draft("2026-11-24", "ready", took: "day:2026-11-20 a"),
      draft("2026-11-25", "failed", took: "day:2026-11-21 b"),
      draft("2026-11-26", "preparing", took: "day:2026-11-22 c"),
      draft("2026-11-27", "drafting", took: "day:2026-11-23 d"),
    ])
    #expect(takenOver(TodoIndex(workspace)) == [CodeUnitKey("day:2026-11-20 a"), CodeUnitKey("day:2026-11-21 b")])
  }

  @Test func skips_count_only_on_earlier_live_day_pages_and_all_count_when_it_was_never_taken() throws {
    func skip(_ id: String, parent: String?) -> JSONValue {
      TestWorkspace.page(
        id, type: "draft", parentId: parent,
        document: #"{"status":"ready","items":[{"id":"s","taskId":"t","state":"skipped"}]}"#)
    }
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-20", rows: []), skip("draft:day:2026-11-20", parent: "day:2026-11-20"),
        TestWorkspace.day("2026-11-22", rows: []), skip("draft:day:2026-11-22", parent: "day:2026-11-22"),
        TestWorkspace.day("2026-11-23", rows: [], trashedAt: "2026-11-24T00:00:00.000Z"),
        skip("draft:day:2026-11-23", parent: "day:2026-11-23"),
        TestWorkspace.day("2026-11-26", rows: []), skip("draft:day:2026-11-26", parent: "day:2026-11-26"),
        skip("draft:loose", parent: nil),
      ],
      tasks: [TestWorkspace.task("t")])
    let day = try #require(LocalDate("2026-11-26"))
    let skipped = skippedDays(in: workspace, index: TodoIndex(workspace), before: day)
    #expect(skipped == [CodeUnitKey("t"): [LocalDate("2026-11-20"), LocalDate("2026-11-22")].compactMap { $0 }])
  }

  @Test func a_page_with_no_date_reads_no_later_plan_and_no_skipped_days() throws {
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-20", rows: []),
        TestWorkspace.page(
          "draft:day:2026-11-20", type: "draft", parentId: "day:2026-11-20",
          document: #"{"status":"ready","items":[{"id":"s","taskId":"t","state":"skipped"}]}"#),
        TestWorkspace.day("2026-11-30", rows: [TestWorkspace.row("t")]),
        Self.page("notes", type: "document", blocks: ["h"]),
        Self.draftPage(of: "notes", [#"{"id":"i","anchor":"h","place":"after","taskId":"t","state":"open"}"#]),
      ],
      tasks: [TestWorkspace.task("t", createdOn: "2026-11-01")])
    let page = try #require(workspace.page("notes"))
    let view = try #require(DraftView.of(page: page, in: workspace, index: TodoIndex(workspace)))
    #expect(view.suggestions.map(\.id) == ["i"], "planned on a later day, but the page has no day to be later than")
    #expect(view.suggestions.first?.skipped == [])
    #expect(view.suggestions.first?.detail == "Sun 11/1")
  }

  @Test func a_suggestion_with_no_safe_place_or_nothing_to_show_is_not_shown() throws {
    // A heading whose level is no number leaves no planning part: nowhere is safe.
    var odd = Self.heading("odd")
    odd.props["level"] = .string("x")
    let nowhere = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-26", rows: [odd, TestWorkspace.row("t1")]),
        Self.draftPage(
          of: "day:2026-11-26", [#"{"id":"nowhere","anchor":"gone","place":"after","taskId":"t2","state":"open"}"#]),
      ],
      tasks: [TestWorkspace.task("t1"), TestWorkspace.task("t2")])
    #expect(try Self.shown(in: nowhere) == [])

    // An item with neither a to-do nor a block, with a place to go.
    let nothing = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-26", rows: [Self.heading("h")]),
      Self.draftPage(
        of: "day:2026-11-26",
        [#"{"id":"nothing","anchor":"h","place":"after","state":"open"}"#, Self.line("words", "Stretch")]),
    ])
    #expect(try Self.shown(in: nothing) == ["words"])
  }

  @Test func an_empty_page_has_no_planning_end_and_its_suggestions_go_at_its_start() throws {
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-26", rows: []),
      Self.draftPage(
        of: "day:2026-11-26",
        [
          Self.line("p", "A plain line", type: "paragraph", anchor: ""),
          Self.line("n", "A numbered line", type: "numberedListItem", anchor: ""),
        ]),
    ])
    let page = try #require(workspace.page("day:2026-11-26"))
    let view = try #require(DraftView.of(page: page, in: workspace, index: TodoIndex(workspace)))
    #expect(view.suggestions.map(\.id) == ["p", "n"])
    #expect(view.suggestions.map(\.anchorId) == [nil, nil])
    #expect(view.suggestions.map(\.mark) == [.line, .line], "a block that is no to-do and no bullet is a plain line")
    #expect(view.planningEndId == nil)
    #expect(view.moreOpenAfterId == nil)
  }

  @Test func a_to_do_with_any_row_on_the_page_is_neither_suggested_nor_more_open() throws {
    let reference = Block(
      id: "bullet", type: "bulletListItem", content: .array([.object(textRun("Errands"))]),
      children: [TestWorkspace.row("t", role: "reference")])
    let workspace = try TestWorkspace.make(
      pages: [
        TestWorkspace.day("2026-11-26", rows: [Self.heading("h"), reference]),
        Self.draftPage(
          of: "day:2026-11-26", moreOpen: ["t", "u"],
          [#"{"id":"i","anchor":"h","place":"after","taskId":"t","state":"open"}"#]),
      ],
      tasks: [TestWorkspace.task("t"), TestWorkspace.task("u", title: "Another")])
    let page = try #require(workspace.page("day:2026-11-26"))
    let view = try #require(DraftView.of(page: page, in: workspace, index: TodoIndex(workspace)))
    #expect(view.suggestions.isEmpty, "a reference row nested under a bullet is a row of it")
    #expect(view.moreOpen.map(\.taskId) == ["u"])
  }

  // MARK: What finding where a line came from parses

  /// The pages a `decidedElsewhere` parsed, by id, in order.
  private final class Parses {
    var ids: [String] = []
  }

  @Test func a_lines_source_is_found_without_parsing_a_page_the_index_holds() throws {
    // Check 6: today's line says where it came from (`b1`); yesterday's decided `Gym` is an older recipe's.
    func decided(first: [JSONValue]) throws -> (decided: Bool, parsed: [String]) {
      let workspace = try TestWorkspace.make(
        pages: first + [
          Self.page("notes", type: "document", createdAt: "2026-11-01T08:00:00.000Z", blocks: ["n1"]),
          Self.page("day:2026-11-24", type: "daily", date: "2026-11-24", blocks: ["b1"]),
          Self.page("tpl", type: "template", blocks: ["b1"]),
          TestWorkspace.day("2026-11-25", rows: [Self.heading("h25")]),
          Self.draftPage(of: "day:2026-11-25", recipe: 4, [Self.line("x", "Gym", state: "skipped")]),
          TestWorkspace.day("2026-11-26", rows: [Self.heading("h")]),
          Self.draftPage(of: "day:2026-11-26", []),
        ])
      let carried = Self.line("i", "Gym", extra: #","from":"b1""#)
      let item = try #require(
        DayDraft(document: #"{"status":"ready","recipe":5,"items":[\#(carried)]}"#)?.items.first)
      let page = try #require(workspace.page("day:2026-11-26"))
      let parses = Parses()
      let elsewhere = DaythreadCore.decidedElsewhere(
        in: workspace, index: TodoIndex(workspace), dayPage: page,
        parse: { page in
          parses.ids.append(page.id)
          return Document.blocks(page.document)
        })
      return (elsewhere(item), parses.ids)
    }

    let held = try decided(first: [])
    #expect(held.decided, "written on the 24th, so it could have been in the 25th's draft")
    #expect(held.parsed == [], "the index already knows the first page holding the block; parsed \(held.parsed)")

    // A page in Trash before it, which the index does not hold, is still the first page holding the block.
    let trashed = Self.page(
      "day:2026-11-27", type: "daily", date: "2026-11-27", trashedAt: "2026-11-28T00:00:00.000Z", blocks: ["b1"])
    let earlier = try decided(first: [trashed])
    #expect(!earlier.decided, "the first page holding it is dated the 27th")
    #expect(earlier.parsed == ["day:2026-11-27"], "only pages the index does not hold, before its hit; parsed \(earlier.parsed)")
  }

  // MARK: Helpers

  /// The ids of the suggestions `day:2026-11-26` shows.
  private static func shown(in workspace: Workspace) throws -> [String] {
    let page = try #require(workspace.page("day:2026-11-26"))
    return try #require(DraftView.of(page: page, in: workspace, index: TodoIndex(workspace))).suggestions.map(\.id)
  }

  /// A line item; `extra` is more fields, each after a comma.
  private static func line(
    _ id: String, _ words: String, state: String = "open", type: String = "bulletListItem", anchor: String = "h",
    extra: String = ""
  ) -> String {
    """
    {"id":"\(id)","anchor":"\(anchor)","place":"after","state":"\(state)",\
    "block":{"id":"block-\(id)","type":"\(type)","props":{},\
    "content":[{"type":"text","text":"\(words)","styles":{}}],"children":[]}\(extra)}
    """
  }

  private static func draftPage(
    of dayPageId: String, recipe: Int = 5, moreOpen: [String] = [], _ items: [String]
  ) -> JSONValue {
    let ids = moreOpen.map { #""\#($0)""# }.joined(separator: ",")
    let document = #"{"status":"ready","recipe":\#(recipe),"items":[\#(items.joined(separator: ","))],"#
    return TestWorkspace.page(
      "draft:\(dayPageId)", type: "draft", parentId: dayPageId, document: document + #""moreOpen":[\#(ids)]}"#)
  }

  /// A page whose blocks are paragraphs of these ids.
  private static func page(
    _ id: String, type: String, date: String? = nil, createdAt: String? = nil, trashedAt: String? = nil,
    blocks: [String]
  ) -> JSONValue {
    let document = Document.write(blocks.map { Block(id: $0, type: $0 == "h" ? "heading" : "paragraph") })
    let base = TestWorkspace.page(id, type: type, date: date, trashedAt: trashedAt, document: document)
    var object = base.objectValue ?? [:]
    if let createdAt { object["createdAt"] = .string(createdAt) }
    return .object(object)
  }

  private static func heading(_ id: String) -> Block {
    Block(id: id, type: "heading", props: ["level": .number("2")], content: .array([.object(textRun("Plan"))]))
  }

  private static func status(_ value: JSONValue?) -> DayDraft.Status {
    switch value?.stringValue {
    case "preparing": .preparing
    case "ready": .ready
    case "failed": .failed
    default: .unknown
    }
  }

  private static func mark(_ type: JSONValue?) -> DraftView.Suggestion.Mark {
    switch type?.stringValue {
    case "task": .todo
    case "bulletListItem": .bullet
    default: .line
    }
  }
}
