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

/// What the navigation bar offers for a date.
struct DayNavigation: Equatable {
  /// False from today on: as on the web, a future day is reached only from the calendar.
  let canGoNext: Bool
  /// False on today.
  let showsToday: Bool

  static func bar(for date: LocalDate, today: LocalDate) -> DayNavigation {
    DayNavigation(canGoNext: date < today, showsToday: date != today)
  }
}
