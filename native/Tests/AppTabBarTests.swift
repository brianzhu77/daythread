import DaythreadCore
import DaythreadSync
import Foundation
import Testing
import UIKit

@testable import DaythreadUI

private let today = LocalDate("2026-11-25")!
private let yesterday = LocalDate("2026-11-24")!

private func copy() throws -> Workspace {
  let page = #"{"id":"day:2026-11-25","type":"daily","date":"2026-11-25","title":"","document":"[]"}"#
  return try #require(Workspace(try JSON.parse(#"{"revision":1,"timezone":"UTC","pages":[\#(page)],"tasks":[]}"#)))
}

/// The signed-in app is the system tab bar: the day screen in the Today tab, the places not built yet saying so, and
/// the Today tab going back to today.
@MainActor
@Suite struct AppTabBarTests {
  /// The root's tab bar controller once it shows the day.
  private func tabs(_ h: Harness) throws -> AppTabBarController {
    let root = RootViewController(model: h.model)
    root.loadViewIfNeeded()
    root.updatePropertiesIfNeeded()
    return try #require(root.children.first as? AppTabBarController)
  }

  @Test func the_root_is_a_tab_bar_with_the_webs_places_and_search() async throws {
    let h = try await Harness(copy: try copy())
    let tabs = try tabs(h)
    let all = tabs.tabs

    #expect(all.count == 6)
    #expect(all.prefix(5).map(\.title) == ["Today", "Tasks", "Calendar", "Pages", "Tags"])
    #expect(all.prefix(5).map(\.image) == AppTabs.places(today: today).map { UIImage(systemName: $0.symbol) })
    #expect(all.last is UISearchTab)
    #expect(tabs.selectedTab === all.first)
  }

  @Test func the_today_tab_holds_the_day_screen_with_no_toolbar() async throws {
    let h = try await Harness(copy: try copy())
    let tabs = try tabs(h)
    let navigation = try #require(tabs.tabs.first?.viewController as? UINavigationController)

    #expect(navigation.viewControllers.first === tabs.dayScreen)
    #expect(navigation.isToolbarHidden)
  }

  @Test func a_place_not_built_yet_says_so() async throws {
    let h = try await Harness(copy: try copy())
    let tabs = try tabs(h)

    for (tab, place) in zip(tabs.tabs.dropFirst(), AppTabs.places(today: today).dropFirst()) {
      let screen = try #require(tab.viewController, "\(place.title) has a screen")
      screen.loadViewIfNeeded()
      let configuration = try #require(screen.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)
      #expect(configuration.text == place.title)
      #expect(configuration.secondaryText == "Not in the app yet")
      #expect(configuration.image == UIImage(systemName: place.symbol))
      #expect(configuration.button.title == nil)
    }
    let search = try #require(tabs.tabs.last?.viewController)
    search.loadViewIfNeeded()
    let configuration = try #require(search.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)
    #expect(configuration.secondaryText == "Not in the app yet")
  }

  @Test func the_today_tab_goes_back_to_today_from_another_day() async throws {
    let h = try await Harness(copy: try copy())
    let tabs = try tabs(h)
    let day = tabs.dayScreen
    day.loadViewIfNeeded()
    let todayTab = try #require(tabs.tabs.first)

    day.open(yesterday)
    #expect(day.date == yesterday)
    #expect(tabs.delegate?.tabBarController?(tabs, shouldSelectTab: todayTab) == true)
    day.updatePropertiesIfNeeded()
    #expect(day.date == today)

    // From another tab too: the web's Today tab is `/`.
    day.open(yesterday)
    tabs.selectedTab = tabs.tabs[1]
    #expect(tabs.delegate?.tabBarController?(tabs, shouldSelectTab: todayTab) == true)
    #expect(day.date == today)
  }

  @Test func the_today_tab_shows_the_day_of_the_month_and_moves_at_midnight() async throws {
    let clock = Clock()
    let h = try await Harness(copy: try copy(), clock: clock)
    let tabs = try tabs(h)
    tabs.updatePropertiesIfNeeded()
    #expect(tabs.tabs.first?.image == UIImage(systemName: "25.calendar"))

    clock.date = Date(timeIntervalSince1970: 1_795_651_201)  // 2026-11-26T00:00:01Z
    h.model.checkToday()
    tabs.updatePropertiesIfNeeded()
    #expect(tabs.tabs.first?.image == UIImage(systemName: "26.calendar"))
  }

  @Test func every_tab_symbol_is_one_the_system_has() {
    for day in ["2026-11-01", "2026-11-25", "2026-12-31"] {
      for place in AppTabs.places(today: LocalDate(day)!) {
        #expect(UIImage(systemName: place.symbol) != nil, "\(place.symbol)")
      }
    }
  }
}
