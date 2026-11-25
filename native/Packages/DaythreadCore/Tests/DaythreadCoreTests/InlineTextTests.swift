import Testing

@testable import DaythreadCore

@Suite struct InlineTextTests {
  @Test func every_shared_case_reads_as_the_domain_reads_it() throws {
    let cases = try #require(try Fixtures.json("inline-text/cases.json").arrayValue)
    #expect(cases.count > 100)
    for entry in cases {
      let object = try #require(entry.objectValue)
      let pageDate = object["pageDate"]?.stringValue.flatMap { LocalDate($0) }
      let expected = try #require(object["text"]?.stringValue)
      let actual = InlineText.plain(object["content"], pageDate: pageDate)
      #expect(actual == expected, "content \(JSON.write(object["content"] ?? .null)) on \(pageDate?.value ?? "no date")")
    }
  }

  @Test func nothing_reads_as_nothing() {
    #expect(InlineText.plain(nil, pageDate: nil) == "")
    #expect(InlineText.plain(.null, pageDate: nil) == "")
    #expect(InlineText.plain(.object(JSONObject()), pageDate: nil) == "")
  }

  @Test func a_chip_leaves_the_year_out_only_on_a_page_of_the_same_year() throws {
    let chip = try json(
      #"[{"type":"dateMention","props":{"eventId":"e","date":"2027-01-05","time":"15:00"}}]"#)
    #expect(InlineText.plain(chip, pageDate: LocalDate("2027-06-01")) == "@Jan 5 3pm")
    #expect(InlineText.plain(chip, pageDate: LocalDate("2026-06-01")) == "@Jan 5, 2027 3pm")
    #expect(InlineText.plain(chip, pageDate: nil) == "@Jan 5, 2027 3pm")
  }

  @Test func a_malformed_chip_is_not_a_chip() throws {
    let cases = [
      #"{"type":"dateMention","props":{"date":"2026-10-22"}}"#,
      #"{"type":"dateMention","props":{"eventId":"","date":"2026-10-22"}}"#,
      #"{"type":"dateMention","props":{"eventId":"e","date":"2026-02-30"}}"#,
      #"{"type":"dateMention","props":{"eventId":"e","date":"2026-2-3"}}"#,
      #"{"type":"dateMention","props":{"eventId":"e","date":"0050-02-03"}}"#,
      #"{"type":"dateMention"}"#,
    ]
    for item in cases {
      #expect(InlineText.plain(try json("[\(item)]"), pageDate: nil) == "", "\(item)")
    }
  }

  @Test func a_chip_with_a_bad_time_reads_without_one() throws {
    for time in ["", "24:00", "9:30", "12:60", "noon"] {
      let chip = try json(
        #"[{"type":"dateMention","props":{"eventId":"e","date":"2026-10-22","time":"\#(time)"}}]"#)
      #expect(InlineText.plain(chip, pageDate: LocalDate("2026-10-22")) == "@Oct 22")
    }
  }

  @Test func the_time_label_follows_the_twelve_hour_clock() throws {
    let expected = [
      "00:00": "12am", "00:15": "12:15am", "09:30": "9:30am", "12:00": "12pm", "12:05": "12:05pm",
      "15:00": "3pm", "23:59": "11:59pm",
    ]
    for (time, label) in expected {
      let chip = try json(
        #"[{"type":"dateMention","props":{"eventId":"e","date":"2026-10-22","time":"\#(time)"}}]"#)
      #expect(InlineText.plain(chip, pageDate: LocalDate("2026-10-22")) == "@Oct 22 \(label)")
    }
  }

  @Test func a_text_that_is_not_a_string_reads_as_javascript_would_spell_it() throws {
    let cases = [
      ("42", "42"), ("1.5", "1.5"), ("true", "true"), ("null", "null"), ("[1,[2,null],\"a\"]", "1,2,,a"),
      (#"{"a":1}"#, "[object Object]"),
    ]
    for (value, text) in cases {
      let content = try json(#"[{"type":"text","text":\#(value)}]"#)
      #expect(InlineText.plain(content, pageDate: nil) == text, "\(value)")
    }
  }
}
