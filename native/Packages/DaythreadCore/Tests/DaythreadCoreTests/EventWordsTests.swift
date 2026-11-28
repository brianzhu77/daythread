import Testing

@testable import DaythreadCore

@Suite struct EventWordsTests {
  @Test func times_are_the_webs() throws {
    let cases = try Fixtures.cases("events/times.json")
    #expect(cases.count == 10)
    for entry in cases {
      let time = try #require(entry["time"]?.stringValue)
      #expect(EventWords.shortTime(time) == entry["text"]?.stringValue, "time: \(time)")
    }
  }

  @Test func lines_are_the_webs() throws {
    let cases = try Fixtures.cases("events/lines.json")
    #expect(cases.count == 8)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let events = try #require(entry["events"]?.arrayValue, "events: \(name)").map(EventTests.expected)
      let line = EventsLine.of(events)
      if let expected = entry["line"]?.objectValue {
        #expect(line?.text == expected["text"]?.stringValue, "text: \(name)")
        #expect(line?.more == expected["more"]?.stringValue, "more: \(name)")
      } else {
        #expect(line == nil, "\(name)")
      }
    }
  }

  @Test func headings_are_the_webs() throws {
    let cases = try Fixtures.cases("events/headings.json")
    #expect(cases.count == 10)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let document = try #require(entry["document"]?.stringValue, "document: \(name)")
      #expect(EventWords.eventsHeading(in: Document.blocks(document)) == entry["headingId"]?.stringValue, "\(name)")
    }
  }
}
