import Testing

@testable import DaythreadCore

@Suite struct JSONRoundTripTests {
  @Test(arguments: try Fixtures.documentStrings())
  func unedited_document_writes_back_identically(_ s: String) throws {
    #expect(JSON.write(try JSON.parse(s)) == s)
    #expect(Document.write(Document.blocks(s)) == s)
  }

  @Test func every_fixture_document_is_present() throws {
    #expect(try Fixtures.documentNames().count >= 9)
  }

  @Test func writer_matches_JSON_stringify_on_the_hard_characters() throws {
    #expect(JSON.write(.string("a\"b\\c\u{07}\u{2028}中😀\n")) == #""a\"b\\c\u0007\#u{2028}中😀\n""#)
    #expect(
      JSON.write(try JSON.parse(#"{"b":1e21,"a":-0.5,"c":[]}"#)) == #"{"b":1e21,"a":-0.5,"c":[]}"#)
  }

  @Test func control_characters_use_short_escapes_where_JSON_stringify_does() {
    #expect(JSON.write(.string("\u{08}\t\n\u{0C}\r\u{1F}")) == #""\b\t\n\f\r\u001f""#)
  }

  @Test func number_spelling_is_kept() throws {
    for token in ["0", "-0", "10", "1.50", "1E5", "1e+21", "-0.0e-2", "123456789012345678901234567890"] {
      #expect(try JSON.parse(token) == .number(token))
      #expect(JSON.write(try JSON.parse(token)) == token)
    }
  }

  @Test func literals_and_empty_containers_round_trip() throws {
    let s = #"[null,true,false,{},[],"",{"a":{"b":[[]]}}]"#
    #expect(JSON.write(try JSON.parse(s)) == s)
  }

  @Test func whitespace_between_tokens_is_accepted_and_not_kept() throws {
    let value = try JSON.parse(" \t\r\n{ \"a\" : [ 1 , 2 ] }\n")
    #expect(JSON.write(value) == #"{"a":[1,2]}"#)
  }

  @Test func duplicate_keys_keep_the_last_value_at_the_first_position() throws {
    let value = try JSON.parse(#"{"a":1,"b":2,"a":3}"#)
    #expect(JSON.write(value) == #"{"a":3,"b":2}"#)
  }

  @Test func accessors_read_the_matching_case_only() throws {
    #expect(JSONValue.string("x").stringValue == "x")
    #expect(JSONValue.number("1").stringValue == nil)
    #expect(JSONValue.number("42").intValue == 42)
    #expect(JSONValue.number("-7").intValue == -7)
    #expect(JSONValue.number("1.5").intValue == nil)
    #expect(JSONValue.string("42").intValue == nil)
    #expect(JSONValue.bool(true).boolValue == true)
    #expect(JSONValue.null.boolValue == nil)
    #expect(JSONValue.array([.null]).arrayValue == [.null])
    #expect(JSONValue.null.arrayValue == nil)
    #expect(JSONValue.object(JSONObject()).objectValue == JSONObject())
    #expect(JSONValue.null.objectValue == nil)
  }

  // MARK: Strings the writer could not reproduce are kept as written

  /// Every input below is built from raw literals; the backslash check keeps an escape from
  /// silently turning into the literal character it stands for.
  private func escaped(_ input: String, backslashes: Int) -> String {
    #expect(input.utf8.filter { $0 == UInt8(ascii: "\\") }.count == backslashes)
    return input
  }

  @Test func a_lone_surrogate_is_written_back_as_it_was() throws {
    let input = escaped(#""\ud83d""#, backslashes: 1)
    #expect(input.utf8.count == 8)
    let value = try JSON.parse(input)
    guard case .verbatim = value else { Issue.record("expected .verbatim, got \(value)"); return }
    #expect(JSON.write(value) == input)
    #expect(value.stringValue == "\u{FFFD}")
  }

  @Test func escapes_JSON_stringify_would_not_write_are_kept() throws {
    let input = escaped(#""a\/b\u00e9""#, backslashes: 2)
    let value = try JSON.parse(input)
    guard case .verbatim = value else { Issue.record("expected .verbatim, got \(value)"); return }
    #expect(JSON.write(value) == input)
    #expect(value.stringValue == "a/b\u{E9}")
  }

  @Test func a_slash_escape_next_to_a_literal_accent_is_kept() throws {
    let input = escaped(#""a\/bé""#, backslashes: 1)
    let value = try JSON.parse(input)
    #expect(JSON.write(value) == input)
    #expect(value.stringValue == "a/b\u{E9}")
  }

  @Test func an_upper_case_hex_escape_is_kept() throws {
    let input = escaped(#""\u00E9""#, backslashes: 1)
    let value = try JSON.parse(input)
    guard case .verbatim = value else { Issue.record("expected .verbatim, got \(value)"); return }
    #expect(JSON.write(value) == input)
    #expect(value.stringValue == "\u{E9}")
  }

  @Test func a_surrogate_pair_written_as_two_escapes_reads_as_one_character() throws {
    let input = escaped(#""\ud83d\ude00""#, backslashes: 2)
    let value = try JSON.parse(input)
    guard case .verbatim = value else { Issue.record("expected .verbatim, got \(value)"); return }
    #expect(value.stringValue == "\u{1F600}")
    #expect(JSON.write(value) == input)
  }

  @Test func a_literal_astral_character_is_a_plain_string() throws {
    let input = "\"\u{1F600}\""
    #expect(!input.utf8.contains(UInt8(ascii: "\\")))
    #expect(try JSON.parse(input) == .string("\u{1F600}"))
    #expect(JSON.write(try JSON.parse(input)) == input)
  }

  @Test func a_string_the_writer_would_write_identically_is_a_plain_string() throws {
    let input = escaped(#""a\"b\\c\n\u0007""#, backslashes: 5)
    let value = try JSON.parse(input)
    guard case .string = value else { Issue.record("expected .string, got \(value)"); return }
    #expect(value.stringValue == "a\"b\\c\n\u{07}")
  }

  @Test func a_string_with_a_literal_replacement_character_is_a_plain_string() throws {
    #expect(try JSON.parse("\"\u{FFFD}\"") == .string("\u{FFFD}"))
  }

  @Test func a_verbatim_string_inside_a_document_is_kept() throws {
    let s = #"[{"a\/b":"x\u00e9","c":["\ud83d"]}]"#
    // Keys are written canonically (additions, item 2); values are kept as written.
    #expect(JSON.write(try JSON.parse(s)) == #"[{"a/b":"x\u00e9","c":["\ud83d"]}]"#)
  }

  // MARK: Malformed input

  @Test(arguments: [
    ("[1] x", JSONError.Reason.trailingCharacters, 4),
    ("[1]]", .trailingCharacters, 3),
    (#""abc"#, .unterminatedString, 4),
    ("\"a\nb\"", .controlCharacterInString, 2),
    (#""\x""#, .badEscape, 2),
    (#""\u12g4""#, .badEscape, 5),
    (#""\u12"#, .unterminatedString, 5),
    ("01", .badNumber, 1),
    ("-", .badNumber, 1),
    ("-a", .badNumber, 1),
    ("1.", .badNumber, 2),
    ("1e", .badNumber, 2),
    ("1e+", .badNumber, 3),
    ("", .unexpectedEnd, 0),
    ("[1,", .unexpectedEnd, 3),
    ("{", .unexpectedEnd, 1),
    ("{not json", .unexpectedCharacter, 1),
    ("[1,]", .unexpectedCharacter, 3),
    (#"{"a" 1}"#, .unexpectedCharacter, 5),
    (#"{"a":1,}"#, .unexpectedCharacter, 7),
    ("tru", .unexpectedCharacter, 0),
    ("nul1", .unexpectedCharacter, 0),
  ])
  func malformed_input_throws_a_typed_error_with_the_byte_offset(
    _ input: String, _ reason: JSONError.Reason, _ offset: Int
  ) {
    #expect(throws: JSONError(reason: reason, offset: offset)) { try JSON.parse(input) }
  }

  @Test func nesting_up_to_512_levels_parses_and_deeper_throws() throws {
    func nested(_ depth: Int) -> String {
      String(repeating: "[", count: depth) + String(repeating: "]", count: depth)
    }
    let parsed = try JSON.parse(nested(512))
    #expect(JSON.write(parsed) == nested(512))
    #expect(throws: JSONError.self) { try JSON.parse(nested(513)) }
    #expect(throws: JSONError.self) {
      try JSON.parse(String(repeating: #"{"a":"#, count: 100_000))
    }
  }

  // MARK: JSONObject

  @Test func object_keeps_keys_in_the_order_they_were_read() throws {
    let object = try #require(try JSON.parse(#"{"z":1,"a":2,"m":3}"#).objectValue)
    #expect(object.keys == ["z", "a", "m"])
    #expect(object["a"] == .number("2"))
    #expect(object["missing"] == nil)
  }

  @Test func setting_an_existing_key_keeps_its_position_and_a_new_key_is_appended() {
    var object = JSONObject()
    object["b"] = .null
    object["a"] = .null
    object["b"] = .bool(true)
    object["c"] = .bool(false)
    #expect(object.keys == ["b", "a", "c"])
    #expect(object["b"] == .bool(true))
  }

  @Test func assigning_nil_removes_the_key_and_keeps_the_others_in_order() {
    var object = JSONObject()
    for key in ["a", "b", "c", "d"] { object[key] = .null }
    object["b"] = nil
    #expect(object.keys == ["a", "c", "d"])
    #expect(object["b"] == nil)
    #expect(object["c"] == .null)
    #expect(object["d"] == .null)
    object["b"] = .bool(true)
    #expect(object.keys == ["a", "c", "d", "b"])
    object["zzz"] = nil
    #expect(object.keys == ["a", "c", "d", "b"])
  }

  @Test func objects_with_the_same_pairs_in_a_different_order_are_different_values() throws {
    #expect(try JSON.parse(#"{"a":1,"b":2}"#) != JSON.parse(#"{"b":2,"a":1}"#))
  }

  @Test func lookups_stay_fast_on_a_wide_object() {
    var object = JSONObject()
    for i in 0..<20_000 { object["k\(i)"] = .number("\(i)") }
    var hits = 0
    for i in 0..<20_000 where object["k\(i)"] == .number("\(i)") { hits += 1 }
    #expect(hits == 20_000)
  }

  // MARK: Equality is by code units

  @Test func strings_that_differ_only_in_normalization_are_different_values() {
    let nfc = String(Unicode.Scalar(0xE9)!)
    let nfd = String(String.UnicodeScalarView([Unicode.Scalar(0x65)!, Unicode.Scalar(0x301)!]))
    #expect(nfc.utf8.count != nfd.utf8.count)
    #expect(JSONValue.string(nfc) != JSONValue.string(nfd))
    #expect(JSONValue.number(nfc) != JSONValue.number(nfd))
    #expect(JSONValue.verbatim(nfc, raw: "x") != JSONValue.verbatim(nfd, raw: "x"))
    #expect(JSONValue.verbatim("x", raw: nfc) != JSONValue.verbatim("x", raw: nfd))
    #expect(JSONValue.string(nfc) == JSONValue.string(nfc))
    #expect(JSONValue.string(nfc).hashValue == JSONValue.string(nfc).hashValue)
    var a = JSONObject()
    var b = JSONObject()
    a["k"] = .string(nfc)
    b["k"] = .string(nfd)
    #expect(JSONValue.object(a) != JSONValue.object(b))
    #expect(JSONValue.array([.string(nfc)]) != JSONValue.array([.string(nfd)]))
  }
}
