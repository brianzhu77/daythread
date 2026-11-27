import Testing

@testable import DaythreadCore

/// Return, row by row of the keys table (spec §10.3).
@Suite struct ReturnTests {
  private typealias Caret = EditablePage.Caret

  private static let todoProps = #"{"taskId":"editor-task:t","role":"plan","planDate":"2026-10-22"}"#

  private func pressReturn(_ page: inout EditablePage, _ block: String, _ offset: Int) -> Caret? {
    page.press(.returnKey, at: Caret(block: block, offset: offset))
  }

  @Test func in_the_middle_of_a_paragraph_splits_it_and_the_first_half_keeps_its_id() throws {
    let props = #"{"backgroundColor":"blue","textColor":"default","textAlignment":"center"}"#
    var page = Lines.editable(Lines.document(Lines.line("a", props: props, "Hello world"), Lines.line("b", "Next")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(Lines.outline(page) == ["a paragraph 'Hello'", "n1 paragraph ' world'", "b paragraph 'Next'"])
    #expect(Lines.written("a", in: page) == Lines.line("a", props: props, "Hello"))
    #expect(Lines.written("b", in: page) == Lines.line("b", "Next"))
  }

  @Test func at_the_end_of_a_bullet_makes_a_bullet() {
    var page = Lines.editable(Lines.document(Lines.line("a", "bulletListItem", "Milk")))

    let caret = pressReturn(&page, "a", 4)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(Lines.outline(page) == ["a bulletListItem 'Milk'", "n1 bulletListItem ''"])
    #expect(Lines.written("a", in: page) == Lines.line("a", "bulletListItem", "Milk"))
    #expect(Lines.written("n1", in: page) == Lines.line("n1", "bulletListItem", ""))
  }

  @Test func of_a_numbered_item_makes_a_numbered_item() {
    let started = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","start":7}"#
    var page = Lines.editable(Lines.document(Lines.line("a", "numberedListItem", props: started, "Seven eight")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(Lines.written("a", in: page) == Lines.line("a", "numberedListItem", props: started, "Seven"))
    // The second item counts on from the first; it does not restart at 7.
    #expect(Lines.written("n1", in: page) == Lines.line("n1", "numberedListItem", " eight"))
  }

  @Test func of_a_quote_makes_a_paragraph() {
    let quote = #"{"backgroundColor":"default","textColor":"default"}"#
    var page = Lines.editable(Lines.document(Lines.line("a", "quote", props: quote, "To be or")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(Lines.written("a", in: page) == Lines.line("a", "quote", props: quote, "To be"))
    #expect(Lines.written("n1", in: page) == Lines.line("n1", " or"))
  }

  @Test func in_a_heading_makes_a_paragraph_of_the_rest() {
    let heading = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":2,"isToggleable":false}"#
    var page = Lines.editable(Lines.document(Lines.line("a", "heading", props: heading, "Notes today")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(Lines.written("a", in: page) == Lines.line("a", "heading", props: heading, "Notes"))
    #expect(Lines.written("n1", in: page) == Lines.line("n1", " today"))
  }

  @Test func nested_lines_go_with_the_second_half() {
    let child = Lines.line("c", "Child", children: [Lines.line("g", "Grandchild")])
    var page = Lines.editable(
      Lines.document(Lines.line("a", "bulletListItem", "Parent", children: [child]), Lines.line("b", "After")))

    let caret = pressReturn(&page, "a", 3)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(
      Lines.outline(page) == [
        "a bulletListItem 'Par'",
        "n1 bulletListItem 'ent'",
        "  c paragraph 'Child'",
        "    g paragraph 'Grandchild'",
        "b paragraph 'After'",
      ])
    #expect(Lines.written("c", in: page) == child)
  }

  @Test func a_nested_line_splits_where_it_is() {
    var page = Lines.editable(
      Lines.document(
        Lines.line(
          "p", "bulletListItem", "Parent",
          children: [
            Lines.line("first", "bulletListItem", "First child", children: [Lines.line("g", "Grand")]),
            Lines.line("mid", "Middle"),
            Lines.line("last", "Last child"),
          ]),
        Lines.line("q", "After")))

    #expect(pressReturn(&page, "first", 5) == Caret(block: "n1", offset: 0))
    #expect(pressReturn(&page, "last", 4) == Caret(block: "n2", offset: 0))

    #expect(
      Lines.outline(page) == [
        "p bulletListItem 'Parent'",
        "  first bulletListItem 'First'",
        "  n1 bulletListItem ' child'",
        "    g paragraph 'Grand'",
        "  mid paragraph 'Middle'",
        "  last paragraph 'Last'",
        "  n2 paragraph ' child'",
        "q paragraph 'After'",
      ])
  }

  @Test func at_the_start_of_a_nested_first_line_puts_an_empty_line_above_it() {
    let first = Lines.line("first", "bulletListItem", "First", children: [Lines.line("g", "Grand")])
    var page = Lines.editable(
      Lines.document(Lines.line("p", "Parent", children: [first, Lines.line("second", "bulletListItem", "Second")])))

    #expect(pressReturn(&page, "first", 0) == Caret(block: "first", offset: 0))

    #expect(
      Lines.outline(page) == [
        "p paragraph 'Parent'",
        "  n1 bulletListItem ''",
        "  first bulletListItem 'First'",
        "    g paragraph 'Grand'",
        "  second bulletListItem 'Second'",
      ])
    #expect(Lines.written("first", in: page) == first)
  }

  @Test func at_the_start_of_a_line_with_words_puts_an_empty_line_above() {
    let heading = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":2,"isToggleable":false}"#
    let cases: [(type: String, props: String, above: String)] = [
      ("bulletListItem", Lines.defaults, "bulletListItem"),
      ("numberedListItem", #"{"start":3}"#, "numberedListItem"),
      ("paragraph", Lines.defaults, "paragraph"),
      ("heading", heading, "paragraph"),
      ("quote", #"{"backgroundColor":"default","textColor":"default"}"#, "paragraph"),
    ]
    for (type, props, above) in cases {
      let line = Lines.line("a", type, props: props, "Words", children: [Lines.line("c", "Nested")])
      var page = Lines.editable(Lines.document(line))

      let caret = pressReturn(&page, "a", 0)

      #expect(caret == Caret(block: "a", offset: 0), "\(type)")
      #expect(Lines.outline(page) == ["n1 \(above) ''", "a \(type) 'Words'", "  c paragraph 'Nested'"], "\(type)")
      #expect(Lines.written("a", in: page) == line, "\(type)")
      #expect(Lines.written("n1", in: page) == Lines.line("n1", above, ""), "\(type)")
    }
  }

  @Test func on_an_empty_bullet_makes_it_a_paragraph_at_the_same_depth() {
    let tinted = #"{"backgroundColor":"default","textColor":"red","textAlignment":"left"}"#
    var page = Lines.editable(
      Lines.document(
        Lines.line(
          "p", "Parent",
          children: [Lines.line("e", "bulletListItem", props: tinted, "", children: [Lines.line("c", "Child")])]),
        Lines.line("o", "numberedListItem", props: #"{"start":4}"#, "")))

    #expect(pressReturn(&page, "e", 0) == Caret(block: "e", offset: 0))
    #expect(pressReturn(&page, "o", 0) == Caret(block: "o", offset: 0))

    #expect(
      Lines.outline(page) == [
        "p paragraph 'Parent'",
        "  e paragraph ''",
        "    c paragraph 'Child'",
        "o paragraph ''",
      ])
    // The web resets the type and keeps the props a paragraph has; `start` is not one of them.
    #expect(Lines.written("e", in: page) == Lines.line("e", props: tinted, "", children: [Lines.line("c", "Child")]))
    #expect(Lines.written("o", in: page) == Lines.line("o", ""))
  }

  @Test func on_an_empty_nested_paragraph_moves_it_out_one_level() {
    var page = Lines.editable(
      Lines.document(
        Lines.line(
          "p", "bulletListItem", "Parent",
          children: [
            Lines.line("one", "One"),
            Lines.line("e", "", children: [Lines.line("g", "Grandchild")]),
            Lines.line("two", "Two"),
          ]),
        Lines.line("q", "After")))

    let caret = pressReturn(&page, "e", 0)

    #expect(caret == Caret(block: "e", offset: 0))
    // BlockNote outdents with `liftItem`, as Shift-Tab does: the lines after it at its old level come under it.
    #expect(
      Lines.outline(page) == [
        "p bulletListItem 'Parent'",
        "  one paragraph 'One'",
        "e paragraph ''",
        "  g paragraph 'Grandchild'",
        "  two paragraph 'Two'",
        "q paragraph 'After'",
      ])
  }

  @Test func on_an_empty_top_level_paragraph_adds_a_paragraph_after_it() {
    var page = Lines.editable(
      Lines.document(Lines.line("e", "", children: [Lines.line("c", "Child")]), Lines.line("b", "After")))

    let caret = pressReturn(&page, "e", 0)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(Lines.outline(page) == ["e paragraph ''", "n1 paragraph ''", "  c paragraph 'Child'", "b paragraph 'After'"])
    #expect(Lines.written("e", in: page) == Lines.line("e", ""))
    #expect(Lines.written("n1", in: page) == Lines.line("n1", "", children: [Lines.line("c", "Child")]))
  }

  @Test func in_a_to_do_makes_a_new_to_do_after_everything_nested_under_it() throws {
    let child = Lines.line("c", "task", props: #"{"taskId":"editor-task:c","role":"plan","planDate":"2026-10-22"}"#, "Sub")
    let bold = #"{"bold":true}"#
    let row = Lines.block(
      "t", "task", props: Self.todoProps, words: [Lines.run("Buy "), Lines.run("milk", styles: bold)], children: [child])
    let day = try #require(LocalDate("2026-10-23"))
    var page = Lines.editable(Lines.document(row, Lines.line("x", "After")), pageDate: day)

    let caret = pressReturn(&page, "t", 6)

    #expect(caret == Caret(block: "n1", offset: 0))
    #expect(
      Lines.outline(page) == ["t task 'Buy mi'", "  c task 'Sub'", "n1 task 'lk'", "x paragraph 'After'"])
    #expect(
      Lines.written("t", in: page)
        == Lines.block(
          "t", "task", props: Self.todoProps, words: [Lines.run("Buy "), Lines.run("mi", styles: bold)],
          children: [child]))
    // Its own task, with the row's role and plan date (not the page's date).
    #expect(
      Lines.written("n1", in: page)
        == Lines.block(
          "n1", "task", props: #"{"taskId":"editor-task:n1","role":"plan","planDate":"2026-10-22"}"#,
          words: [Lines.run("lk", styles: bold)]))
  }

  @Test func at_the_start_of_a_to_do_with_words_puts_an_empty_to_do_above_and_leaves_the_to_do_alone() {
    let row = Lines.line("t", "task", props: Self.todoProps, "Call Sam", children: [Lines.line("c", "Note")])
    var page = Lines.editable(Lines.document(row))

    let caret = pressReturn(&page, "t", 0)

    #expect(caret == Caret(block: "t", offset: 0))
    #expect(Lines.outline(page) == ["n1 task ''", "t task 'Call Sam'", "  c paragraph 'Note'"])
    #expect(Lines.written("t", in: page) == row)
    #expect(
      Lines.written("n1", in: page)
        == Lines.line("n1", "task", props: #"{"taskId":"editor-task:n1","role":"plan","planDate":"2026-10-22"}"#, ""))
  }

  @Test func on_an_empty_to_do_makes_it_a_paragraph() {
    var page = Lines.editable(
      Lines.document(
        Lines.line(
          "b", "bulletListItem", "List",
          children: [Lines.line("t", "task", props: Self.todoProps, "", children: [Lines.line("c", "Child")])])))

    let caret = pressReturn(&page, "t", 0)

    #expect(caret == Caret(block: "t", offset: 0))
    #expect(Lines.outline(page) == ["b bulletListItem 'List'", "  t paragraph ''", "    c paragraph 'Child'"])
    #expect(Lines.written("t", in: page) == Lines.line("t", "", children: [Lines.line("c", "Child")]))
    #expect(page.singleDeleteIds.isEmpty)
  }

  @Test func a_new_blocks_props_are_the_webs() {
    let tinted = #"{"backgroundColor":"yellow","textColor":"red","textAlignment":"right"}"#
    var page = Lines.editable(Lines.document(Lines.line("a", props: tinted, "Split here")))

    _ = pressReturn(&page, "a", 5)

    #expect(
      Lines.written("n1", in: page)
        == #"{"id":"n1","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":" here","styles":{}}],"children":[]}"#
    )
  }

  @Test func a_block_the_app_does_not_draw_is_never_changed() {
    let database = Lines.block(
      "db", "database", props: #"{"databaseId":"d1","view":"table"}"#,
      children: [Lines.line("inside", "Hidden row")])
    let original = Lines.document(Lines.line("a", "Before"), database, Lines.line("b", "After"))
    var page = Lines.editable(original)

    #expect(pressReturn(&page, "db", 0) == nil)
    #expect(pressReturn(&page, "inside", 3) == nil)
    _ = page.replaceText(in: "inside", range: 0..<0, with: "x")
    #expect(page.document == original)

    #expect(pressReturn(&page, "a", 6) == Caret(block: "n1", offset: 0))
    #expect(pressReturn(&page, "b", 0) == Caret(block: "b", offset: 0))

    #expect(
      Lines.outline(page) == [
        "a paragraph 'Before'",
        "n1 paragraph ''",
        "db database ''",
        "  inside paragraph 'Hidden row'",
        "n2 paragraph ''",
        "b paragraph 'After'",
      ])
    #expect(Lines.written("db", in: page) == database)
  }
}
