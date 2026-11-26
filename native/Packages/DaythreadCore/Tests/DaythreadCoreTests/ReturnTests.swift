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
    var page = Page.editable(Page.document(Page.line("a", props: props, "Hello world"), Page.line("b", "Next")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(Page.outline(page) == ["a paragraph 'Hello'", "n paragraph ' world'", "b paragraph 'Next'"])
    #expect(Page.written("a", in: page) == Page.line("a", props: props, "Hello"))
    #expect(Page.written("b", in: page) == Page.line("b", "Next"))
  }

  @Test func at_the_end_of_a_bullet_makes_a_bullet() {
    var page = Page.editable(Page.document(Page.line("a", "bulletListItem", "Milk")))

    let caret = pressReturn(&page, "a", 4)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(Page.outline(page) == ["a bulletListItem 'Milk'", "n bulletListItem ''"])
    #expect(Page.written("a", in: page) == Page.line("a", "bulletListItem", "Milk"))
    #expect(Page.written("n", in: page) == Page.line("n", "bulletListItem", ""))
  }

  @Test func of_a_numbered_item_makes_a_numbered_item() {
    let started = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","start":7}"#
    var page = Page.editable(Page.document(Page.line("a", "numberedListItem", props: started, "Seven eight")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(Page.written("a", in: page) == Page.line("a", "numberedListItem", props: started, "Seven"))
    // The second item counts on from the first; it does not restart at 7.
    #expect(Page.written("n", in: page) == Page.line("n", "numberedListItem", " eight"))
  }

  @Test func of_a_quote_makes_a_paragraph() {
    let quote = #"{"backgroundColor":"default","textColor":"default"}"#
    var page = Page.editable(Page.document(Page.line("a", "quote", props: quote, "To be or")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(Page.written("a", in: page) == Page.line("a", "quote", props: quote, "To be"))
    #expect(Page.written("n", in: page) == Page.line("n", " or"))
  }

  @Test func in_a_heading_makes_a_paragraph_of_the_rest() {
    let heading = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":2,"isToggleable":false}"#
    var page = Page.editable(Page.document(Page.line("a", "heading", props: heading, "Notes today")))

    let caret = pressReturn(&page, "a", 5)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(Page.written("a", in: page) == Page.line("a", "heading", props: heading, "Notes"))
    #expect(Page.written("n", in: page) == Page.line("n", " today"))
  }

  @Test func nested_lines_go_with_the_second_half() {
    let child = Page.line("c", "Child", children: [Page.line("g", "Grandchild")])
    var page = Page.editable(
      Page.document(Page.line("a", "bulletListItem", "Parent", children: [child]), Page.line("b", "After")))

    let caret = pressReturn(&page, "a", 3)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(
      Page.outline(page) == [
        "a bulletListItem 'Par'",
        "n bulletListItem 'ent'",
        "  c paragraph 'Child'",
        "    g paragraph 'Grandchild'",
        "b paragraph 'After'",
      ])
    #expect(Page.written("c", in: page) == child)
  }

  @Test func at_the_start_of_a_line_with_words_puts_an_empty_line_above() {
    let heading = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":2,"isToggleable":false}"#
    let cases: [(type: String, props: String, above: String)] = [
      ("bulletListItem", Page.defaults, "bulletListItem"),
      ("numberedListItem", #"{"start":3}"#, "numberedListItem"),
      ("paragraph", Page.defaults, "paragraph"),
      ("heading", heading, "paragraph"),
      ("quote", #"{"backgroundColor":"default","textColor":"default"}"#, "paragraph"),
    ]
    for (type, props, above) in cases {
      let line = Page.line("a", type, props: props, "Words", children: [Page.line("c", "Nested")])
      var page = Page.editable(Page.document(line))

      let caret = pressReturn(&page, "a", 0)

      #expect(caret == Caret(block: "a", offset: 0), "\(type)")
      #expect(Page.outline(page) == ["n \(above) ''", "a \(type) 'Words'", "  c paragraph 'Nested'"], "\(type)")
      #expect(Page.written("a", in: page) == line, "\(type)")
      #expect(Page.written("n", in: page) == Page.line("n", above, ""), "\(type)")
    }
  }

  @Test func on_an_empty_bullet_makes_it_a_paragraph_at_the_same_depth() {
    let tinted = #"{"backgroundColor":"default","textColor":"red","textAlignment":"left"}"#
    var page = Page.editable(
      Page.document(
        Page.line(
          "p", "Parent",
          children: [Page.line("e", "bulletListItem", props: tinted, "", children: [Page.line("c", "Child")])]),
        Page.line("o", "numberedListItem", props: #"{"start":4}"#, "")))

    #expect(pressReturn(&page, "e", 0) == Caret(block: "e", offset: 0))
    #expect(pressReturn(&page, "o", 0) == Caret(block: "o", offset: 0))

    #expect(
      Page.outline(page) == [
        "p paragraph 'Parent'",
        "  e paragraph ''",
        "    c paragraph 'Child'",
        "o paragraph ''",
      ])
    // The web resets the type and keeps the props a paragraph has; `start` is not one of them.
    #expect(Page.written("e", in: page) == Page.line("e", props: tinted, "", children: [Page.line("c", "Child")]))
    #expect(Page.written("o", in: page) == Page.line("o", ""))
  }

  @Test func on_an_empty_nested_paragraph_moves_it_out_one_level() {
    var page = Page.editable(
      Page.document(
        Page.line(
          "p", "bulletListItem", "Parent",
          children: [
            Page.line("one", "One"),
            Page.line("e", "", children: [Page.line("g", "Grandchild")]),
            Page.line("two", "Two"),
          ]),
        Page.line("q", "After")))

    let caret = pressReturn(&page, "e", 0)

    #expect(caret == Caret(block: "e", offset: 0))
    // BlockNote outdents with `liftItem`, as Shift-Tab does: the lines after it at its old level come under it.
    #expect(
      Page.outline(page) == [
        "p bulletListItem 'Parent'",
        "  one paragraph 'One'",
        "e paragraph ''",
        "  g paragraph 'Grandchild'",
        "  two paragraph 'Two'",
        "q paragraph 'After'",
      ])
  }

  @Test func on_an_empty_top_level_paragraph_adds_a_paragraph_after_it() {
    var page = Page.editable(
      Page.document(Page.line("e", "", children: [Page.line("c", "Child")]), Page.line("b", "After")))

    let caret = pressReturn(&page, "e", 0)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(Page.outline(page) == ["e paragraph ''", "n paragraph ''", "  c paragraph 'Child'", "b paragraph 'After'"])
    #expect(Page.written("e", in: page) == Page.line("e", ""))
    #expect(Page.written("n", in: page) == Page.line("n", "", children: [Page.line("c", "Child")]))
  }

  @Test func in_a_to_do_makes_a_new_to_do_after_everything_nested_under_it() throws {
    let child = Page.line("c", "task", props: #"{"taskId":"editor-task:c","role":"plan","planDate":"2026-10-22"}"#, "Sub")
    let bold = #"{"bold":true}"#
    let row = Page.block(
      "t", "task", props: Self.todoProps, words: [Page.run("Buy "), Page.run("milk", styles: bold)], children: [child])
    let day = try #require(LocalDate("2026-10-23"))
    var page = Page.editable(Page.document(row, Page.line("x", "After")), pageDate: day)

    let caret = pressReturn(&page, "t", 6)

    #expect(caret == Caret(block: "n", offset: 0))
    #expect(
      Page.outline(page) == ["t task 'Buy mi'", "  c task 'Sub'", "n task 'lk'", "x paragraph 'After'"])
    #expect(
      Page.written("t", in: page)
        == Page.block(
          "t", "task", props: Self.todoProps, words: [Page.run("Buy "), Page.run("mi", styles: bold)],
          children: [child]))
    // Its own task, with the row's role and plan date (not the page's date).
    #expect(
      Page.written("n", in: page)
        == Page.block(
          "n", "task", props: #"{"taskId":"editor-task:n","role":"plan","planDate":"2026-10-22"}"#,
          words: [Page.run("lk", styles: bold)]))
  }

  @Test func at_the_start_of_a_to_do_with_words_puts_an_empty_to_do_above_and_leaves_the_to_do_alone() {
    let row = Page.line("t", "task", props: Self.todoProps, "Call Sam", children: [Page.line("c", "Note")])
    var page = Page.editable(Page.document(row))

    let caret = pressReturn(&page, "t", 0)

    #expect(caret == Caret(block: "t", offset: 0))
    #expect(Page.outline(page) == ["n task ''", "t task 'Call Sam'", "  c paragraph 'Note'"])
    #expect(Page.written("t", in: page) == row)
    #expect(
      Page.written("n", in: page)
        == Page.line("n", "task", props: #"{"taskId":"editor-task:n","role":"plan","planDate":"2026-10-22"}"#, ""))
  }

  @Test func on_an_empty_to_do_makes_it_a_paragraph() {
    var page = Page.editable(
      Page.document(
        Page.line(
          "b", "bulletListItem", "List",
          children: [Page.line("t", "task", props: Self.todoProps, "", children: [Page.line("c", "Child")])])))

    let caret = pressReturn(&page, "t", 0)

    #expect(caret == Caret(block: "t", offset: 0))
    #expect(Page.outline(page) == ["b bulletListItem 'List'", "  t paragraph ''", "    c paragraph 'Child'"])
    #expect(Page.written("t", in: page) == Page.line("t", "", children: [Page.line("c", "Child")]))
    #expect(page.singleDeleteIds.isEmpty)
  }

  @Test func a_new_blocks_props_are_the_webs() {
    let tinted = #"{"backgroundColor":"yellow","textColor":"red","textAlignment":"right"}"#
    var page = Page.editable(Page.document(Page.line("a", props: tinted, "Split here")))

    _ = pressReturn(&page, "a", 5)

    #expect(
      Page.written("n", in: page)
        == #"{"id":"n","type":"paragraph","props":{"backgroundColor":"default","textColor":"default","textAlignment":"left"},"content":[{"type":"text","text":" here","styles":{}}],"children":[]}"#
    )
  }

  @Test func a_block_the_app_does_not_draw_is_never_changed() {
    let database = Page.block(
      "db", "database", props: #"{"databaseId":"d1","view":"table"}"#,
      children: [Page.line("inside", "Hidden row")])
    let original = Page.document(Page.line("a", "Before"), database, Page.line("b", "After"))
    var page = Page.editable(original)

    #expect(pressReturn(&page, "db", 0) == nil)
    #expect(pressReturn(&page, "inside", 3) == nil)
    #expect(page.replaceText(in: "inside", range: 0..<0, with: "x") == Caret(block: "inside", offset: 0))
    #expect(page.document == original)

    #expect(pressReturn(&page, "a", 6) == Caret(block: "n", offset: 0))
    #expect(pressReturn(&page, "b", 0) == Caret(block: "b", offset: 0))

    #expect(
      Page.outline(page) == [
        "a paragraph 'Before'",
        "n paragraph ''",
        "db database ''",
        "  inside paragraph 'Hidden row'",
        "n paragraph ''",
        "b paragraph 'After'",
      ])
    #expect(Page.written("db", in: page) == database)
  }
}
