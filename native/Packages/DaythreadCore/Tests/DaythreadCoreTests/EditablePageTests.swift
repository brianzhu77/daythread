import Synchronization
import Testing

@testable import DaythreadCore

/// Short documents written in the tests, in the shape the web stores.
enum Lines {
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

  /// A paragraph with the web's props.
  static func line(_ id: String, _ text: String, children: [String] = []) -> String {
    line(id, "paragraph", props: defaults, text, children: children)
  }

  static func document(_ blocks: String...) -> String {
    "[\(blocks.joined(separator: ","))]"
  }

  /// New blocks get `n1`, `n2`, … in the order they are made.
  static func editable(_ document: String, pageDate: LocalDate? = nil) -> EditablePage {
    let counter = Counter()
    return EditablePage(document: document, pageDate: pageDate, makeID: { "n\(counter.next())" })
  }

  final class Counter: Sendable {
    private let count = Mutex(0)

    func next() -> Int {
      count.withLock { value in
        value += 1
        return value
      }
    }
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
    let original = Lines.document(
      Lines.line("h", "heading", props: #"{"level":2}"#, "Notes"),
      Lines.block(
        "a", props: "{}", words: [Lines.run(#"a\/b"#)],
        children: [
          Lines.line("b", "bulletListItem", "Hello"),
          Lines.block("odd", "paragraph", props: #"{"textColor":"red","x":1.50}"#, words: [Lines.run("Keep")]),
        ]),
      Lines.line("c", "task", props: #"{"taskId":"editor-task:c","role":"plan","planDate":"2026-10-22"}"#, "Call"))
    var page = Lines.editable(original)

    let caret = page.replaceText(in: "b", range: 5..<5, with: " there")

    #expect(caret == EditablePage.Caret(block: "b", offset: 11))
    #expect(
      page.document == original.replacingOccurrences(of: #""text":"Hello""#, with: #""text":"Hello there""#))
  }

  @Test func typing_replaces_a_range_and_a_line_without_content_gains_runs() {
    var page = Lines.editable(Lines.document(Lines.line("a", "Hello world"), Lines.block("e")))

    #expect(page.replaceText(in: "a", range: 0..<5, with: "Goodbye") == EditablePage.Caret(block: "a", offset: 7))
    #expect(page.replaceText(in: "e", range: 0..<0, with: "New") == EditablePage.Caret(block: "e", offset: 3))

    #expect(
      page.document
        == Lines.document(Lines.line("a", "Goodbye world"), Lines.block("e", words: [Lines.run("New")])))
  }

  @Test func text_blocks_are_the_lines_that_hold_a_caret_in_page_order() {
    let page = Lines.editable(
      Lines.document(
        Lines.line("h", "heading", "Title"),
        Lines.line("b", "bulletListItem", "One", children: [Lines.line("q", "quote", "Two")]),
        Lines.block("d", "divider", props: "{}", children: [Lines.line("under", "Below")]),
        Lines.block("db", "database", props: #"{"databaseId":"x"}"#, children: [Lines.line("inside", "Hidden")]),
        Lines.line("t", "task", props: #"{"taskId":"editor-task:t","role":"plan","planDate":""}"#, "Do"),
        Lines.line("n", "numberedListItem", "Three")))

    #expect(page.textBlocks == ["h", "b", "q", "under", "t", "n"])
    #expect(page.content(of: "b")?.plain == "One")
    #expect(page.content(of: "db") == nil)
    #expect(page.content(of: "inside") == nil)
    #expect(page.content(of: "missing") == nil)
  }

  @Test func keys_after_return_do_nothing_yet_and_an_unknown_line_does_nothing() {
    let original = Lines.document(Lines.line("a", "Hello"))
    var page = Lines.editable(original)
    let caret = EditablePage.Caret(block: "a", offset: 0)

    #expect(page.press(.backspace, at: caret) == nil)
    #expect(page.press(.tab, at: caret) == nil)
    #expect(page.press(.shiftTab, at: caret) == nil)
    #expect(page.press(.returnKey, at: EditablePage.Caret(block: "missing", offset: 0)) == nil)
    #expect(page.document == original)
    #expect(page.singleDeleteIds.isEmpty)
  }

  @Test func a_document_that_does_not_read_is_never_rewritten_or_edited() {
    let unreadable = [
      "not json",
      #"{"id":"a","type":"paragraph"}"#,
      #"[{"id":"a","type":"paragraph","props":{},"content":[],"children":{}}]"#,
    ]
    for original in unreadable {
      var page = Lines.editable(original)

      #expect(!page.isReadable, "\(original)")
      #expect(page.document == original, "\(original)")
      #expect(page.press(.returnKey, at: EditablePage.Caret(block: "a", offset: 0)) == nil, "\(original)")
      _ = page.replaceText(in: "a", range: 0..<0, with: "x")
      #expect(page.document == original, "\(original)")
      #expect(page.blocks.isEmpty && page.textBlocks.isEmpty, "\(original)")
    }
    #expect(Lines.editable("[]").isReadable)
  }

  @Test func an_untouched_page_is_written_back_as_it_was_read() throws {
    let originals = try Fixtures.documentStrings() + [
      // Whitespace and an escape that writing the blocks back would not reproduce.
      "[ {\"id\":\"a\",\"type\":\"paragraph\",\"props\":{},\"content\":[{\"type\":\"text\",\"text\":\"x\",\"styles\":{}}],\"children\":[]} ]"
    ]
    #expect(originals.count > 1)
    for original in originals {
      var page = Lines.editable(original)
      #expect(page.document == original)

      let ids = page.textBlocks
      // Inside the words Backspace is the text view's: the key itself does nothing.
      #expect(page.press(.backspace, at: EditablePage.Caret(block: ids.first ?? "missing", offset: 1)) == nil)
      #expect(page.press(.returnKey, at: EditablePage.Caret(block: "missing", offset: 0)) == nil)
      if let id = ids.first { _ = page.replaceText(in: id, range: 0..<0, with: "") }
      #expect(page.document == original)
    }
  }

  @Test func a_repeated_id_acts_on_the_first_line_with_it() {
    let original = Lines.document(Lines.line("a", "First"), Lines.line("a", "Second"))
    var page = Lines.editable(original)

    _ = page.replaceText(in: "a", range: 5..<5, with: "!")

    #expect(page.document == Lines.document(Lines.line("a", "First!"), Lines.line("a", "Second")))
  }

  /// The page that replaces an edited one (a redraw from outside) still names the rows he removed one at a time,
  /// while they are not in it; a row that is back, anywhere, is no longer named.
  @Test func rows_removed_one_at_a_time_are_carried_to_the_page_that_replaces_it() {
    var page = Lines.editable(
      Lines.document(
        Lines.line("a", "One"),
        Lines.block("db", "database", props: #"{"databaseId":"x"}"#, children: [Lines.line("t2", "Inside")])))

    page.carryRemovedRows(["t", "t2", "t3", "t"])

    #expect(page.singleDeleteIds == ["t", "t3"])
    #expect(page.document == Lines.document(
      Lines.line("a", "One"),
      Lines.block("db", "database", props: #"{"databaseId":"x"}"#, children: [Lines.line("t2", "Inside")])))
  }

  /// A tap under a page that ends with a block holding no words: an empty paragraph after it, with the web's props.
  @Test func a_paragraph_is_added_at_the_end_of_the_page() {
    let divider = Lines.block("d", "divider", props: "{}")
    let database = Lines.block("db", "database", props: #"{"databaseId":"x"}"#, children: [Lines.line("in", "Hidden")])
    var page = Lines.editable(Lines.document(Lines.line("a", "One"), divider, database))

    #expect(page.appendParagraph() == EditablePage.Caret(block: "n1", offset: 0))

    #expect(
      page.document
        == Lines.document(Lines.line("a", "One"), divider, database, Lines.block("n1", words: [])))
    #expect(page.textBlocks.last == "n1")

    var unreadable = Lines.editable("not a page")
    #expect(unreadable.appendParagraph() == nil)
    #expect(unreadable.document == "not a page")
  }
}
