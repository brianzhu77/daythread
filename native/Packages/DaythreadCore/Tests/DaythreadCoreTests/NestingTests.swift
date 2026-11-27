import Testing

@testable import DaythreadCore

/// Tab and Shift-Tab (spec §10.3), and the guard of Review Focus 5: no key moves a line into or out of a block the
/// app does not draw the inside of.
@Suite struct NestingTests {
  private typealias Caret = EditablePage.Caret

  private func press(_ key: EditablePage.Key, _ page: inout EditablePage, _ block: String, _ offset: Int = 0) -> Caret? {
    page.press(key, at: Caret(block: block, offset: offset))
  }

  @Test func tab_moves_a_line_under_the_one_before_with_its_own_nested_lines() {
    var page = Lines.editable(
      Lines.document(
        Lines.line("a", "bulletListItem", "One", children: [Lines.line("x", "Kid")]),
        Lines.line("b", "bulletListItem", "Two", children: [Lines.line("c", "Child")]),
        Lines.line("z", "After")))

    #expect(press(.tab, &page, "b", 2) == Caret(block: "b", offset: 2))

    #expect(
      Lines.outline(page) == [
        "a bulletListItem 'One'",
        "  x paragraph 'Kid'",
        "  b bulletListItem 'Two'",
        "    c paragraph 'Child'",
        "z paragraph 'After'",
      ])
    #expect(Lines.written("b", in: page) == Lines.line("b", "bulletListItem", "Two", children: [Lines.line("c", "Child")]))
  }

  @Test func tab_does_nothing_on_a_heading_right_under_a_heading_or_on_the_first_line_of_its_group() {
    let original = Lines.document(
      Lines.line("h", "heading", "Title"),
      Lines.line("p", "Under the heading"),
      Lines.line("q", "Line", children: [Lines.line("k", "First nested")]),
      Lines.line("h2", "heading", "Second"))
    for line in ["h", "p", "k", "h2"] {
      var page = Lines.editable(original)
      #expect(press(.tab, &page, line) == nil, "\(line)")
      #expect(page.document == original, "\(line)")
    }
  }

  @Test func tab_does_nothing_under_a_block_the_app_does_not_draw_the_inside_of() {
    let kinds = [
      Lines.block("x", "database", props: #"{"databaseId":"d1"}"#, children: [Lines.line("inside", "Row")]),
      Lines.block("x", "syncedBlock", props: #"{"syncedId":"s1"}"#, children: [Lines.line("inside", "Shared")]),
      Lines.block("x", "image", props: #"{"url":"https://example.com/a.png"}"#),
    ]
    for kind in kinds {
      let original = Lines.document(Lines.line("a", "Above"), kind, Lines.line("l", "Line"))
      var page = Lines.editable(original)
      #expect(press(.tab, &page, "l", 2) == nil, "\(kind)")
      #expect(page.document == original, "\(kind)")
    }
  }

  @Test func shift_tab_moves_a_line_out_and_takes_the_lines_after_it_as_its_own() {
    var page = Lines.editable(
      Lines.document(
        Lines.line(
          "p", "bulletListItem", "Parent",
          children: [
            Lines.line("a", "One"),
            Lines.line("b", "bulletListItem", "Two", children: [Lines.line("g", "Grand")]),
            Lines.line("c", "Three"),
          ]),
        Lines.line("z", "After")))

    #expect(press(.shiftTab, &page, "b", 1) == Caret(block: "b", offset: 1))

    #expect(
      Lines.outline(page) == [
        "p bulletListItem 'Parent'",
        "  a paragraph 'One'",
        "b bulletListItem 'Two'",
        "  g paragraph 'Grand'",
        "  c paragraph 'Three'",
        "z paragraph 'After'",
      ])
  }

  @Test func shift_tab_does_nothing_at_the_top_level() {
    let original = Lines.document(Lines.line("a", "One"), Lines.line("b", "bulletListItem", "Two"))
    var page = Lines.editable(original)

    #expect(press(.shiftTab, &page, "b") == nil)
    #expect(page.document == original)
  }

  @Test func the_caret_keeps_its_place_in_the_words() {
    var page = Lines.editable(Lines.document(Lines.line("a", "One"), Lines.line("b", "Second line")))

    #expect(press(.tab, &page, "b", 7) == Caret(block: "b", offset: 7))
    #expect(Lines.outline(page) == ["a paragraph 'One'", "  b paragraph 'Second line'"])
    #expect(press(.shiftTab, &page, "b", 4) == Caret(block: "b", offset: 4))
    #expect(Lines.outline(page) == ["a paragraph 'One'", "b paragraph 'Second line'"])
  }

  /// Every key at every caret of every line around a block the app does not draw the inside of, one block kind at
  /// a time, on a fresh page each time. The block is written back exactly as it was read, and a key that does
  /// nothing changes nothing.
  @Test func no_key_moves_a_line_into_or_out_of_a_block_the_app_does_not_draw() {
    let kinds: [(type: String, props: String)] = [
      ("database", #"{"databaseId":"d1","view":"table"}"#),
      ("syncedBlock", #"{"syncedId":"s1"}"#),
      ("image", #"{"url":"https://example.com/a.png"}"#),
      ("file", #"{"url":"https://example.com/a.pdf"}"#),
      ("table", "{}"),
      ("video", #"{"url":"https://example.com/a.mp4"}"#),
      ("pageLink", #"{"pageId":"p2"}"#),
      ("aKindFromALaterBuild", "{}"),
    ]
    let keys: [EditablePage.Key] = [.returnKey, .backspace, .tab, .shiftTab]
    let todo = #"{"taskId":"editor-task:t","role":"plan","planDate":"2026-10-22"}"#
    for (type, props) in kinds {
      func hidden(_ id: String) -> String {
        Lines.block(
          id, type, props: props,
          children: [Lines.line("\(id)-inside", "Hidden", children: [Lines.line("\(id)-deep", "")])])
      }
      let top = hidden("x")
      let nested = hidden("y")
      let later = top.replacingOccurrences(of: #""x"#, with: #""w"#)
      let original = Lines.document(
        Lines.line("a", "Before", children: [Lines.line("an", "Nested before")]),
        top,
        Lines.line("b", "After"),
        Lines.line("e", ""),
        Lines.line("t", "task", props: todo, ""),
        Lines.line(
          "l", "bulletListItem", "List",
          children: [Lines.line("f", "First"), nested, Lines.line("u", "Under"), Lines.line("ue", "")]),
        later,
        Lines.line("last", ""))
      let lines = Lines.editable(original).textBlocks
      #expect(lines == ["a", "an", "b", "e", "t", "l", "f", "u", "ue", "last"], "\(type)")

      for line in lines {
        let length = Lines.editable(original).content(of: line)?.length ?? 0
        for offset in 0...length {
          for key in keys {
            var page = Lines.editable(original)
            let caret = page.press(key, at: Caret(block: line, offset: offset))
            let label = "\(type) \(key) at \(line) \(offset)"
            #expect(Lines.written("x", in: page) == top, "\(label)")
            #expect(Lines.written("y", in: page) == nested, "\(label)")
            #expect(Lines.written("w", in: page) == later, "\(label)")
            if caret == nil { #expect(page.document == original, "\(label)") }
          }
        }
      }

      for inside in ["x", "x-inside", "x-deep", "y-inside"] {
        var page = Lines.editable(original)
        for key in keys { #expect(page.press(key, at: Caret(block: inside, offset: 0)) == nil, "\(type) \(inside)") }
        _ = page.replaceText(in: inside, range: 0..<0, with: "#")
        _ = page.replaceText(in: inside, range: 1..<1, with: " ")
        #expect(page.document == original, "\(type) \(inside)")
      }
    }
  }
}
