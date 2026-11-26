import Testing

@testable import DaythreadCore

@Suite struct InlineContentTests {
  private func parse(_ text: String) throws -> JSONValue { try JSON.parse(text) }

  private func content(_ text: String) throws -> InlineContent {
    InlineContent(try parse(text))
  }

  private func written(_ content: InlineContent) -> String {
    content.json.map(JSON.write) ?? "absent"
  }

  /// Every `content` of every block in the shared documents, nested blocks included.
  private func allContents(in value: JSONValue, into out: inout [JSONValue?]) {
    switch value {
    case .array(let items):
      for item in items { allContents(in: item, into: &out) }
    case .object(let object):
      if object["id"] != nil, object["type"] != nil { out.append(object["content"]) }
      for key in object.keys { if let child = object[key] { allContents(in: child, into: &out) } }
    default: break
    }
  }

  /// One entry per UTF-16 unit with everything that styles it, so two lines that read the same
  /// and look the same compare equal even when one has split a run in two.
  private func perUnit(_ content: InlineContent) throws -> [String] {
    var out: [String] = []
    func walk(_ value: JSONValue, link: String) {
      guard let object = value.objectValue else { return }
      if object["type"]?.stringValue == "text", let text = object["text"]?.stringValue {
        var rest = object
        rest["text"] = nil
        for unit in text.utf16 { out.append("\(unit)|\(link)|\(JSON.write(.object(rest)))") }
      } else if object["type"]?.stringValue == "link", let inner = object["content"]?.arrayValue {
        var rest = object
        rest["content"] = nil
        for item in inner { walk(item, link: JSON.write(.object(rest))) }
      } else {
        out.append("token|\(JSON.write(value))")
      }
    }
    for item in try #require(content.json?.arrayValue) { walk(item, link: "") }
    return out
  }

