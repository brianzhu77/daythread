/// What the strip above a day's page shows (`dayFacts`, `src/components/day-facts.ts`), as strings and to-do ids.
public struct DayFacts: Hashable, Sendable {
  public struct Row: Hashable, Sendable {
    public let taskId: String
    /// The to-do's title as stored.
    public let words: String
    /// Nil when the web's tag is empty: the row shows its words alone.
    public let tag: String?

    /// One line for VoiceOver: `File the taxes, Due today`; the words alone with no tag.
    public var spoken: String { tag.map { "\(words), \($0)" } ?? words }

    /// The row's menu button, for VoiceOver.
    public var menuLabel: String { "More for \(words)" }
  }

  public struct NotToday: Hashable, Sendable {
    /// `Not today · 3`
    public let title: String
    public let rows: [Row]
    /// `Another day`: the weekday's options (`Tomorrow · Fri 11/27`, ...), then `Pick date…`.
    public let menu: RowMenu.Group
  }

  /// Today only, when today has an event.
  public let events: EventsLine?
  /// The page's top-level heading titled `Events`, when there are events; nil: the events line is words, not a button.
  public let eventsHeadingId: String?
  /// Every open to-do with words whose Due or Start date is the day or earlier and that has no row (any role) on the
  /// day's live page, in the workspace's order; tagged `DateTag.text(pageDate: day, planned: plannedOn)`, and for a
  /// to-do set aside `Not today · <tag>`, or `Not today` when that tag is empty. Empty: the part is not drawn.
  public let dueSoon: [Row]
  /// Today only, when an open to-do with words is set aside; in the workspace's order, tagged
  /// `DateTag.text(pageDate: today, planned: plannedOn)`.
  public let notToday: NotToday?

  public static let none = DayFacts(events: nil, eventsHeadingId: nil, dueSoon: [], notToday: nil)

  /// Nothing to draw: the strip takes no room.
  public var isEmpty: Bool { events == nil && dueSoon.isEmpty && notToday == nil }

  /// The facts of `day` as `workspace` draws it (a page draft drawn in, ticks played over it); `index` is of
  /// `workspace`. `.none` for a later day without a live page.
  ///
  /// Cost: one pass over the workspace's to-dos, a dictionary read of the index per to-do that is due, and one
  /// parse of the day page's document, only for the heading of a day that has events. No other page is read.
  public static func of(day: LocalDate, in workspace: Workspace, index: TodoIndex, today: LocalDate) -> DayFacts {
    // The web's `dayPage` takes an empty trash stamp as none (`!Boolean(trashedAt)`), so this does too; the Core's
    // `Workspace.dayPage` does not, and a stamp of "" does not occur on a server-written page.
    let page = workspace.pages.first { $0.type == "daily" && $0.date == day && ($0.trashedAt?.isEmpty ?? true) }
    if day > today && page == nil { return .none }

    let isToday = day == today
    let listed = workspace.tasks.filter { $0.status == .open && !Workspace.isBlankInJavaScript($0.title) }

    let dueSoon = listed.filter { task in
      guard task.deadlineOn.map({ $0 <= day }) == true || task.attentionOn.map({ $0 <= day }) == true else {
        return false
      }
      // The web drops a row with no task id from the page's set.
      guard let page, !task.id.isEmpty else { return true }
      return !index.rows(of: task.id).contains { $0.pageId.hasSameCodeUnits(as: page.id) }
    }.map { task in
      let tag = DateTag.text(for: task, today: today, pageDate: day, planned: index.plannedOn(task.id))
      guard task.paused else { return Row(taskId: task.id, words: task.title, tag: tag.isEmpty ? nil : tag) }
      return Row(taskId: task.id, words: task.title, tag: tag.isEmpty ? "Not today" : "Not today · \(tag)")
    }

    var events: EventsLine?
    var headingId: String?
    if isToday, let line = EventsLine.of(index.events(on: day)) {
      events = line
      if let page { headingId = EventWords.eventsHeading(in: Document.blocks(page.document)) }
    }

    let aside = isToday ? listed.filter(\.paused) : []
    let notToday = aside.isEmpty ? nil : NotToday(
      title: "Not today · \(aside.count)",
      rows: aside.map { task in
        let tag = DateTag.text(for: task, today: today, pageDate: today, planned: index.plannedOn(task.id))
        return Row(taskId: task.id, words: task.title, tag: tag.isEmpty ? nil : tag)
      },
      menu: anotherDayMenu(today: today))
    return DayFacts(events: events, eventsHeadingId: headingId, dueSoon: dueSoon, notToday: notToday)
  }

  /// `planOnNotice`: `On today`, or `Moved to Sat 11/28` (the short label: not a row's `Moved to Sat, Nov 28`).
  public static func planNotice(date: LocalDate, today: LocalDate) -> String {
    date == today ? "On today" : "Moved to \(DayWords.shortLabel(date))"
  }

  /// `anotherDayItems`: every option of the weekday, none left out, then `Pick date…`.
  private static func anotherDayMenu(today: LocalDate) -> RowMenu.Group {
    let options = RowMenu.anotherDayOptions(today: today).map {
      RowMenu.Item(title: "\($0.label) · \(DayWords.shortLabel($0.date))", action: .move($0.date), destructive: false)
    }
    return RowMenu.Group(
      title: "Another day",
      items: options + [RowMenu.Item(title: "Pick date…", action: .pickDate, destructive: false)])
  }
}
