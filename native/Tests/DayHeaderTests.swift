import DaythreadCore
import Foundation
import Testing

@testable import DaythreadUI

private let today = LocalDate("2026-11-25")!
private let english = Locale(identifier: "en_US")

/// What the day's header, the page's first row, says: the relative word when there is one, the web's short title,
/// and the title button's label for VoiceOver.
@Suite struct DayHeaderTests {
  @Test func today_says_today_above_the_short_title() {
    let heading = DayHeading(for: today, today: today, locale: english)
    #expect(heading.relative == .today)
    #expect(heading.relative?.text == "Today")
    #expect(heading.title == "Wed, Nov 25")
    #expect(heading.accessibilityLabel == "Today, Wed, Nov 25. Choose a date")
  }

  @Test func yesterday_says_yesterday() {
    let heading = DayHeading(for: LocalDate("2026-11-24")!, today: today, locale: english)
    #expect(heading.relative == .yesterday)
    #expect(heading.relative?.text == "Yesterday")
    #expect(heading.title == "Tue, Nov 24")
    #expect(heading.accessibilityLabel == "Yesterday, Tue, Nov 24. Choose a date")
  }

  @Test func tomorrow_says_tomorrow() {
    let heading = DayHeading(for: LocalDate("2026-11-26")!, today: today, locale: english)
    #expect(heading.relative == .tomorrow)
    #expect(heading.relative?.text == "Tomorrow")
    #expect(heading.title == "Thu, Nov 26")
    #expect(heading.accessibilityLabel == "Tomorrow, Thu, Nov 26. Choose a date")
  }

  @Test func another_day_has_no_relative_word() {
    let heading = DayHeading(for: LocalDate("2026-11-03")!, today: today, locale: english)
    #expect(heading.relative == nil)
    #expect(heading.title == "Tue, Nov 3")
    #expect(heading.accessibilityLabel == "Tue, Nov 3. Choose a date")
  }

  @Test func the_short_title_crosses_a_year_without_naming_it() {
    #expect(DayTitle.short(for: LocalDate("2027-01-01")!, locale: english) == "Fri, Jan 1")
    #expect(DayHeading(for: LocalDate("2026-12-31")!, today: LocalDate("2027-01-01")!, locale: english).relative == .yesterday)
  }
}

/// The tab bar: four of the web's places in its order, then the system's search tab; Tags waits for a tab, since a
/// sixth item would put Tags and Search behind the system's More tab.
@Suite struct AppTabsTests {
  @Test func the_places_are_four_of_the_webs_in_its_order_with_their_symbols() {
    let places = AppTabs.places(today: today)
    #expect(places.map(\.title) == ["Today", "Tasks", "Calendar", "Pages"])
    #expect(places.map(\.symbol) == ["25.calendar", "checkmark.square", "calendar", "doc.text"])
  }

  @Test func the_today_symbol_is_the_day_of_the_month_of_the_accounts_today() {
    #expect(AppTabs.places(today: LocalDate("2026-12-01")!).first?.symbol == "1.calendar")
    #expect(AppTabs.places(today: LocalDate("2026-12-31")!).first?.symbol == "31.calendar")
  }
}
