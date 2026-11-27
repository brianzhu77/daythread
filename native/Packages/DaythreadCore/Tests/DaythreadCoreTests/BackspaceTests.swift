import Testing

@testable import DaythreadCore

/// Backspace at the start of a line, row by row of the keys table (spec §10.3).
@Suite struct BackspaceTests {
  private typealias Caret = EditablePage.Caret

  private static let todoProps = #"{"taskId":"editor-task:t","role":"plan","planDate":"2026-10-22"}"#
  private static let tinted = #"{"backgroundColor":"default","textColor":"red","textAlignment":"left"}"#

  private func backspace(_ page: inout EditablePage, _ block: String, _ offset: Int = 0) -> Caret? {
    page.press(.backspace, at: Caret(block: block, offset: offset))
  }

  @Test func at_the_start_of_a_bullet_makes_it_a_paragraph_keeping_words_and_nested_lines() {
    let heading = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":2,"isToggleable":false}"#
    let cases: [(type: String, props: String, paragraph: String)] = [
      ("bulletListItem", Self.tinted, Self.tinted),
      ("numberedListItem", #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","start":3}"#, Lines.defaults),
      ("quote", #"{"backgroundColor":"default","textColor":"default"}"#, Lines.defaults),
      ("heading", heading, Lines.defaults),
      ("task", Self.todoProps, Lines.defaults),
    ]
    for (type, props, paragraph) in cases {
      let child = Lines.line("c", "Nested")
      var page = Lines.editable(
        Lines.document(Lines.line("a", "Above"), Lines.line("x", type, props: props, "Words", children: [child])))

      #expect(backspace(&page, "x") == Caret(block: "x", offset: 0), "\(type)")

      #expect(Lines.outline(page) == ["a paragraph 'Above'", "x paragraph 'Words'", "  c paragraph 'Nested'"], "\(type)")
      #expect(Lines.written("x", in: page) == Lines.line("x", props: paragraph, "Words", children: [child]), "\(type)")
      #expect(page.singleDeleteIds.isEmpty, "\(type)")
    }
  }

  @Test func not_at_the_start_does_nothing() {
    let original = Lines.document(Lines.line("a", "Above"), Lines.line("x", "bulletListItem", "Words"))
    var page = Lines.editable(original)

    #expect(backspace(&page, "x", 2) == nil)
    #expect(page.document == original)
  }

  @Test func at_the_start_of_a_paragraph_joins_the_line_above() {
    var page = Lines.editable(
      Lines.document(
        Lines.line("a", "bulletListItem", props: Self.tinted, "Hello "),
        Lines.line("b", "world", children: [Lines.line("c", "Child")]),
        Lines.line("d", "After")))

    // The joining point: the end of the upper line's words.
    #expect(backspace(&page, "b") == Caret(block: "a", offset: 6))

    #expect(Lines.outline(page) == ["a bulletListItem 'Hello world'", "c paragraph 'Child'", "d paragraph 'After'"])
    #expect(Lines.written("a", in: page) == Lines.line("a", "bulletListItem", props: Self.tinted, "Hello world"))

    // The line above is the one drawn above: the previous line's deepest last nested line.
    var nested = Lines.editable(
      Lines.document(
        Lines.line("p", "bulletListItem", "Parent", children: [Lines.line("q", "quote", props: "{}", "Last")]),
        Lines.line("l", "Line")))

    #expect(backspace(&nested, "l") == Caret(block: "q", offset: 4))
    #expect(Lines.outline(nested) == ["p bulletListItem 'Parent'", "  q quote 'LastLine'"])
    #expect(Lines.written("q", in: nested) == Lines.line("q", "quote", props: "{}", "LastLine"))
  }

  @Test func into_an_empty_line_of_the_same_kind_keeps_the_lower_lines_id() {
    var page = Lines.editable(
      Lines.document(Lines.line("e", ""), Lines.line("l", "Line", children: [Lines.line("c", "Child")])))

    #expect(backspace(&page, "l") == Caret(block: "l", offset: 0))
    #expect(Lines.outline(page) == ["l paragraph 'Line'", "  c paragraph 'Child'"])

    // Nested: the lower line takes the empty line's place, there.
    var nested = Lines.editable(
      Lines.document(
        Lines.line("b", "bulletListItem", "List", children: [Lines.line("e", "")]),
        Lines.line("l", "Line", children: [Lines.line("c", "Child")])))

    #expect(backspace(&nested, "l") == Caret(block: "l", offset: 0))
    #expect(Lines.outline(nested) == ["b bulletListItem 'List'", "  l paragraph 'Line'", "    c paragraph 'Child'"])

    // Of another kind, the empty line keeps its id, type and props and takes the words.
    let heading = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":1,"isToggleable":false}"#
    var other = Lines.editable(Lines.document(Lines.line("h", "heading", props: heading, ""), Lines.line("l", "Line")))

    #expect(backspace(&other, "l") == Caret(block: "h", offset: 0))
    #expect(Lines.outline(other) == ["h heading 'Line'"])
    #expect(Lines.written("h", in: other) == Lines.line("h", "heading", props: heading, "Line"))
  }

  @Test func joins_before_it_unnests() {
    var page = Lines.editable(
      Lines.document(
        Lines.line(
          "p", "bulletListItem", "Parent",
          children: [Lines.line("f", "First", children: [Lines.line("g", "Grand")]), Lines.line("s", "Second")])))

    #expect(backspace(&page, "f") == Caret(block: "p", offset: 6))

    #expect(
      Lines.outline(page) == ["p bulletListItem 'ParentFirst'", "  g paragraph 'Grand'", "  s paragraph 'Second'"])
  }

  @Test func under_a_block_with_no_words_does_nothing_when_it_has_words_and_removes_it_when_empty() {
    let kinds = [
      Lines.block("x", "image", props: #"{"url":"https://example.com/a.png"}"#),
      Lines.block("x", "file", props: #"{"url":"https://example.com/a.pdf"}"#),
      Lines.block("x", "table", props: "{}"),
    ]
    for kind in kinds {
      let withWords = Lines.document(Lines.line("a", "Above"), kind, Lines.line("w", "Words"))
      var page = Lines.editable(withWords)
      #expect(backspace(&page, "w") == nil, "\(kind)")
      #expect(page.document == withWords, "\(kind)")

      // Removed; its nested lines take its place, and the caret goes to the end of the nearest line above.
      var empty = Lines.editable(
        Lines.document(
          Lines.line("a", "Above"), kind, Lines.line("e", "", children: [Lines.line("c", "Child")]),
          Lines.line("z", "Next")))
      #expect(backspace(&empty, "e") == Caret(block: "a", offset: 5), "\(kind)")
      #expect(
        Lines.outline(empty).filter { !$0.hasPrefix("x ") } == [
          "a paragraph 'Above'", "c paragraph 'Child'", "z paragraph 'Next'",
        ], "\(kind)")
      #expect(Lines.written("x", in: empty) == kind, "\(kind)")

      // With no line above, to the start of the next one.
      var first = Lines.editable(Lines.document(kind, Lines.line("e", ""), Lines.line("z", "Next")))
      #expect(backspace(&first, "e") == Caret(block: "z", offset: 0), "\(kind)")
      #expect(Lines.outline(first).filter { !$0.hasPrefix("x ") } == ["z paragraph 'Next'"], "\(kind)")

      // With no other line at all, nothing.
      let alone = Lines.document(kind, Lines.line("e", ""))
      var lonely = Lines.editable(alone)
      #expect(backspace(&lonely, "e") == nil, "\(kind)")
      #expect(lonely.document == alone, "\(kind)")
    }
  }

  @Test func under_a_divider_removes_the_divider_when_it_has_words_and_the_line_when_empty() {
    let divider = Lines.block("d", "divider", props: "{}")
    var words = Lines.editable(Lines.document(Lines.line("a", "Above"), divider, Lines.line("w", "Words")))
    #expect(backspace(&words, "w") == Caret(block: "w", offset: 0))
    #expect(Lines.outline(words) == ["a paragraph 'Above'", "w paragraph 'Words'"])

    var empty = Lines.editable(
      Lines.document(Lines.line("a", "Above"), divider, Lines.line("e", ""), Lines.line("z", "Next")))
    #expect(backspace(&empty, "e") == Caret(block: "a", offset: 5))
    #expect(Lines.outline(empty) == ["a paragraph 'Above'", "d divider ''", "z paragraph 'Next'"])

    // The first line nested under a divider: the divider goes, and its nested lines take its place.
    var nested = Lines.editable(
      Lines.document(
        Lines.line("a", "Above"),
        Lines.block("d", "divider", props: "{}", children: [Lines.line("f", "First"), Lines.line("s", "Second")])))
    #expect(backspace(&nested, "f") == Caret(block: "f", offset: 0))
    #expect(Lines.outline(nested) == ["a paragraph 'Above'", "f paragraph 'First'", "s paragraph 'Second'"])

    // A divider that is the previous line's last nested line: the line takes its place, with its own nested lines
    // (BlockNote's "deletes previous block if it contains no content").
    var deeper = Lines.editable(
      Lines.document(
        Lines.line("b", "bulletListItem", "List", children: [Lines.line("k", "Kept"), divider]),
        Lines.line("w", "Words", children: [Lines.line("c", "Child")]),
        Lines.line("z", "Next")))
    #expect(backspace(&deeper, "w") == Caret(block: "w", offset: 0))
    #expect(
      Lines.outline(deeper) == [
        "b bulletListItem 'List'", "  k paragraph 'Kept'", "  w paragraph 'Words'", "    c paragraph 'Child'",
        "z paragraph 'Next'",
      ])
  }

  @Test func under_a_synced_block_or_a_database_does_nothing() {
    let kinds = [
      Lines.block("x", "syncedBlock", props: #"{"syncedId":"s1"}"#, children: [Lines.line("inside", "Shared")]),
      Lines.block("x", "database", props: #"{"databaseId":"d1"}"#, children: [Lines.line("inside", "Row")]),
    ]
    for kind in kinds {
      for line in [Lines.line("w", "Words"), Lines.line("w", "")] {
        let original = Lines.document(Lines.line("a", "Above"), kind, line)
        var page = Lines.editable(original)
        #expect(backspace(&page, "w") == nil, "\(kind) \(line)")
        #expect(page.document == original, "\(kind) \(line)")
      }
      // The last line nested under the line above is the block itself.
      let nested = Lines.document(Lines.line("b", "bulletListItem", "List", children: [kind]), Lines.line("w", "Words"))
      var page = Lines.editable(nested)
      #expect(backspace(&page, "w") == nil, "\(kind)")
      #expect(page.document == nested, "\(kind)")
    }
  }

  @Test func on_an_empty_to_do_removes_the_row_and_names_it() throws {
    let day = try #require(LocalDate("2026-10-22"))
    var page = Lines.editable(
      Lines.document(
        Lines.line("a", "Above"), Lines.line("t", "task", props: Self.todoProps, "", children: [Lines.line("c", "Child")]),
        Lines.line("z", "Next")),
      pageDate: day)

    #expect(backspace(&page, "t") == Caret(block: "a", offset: 5))

    #expect(Lines.outline(page) == ["a paragraph 'Above'", "c paragraph 'Child'", "z paragraph 'Next'"])
    // The web adds the row's block id (`page-editor.tsx`, `semanticDeletes.current.add(id)`); the server reads the
    // list as row ids (`workspace.ts`, `single.has(r.id)`).
    #expect(page.singleDeleteIds == ["t"])
  }

  @Test func turning_the_first_line_from_a_to_do_into_a_paragraph_names_it() {
    var page = Lines.editable(
      Lines.document(Lines.line("t", "task", props: Self.todoProps, "Call"), Lines.line("z", "Next")))

    #expect(backspace(&page, "t") == Caret(block: "t", offset: 0))

    #expect(Lines.written("t", in: page) == Lines.line("t", "Call"))
    #expect(page.singleDeleteIds == ["t"])

    // An empty first to-do becomes a paragraph too, as `plainFirstLine` runs before the empty to-do's rule.
    var empty = Lines.editable(
      Lines.document(Lines.line("t", "task", props: Self.todoProps, ""), Lines.line("z", "Next")))

    #expect(backspace(&empty, "t") == Caret(block: "t", offset: 0))
    #expect(Lines.outline(empty) == ["t paragraph ''", "z paragraph 'Next'"])
    #expect(empty.singleDeleteIds == ["t"])
  }

  @Test func the_pages_first_line_is_its_first_line_of_words() {
    let divider = Lines.block("d", "divider", props: "{}")
    var page = Lines.editable(Lines.document(divider, Lines.line("t", "task", props: Self.todoProps, "Call")))

    #expect(backspace(&page, "t") == Caret(block: "t", offset: 0))
    #expect(Lines.outline(page) == ["d divider ''", "t paragraph 'Call'"])
    #expect(page.singleDeleteIds == ["t"])

    let image = Lines.block("x", "image", props: #"{"url":"https://example.com/a.png"}"#)
    var empty = Lines.editable(Lines.document(image, Lines.line("t", "task", props: Self.todoProps, "")))

    #expect(backspace(&empty, "t") == Caret(block: "t", offset: 0))
    #expect(Lines.outline(empty) == ["x image ''", "t paragraph ''"])
    #expect(empty.singleDeleteIds == ["t"])
  }

  @Test func a_row_named_twice_is_listed_once() {
    var page = Lines.editable(Lines.document(Lines.line("t", "task", props: Self.todoProps, "Call")))
    _ = backspace(&page, "t")
    #expect(page.singleDeleteIds == ["t"])

    // Made a to-do again under the same id, then let go again.
    for (offset, character) in "[] ".enumerated() {
      _ = page.replaceText(in: "t", range: offset..<offset, with: String(character))
    }
    _ = page.replaceText(in: "t", range: 0..<0, with: "x")
    _ = page.replaceText(in: "t", range: 0..<1, with: "")
    #expect(Lines.written("t", in: page) == Lines.line("t", "task", props: #"{"taskId":"editor-task:t","role":"reference","planDate":""}"#, "Call"))

    #expect(backspace(&page, "t") == Caret(block: "t", offset: 0))
    #expect(page.singleDeleteIds == ["t"])
  }

  @Test func turning_a_later_to_do_into_a_paragraph_names_nothing() {
    var page = Lines.editable(
      Lines.document(Lines.line("a", "Above"), Lines.line("t", "task", props: Self.todoProps, "Call")))

    #expect(backspace(&page, "t") == Caret(block: "t", offset: 0))
    #expect(Lines.written("t", in: page) == Lines.line("t", "Call"))
    #expect(page.singleDeleteIds.isEmpty)

    // The first line nested under the page's first line is not the page's first line.
    var nested = Lines.editable(
      Lines.document(Lines.line("p", "Parent", children: [Lines.line("t", "task", props: Self.todoProps, "Call")])))

    #expect(backspace(&nested, "t") == Caret(block: "t", offset: 0))
    #expect(Lines.outline(nested) == ["p paragraph 'Parent'", "  t paragraph 'Call'"])
    #expect(nested.singleDeleteIds.isEmpty)
  }

  @Test func on_the_first_line_of_the_page_with_nothing_above_does_nothing_more_than_make_it_a_paragraph() {
    let heading = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":1,"isToggleable":false}"#
    var page = Lines.editable(Lines.document(Lines.line("h", "heading", props: heading, "Title"), Lines.line("z", "Next")))

    #expect(backspace(&page, "h") == Caret(block: "h", offset: 0))
    let afterFirst = page.document
    #expect(Lines.outline(page) == ["h paragraph 'Title'", "z paragraph 'Next'"])

    #expect(backspace(&page, "h") == nil)
    #expect(page.document == afterFirst)

    for original in [Lines.document(Lines.line("p", "Words")), Lines.document(Lines.line("p", ""))] {
      var plain = Lines.editable(original)
      #expect(backspace(&plain, "p") == nil)
      #expect(plain.document == original)
    }
  }
}
