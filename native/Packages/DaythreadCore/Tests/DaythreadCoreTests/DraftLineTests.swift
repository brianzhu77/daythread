import Foundation
import Testing

@testable import DaythreadCore

@Suite struct DraftLineTests {
  private static let now = Date(timeIntervalSinceReferenceDate: 800_000_000)

  @Test func the_line_is_the_webs() throws {
    let cases = try Fixtures.cases("draft/line.json")
    #expect(cases.count == 18)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let view = try entry["view"]?.objectValue.map { try Self.view($0, name) }
      let ask = try Self.ask(entry["ask"], name)
      let offline = try #require(entry["offline"]?.boolValue as Bool?, "offline: \(name)")
      let held = try #require(entry["held"]?.boolValue as Bool?, "held: \(name)")
      let state = DraftLine.state(view: view, ask: ask, offline: offline, at: Self.now)
      #expect(state == Self.state(entry["state"]), "state: \(name)")
      let line = DraftLine.of(state, shown: view?.suggestions.count ?? 0, held: held)
      #expect(line == Self.line(entry["words"]?.objectValue), "words: \(name)")
    }
  }

  @Test func the_words() {
    #expect(DraftLine.count(1) == "1 suggestion")
    #expect(DraftLine.count(3) == "3 suggestions")
    #expect(DraftLine.failedText.unicodeScalars.contains("\u{2019}"))
    #expect(DraftLine.preparingText.unicodeScalars.last == "\u{2026}")
    #expect(
      DraftLine.segments(count: "2 suggestions", failed: true, offline: false).spoken
        == "2 suggestions, Couldn\u{2019}t draft")
    #expect(DraftLine.segments(count: "3 suggestions", failed: false, offline: false).spoken == "3 suggestions")
    #expect(DraftLine.segments(count: nil, failed: true, offline: false).spoken == "Couldn\u{2019}t draft")
    #expect(DraftLine.preparing.spoken == "Preparing\u{2026}")
  }

  /// The line's segments, each its words and the buttons after them: the view draws them in this order, and VoiceOver
  /// hears each segment's words before its buttons, so `Retry` is heard after `Couldn’t draft`, not after the count.
  @Test func each_segment_holds_its_words_and_buttons() {
    typealias Segment = DraftLine.Segment
    #expect(
      DraftLine.segments(count: "2 suggestions", failed: true, offline: true).shownSegments == [
        Segment(words: "2 suggestions", buttons: [.applyAll, .dismiss]),
        Segment(words: "Couldn\u{2019}t draft", buttons: [.retry]), Segment(words: "Offline", buttons: []),
      ])
    #expect(
      DraftLine.segments(count: "3 suggestions", failed: false, offline: false).shownSegments
        == [Segment(words: "3 suggestions", buttons: [.applyAll, .dismiss])])
    #expect(
      DraftLine.segments(count: nil, failed: true, offline: false).shownSegments
        == [Segment(words: "Couldn\u{2019}t draft", buttons: [.retry])])
    #expect(DraftLine.preparing.shownSegments == [Segment(words: "Preparing\u{2026}", buttons: [])])
    #expect(DraftLine.held.shownSegments == [Segment(words: "Suggestions ready", buttons: [.show])])
  }

  @Test func an_ask_is_lost_after_sixty_seconds_and_counts_as_a_failure() {
    let asking = DraftAsk.asking(since: Self.now, failures: 1)
    #expect(asking.inFlight(at: Self.now.addingTimeInterval(59.9)))
    #expect(!asking.inFlight(at: Self.now.addingTimeInterval(60)))
    #expect(asking.failures == 2, "an ask in flight counts as one more")
    #expect(DraftAsk.failed(failures: 1).failures == 1)
    #expect(DraftAsk.done.failures == 0)
    #expect(!DraftAsk.done.inFlight(at: Self.now))
    #expect(!DraftAsk.failed(failures: 1).inFlight(at: Self.now))
    #expect(DraftAsk.lostAfter == 60)
    #expect(DraftAsk.asksByItself == 2)
  }

  /// The case's `{ status, items: <count> }`: a view with that status and that many suggestions.
  private static func view(_ object: JSONObject, _ name: String) throws -> DraftView {
    let count = try #require(object["items"]?.intValue, "items: \(name)")
    let status: DayDraft.Status =
      switch object["status"]?.stringValue {
      case "preparing": .preparing
      case "ready": .ready
      case "failed": .failed
      default: .unknown
      }
    let suggestions = (0..<count).map { number in
      DraftView.Suggestion(
        id: "i\(number)", kind: .after, anchorId: nil, mark: .line, words: "Line \(number)", taskId: nil,
        since: nil, skipped: [], on: nil)
    }
    return DraftView(
      status: status, suggestions: suggestions, moreOpen: [], planningEndId: nil, moreOpenAfterId: nil)
  }

  private static func ask(_ value: JSONValue?, _ name: String) throws -> DraftAsk? {
    switch value?.stringValue {
    case nil: return nil
    case "in-flight": return .asking(since: now.addingTimeInterval(-10), failures: 0)
    case "lost": return .asking(since: now.addingTimeInterval(-61), failures: 0)
    case "failed": return .failed(failures: 1)
    case "done": return .done
    case let other?: throw Fixtures.Missing(path: "draft/line.json: ask \(other) in \(name)")
    }
  }

  private static func state(_ value: JSONValue?) -> DraftLineState? {
    switch value?.stringValue {
    // Spelled out: a bare `.none` here would be the optional's.
    case "none": DraftLineState.none
    case "preparing": .preparing
    case "ready": .ready
    case "failed": .failed
    case "offline": .offline
    default: nil
    }
  }

  private static func line(_ words: JSONObject?) -> DraftLine? {
    switch words?["kind"]?.stringValue {
    case "preparing": .preparing
    case "held": .held
    case "segments":
      .segments(
        count: words?["count"]?.stringValue, failed: words?["failed"]?.boolValue == true,
        offline: words?["offline"]?.boolValue == true)
    default: nil
    }
  }
}
