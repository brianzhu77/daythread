import Testing

@testable import DaythreadCore

/// Short documents written in the tests, in the shape the web stores.
enum Page {
  static let defaults = #"{"backgroundColor":"default","textColor":"default","textAlignment":"left"}"#

  static func run(_ text: String, styles: String = "{}") -> String {
    #"{"type":"text","text":"\#(text)","styles":\#(styles)}"#
  }

  /// A block as stored. `words` is the raw `content` array's items; nil leaves `content` out.
  static func block(
    _ id: String, _ type: String = "paragraph", props: String = defaults, words: [String]? = nil,
    children: [String] = []
  ) -> String {
    let content = words.map { #","content":[\#($0.joined(separator: ","))]"# } ?? ""
    return #"{"id":"\#(id)","type":"\#(type)","props":\#(props)\#(content),"children":[\#(children.joined(separator: ","))]}"#
  }

  static func line(_ id: String, _ type: String = "paragraph", props: String = defaults, _ text: String, children: [String] = [])
    -> String
  {
    block(id, type, props: props, words: text.isEmpty ? [] : [run(text)], children: children)
  }

  static func document(_ blocks: String...) -> String {
    "[\(blocks.joined(separator: ","))]"
  }

  static func editable(_ document: String, pageDate: LocalDate? = nil, newID: String = "n") -> EditablePage {
    EditablePage(document: document, pageDate: pageDate, makeID: { newID })
  }

  /// One line per block, indented by depth: its id, type and words.
  static func outline(_ page: EditablePage) -> [String] {
    var out: [String] = []
    func walk(_ blocks: [Block], depth: Int) {
      for block in blocks {
        let indent = String(repeating: "  ", count: depth)
        out.append("\(indent)\(block.id) \(block.type) '\(InlineContent(block.content).plain)'")
        walk(block.children, depth: depth + 1)
      }
    }
    walk(page.blocks, depth: 0)
    return out
  }

  /// The first block with that id, nested blocks included.
  static func find(_ id: String, in blocks: [Block]) -> Block? {
    for block in blocks {
      if block.id == id { return block }
      if let found = find(id, in: block.children) { return found }
    }
    return nil
  }

  static func written(_ id: String, in page: EditablePage) -> String? {
    find(id, in: page.blocks).map { JSON.write($0.value) }
  }
}

@Suite struct EditablePageTests {
  @Test func typing_changes_only_that_block_in_the_written_document() {
    let original = Page.document(
      Page.line("h", "heading", props: #"{"level":2}"#, "Notes"),
      Page.block(
        "a", props: "{}", words: [Page.run(#"a\/b"#)],
        children: [
          Page.line("b", "bulletListItem", "Hello"),
          Page.block("odd", "paragraph", props: #"{"textColor":"red","x":1.50}"#, words: [Page.run("Keep")]),
        ]),
      Page.line("c", "task", props: #"{"taskId":"editor-task:c","role":"plan","planDate":"2026-10-22"}"#, "Call"))
    var page = Page.editable(original)

    let caret = page.replaceText(in: "b", range: 5..<5, with: " there")

    #expect(caret == EditablePage.Caret(block: "b", offset: 11))
    #expect(
      page.document == original.replacingOccurrences(of: #""text":"Hello""#, with: #""text":"Hello there""#))
  }

  @Test func typing_replaces_a_range_and_a_line_without_content_gains_runs() {
    var page = Page.editable(Page.document(Page.line("a", "Hello world"), Page.block("e")))

    #expect(page.replaceText(in: "a", range: 0..<5, with: "Goodbye") == EditablePage.Caret(block: "a", offset: 7))
    #expect(page.replaceText(in: "e", range: 0..<0, with: "New") == EditablePage.Caret(block: "e", offset: 3))

    #expect(
      page.document
        == Page.document(Page.line("a", "Goodbye world"), Page.block("e", words: [Page.run("New")])))
  }

  @Test func text_blocks_are_the_lines_that_hold_a_caret_in_page_order() {
    let page = Page.editable(
      Page.document(
        Page.line("h", "heading", "Title"),
        Page.line("b", "bulletListItem", "One", children: [Page.line("q", "quote", "Two")]),
        Page.block("d", "divider", props: "{}", children: [Page.line("under", "Below")]),
        Page.block("db", "database", props: #"{"databaseId":"x"}"#, children: [Page.line("inside", "Hidden")]),
        Page.line("t", "task", props: #"{"taskId":"editor-task:t","role":"plan","planDate":""}"#, "Do"),
        Page.line("n", "numberedListItem", "Three")))

    #expect(page.textBlocks == ["h", "b", "q", "under", "t", "n"])
    #expect(page.content(of: "b")?.plain == "One")
    #expect(page.content(of: "db") == nil)
    #expect(page.content(of: "inside") == nil)
    #expect(page.content(of: "missing") == nil)
  }

  @Test func keys_after_return_do_nothing_yet_and_an_unknown_line_does_nothing() {
    let original = Page.document(Page.line("a", "Hello"))
    var page = Page.editable(original)
    let caret = EditablePage.Caret(block: "a", offset: 0)

    #expect(page.press(.backspace, at: caret) == nil)
    #expect(page.press(.tab, at: caret) == nil)
    #expect(page.press(.shiftTab, at: caret) == nil)
    #expect(page.press(.returnKey, at: EditablePage.Caret(block: "missing", offset: 0)) == nil)
    #expect(page.document == original)
    #expect(page.singleDeleteIds.isEmpty)
  }

  @Test func a_repeated_id_acts_on_the_first_line_with_it() {
    let original = Page.document(Page.line("a", "First"), Page.line("a", "Second"))
    var page = Page.editable(original)

    _ = page.replaceText(in: "a", range: 5..<5, with: "!")

    #expect(page.document == Page.document(Page.line("a", "First!"), Page.line("a", "Second")))
  }
}
