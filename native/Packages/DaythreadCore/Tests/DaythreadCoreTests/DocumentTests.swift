import Testing

@testable import DaythreadCore

@Suite struct DocumentTests {
  @Test func editing_one_block_leaves_every_other_block_as_it_was() throws {
    let s = try Fixtures.document("day-with-everything")
    var blocks = Document.blocks(s)
    let i = try #require(blocks.firstIndex { $0.type == "paragraph" })
    blocks[i].content = .array([.object(textRun("changed"))])
    let before = try #require(try JSON.parse(s).arrayValue)
    let after = try #require(try JSON.parse(Document.write(blocks)).arrayValue)
    #expect(before.count == after.count)
    for j in before.indices where j != i { #expect(before[j] == after[j]) }
    #expect(before[i] != after[i])
  }

  @Test func an_edit_changes_only_the_text_of_the_edited_block_in_the_written_string() throws {
    let s = #"[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"one","styles":{}}],"children":[]},{"id":"b","type":"paragraph","props":{},"content":[],"children":[]}]"#
    var blocks = Document.blocks(s)
    blocks[0].content = .array([.object(textRun("two"))])
    #expect(Document.write(blocks) == s.replacing("one", with: "two"))
  }

  @Test func a_document_that_is_not_JSON_reads_as_empty_and_says_so() {
    #expect(Document.blocks("{not json").isEmpty)
    #expect(!Document.parses("{not json"))
    #expect(Document.parses("[]"))
  }

  @Test func twenty_levels_of_children_survive() throws {
    var s = #"{"id":"n20","type":"paragraph","props":{},"children":[]}"#
    for level in stride(from: 19, through: 1, by: -1) {
      s = #"{"id":"n\#(level)","type":"paragraph","props":{},"children":[\#(s)]}"#
    }
    s = "[\(s)]"
    var depth = 0
    var level = Document.blocks(s)
    while let first = level.first {
      depth += 1
      level = first.children
    }
    #expect(depth == 20)
    #expect(Document.write(Document.blocks(s)) == s)
  }

  @Test func a_block_reads_its_named_fields_and_keeps_the_rest_in_raw() throws {
    let s = #"[{"id":"h1","type":"heading","props":{"level":2},"content":[{"type":"text","text":"Plan","styles":{}}],"children":[],"extra":{"k":1}}]"#
    let block = try #require(Document.blocks(s).first)
    #expect(block.id == "h1")
    #expect(block.type == "heading")
    #expect(block.props["level"]?.intValue == 2)
    #expect(block.content?.arrayValue?.count == 1)
    #expect(block.children.isEmpty)
    #expect(block.raw["extra"] != nil)
    #expect(Document.write([block]) == s)
  }

  @Test func a_node_without_content_has_nil_content_and_stays_without() throws {
    let s = #"[{"id":"d","type":"divider","props":{},"children":[]}]"#
    let blocks = Document.blocks(s)
    #expect(blocks.first?.content == nil)
    #expect(Document.write(blocks) == s)
  }

  @Test func content_that_is_not_an_array_is_kept_as_is() throws {
    let s = #"[{"id":"t","type":"table","props":{},"content":{"type":"tableContent","rows":[]},"children":[]}]"#
    let blocks = Document.blocks(s)
    #expect(blocks.first?.content?.objectValue != nil)
    #expect(Document.write(blocks) == s)
  }

  @Test func an_unknown_field_stays_in_place_when_a_named_field_changes() throws {
    let s = #"[{"id":"a","extra":true,"type":"paragraph","props":{},"children":[]}]"#
    var blocks = Document.blocks(s)
    blocks[0].type = "heading"
    #expect(Document.write(blocks) == #"[{"id":"a","extra":true,"type":"heading","props":{},"children":[]}]"#)
  }

  @Test func a_field_the_node_did_not_have_is_appended_when_set() throws {
    let s = #"[{"id":"a","type":"paragraph","props":{}}]"#
    var blocks = Document.blocks(s)
    #expect(blocks[0].children.isEmpty)
    #expect(Document.write(blocks) == s)
    blocks[0].children = [Block(id: "b", type: "paragraph")]
    #expect(
      Document.write(blocks)
        == #"[{"id":"a","type":"paragraph","props":{},"children":[{"id":"b","type":"paragraph","props":{},"children":[]}]}]"#
    )
  }

