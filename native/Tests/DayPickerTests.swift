import DaythreadCore
import Foundation
import Testing
import UIKit

@testable import DaythreadUI

/// The calendar sheet: the day it marks as today is the account's, and the day tapped is the day opened.
@MainActor
@Suite struct DayPickerTests {
  private func picker(timezone: String, onPick: @escaping (LocalDate) -> Void = { _ in }) -> DayPickerViewController {
    let picker = DayPickerViewController(
      selected: LocalDate("2026-11-25")!, written: [], weekStartsOnMonday: false, timezone: timezone, onPick: onPick)
    picker.loadViewIfNeeded()
    return picker
  }

  /// At 02:13 UTC on Nov 26 it is still Nov 25 in Vancouver; the system marks today in the calendar view's zone.
  @Test func the_calendar_marks_today_in_the_accounts_zone() {
    let picker = picker(timezone: "America/Vancouver")
    #expect(picker.calendarView.timeZone?.identifier == "America/Vancouver")
    #expect(picker.calendarView.calendar.timeZone.identifier == "America/Vancouver")
  }

  @Test func the_day_tapped_is_the_day_opened_whatever_the_zone() {
    for zone in ["America/Vancouver", "Asia/Shanghai", "UTC"] {
      var picked: [LocalDate] = []
      let picker = picker(timezone: zone) { picked.append($0) }
      let selection = UICalendarSelectionSingleDate(delegate: picker)
      picker.dateSelection(selection, didSelectDate: DateComponents(year: 2026, month: 11, day: 24))
      #expect(picked == [LocalDate("2026-11-24")!], "in \(zone)")
    }
  }

  /// `Pick date…`: no day selected, today and later selectable, no day before it.
  @Test func pick_date_selects_nothing_and_no_day_before_today() throws {
    let picker = DayPickerViewController(
      selected: nil, notBefore: LocalDate("2026-11-26")!, written: [], weekStartsOnMonday: false, timezone: "UTC"
    ) { _ in }
    picker.loadViewIfNeeded()
    let selection = try #require(picker.calendarView.selectionBehavior as? UICalendarSelectionSingleDate)
    #expect(selection.selectedDate == nil)
    #expect(!picker.dateSelection(selection, canSelectDate: DateComponents(year: 2026, month: 11, day: 25)))
    #expect(picker.dateSelection(selection, canSelectDate: DateComponents(year: 2026, month: 11, day: 26)))
    #expect(picker.dateSelection(selection, canSelectDate: DateComponents(year: 2027, month: 1, day: 4)))
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let start = calendar.date(from: DateComponents(year: 2026, month: 11, day: 26))
    #expect(picker.calendarView.availableDateRange.start == start)
    #expect(picker.calendarView.visibleDateComponents.month == 11)
  }

  /// At the accessibility text sizes a month does not fit half the screen: the sheet opens at its full height.
  @Test func the_sheet_opens_at_full_height_at_the_accessibility_text_sizes() {
    #expect(DayPickerViewController.firstDetent(for: .large) == .medium)
    #expect(DayPickerViewController.firstDetent(for: .extraExtraExtraLarge) == .medium)
    #expect(DayPickerViewController.firstDetent(for: .accessibilityMedium) == .large)
    #expect(DayPickerViewController.firstDetent(for: .accessibilityExtraExtraExtraLarge) == .large)
  }
}
