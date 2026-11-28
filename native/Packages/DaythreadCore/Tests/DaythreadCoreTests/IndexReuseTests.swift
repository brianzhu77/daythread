import Testing

@testable import DaythreadCore

/// An index built reusing the one before it takes the drafts whose pages did not change from it, unparsed.
@Suite struct IndexReuseTests {
  private static func draft(_ day: String, _ status: String, trashedAt: String? = nil) -> JSONValue {
    TestWorkspace.page(
      "draft:day:\(day)", type: "draft", parentId: "day:\(day)", trashedAt: trashedAt,
      document: #"{"status":"\#(status)","items":[{"id":"i","anchor":"","state":"open"}],"moreOpen":[]}"#)
  }

  @Test func an_index_reusing_another_parses_only_the_drafts_whose_pages_changed() throws {
    let before = try TestWorkspace.make(pages: [
      Self.draft("2026-11-23", "ready"), Self.draft("2026-11-24", "ready"), Self.draft("2026-11-25", "ready"),
    ])
    let previous = TodoIndex(before)
    #expect(previous.draftsParsed == 3)
    #expect(TodoIndex(before, reusing: previous).draftsParsed == 0, "nothing changed: nothing parsed")

    let after = try TestWorkspace.make(pages: [
      Self.draft("2026-11-23", "ready"),
      Self.draft("2026-11-24", "failed"),
      Self.draft("2026-11-25", "ready", trashedAt: "2026-11-26T00:00:00.000Z"),
      Self.draft("2026-11-26", "preparing"),
    ])
    let index = TodoIndex(after, reusing: previous)
    #expect(index.draftsParsed == 2, "the changed draft and the new one")
    #expect(index.dayDraft(of: "day:2026-11-23")?.status == .ready)
    #expect(index.dayDraft(of: "day:2026-11-24")?.status == .failed, "the changed document is what it answers with")
    #expect(index.dayDraft(of: "day:2026-11-25") == nil, "a draft put in Trash since is not kept")
    #expect(index.dayDraft(of: "day:2026-11-26")?.status == .preparing)
    #expect(index.dayDrafts.map(\.pageId) == ["draft:day:2026-11-23", "draft:day:2026-11-24", "draft:day:2026-11-26"])

    let gone = try TestWorkspace.make(pages: [Self.draft("2026-11-23", "ready")])
    let shrunk = TodoIndex(gone, reusing: previous)
    #expect(shrunk.draftsParsed == 0)
    #expect(shrunk.dayDrafts.map(\.pageId) == ["draft:day:2026-11-23"], "a draft page gone is not kept")
  }

  @Test func a_document_that_differs_only_in_its_code_units_is_parsed_again() throws {
    // `é` composed, then decomposed: equal as Swift strings, not as the web's.
    func workspace(_ words: String) throws -> Workspace {
      try TestWorkspace.make(pages: [
        TestWorkspace.page(
          "draft:day:2026-11-26", type: "draft", parentId: "day:2026-11-26",
          document: #"{"status":"ready","items":[{"id":"\#(words)","state":"open"}],"moreOpen":[]}"#)
      ])
    }
    let previous = TodoIndex(try workspace("caf\u{E9}"))
    let index = TodoIndex(try workspace("cafe\u{301}"), reusing: previous)
    #expect(index.draftsParsed == 1)
    #expect(index.dayDraft(of: "day:2026-11-26")?.items.first?.id.hasSameCodeUnits(as: "cafe\u{301}") == true)
  }

  @Test func an_index_reusing_another_answers_as_one_built_fresh() throws {
    let views = try Fixtures.cases("draft/views.json")
    #expect(views.count == 53)
    var earlier: TodoIndex?
    for entry in views {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try Fixtures.workspace(of: entry, name)
      let pageId = try #require(entry["pageId"]?.stringValue, "pageId: \(name)")
      let page = try #require(workspace.page(pageId), "page: \(name)")
      let fresh = TodoIndex(workspace)
      let again = TodoIndex(workspace, reusing: fresh)
      #expect(again.draftsParsed == 0, "the same workspace: \(name)")
      let expected = DraftView.of(page: page, in: workspace, index: fresh)
      #expect(DraftView.of(page: page, in: workspace, index: again) == expected, "reusing itself: \(name)")
      if let earlier {
        let mixed = TodoIndex(workspace, reusing: earlier)
        #expect(DraftView.of(page: page, in: workspace, index: mixed) == expected, "reusing the case before: \(name)")
      }
      earlier = fresh
    }

    let carried = try Fixtures.cases("carried/cases.json")
    #expect(carried.count == 9)
    for entry in carried {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try Fixtures.workspace(of: entry, name)
      let task = try #require(entry["taskId"]?.stringValue.flatMap(workspace.task), "task: \(name)")
      let today = try #require(entry["today"]?.stringValue.flatMap(LocalDate.init), "today: \(name)")
      let fresh = TodoIndex(workspace).carriedSince(task, today: today)
      let previous = try #require(earlier)
      #expect(TodoIndex(workspace, reusing: previous).carriedSince(task, today: today) == fresh, "since: \(name)")
      #expect(
        TodoIndex(workspace, reusing: TodoIndex(workspace)).carriedSince(task, today: today) == fresh, "since: \(name)")
      earlier = TodoIndex(workspace)
    }
  }
}