  @Test func content_given_to_a_block_that_had_none_is_written_before_children() throws {
    let s = #"[{"id":"a","type":"paragraph","props":{},"children":[]}]"#
    var blocks = Document.blocks(s)
    #expect(Document.write(blocks) == s)
    blocks[0].content = .array([.object(textRun("hi"))])
    #expect(
      Document.write(blocks)
        == #"[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"hi","styles":{}}],"children":[]}]"#
    )
  }

  @Test func content_given_to_a_node_with_no_content_and_no_children_is_written_last() throws {
    let s = #"[{"id":"a","type":"paragraph","props":{}}]"#
    var blocks = Document.blocks(s)
    blocks[0].content = .array([])
    #expect(Document.write(blocks) == #"[{"id":"a","type":"paragraph","props":{},"content":[]}]"#)
  }

  @Test func unedited_blocks_still_write_back_identically() throws {
    for name in try Fixtures.documentNames() {
      let s = try Fixtures.document(name)
      #expect(Document.write(Document.blocks(s)) == s, "\(name)")
    }
  }

  @Test func clearing_content_removes_the_key() throws {
    let s = #"[{"id":"a","type":"paragraph","props":{},"content":[],"children":[]}]"#
    var blocks = Document.blocks(s)
    blocks[0].content = nil
    #expect(Document.write(blocks) == #"[{"id":"a","type":"paragraph","props":{},"children":[]}]"#)
  }

  @Test func editing_a_child_leaves_its_siblings_and_its_parent_s_other_fields_alone() throws {
    let s = #"[{"id":"p","type":"bulletListItem","props":{},"content":[],"children":[{"id":"c1","type":"paragraph","props":{},"content":[],"children":[]},{"id":"c2","type":"paragraph","props":{},"content":[],"children":[]}],"z":0}]"#
    var blocks = Document.blocks(s)
    blocks[0].children[1].props["k"] = .string("v")
    #expect(
      Document.write(blocks)
        == s.replacing(#"{"id":"c2","type":"paragraph","props":{}"#, with: #"{"id":"c2","type":"paragraph","props":{"k":"v"}"#)
    )
  }

  @Test(arguments: [
    #"[{"type":"paragraph","props":{},"children":[]}]"#,
    #"[{"id":"a","props":{},"children":[]}]"#,
    #"[{"id":1,"type":"paragraph","props":{},"children":[]}]"#,
    #"[{"id":"a","type":"paragraph","props":{},"children":"x"}]"#,
    #"[{"id":"a","type":"paragraph","props":{},"children":[1]}]"#,
    #"[{"id":"a","type":"paragraph","props":{},"children":[{"type":"paragraph"}]}]"#,
    #"[{"id":"a","type":"paragraph","props":{},"children":[]}, 3]"#,
    #"{"id":"a","type":"paragraph"}"#,
    #"[{"id":"a","type":"paragraph","props":[],"children":[]}]"#,
  ])
  func an_unreadable_node_makes_the_whole_document_unreadable(_ s: String) {
    #expect(Document.blocks(s).isEmpty)
    #expect(!Document.parses(s))
  }

  @Test func every_fixture_document_parses_and_has_blocks_except_the_empty_one() throws {
    for name in try Fixtures.documentNames() {
      let s = try Fixtures.document(name)
      #expect(Document.parses(s), "\(name)")
      #expect(Document.blocks(s).isEmpty == (name == "empty"), "\(name)")
    }
  }

  // MARK: Fields are rewritten only when they changed

  @Test func an_escaped_id_is_written_back_as_it_was() throws {
    let s = #"[{"id":"\u0061","type":"paragraph","props":{},"content":[],"children":[]}]"#
    #expect(s.utf8.contains(UInt8(ascii: "\\")))
    var blocks = Document.blocks(s)
    #expect(blocks.first?.id == "a")
    #expect(Document.write(blocks) == s)
    blocks[0].id = "b"
    #expect(Document.write(blocks) == #"[{"id":"b","type":"paragraph","props":{},"content":[],"children":[]}]"#)
  }

  @Test func an_escaped_type_is_written_back_as_it_was() throws {
    let s = #"[{"id":"a","type":"par\u0061graph","props":{},"content":[],"children":[]}]"#
    #expect(s.utf8.contains(UInt8(ascii: "\\")))
    var blocks = Document.blocks(s)
    #expect(blocks.first?.type == "paragraph")
    #expect(Document.write(blocks) == s)
    blocks[0].type = "heading"
    #expect(Document.write(blocks) == #"[{"id":"a","type":"heading","props":{},"content":[],"children":[]}]"#)
  }

  private static let nfc = String(Unicode.Scalar(0xE9)!)
  private static let nfd = String(String.UnicodeScalarView([Unicode.Scalar(0x65)!, Unicode.Scalar(0x301)!]))

  @Test func a_document_holding_decomposed_text_round_trips_byte_identically() throws {
    let s = "[{\"id\":\"a\",\"type\":\"paragraph\",\"props\":{},\"content\":[{\"type\":\"text\",\"text\":\"caf\(Self.nfd)\",\"styles\":{}}],\"children\":[]}]"
    #expect(Array(Document.write(Document.blocks(s)).utf8) == Array(s.utf8))
    #expect(Array(JSON.write(try JSON.parse(s)).utf8) == Array(s.utf8))
  }

  @Test func an_edit_that_only_changes_normalization_is_written() throws {
    func document(_ text: String) -> String {
      "[{\"id\":\"a\",\"type\":\"paragraph\",\"props\":{},\"content\":[{\"type\":\"text\",\"text\":\"\(text)\",\"styles\":{}}],\"children\":[]}]"
    }
    var blocks = Document.blocks(document(Self.nfd))
    blocks[0].content = .array([.object(textRun(Self.nfc))])
    #expect(Array(Document.write(blocks).utf8) == Array(document(Self.nfc).utf8))
  }

  @Test func an_id_that_only_changes_normalization_is_written() throws {
    var blocks = Document.blocks("[{\"id\":\"\(Self.nfd)\",\"type\":\"paragraph\",\"props\":{},\"children\":[]}]")
    blocks[0].id = Self.nfc
    #expect(Array(Document.write(blocks).utf8) == Array("[{\"id\":\"\(Self.nfc)\",\"type\":\"paragraph\",\"props\":{},\"children\":[]}]".utf8))
  }
}
