#if canImport(UIKit)
  import DaythreadCore
  import UIKit

  /// The system's calendar for picking a day: a dot on each day with something written, the week starting as the
  /// account has it, and the shown day selected. Picking a day, a future one too, hands it to `onPick`.
  @MainActor
  final class DayPickerViewController: UIViewController, UICalendarViewDelegate, UICalendarSelectionSingleDateDelegate {
    private let selected: LocalDate
    private let written: Set<LocalDate>
    private let onPick: (LocalDate) -> Void
    let calendarView = UICalendarView()
    /// In the account's zone, so the day the system marks as today is the app's Today. A `LocalDate` goes in and comes
    /// out as year, month and day only, so the zone never moves the day tapped.
    private let calendar: Calendar

    init(
      selected: LocalDate, written: Set<LocalDate>, weekStartsOnMonday: Bool, timezone: String,
      onPick: @escaping (LocalDate) -> Void
    ) {
      self.selected = selected
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
      let shown = components(of: selected)
      selection.selectedDate = shown
      calendarView.selectionBehavior = selection
      calendarView.visibleDateComponents = shown

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
      onPick(dateComponents.flatMap(localDate(of:)) ?? selected)
    }
  }
#endif
