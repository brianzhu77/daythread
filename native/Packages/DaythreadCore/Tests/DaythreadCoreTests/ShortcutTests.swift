import Testing

@testable import DaythreadCore

/// The typed shortcuts (spec §10.3): characters typed at the start of a paragraph that change its kind.
@Suite struct ShortcutTests {
  private typealias Caret = EditablePage.Caret

  /// Types `characters` one at a time from `offset`, as the keyboard sends them. Returns the last caret.
  @discardableResult
  private func type(_ characters: String, into block: String, at offset: Int = 0, _ page: inout EditablePage) -> Caret {
    var caret = Caret(block: block, offset: offset)
    for character in characters {
      caret = page.replaceText(in: caret.block, range: caret.offset..<caret.offset, with: String(character))
    }
    return caret
  }

  @Test func typed_at_the_start_of_a_paragraph_they_change_its_kind_keeping_id_depth_and_nested_lines() throws {
    let day = try #require(LocalDate("2026-11-26"))
    let heading = { (level: Int) in
      #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","level":\#(level),"isToggleable":false}"#
    }
    let cases: [(typed: String, type: String, props: String)] = [
      ("# ", "heading", heading(1)),
      ("## ", "heading", heading(2)),
      ("### ", "heading", heading(3)),
      ("- ", "bulletListItem", Lines.defaults),
      ("* ", "bulletListItem", Lines.defaults),
      ("1. ", "numberedListItem", Lines.defaults),
      ("7. ", "numberedListItem", #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","start":7}"#),
      ("[] ", "task", #"{"taskId":"editor-task:l","role":"plan","planDate":"2026-11-26"}"#),
      ("> ", "quote", #"{"backgroundColor":"default","textColor":"default"}"#),
    ]
    for (typed, type, props) in cases {
      let child = Lines.line("c", "Child")
      var page = Lines.editable(
        Lines.document(Lines.line("p", "bulletListItem", "Parent", children: [Lines.line("l", "Words", children: [child])])),
        pageDate: day)

      #expect(self.type(typed, into: "l", &page) == Caret(block: "l", offset: 0), "\(typed)")

      #expect(
        Lines.outline(page) == ["p bulletListItem 'Parent'", "  l \(type) 'Words'", "    c paragraph 'Child'"], "\(typed)")
      #expect(Lines.written("l", in: page) == Lines.line("l", type, props: props, "Words", children: [child]), "\(typed)")
    }
  }

  @Test func a_colour_the_paragraph_had_stays() {
    let tinted = #"{"backgroundColor":"yellow","textColor":"red","textAlignment":"center"}"#
    var page = Lines.editable(Lines.document(Lines.line("l", props: tinted, "")))

    type("- ", into: "l", &page)

    #expect(Lines.written("l", in: page) == Lines.line("l", "bulletListItem", props: tinted, ""))
  }

  @Test func three_dashes_on_a_line_of_their_own_make_a_divider_and_the_caret_goes_to_an_empty_line_after_it() {
    let child = Lines.line("c", "Child")
    var page = Lines.editable(Lines.document(Lines.line("l", "", children: [child]), Lines.line("z", "Next")))

    #expect(type("---", into: "l", &page) == Caret(block: "n2", offset: 0))

    // A new block, as the web's `insertSeparator` replaces the line with one; the nested lines stay under it.
    #expect(Lines.outline(page) == ["n1 divider ''", "  c paragraph 'Child'", "n2 paragraph ''", "z paragraph 'Next'"])
    #expect(Lines.written("n1", in: page) == #"{"id":"n1","type":"divider","props":{},"children":[\#(child)]}"#)
    #expect(Lines.written("n2", in: page) == Lines.line("n2", ""))

    // An empty line with nothing nested after it takes the caret; one with nested lines does not.
    var existing = Lines.editable(Lines.document(Lines.line("l", ""), Lines.line("e", "")))
    #expect(type("---", into: "l", &existing) == Caret(block: "e", offset: 0))
    #expect(Lines.outline(existing) == ["n1 divider ''", "e paragraph ''"])

    var full = Lines.editable(Lines.document(Lines.line("l", ""), Lines.line("e", "", children: [child])))
    #expect(type("---", into: "l", &full) == Caret(block: "n2", offset: 0))
    #expect(Lines.outline(full) == ["n1 divider ''", "n2 paragraph ''", "e paragraph ''", "  c paragraph 'Child'"])

    // Not on a line with other words.
    var words = Lines.editable(Lines.document(Lines.line("l", "x")))
    #expect(type("---", into: "l", &words) == Caret(block: "l", offset: 3))
    #expect(Lines.outline(words) == ["l paragraph '---x'"])
  }

  @Test func three_dashes_make_a_divider_in_any_line_but_a_to_do() {
    for kind in ["bulletListItem", "heading", "quote", "numberedListItem"] {
      let child = Lines.line("c", "Child")
      var page = Lines.editable(Lines.document(Lines.line("l", kind, "", children: [child])))

      #expect(type("---", into: "l", &page) == Caret(block: "n2", offset: 0), "\(kind)")
      #expect(Lines.outline(page) == ["n1 divider ''", "  c paragraph 'Child'", "n2 paragraph ''"], "\(kind)")
    }
  }

  @Test func backspace_straight_after_a_shortcut_puts_the_characters_back() {
    for typed in ["# ", "- ", "7. ", "[] ", "> "] {
      let original = Lines.line("l", "Words")
      var page = Lines.editable(Lines.document(original))
      type(typed, into: "l", &page)

      #expect(page.press(.backspace, at: Caret(block: "l", offset: 0)) == Caret(block: "l", offset: typed.utf16.count))

      #expect(Lines.written("l", in: page) == Lines.line("l", "\(typed)Words"), "\(typed)")
      // Not the page's first line letting go of a to-do: there never was one.
      #expect(page.singleDeleteIds.isEmpty, "\(typed)")
    }

    // After anything else, Backspace is the ordinary rule.
    var later = Lines.editable(Lines.document(Lines.line("a", "Above"), Lines.line("l", "Words")))
    type("> ", into: "l", &later)
    _ = later.replaceText(in: "l", range: 0..<0, with: "x")
    _ = later.replaceText(in: "l", range: 0..<1, with: "")
    #expect(later.press(.backspace, at: Caret(block: "l", offset: 0)) == Caret(block: "l", offset: 0))
    #expect(Lines.outline(later) == ["a paragraph 'Above'", "l paragraph 'Words'"])

    // And only for the line the shortcut changed.
    var other = Lines.editable(Lines.document(Lines.line("a", "bulletListItem", "Above"), Lines.line("l", "Words")))
    type("- ", into: "l", &other)
    #expect(other.press(.backspace, at: Caret(block: "a", offset: 0)) == Caret(block: "a", offset: 0))
    #expect(Lines.outline(other) == ["a paragraph 'Above'", "l bulletListItem 'Words'"])
  }

  @Test func inside_a_to_do_they_are_just_characters() {
    let todo = #"{"taskId":"editor-task:t","role":"plan","planDate":"2026-10-22"}"#
    for typed in ["# ", "- ", "1. ", "[] ", "> ", "---"] {
      var page = Lines.editable(Lines.document(Lines.line("t", "task", props: todo, "")))

      #expect(type(typed, into: "t", &page) == Caret(block: "t", offset: typed.utf16.count), "\(typed)")
      #expect(Lines.written("t", in: page) == Lines.line("t", "task", props: todo, typed), "\(typed)")
    }
  }

  @Test func in_any_other_line_but_a_paragraph_they_are_just_characters() {
    for kind in ["bulletListItem", "heading", "quote", "numberedListItem"] {
      var page = Lines.editable(Lines.document(Lines.line("l", kind, "")))

      #expect(type("- ", into: "l", &page) == Caret(block: "l", offset: 2), "\(kind)")
      #expect(type("-", into: "l", at: 2, &page) == Caret(block: "l", offset: 3), "\(kind)")
      #expect(Lines.outline(page) == ["l \(kind) '- -'"], "\(kind)")
    }
  }

  @Test func not_at_the_start_they_are_just_characters() {
    var page = Lines.editable(Lines.document(Lines.line("l", "Hi")))
    #expect(type(" # ", into: "l", at: 2, &page) == Caret(block: "l", offset: 5))
    #expect(Lines.outline(page) == ["l paragraph 'Hi # '"])

    // Nor a pattern the web does not have, nor one pasted whole.
    for typed in ["#### ", "#x ", "1.5 "] {
      var other = Lines.editable(Lines.document(Lines.line("l", "")))
      type(typed, into: "l", &other)
      #expect(Lines.outline(other) == ["l paragraph '\(typed)'"], "\(typed)")
    }
    var pasted = Lines.editable(Lines.document(Lines.line("l", "")))
    #expect(pasted.replaceText(in: "l", range: 0..<0, with: "# ") == Caret(block: "l", offset: 2))
    #expect(Lines.outline(pasted) == ["l paragraph '# '"])
  }
}