  @Test func reading_and_writing_back_changes_nothing() throws {
    var all: [JSONValue?] = []
    for document in try Fixtures.documentStrings() { allContents(in: try parse(document), into: &all) }
    #expect(all.count > 20)
    for original in all {
      #expect(InlineContent(original).json == original, "content \(original.map(JSON.write) ?? "absent")")
    }
    for original: JSONValue? in [
      nil, .string("plain"), .number("7"), .null, .bool(true), .object(JSONObject()), .array([]),
      .verbatim("a/b", raw: #"a\/b"#),
      try parse(#"[{"type":"text","text":"a\/b é","styles":{}}]"#),
      try parse(#"[{"type":"text","text":"x","styles":{"bold":true},"future":[1,{"a":null}]}]"#),
      try parse(#"[{"type":"link","href":"h","title":"t","content":[{"type":"text","text":"l","styles":{},"x":1}]}]"#),
      try parse(#"["stray",{"type":"text"},{"type":"link","href":"h"},7]"#),
    ] {
      #expect(InlineContent(original).json == original, "content \(original.map(JSON.write) ?? "absent")")
    }
  }

  @Test func reading_gives_runs_links_and_tokens() throws {
    let line = try content(
      #"[{"type":"text","text":"a","styles":{}},{"type":"link","href":"h","content":[{"type":"text","text":"bc","styles":{}}]},{"type":"pageRef","props":{"pageId":"p"}}]"#)
    #expect(line.items.count == 3)
    #expect(line.length == 4)
    #expect(line.plain == "abc\u{FFFC}")
    #expect(!line.isEmpty)
  }

  @Test func emptiness() throws {
    #expect(InlineContent(nil).isEmpty)
    #expect(InlineContent(.array([])).isEmpty)
    #expect(try content(#"[{"type":"text","text":"","styles":{}}]"#).isEmpty)
    #expect(InlineContent(.string("")).isEmpty)
    #expect(!InlineContent(.string("x")).isEmpty)
    #expect(!(try content(#"[{"type":"pageRef","props":{}}]"#)).isEmpty)
  }

  @Test func typing_inside_a_run_keeps_its_styles() throws {
    var line = try content(
      #"[{"type":"text","text":"ab","styles":{}},{"type":"text","text":"cd","styles":{"bold":true},"k":1}]"#)
    line.replace(3..<3, with: "XY")
    #expect(
      written(line)
        == #"[{"type":"text","text":"ab","styles":{}},{"type":"text","text":"cXYd","styles":{"bold":true},"k":1}]"#)
  }

  @Test func typing_between_two_runs_takes_the_styles_of_the_one_before() throws {
    var line = try content(
      #"[{"type":"text","text":"ab","styles":{"bold":true}},{"type":"text","text":"cd","styles":{"italic":true}}]"#)
    line.replace(2..<2, with: "X")
    #expect(
      written(line)
        == #"[{"type":"text","text":"abX","styles":{"bold":true}},{"type":"text","text":"cd","styles":{"italic":true}}]"#)
  }

  @Test func typing_at_the_start_of_the_line_takes_the_first_runs_styles() throws {
    var line = try content(#"[{"type":"text","text":"ab","styles":{"bold":true}}]"#)
    line.replace(0..<0, with: "X")
    #expect(written(line) == #"[{"type":"text","text":"Xab","styles":{"bold":true}}]"#)
  }

  @Test func typing_into_an_empty_line_makes_a_plain_run() {
    let plainRun = #"[{"type":"text","text":"hi","styles":{}}]"#
    for start: JSONValue? in [nil, .array([]), .string("")] {
      var line = InlineContent(start)
      line.replace(0..<0, with: "hi")
      #expect(written(line) == plainRun)
    }
  }

  @Test func deleting_across_two_runs_leaves_both_runs_remainders_and_drops_an_emptied_run() throws {
    let source =
      #"[{"type":"text","text":"abc","styles":{"bold":true}},{"type":"text","text":"def","styles":{"italic":true}},{"type":"text","text":"ghi","styles":{}}]"#
    var line = try content(source)
    line.replace(2..<7, with: "")
    #expect(
      written(line)
        == #"[{"type":"text","text":"ab","styles":{"bold":true}},{"type":"text","text":"hi","styles":{}}]"#)
    var middle = try content(source)
    middle.replace(3..<6, with: "")
    #expect(
      written(middle)
        == #"[{"type":"text","text":"abc","styles":{"bold":true}},{"type":"text","text":"ghi","styles":{}}]"#)
    var across = try content(source)
    across.replace(1..<5, with: "")
    #expect(
      written(across)
        == #"[{"type":"text","text":"a","styles":{"bold":true}},{"type":"text","text":"f","styles":{"italic":true}},{"type":"text","text":"ghi","styles":{}}]"#)
  }

  @Test func replacing_a_selection_takes_the_styles_where_it_began() throws {
    var line = try content(
      #"[{"type":"text","text":"ab","styles":{"bold":true}},{"type":"text","text":"cd","styles":{}}]"#)
    line.replace(0..<2, with: "X")
    #expect(written(line) == #"[{"type":"text","text":"X","styles":{"bold":true}},{"type":"text","text":"cd","styles":{}}]"#)
  }

  @Test func a_token_is_one_position_wide_can_be_deleted_and_cannot_be_typed_into() throws {
    let source =
      #"[{"type":"text","text":"a","styles":{"bold":true}},{"type":"pageRef","props":{"pageId":"p"}},{"type":"text","text":"b","styles":{"italic":true}}]"#
    let line = try content(source)
    #expect(line.length == 3)

    var before = line
    before.replace(1..<1, with: "X")
    #expect(before.items.count == 3)
    #expect(written(before).contains(#""text":"aX","styles":{"bold":true}"#))

    var after = line
    after.replace(2..<2, with: "X")
    #expect(written(after).contains(#""text":"Xb","styles":{"italic":true}"#))

    var removed = line
    removed.replace(1..<2, with: "")
    #expect(
      written(removed)
        == #"[{"type":"text","text":"a","styles":{"bold":true}},{"type":"text","text":"b","styles":{"italic":true}}]"#)

    var alone = try content(#"[{"type":"pageRef","props":{"pageId":"p"}}]"#)
    alone.replace(0..<0, with: "X")
    #expect(
      written(alone)
        == #"[{"type":"text","text":"X","styles":{}},{"type":"pageRef","props":{"pageId":"p"}}]"#)
    var behind = try content(#"[{"type":"pageRef","props":{"pageId":"p"}}]"#)
    behind.replace(1..<1, with: "X")
    #expect(
      written(behind)
        == #"[{"type":"pageRef","props":{"pageId":"p"}},{"type":"text","text":"X","styles":{}}]"#)
  }

  @Test func typing_inside_a_link_stays_in_the_link() throws {
    var line = try content(
      #"[{"type":"text","text":"a","styles":{}},{"type":"link","href":"h","content":[{"type":"text","text":"bc","styles":{"bold":true}}]}]"#)
    line.replace(2..<2, with: "X")
    #expect(
      written(line)
        == #"[{"type":"text","text":"a","styles":{}},{"type":"link","href":"h","content":[{"type":"text","text":"bXc","styles":{"bold":true}}]}]"#)
  }

  @Test func a_link_emptied_of_words_is_dropped() throws {
    var line = try content(
      #"[{"type":"text","text":"a","styles":{}},{"type":"link","href":"h","content":[{"type":"text","text":"bc","styles":{}}]},{"type":"text","text":"d","styles":{}}]"#)
    line.replace(1..<3, with: "")
    #expect(written(line) == #"[{"type":"text","text":"a","styles":{}},{"type":"text","text":"d","styles":{}}]"#)
  }

  @Test func split_and_append_are_inverse() throws {
    let line = try content(
      #"[{"type":"text","text":"ab😀","styles":{"bold":true}},{"type":"link","href":"h","content":[{"type":"text","text":"cd","styles":{}},{"type":"text","text":"ef","styles":{"code":true}}]},{"type":"dateMention","props":{"eventId":"e","date":"2026-10-22","time":""}},{"type":"text","text":"gh","styles":{}}]"#)
    #expect(line.length == 10)
    for offset in 0...line.length {
      if offset == 3 { continue }  // inside the emoji: covered below
      let (left, right) = line.split(at: offset)
      #expect(left.length == offset, "offset \(offset)")
      #expect(right.length == line.length - offset)
      #expect(left.plain + right.plain == line.plain)
      let joined = left.appending(right)
      #expect(joined.length == line.length)
      #expect(try perUnit(joined) == perUnit(line), "offset \(offset)")
    }
    #expect(line.split(at: 0).1.json == line.json)
    #expect(line.split(at: line.length).0.json == line.json)
    #expect(line.split(at: 0).0.isEmpty)
    // Run boundaries rejoin to exactly what was read.
    for boundary in [4, 6, 8, 9] {
      let (left, right) = line.split(at: boundary)
      #expect(left.appending(right).json == line.json, "boundary \(boundary)")
    }
    // An offset inside a surrogate pair moves back to the character's start.
    let (left, right) = line.split(at: 3)
    #expect(left.length == 2 && right.length == 8)
  }

  @Test func offsets_count_utf16_units() throws {
    var line = try content(#"[{"type":"text","text":"a😀中","styles":{}}]"#)
    #expect(line.length == 4)
    line.replace(3..<3, with: "X")
    #expect(line.plain == "a😀X中")
    line.replace(1..<3, with: "")
    #expect(line.plain == "aX中")
    #expect(line.length == 3)
  }

  @Test func a_range_inside_a_surrogate_pair_grows_to_whole_characters() throws {
    var line = try content(#"[{"type":"text","text":"a😀b","styles":{}}]"#)
    line.replace(2..<3, with: "")
    #expect(line.plain == "ab")
    var typing = try content(#"[{"type":"text","text":"a😀b","styles":{}}]"#)
    typing.replace(2..<2, with: "X")
    #expect(typing.plain == "aX😀b")
    var half = try content(#"[{"type":"text","text":"a😀b","styles":{}}]"#)
    half.replace(1..<2, with: "")
    #expect(half.plain == "ab")
  }

  @Test func a_line_break_inside_a_run_is_kept() throws {
    var line = try content(#"[{"type":"text","text":"a\nb","styles":{}}]"#)
    #expect(line.length == 3)
    #expect(line.plain == "a\nb")
    line.replace(3..<3, with: "c")
    #expect(written(line) == #"[{"type":"text","text":"a\nbc","styles":{}}]"#)
    let (left, right) = line.split(at: 2)
    #expect(left.plain == "a\n" && right.plain == "bc")
  }

  @Test func editing_a_string_or_foreign_content_makes_it_a_list_of_runs() throws {
    var text = InlineContent(.string("ab"))
    text.replace(2..<2, with: "c")
    #expect(written(text) == #"[{"type":"text","text":"abc","styles":{}}]"#)
    var number = InlineContent(.number("7"))
    #expect(number.isEmpty && number.length == 0)
    number.replace(0..<0, with: "x")
    #expect(written(number) == #"[{"type":"text","text":"x","styles":{}}]"#)
  }

  @Test func an_edit_that_changes_nothing_writes_back_what_was_read() throws {
    var line = try content(#"[{"type":"text","text":"a\/b","styles":{}}]"#)
    line.replace(1..<1, with: "")
    #expect(written(line) == #"[{"type":"text","text":"a\/b","styles":{}}]"#)
  }

  @Test func untouched_runs_keep_unknown_fields_after_an_edit_elsewhere() throws {
    var line = try content(
      #"[{"type":"text","text":"a\/b","styles":{},"x":1},{"type":"text","text":"cd","styles":{},"y":2}]"#)
    line.replace(5..<5, with: "!")
    #expect(
      written(line)
        == #"[{"type":"text","text":"a\/b","styles":{},"x":1},{"type":"text","text":"cd!","styles":{},"y":2}]"#)
  }
}
