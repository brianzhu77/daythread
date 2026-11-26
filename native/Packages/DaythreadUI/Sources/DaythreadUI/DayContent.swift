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

/// Where the day screen's controls are (`native-phase-1.md` §6): the navigation bar is left to the title, the account
/// and the held changes; moving between days is in the system's toolbar.
struct DayControls: Equatable {
  enum Item: Equatable {
    case account, held, previousDay, calendar, today, nextDay
    /// A flexible space.
    case space
  }

  /// The navigation bar's trailing items, from the trailing edge.
  let navigationBar: [Item]
  /// The toolbar's items, from the leading edge.
  let toolbar: [Item]
  /// Whether Next day is enabled.
  let canGoNext: Bool

  static func controls(for date: LocalDate, today: LocalDate, hasAccount: Bool, hasHeld: Bool) -> DayControls {
    let navigation = DayNavigation.bar(for: date, today: today)
    // "Today" sits beside Next with no space between, so its coming and going leaves Previous and Next at the edges
    // and moves the calendar by half its width, not by a third of the bar.
    return DayControls(
      navigationBar: (hasAccount ? [.account] : []) + (hasHeld ? [.held] : []),
      toolbar: [.previousDay, .space, .calendar, .space] + (navigation.showsToday ? [.today] : []) + [.nextDay],
      canGoNext: navigation.canGoNext)
  }
}
