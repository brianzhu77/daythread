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
      let page = try #require(workspace.page(try #require(entry["pageId"]?.stringValue)), "page: \(name)")
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
    let stored = try #require(
      DraftView.of(page: try #require(workspace.page(today)), in: workspace, index: TodoIndex(workspace)))
    #expect(stored.suggestions.map(\.id) == ["a", "b"])

    let typedLine = Block(id: "typed", type: "paragraph", content: .array([.object(textRun("Coffee"))]))
    let typedRow = Block(
      id: "row", type: "task", props: ["taskId": .string("t"), "role": .string("plan")],
      content: .array([.object(textRun("Call the bank"))]))
    let drawn = workspace.drawing(draft: Document.write([Self.heading("h"), typedLine, anchor, typedRow]), of: today)
    let view = try #require(
      DraftView.of(page: try #require(drawn.page(today)), in: drawn, index: TodoIndex(drawn)))
    #expect(view.suggestions.map(\.id) == ["b"], "the to-do he typed a row of is not suggested")
    #expect(view.suggestions.first?.kind == .after)
    #expect(view.suggestions.first?.anchorId == "anchor", "a typed line above the anchor moves nothing else")
    #expect(view.planningEndId == stored.planningEndId)
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
