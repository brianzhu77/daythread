/// An event a `@date` chip makes (`DayEvent`, `chip-events.ts`): read from the documents, never stored.
public struct DayEvent: Hashable, Sendable {
  public let id: String
  public let title: String
  public let date: LocalDate
  /// `HH:mm`; nil for an event with no time (all day).
  public let time: String?
  /// The line holding it, on the page it is read from (1d.2's rows link back to it).
  public let pageId: String
  public let lineId: String
}

extension TodoIndex {
  /// `dayEvents`: the day's events, those with no time first, then by time (code units); ties keep the order in
  /// which each event's id was first met walking the live pages in the workspace's order, each page depth first.
  public func events(on day: LocalDate) -> [DayEvent] {
    // `HH:mm` is ASCII, so comparing the strings compares the code units.
    eventsInFirstMetOrder.filter { $0.date == day }.enumerated().sorted { a, b in
      let (x, y) = (a.element.time ?? "", b.element.time ?? "")
      return x == y ? a.offset < b.offset : x.utf8.lexicographicallyPrecedes(y.utf8)
    }.map(\.element)
  }
}

/// The events line's words (`eventsLine`, `event-words.ts`).
public struct EventsLine: Hashable, Sendable {
  /// The first two events, each `10:30 AM Standup with Lu` (the title alone with no time; `Untitled event` for no
  /// words), joined by ` · `, then ` · All day` when there is exactly one event and it has no time.
  public let text: String
  /// `+N more` past two events; nil otherwise.
  public let more: String?

  /// Nil for no events.
  public static func of(_ events: [DayEvent]) -> EventsLine? {
    guard let first = events.first else { return nil }
    var parts = events.prefix(2).map { event in
      let title = event.title.isEmpty ? "Untitled event" : event.title
      return event.time.map { "\(EventWords.shortTime($0)) \(title)" } ?? title
    }
    if events.count == 1, first.time == nil { parts.append("All day") }
    return EventsLine(text: parts.joined(separator: " · "), more: events.count > 2 ? "+\(events.count - 2) more" : nil)
  }
}

public enum EventWords {
  /// `shortTime`: `10:30 AM`, `3 PM`, `12 PM`, `12:15 AM`.
  public static func shortTime(_ time: String) -> String {
    guard let (clock, isMorning) = DateMention.twelveHour(time) else { return time }
    return "\(clock) \(isMorning ? "AM" : "PM")"
  }

  /// `eventsHeading`: the id of the first top-level `heading` whose words (`InlineText.plain` with no page date, so a
  /// chip reads with its year) trimmed as JavaScript's `trim` and lower-cased are exactly `events` (code units).
  public static func eventsHeading(in blocks: [Block]) -> String? {
    blocks.first { block in
      block.type.hasSameCodeUnits(as: "heading")
        && JavaScriptSpace.trimmed(InlineText.plain(block.content, pageDate: nil)).lowercased()
          .hasSameCodeUnits(as: "events")
    }?.id
  }
}

/// The chips of the live pages, one holder per event id (`chipEvents`).
struct EventCollector {
  struct Holder {
    let mention: DateMention
    let content: JSONValue?
    let pageId: String
    let lineId: String
    let pageDate: LocalDate?
  }

  private(set) var keys: [CodeUnitKey] = []
  private(set) var holders: [CodeUnitKey: Holder] = [:]

  var isEmpty: Bool { keys.isEmpty }

  /// The chips among a block's own content items, not those inside a link (the web reads `n.content` only).
  mutating func read(_ block: Block, on page: Page, pageDate: LocalDate?) {
    guard case .array(let items)? = block.content else { return }
    for item in items {
      guard let mention = DateMention(item) else { continue }
      let holder = Holder(
        mention: mention, content: block.content, pageId: page.id, lineId: block.id, pageDate: pageDate)
      let key = CodeUnitKey(mention.eventId)
      guard let seen = holders[key] else {
        keys.append(key)
        holders[key] = holder
        continue
      }
      // `newer`: a later holder wins only on a newer day page; a page that is not a day page is the empty date.
      if Self.isNewer(holder.pageDate, than: seen.pageDate) { holders[key] = holder }
    }
  }

  private static func isNewer(_ date: LocalDate?, than other: LocalDate?) -> Bool {
    guard let date else { return false }
    guard let other else { return true }
    return date > other
  }

  /// Titles are read here, for the holders kept only.
  func events(pages: [Page]) -> [DayEvent] {
    var titles: [CodeUnitKey: String] = [:]
    // `liveTitle`: the first page of that id, in Trash or not.
    for page in pages where titles[CodeUnitKey(page.id)] == nil { titles[CodeUnitKey(page.id)] = page.title }
    return keys.compactMap { key in
      guard let holder = holders[key] else { return nil }
      return DayEvent(
        id: holder.mention.eventId,
        title: InlineText.eventTitle(holder.content, pageTitle: { titles[CodeUnitKey($0)] }),
        date: holder.mention.date, time: holder.mention.time, pageId: holder.pageId, lineId: holder.lineId)
    }
  }
}
