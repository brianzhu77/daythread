import Testing

@testable import DaythreadCore

@Suite struct DayDraftTests {
  @Test func documents_are_the_webs() throws {
    let cases = try Fixtures.cases("draft/documents.json")
    #expect(cases.count == 12)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let document = try #require(entry["document"]?.stringValue, "document: \(name)")
      let draft = DayDraft(document: document)
      guard let expected = entry["draft"]?.objectValue else {
        #expect(draft == nil, "no draft: \(name)")
        continue
      }
      let read = try #require(draft, "draft: \(name)")
      #expect(read.status == Self.status(expected["status"]), "status: \(name)")
      #expect(read.recipe == expected["recipe"]?.intValue, "recipe: \(name)")
      #expect(read.moreOpen == Self.strings(expected["moreOpen"]), "moreOpen: \(name)")
      let items = expected["items"]?.arrayValue ?? []
      #expect(read.items.count == items.count, "item count: \(name)")
      for (item, entryItem) in zip(read.items, items) {
        let expectedItem = try #require(entryItem.objectValue)
        let label = "\(name) / \(item.id)"
        #expect(item.id == expectedItem["id"]?.stringValue ?? "", "id: \(label)")
        #expect(item.anchor == expectedItem["anchor"]?.stringValue ?? "", "anchor: \(label)")
        #expect(item.place == (expectedItem["place"]?.stringValue == "fill" ? .fill : .after), "place: \(label)")
        #expect(item.taskId == expectedItem["taskId"]?.stringValue, "taskId: \(label)")
        #expect(item.block?.raw == expectedItem["block"]?.objectValue, "block: \(label)")
        #expect(item.state == Self.state(expectedItem["state"]), "state: \(label)")
        #expect(item.until?.value == expectedItem["until"]?.stringValue, "until: \(label)")
        #expect(item.by == expectedItem["by"]?.stringValue, "by: \(label)")
        #expect(item.from == Self.nonEmpty(expectedItem["from"]), "from: \(label)")
        #expect(item.since?.value == expectedItem["since"]?.stringValue, "since: \(label)")
        #expect(item.recipe == expectedItem["recipe"]?.intValue, "recipe: \(label)")
        #expect(item.took == Self.strings(expectedItem["took"]), "took: \(label)")
        #expect(item.row == Self.nonEmpty(expectedItem["row"]), "row: \(label)")
      }
      #expect(read.settled == entry["settled"]?.boolValue, "settled: \(name)")
      #expect(read.stale == entry["stale"]?.boolValue, "stale: \(name)")
    }
  }

  @Test func the_recipe_is_the_webs() throws {
    let recipe = try Fixtures.json("draft/recipe.json").objectValue?["recipe"]?.intValue
    #expect(DayDraft.currentRecipe == recipe)
  }

  @Test func a_field_of_the_wrong_kind_reads_as_absent() throws {
    let whole = try #require(DayDraft(document: #"{"status":"ready","items":5,"moreOpen":false,"recipe":"5"}"#))
    #expect(whole.items.isEmpty)
    #expect(whole.moreOpen.isEmpty)
    #expect(whole.recipe == nil)
    #expect(whole.status == .ready)

    let odd = try #require(
      DayDraft(
        document: """
          {"status":3,"items":[{"id":7,"anchor":null,"place":"Fill","state":3,"from":"","row":"","took":"x",\
          "block":5,"until":"soon","since":4,"by":false,"recipe":"4","taskId":9}]}
          """))
    #expect(odd.status == .unknown)
    let item = try #require(odd.items.first)
    #expect(item.id == "")
    #expect(item.anchor == "")
    #expect(item.place == .after)
    #expect(item.state == .unknown)
    #expect(item.from == nil)
    #expect(item.row == nil)
    #expect(item.took.isEmpty)
    #expect(item.block == nil)
    #expect(item.until == nil)
    #expect(item.since == nil)
    #expect(item.by == nil)
    #expect(item.recipe == nil)
    #expect(item.taskId == nil)
    #expect(item.words == nil)
    #expect(odd.settled, "an item that is not open settles the draft")

    let stateless = try #require(DayDraft(document: #"{"status":"failed","items":[{"id":"i"}]}"#))
    #expect(stateless.items.first?.state != .open, "an item with no state is not open")
    #expect(stateless.settled, "an item with no state settles the draft")

    #expect(DayDraft(document: "[]") == nil)
    #expect(DayDraft(document: "5") == nil)
    #expect(DayDraft(document: "") == nil)
  }

  @Test func an_items_words_are_its_blocks_same_words() throws {
    let draft = try #require(
      DayDraft(
        document: """
          {"status":"ready","items":[{"id":"a","block":{"id":"b","type":"paragraph","props":{},\
          "content":[{"type":"text","text":"  Call   MOM. ","styles":{}}],"children":[]}}]}
          """))
    #expect(draft.items.first?.words == "call mom")
  }

  @Test func the_index_finds_a_days_first_draft_not_in_trash_and_lists_every_draft_that_reads() throws {
    let day = "day:2026-11-26"
    func draftPage(_ id: String, _ status: String, trashedAt: String? = nil, parent: String? = day) -> JSONValue {
      TestWorkspace.page(
        id, type: "draft", parentId: parent, trashedAt: trashedAt,
        document: #"{"status":"\#(status)","items":[],"moreOpen":[]}"#)
    }
    let workspace = try TestWorkspace.make(pages: [
      TestWorkspace.day("2026-11-26", rows: []),
      draftPage("draft:\(day)", "failed", trashedAt: "2026-11-27T00:00:00.000Z"),
      draftPage("draft:\(day)", "ready"),
      TestWorkspace.page("draft:day:2026-11-25", type: "draft", parentId: "day:2026-11-25", document: "not json"),
    ])
    let index = TodoIndex(workspace)
    #expect(index.dayDraft(of: day)?.status == .ready)
    #expect(index.dayDraft(of: "day:2026-11-25") == nil)
    #expect(index.dayDraft(of: "day:2026-11-24") == nil)
    #expect(index.dayDrafts.map(\.pageId) == ["draft:\(day)"])
    #expect(index.dayDrafts.map(\.parentId) == [day])
    #expect(index.dayDrafts.first?.draft.status == .ready)
  }

  @Test func the_workspace_reads_a_days_draft_as_the_index_does() throws {
    func draftPage(_ day: String, _ document: String, trashedAt: String? = nil) -> JSONValue {
      TestWorkspace.page("draft:\(day)", type: "draft", parentId: day, trashedAt: trashedAt, document: document)
    }
    func ready(_ status: String) -> String { #"{"status":"\#(status)","items":[],"moreOpen":[]}"# }
    let workspace = try TestWorkspace.make(pages: [
      // In Trash, then one that reads: the second.
      draftPage("day:2026-11-26", ready("failed"), trashedAt: "2026-11-27T00:00:00.000Z"),
      draftPage("day:2026-11-26", ready("ready")),
      // The first does not parse: no draft, not the second.
      draftPage("day:2026-11-25", "not json"),
      draftPage("day:2026-11-25", ready("ready")),
      // Two of one id that read: the first.
      draftPage("day:2026-11-24", ready("failed")),
      draftPage("day:2026-11-24", ready("ready")),
    ])
    let index = TodoIndex(workspace)
    for day in ["day:2026-11-26", "day:2026-11-25", "day:2026-11-24", "day:2026-11-23"] {
      #expect(workspace.dayDraft(of: day) == index.dayDraft(of: day), "\(day)")
    }
    #expect(workspace.dayDraft(of: "day:2026-11-26")?.status == .ready)
    #expect(workspace.dayDraft(of: "day:2026-11-25") == nil)
    #expect(workspace.dayDraft(of: "day:2026-11-24")?.status == .failed)
  }

  @Test func a_draft_stands_when_stored_and_not_stale() throws {
    func standing(_ document: String?) throws -> Bool {
      let pages: [JSONValue] =
        document.map { [TestWorkspace.page("draft:day:2026-11-26", type: "draft", document: $0)] } ?? []
      return TodoIndex(try TestWorkspace.make(pages: pages)).draftStands(for: "day:2026-11-26")
    }
    let item = #"{"id":"i","anchor":"a","state":"open"}"#
    #expect(try standing(#"{"status":"failed","items":[\#(item)],"recipe":5}"#))
    #expect(try standing(#"{"status":"failed","items":[\#(item)],"recipe":4}"#), "an older recipe, unsettled")
    #expect(try !standing(#"{"status":"ready","items":[\#(item)],"recipe":4}"#), "an older recipe, ready")
    #expect(try standing(#"{"status":"ready","items":[\#(item)],"recipe":5}"#))
    #expect(try !standing(nil))
  }

  @Test func since_still_reads_what_a_draft_applied() throws {
    let today = try #require(LocalDate("2026-11-26"))
    func since(draftOf day: String?) throws -> String? {
      var pages = [
        TestWorkspace.day("2026-11-10", rows: [TestWorkspace.row("t")]),
        TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("t")]),
        TestWorkspace.draft(of: "day:2026-11-26", applied: ["t"]),
      ]
      if let day { pages.append(TestWorkspace.draft(of: day, applied: ["t"])) }
      let workspace = try TestWorkspace.make(
        pages: pages, tasks: [TestWorkspace.task("t", createdOn: "2026-11-01")])
      let task = try #require(workspace.task("t"))
      return TodoIndex(workspace).carriedSince(task, today: today)?.value
    }
    #expect(try since(draftOf: nil) == "2026-11-10")
    #expect(try since(draftOf: "day:2026-11-10") == "2026-11-01")
  }

  private static func status(_ value: JSONValue?) -> DayDraft.Status {
    switch value?.stringValue {
    case "preparing": .preparing
    case "ready": .ready
    case "failed": .failed
    default: .unknown
    }
  }

  private static func state(_ value: JSONValue?) -> DayDraft.Item.State {
    switch value?.stringValue {
    case "open": .open
    case "applied": .applied
    case "skipped": .skipped
    default: .unknown
    }
  }

  private static func strings(_ value: JSONValue?) -> [String] {
    (value?.arrayValue ?? []).compactMap(\.stringValue)
  }

  private static func nonEmpty(_ value: JSONValue?) -> String? {
    value?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
  }
}
