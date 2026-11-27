#if canImport(UIKit)
  import DaythreadCore
  import UIKit

  /// The system's calendar for picking a day: a dot on each day with something written, the week starting as the
  /// account has it, and the shown day selected. Picking a day, a future one too, hands it to `onPick`. For `Pick
  /// date…` no day is selected and the days before today cannot be picked.
  @MainActor
  final class DayPickerViewController: UIViewController, UICalendarViewDelegate, UICalendarSelectionSingleDateDelegate {
    private let selected: LocalDate?
    private let notBefore: LocalDate?
    private let written: Set<LocalDate>
    private let onPick: (LocalDate) -> Void
    let calendarView = UICalendarView()
    /// In the account's zone, so the day the system marks as today is the app's Today. A `LocalDate` goes in and comes
    /// out as year, month and day only, so the zone never moves the day tapped.
    private let calendar: Calendar

    convenience init(
      selected: LocalDate, written: Set<LocalDate>, weekStartsOnMonday: Bool, timezone: String,
      onPick: @escaping (LocalDate) -> Void
    ) {
      self.init(
        selected: selected, notBefore: nil, written: written, weekStartsOnMonday: weekStartsOnMonday,
        timezone: timezone, onPick: onPick)
    }

    /// `selected` nil selects no day; `notBefore` makes the days before it unselectable (`availableDateRange`).
    init(
      selected: LocalDate?, notBefore: LocalDate?, written: Set<LocalDate>, weekStartsOnMonday: Bool,
      timezone: String, onPick: @escaping (LocalDate) -> Void
    ) {
      self.selected = selected
      self.notBefore = notBefore
      self.written = written
      self.onPick = onPick
      var calendar = Calendar(identifier: .gregorian)
      calendar.timeZone = TimeZone(identifier: timezone) ?? .gmt
      calendar.firstWeekday = weekStartsOnMonday ? 2 : 1
      self.calendar = calendar
      super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The detent the sheet opens at on the phone: half the screen holds a month up to the largest of the ordinary text
    /// sizes, and not at the accessibility sizes.
    static func firstDetent(for category: UIContentSizeCategory) -> UISheetPresentationController.Detent.Identifier {
      category.isAccessibilityCategory ? .large : .medium
    }

    override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .systemBackground
      calendarView.calendar = calendar
      calendarView.timeZone = calendar.timeZone
      calendarView.delegate = self
      let selection = UICalendarSelectionSingleDate(delegate: self)
      selection.selectedDate = selected.map(components(of:))
      calendarView.selectionBehavior = selection
      if let notBefore, let start = calendar.date(from: components(of: notBefore)) {
        calendarView.availableDateRange = DateInterval(start: start, end: .distantFuture)
      }
      if let shown = selected ?? notBefore { calendarView.visibleDateComponents = components(of: shown) }

      calendarView.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(calendarView)
      let guide = view.safeAreaLayoutGuide
      NSLayoutConstraint.activate([
        calendarView.topAnchor.constraint(equalTo: guide.topAnchor),
        calendarView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
        calendarView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
        calendarView.bottomAnchor.constraint(lessThanOrEqualTo: guide.bottomAnchor),
      ])
      // The popover's size where the system shows one (iPad, Mac).
      preferredContentSize = calendarView.systemLayoutSizeFitting(
        CGSize(width: 360, height: UIView.layoutFittingCompressedSize.height),
        withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
    }

    private func components(of date: LocalDate) -> DateComponents {
      let parts = date.value.split(separator: "-").compactMap { Int($0) }
      return DateComponents(calendar: calendar, year: parts[0], month: parts[1], day: parts[2])
    }

    private func localDate(of components: DateComponents) -> LocalDate? {
      guard let year = components.year, let month = components.month, let day = components.day else { return nil }
      func pad(_ number: Int, _ width: Int) -> String {
        let digits = String(number)
        return String(repeating: "0", count: max(0, width - digits.count)) + digits
      }
      return LocalDate("\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))")
    }

    // MARK: UICalendarViewDelegate

    func calendarView(_ calendarView: UICalendarView, decorationFor dateComponents: DateComponents)
      -> UICalendarView.Decoration?
    {
      guard let date = localDate(of: dateComponents), written.contains(date) else { return nil }
      return .default()
    }

    // MARK: UICalendarSelectionSingleDateDelegate

    func dateSelection(_ selection: UICalendarSelectionSingleDate, didSelectDate dateComponents: DateComponents?) {
      // A tap on the shown day may clear the selection; it still means that day.
      guard let day = dateComponents.flatMap(localDate(of:)) ?? selected else { return }
      onPick(day)
    }

    func dateSelection(_ selection: UICalendarSelectionSingleDate, canSelectDate dateComponents: DateComponents?)
      -> Bool
    {
      guard let notBefore else { return true }
      guard let day = dateComponents.flatMap(localDate(of:)) else { return false }
      return !(day < notBefore)
    }
  }
#endif
