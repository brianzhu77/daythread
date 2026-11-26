import DaythreadCore

/// What the day screen shows for a date (`native-phase-1.md` §6).
enum DayContent: Equatable {
  /// The day's live page.
  case page(Page)
  /// Today, no page and none in Trash: the engine is asking the server for it.
  case askingForToday
  /// A past day with no page. Opening it does not make one.
  case noPage
  /// A future day with no page.
  case notYet
  /// The day's page that went to Trash last.
  case inTrash(Page)

  static func content(for date: LocalDate, today: LocalDate, in workspace: Workspace) -> DayContent {
    if let page = workspace.dayPage(date) { return .page(page) }
    // A page in Trash is his to restore or start again, today too: the engine does not ask for one then.
    if let page = workspace.trashedDayPage(date) { return .inTrash(page) }
    if date == today { return .askingForToday }
    return date < today ? .noPage : .notYet
  }
}

/// Which ways to other days a date offers.
struct DayNavigation: Equatable {
  /// False from today on: as on the web, a future day is reached only from the calendar.
  let canGoNext: Bool
  /// False on today.
  let showsToday: Bool

  static func bar(for date: LocalDate, today: LocalDate) -> DayNavigation {
    DayNavigation(canGoNext: date < today, showsToday: date != today)
  }
}

/// The day screen's quiet controls, all trailing in the navigation bar (`native-phase-1.md` §6), as the web's phone app
/// places them. The day's title is the page's first row, and the tab bar is at the bottom.
struct DayControls: Equatable {
  enum Item: Equatable {
    case today, previousDay, nextDay, held, more
  }

  /// The navigation bar's trailing items, from the leading edge to the trailing edge.
  let navigationBar: [Item]
  /// Whether Next day is enabled.
  let canGoNext: Bool

  /// "Today" only at regular width (the web shows it from 600 px up); on the phone the Today tab does it. "More" only
  /// when its menu would hold something.
  static func controls(for date: LocalDate, today: LocalDate, regularWidth: Bool, hasHeld: Bool, hasMore: Bool)
    -> DayControls
  {
    let navigation = DayNavigation.bar(for: date, today: today)
    return DayControls(
      navigationBar: (regularWidth && navigation.showsToday ? [.today] : []) + [.previousDay, .nextDay]
        + (hasHeld ? [.held] : []) + (hasMore ? [.more] : []),
      canGoNext: navigation.canGoNext)
  }
}
