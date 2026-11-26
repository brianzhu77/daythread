import DaythreadCore
import Foundation

/// What the day's header says (`DayHeader` in `src/components/day-header.tsx`): a word for today, yesterday or
/// tomorrow, the day's short title, and the title button's label for VoiceOver, the web's.
struct DayHeading: Equatable {
  enum Relative: Equatable {
    case today, yesterday, tomorrow

    var text: String {
      switch self {
      case .today: "Today"
      case .yesterday: "Yesterday"
      case .tomorrow: "Tomorrow"
      }
    }
  }

  let relative: Relative?
  let title: String

  init(for date: LocalDate, today: LocalDate, locale: Locale = .current) {
    relative =
      if date == today { .today }
      else if date == today.adding(days: -1) { .yesterday }
      else if date == today.adding(days: 1) { .tomorrow }
      else { nil }
    title = DayTitle.short(for: date, locale: locale)
  }

  /// "Today, Wed, Nov 25. Choose a date"; the relative word only when there is one.
  var accessibilityLabel: String {
    "\(relative.map { "\($0.text), " } ?? "")\(title). Choose a date"
  }
}
