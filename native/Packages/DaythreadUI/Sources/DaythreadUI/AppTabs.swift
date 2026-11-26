import DaythreadCore

/// The tab bar's places: the web's (`destinations` in `src/components/navigation.tsx`), in its order, but four of its
/// five. A phone's bar shows five items, the search tab that follows them included; a sixth puts Tags and Search
/// behind the system's More tab. Tags waits for a tab until Brian says which place gives way (`native-phase-1.md` §6).
enum AppTabs {
  struct Place: Equatable {
    let id: String
    let title: String
    let symbol: String
  }

  /// Today's symbol is the calendar page showing the day of the month of the account's today.
  static func places(today: LocalDate) -> [Place] {
    [
      Place(id: "today", title: "Today", symbol: "\(dayOfMonth(today)).calendar"),
      Place(id: "tasks", title: "Tasks", symbol: "checkmark.square"),
      Place(id: "calendar", title: "Calendar", symbol: "calendar"),
      Place(id: "pages", title: "Pages", symbol: "doc.text"),
    ]
  }

  private static func dayOfMonth(_ date: LocalDate) -> Int {
    date.value.split(separator: "-").last.flatMap { Int($0) } ?? 1
  }
}
