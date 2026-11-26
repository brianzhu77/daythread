import DaythreadCore
import DaythreadSync
import Foundation
import Testing
import UIKit

@testable import DaythreadUI

private let today = LocalDate("2026-11-25")!
private let yesterday = LocalDate("2026-11-24")!
private let tomorrow = LocalDate("2026-11-26")!

private func dayPage(_ date: LocalDate) -> String {
  #"{"id":"day:\#(date.value)","type":"daily","date":"\#(date.value)","title":"","document":"[]"}"#
}

/// Today's page and an open to-do; nothing for yesterday.
private func copy() throws -> Workspace {
  let task = #"{"id":"t-open","title":"Water the plants","status":"open","paused":false,"doneOn":null,"version":1}"#
  let text = #"{"revision":1,"timezone":"UTC","pages":[\#(dayPage(today))],"tasks":[\#(task)]}"#
  return try #require(Workspace(try JSON.parse(text)))
}

/// What the server answers for `ensure-day` on yesterday, made on revision 1.
private func yesterdayStarted() throws -> WorkspaceChanges {
  let text =
    #"{"from":1,"revision":2,"timezone":"UTC","pages":{"upsert":[\#(dayPage(yesterday))],"remove":[]},"#
    + #""tasks":{"upsert":[],"remove":[]}}"#
  return try #require(WorkspaceChanges(try JSON.parse(text)))
}

@MainActor
extension DayViewController {
  /// The bar button with this accessibility label or title.
  fileprivate func item(_ name: String) -> UIBarButtonItem? {
    let items = (navigationItem.leftBarButtonItems ?? []) + (navigationItem.rightBarButtonItems ?? [])
    return items.first { $0.accessibilityLabel == name || $0.title == name }
  }

  fileprivate func tap(_ name: String) {
    guard let item = item(name) else {
      Issue.record("No \(name) button")
      return
    }
    item.primaryAction?.performWithSender(item, target: nil)
    updatePropertiesIfNeeded()
  }

  fileprivate func tapEmptyStateButton() {
    emptyState?.buttonProperties.primaryAction?.performWithSender(nil, target: nil)
    updatePropertiesIfNeeded()
  }

  /// The screen as drawn now.
  fileprivate func drawn() -> Self {
    updatePropertiesIfNeeded()
    return self
  }
}

/// Moving between days: what the bar offers on each, which day the screen holds as the clock moves, and starting a
/// day's page from its empty state.
@MainActor
@Suite struct DayNavigationTests {
  @Test func yesterday_can_go_next_and_shows_today() {
    #expect(DayNavigation.bar(for: yesterday, today: today) == DayNavigation(canGoNext: true, showsToday: true))
  }

  @Test func today_cannot_go_next_and_does_not_show_today() {
    #expect(DayNavigation.bar(for: today, today: today) == DayNavigation(canGoNext: false, showsToday: false))
  }

  @Test func tomorrow_cannot_go_next_and_shows_today() {
    #expect(DayNavigation.bar(for: tomorrow, today: today) == DayNavigation(canGoNext: false, showsToday: true))
  }

  @Test func the_bar_steps_back_a_day_and_returns_to_today() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()

    #expect(screen.title == DayTitle.text(for: today))
    #expect(screen.item("Next day")?.isEnabled == false)
    #expect(screen.item("Today") == nil)
    #expect(screen.item("Calendar") != nil)

    screen.tap("Previous day")
    #expect(screen.title == DayTitle.text(for: yesterday))
    #expect(screen.item("Next day")?.isEnabled == true)
    #expect(screen.item("Today") != nil)

    screen.tap("Today")
    #expect(screen.title == DayTitle.text(for: today))
    #expect(screen.item("Today") == nil)
  }

  @Test func today_follows_the_day_and_another_day_stays() async throws {
    let clock = Clock()
    let h = try await Harness(copy: try copy(), clock: clock)
    let following = DayViewController(model: h.model)
    let staying = DayViewController(model: h.model)
    following.loadViewIfNeeded()
    staying.loadViewIfNeeded()
    staying.tap("Previous day")
    #expect(following.drawn().title == DayTitle.text(for: today))
    #expect(staying.drawn().title == DayTitle.text(for: yesterday))

    await h.server.hold()
    #expect(h.model.tick(taskId: "t-open"))
    await h.server.callHeld()

    clock.date = Date(timeIntervalSince1970: 1_795_651_201)  // 2026-11-26T00:00:01Z
    h.model.checkToday()

    #expect(h.model.today == tomorrow)
    #expect(following.drawn().title == DayTitle.text(for: tomorrow))
    #expect(staying.drawn().title == DayTitle.text(for: yesterday))
    let sent = await h.server.sent
    #expect(sent.count == 1)
    #expect(sent.first?.objectValue?["today"]?.stringValue == today.value)
    await h.server.release()
  }

  @Test func start_this_page_asks_the_server_once_and_shows_the_page() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")

    let empty = try #require(screen.emptyState)
    #expect(empty.text == "No page for \(DayTitle.text(for: yesterday)) yet")
    #expect(empty.button.title == "Start this page")
    #expect(empty.secondaryText == nil)

    await h.server.add([.outcome(.applied(receipt: .object([:]), changes: try yesterdayStarted(), owner: "one"))])
    await h.server.hold()
    screen.tapEmptyStateButton()
    screen.tapEmptyStateButton()
    await h.server.callHeld()
    let waiting = try #require(screen.drawn().emptyState)
    #expect(waiting.button.showsActivityIndicator)
    #expect(!waiting.buttonProperties.isEnabled)
    await h.server.release()

    try await until { screen.drawn().content == h.model.workspace?.dayPage(yesterday).map(DayContent.page) }
    #expect(screen.emptyState == nil)
    #expect(screen.title == DayTitle.text(for: yesterday))
    #expect(await h.server.sent == [Command.ensureDay(yesterday)])
  }

  @Test func start_this_page_says_it_could_not_when_offline() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")

    // The server has no reply scripted: the call fails for lack of network.
    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState?.secondaryText == "Couldn't start a page · try again" }
    let failed = try #require(screen.emptyState)
    #expect(failed.text == "No page for \(DayTitle.text(for: yesterday)) yet")
    #expect(!failed.button.showsActivityIndicator)
    #expect(failed.buttonProperties.isEnabled)

    await h.server.add([.outcome(.applied(receipt: .object([:]), changes: try yesterdayStarted(), owner: "one"))])
    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState == nil }
    #expect(screen.content == .page(try #require(h.model.workspace?.dayPage(yesterday))))
    #expect(await h.server.sent == [Command.ensureDay(yesterday), Command.ensureDay(yesterday)])
  }
}
