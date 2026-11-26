import DaythreadCore

/// The tab bar's places: the web's five (`destinations` in `src/components/navigation.tsx`), in its order. Search
/// follows them as the system's own search tab.
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
      Place(id: "tags", title: "Tags", symbol: "number"),
    ]
  }

  private static func dayOfMonth(_ date: LocalDate) -> Int {
    date.value.split(separator: "-").last.flatMap { Int($0) } ?? 1
  }
}
