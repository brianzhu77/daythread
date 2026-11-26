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

  /// At the accessibility text sizes a month does not fit half the screen: the sheet opens at its full height.
  @Test func the_sheet_opens_at_full_height_at_the_accessibility_text_sizes() {
    #expect(DayPickerViewController.firstDetent(for: .large) == .medium)
    #expect(DayPickerViewController.firstDetent(for: .extraExtraExtraLarge) == .medium)
    #expect(DayPickerViewController.firstDetent(for: .accessibilityMedium) == .large)
    #expect(DayPickerViewController.firstDetent(for: .accessibilityExtraExtraExtraLarge) == .large)
  }
}
