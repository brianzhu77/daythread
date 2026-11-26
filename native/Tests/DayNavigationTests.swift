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

/// Yesterday's page gone to Trash, with the batch it went in when `trashId` is given.
private func trashedPage(_ date: LocalDate, trashId: String?) -> String {
  let batch = trashId.map { #","trashId":"\#($0)""# } ?? ""
  return #"{"id":"day:\#(date.value)","type":"daily","date":"\#(date.value)","title":"","document":"[]","#
    + #""trashedAt":"2026-11-24T20:00:00.000Z"\#(batch)}"#
}

/// Today's page and an open to-do, and `others` pages; nothing for yesterday unless `others` has it.
private func copy(revision: Int = 1, others: [String] = []) throws -> Workspace {
  let task = #"{"id":"t-open","title":"Water the plants","status":"open","paused":false,"doneOn":null,"version":1}"#
  let pages = ([dayPage(today)] + others).joined(separator: ",")
  let text = #"{"revision":\#(revision),"timezone":"UTC","pages":[\#(pages)],"tasks":[\#(task)]}"#
  return try #require(Workspace(try JSON.parse(text)))
}

/// What the server answers for `restore-batch` on yesterday's page, made on revision 1.
private func yesterdayRestored() throws -> WorkspaceChanges {
  let text =
    #"{"from":1,"revision":2,"timezone":"UTC","pages":{"upsert":[\#(dayPage(yesterday))],"remove":[]},"#
    + #""tasks":{"upsert":[],"remove":[]}}"#
  return try #require(WorkspaceChanges(try JSON.parse(text)))
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
  /// The button with this accessibility label or title, in the navigation bar or the toolbar.
  fileprivate func item(_ name: String) -> UIBarButtonItem? {
    let items =
      (navigationItem.leftBarButtonItems ?? []) + (navigationItem.rightBarButtonItems ?? []) + (toolbarItems ?? [])
    return items.first { $0.accessibilityLabel == name || $0.title == name }
  }

  /// The navigation bar's trailing buttons from the trailing edge, by what VoiceOver says.
  fileprivate var trailingButtons: [String] { (navigationItem.rightBarButtonItems ?? []).compactMap(\.name) }

  /// The toolbar's buttons from the leading edge, by what VoiceOver says; its spaces are not buttons.
  fileprivate var toolbarButtons: [String] { (toolbarItems ?? []).compactMap(\.name) }

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

extension UIBarButtonItem {
  fileprivate var name: String? { accessibilityLabel ?? title }
}

/// A held tick, answered by a server that holds it and then has the to-do cancelled elsewhere.
@MainActor
private func heldTick(on h: Harness) async throws {
  let cancelled = #"{"id":"t-open","title":"Water the plants","status":"cancelled","paused":false,"doneOn":null,"version":2}"#
  let text = #"{"revision":2,"timezone":"UTC","pages":[\#(dayPage(today))],"tasks":[\#(cancelled)]}"#
  await h.server.add([
    .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "one")),
    .workspace(.full(try #require(Workspace(try JSON.parse(text))), owner: "one")),
  ])
  #expect(h.model.tick(taskId: "t-open"))
  try await until { !h.model.state.held.isEmpty }
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

  @Test func on_today_the_bar_has_the_account_and_the_toolbar_the_three_day_controls() {
    #expect(
      DayControls.controls(for: today, today: today, hasAccount: true, hasHeld: false)
        == DayControls(
          navigationBar: [.account], toolbar: [.previousDay, .space, .calendar, .space, .nextDay], canGoNext: false))
  }

  @Test func on_yesterday_the_toolbar_adds_today_before_next() {
    #expect(
      DayControls.controls(for: yesterday, today: today, hasAccount: true, hasHeld: false)
        == DayControls(
          navigationBar: [.account], toolbar: [.previousDay, .space, .calendar, .space, .today, .nextDay],
          canGoNext: true))
  }

  @Test func on_tomorrow_the_toolbar_adds_today_and_next_is_off() {
    #expect(
      DayControls.controls(for: tomorrow, today: today, hasAccount: true, hasHeld: false)
        == DayControls(
          navigationBar: [.account], toolbar: [.previousDay, .space, .calendar, .space, .today, .nextDay],
          canGoNext: false))
  }

  @Test func not_saved_sits_beside_the_account_only_while_a_change_is_held() {
    let held = DayControls.controls(for: today, today: today, hasAccount: true, hasHeld: true)
    #expect(held.navigationBar == [.account, .held])
    #expect(DayControls.controls(for: today, today: today, hasAccount: false, hasHeld: true).navigationBar == [.held])
    #expect(DayControls.controls(for: today, today: today, hasAccount: false, hasHeld: false).navigationBar == [])
  }

  @Test func the_day_controls_are_in_the_toolbar_and_the_account_in_the_navigation_bar() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()

    #expect(screen.navigationItem.leftBarButtonItems ?? [] == [])
    #expect(screen.trailingButtons == ["Account"])
    #expect(screen.toolbarButtons == ["Previous day", "Calendar", "Next day"])
    #expect(screen.item("Next day")?.isEnabled == false)

    screen.tap("Previous day")
    #expect(screen.trailingButtons == ["Account"])
    #expect(screen.toolbarButtons == ["Previous day", "Calendar", "Today", "Next day"])
    #expect(screen.item("Next day")?.isEnabled == true)

    screen.tap("Today")
    #expect(screen.toolbarButtons == ["Previous day", "Calendar", "Next day"])
  }

  @Test func not_saved_appears_beside_the_account_while_a_change_is_held() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()

    try await heldTick(on: h)

    #expect(screen.drawn().trailingButtons == ["Account", "Not saved"])
    #expect(screen.toolbarButtons == ["Previous day", "Calendar", "Next day"])
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

  @Test func add_page_asks_the_server_once_and_shows_the_page() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")

    let empty = try #require(screen.emptyState)
    #expect(empty.text == "No page for \(DayTitle.text(for: yesterday))")
    #expect(empty.button.title == "Add page")
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

  @Test func add_page_says_it_could_not_when_offline() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")

    // The server has no reply scripted: the call fails for lack of network.
    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState?.secondaryText == "Couldn't add a page · try again" }
    let failed = try #require(screen.emptyState)
    #expect(failed.text == "No page for \(DayTitle.text(for: yesterday))")
    #expect(!failed.button.showsActivityIndicator)
    #expect(failed.buttonProperties.isEnabled)

    await h.server.add([.outcome(.applied(receipt: .object([:]), changes: try yesterdayStarted(), owner: "one"))])
    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState == nil }
    #expect(screen.content == .page(try #require(h.model.workspace?.dayPage(yesterday))))
    #expect(await h.server.sent == [Command.ensureDay(yesterday), Command.ensureDay(yesterday)])
  }

  @Test func a_day_opened_before_it_is_today_follows_today_once_it_is() async throws {
    let clock = Clock()
    let h = try await Harness(copy: try copy(), clock: clock)
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.open(tomorrow)
    #expect(screen.drawn().title == DayTitle.text(for: tomorrow))

    clock.date = Date(timeIntervalSince1970: 1_795_651_201)  // 2026-11-26T00:00:01Z
    h.model.checkToday()
    #expect(screen.drawn().title == DayTitle.text(for: tomorrow))
    #expect(screen.item("Today") == nil, "the day shown is today")

    clock.date = Date(timeIntervalSince1970: 1_795_737_601)  // 2026-11-27T00:00:01Z
    h.model.checkToday()
    #expect(screen.drawn().title == DayTitle.text(for: LocalDate("2026-11-27")!))
  }

  @Test func the_day_timer_is_set_again_when_the_scene_becomes_active() async throws {
    let clock = Clock()
    let h = try await Harness(copy: try copy(), clock: clock)
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()
    let armed = try #require(screen.dayTimer)

    // The device slept for an hour: the timer counted none of it, so it would fire an hour late.
    clock.date = noon.addingTimeInterval(3_600)
    NotificationCenter.default.post(name: UIScene.didActivateNotification, object: nil)
    let rearmed = try #require(screen.drawn().dayTimer)

    #expect(rearmed !== armed)
    #expect(!armed.isValid)
    let fires = rearmed.fireDate.timeIntervalSinceNow
    #expect(abs(fires - h.model.nextDayChange.in) < 5, "fires in \(fires) s, the day changes in \(h.model.nextDayChange.in) s")
  }

  @Test func a_failure_line_goes_when_he_moves_to_another_day() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")
    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState?.secondaryText == "Couldn't add a page · try again" }

    screen.tap("Today")
    screen.tap("Previous day")
    let empty = try #require(screen.emptyState)
    #expect(empty.text == "No page for \(DayTitle.text(for: yesterday))")
    #expect(empty.secondaryText == nil)
  }

  @Test func a_failure_line_goes_when_the_day_shows_a_page() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")
    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState?.secondaryText == "Couldn't add a page · try again" }

    // Another device starts the page, then puts it in Trash.
    await h.server.add([.workspace(.full(try copy(revision: 2, others: [dayPage(yesterday)]), owner: "one"))])
    await h.model.refresh()
    try await until { screen.drawn().emptyState == nil }
    await h.server.add([
      .workspace(.full(try copy(revision: 3, others: [trashedPage(yesterday, trashId: "batch-1")]), owner: "one"))
    ])
    await h.model.refresh()
    try await until { screen.drawn().emptyState != nil }
    let trashed = try #require(screen.emptyState)
    #expect(trashed.text == "The page for \(DayTitle.text(for: yesterday)) is in Trash.")
    #expect(trashed.secondaryText == nil)
  }

  @Test func restore_sends_the_pages_trash_batch_and_shows_the_page() async throws {
    let h = try await Harness(copy: try copy(others: [trashedPage(yesterday, trashId: "batch-1")]))
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")

    let empty = try #require(screen.emptyState)
    #expect(empty.text == "The page for \(DayTitle.text(for: yesterday)) is in Trash.")
    #expect(empty.button.title == "Restore")
    #expect(empty.secondaryButton.title == "Add a new page")

    await h.server.add([.outcome(.applied(receipt: .object([:]), changes: try yesterdayRestored(), owner: "one"))])
    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState == nil }
    #expect(screen.content == .page(try #require(h.model.workspace?.dayPage(yesterday))))
    #expect(await h.server.sent == [Command.restoreBatch(trashId: "batch-1")])
  }

  @Test func restore_says_it_could_not_when_offline() async throws {
    let h = try await Harness(copy: try copy(others: [trashedPage(yesterday, trashId: "batch-1")]))
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")

    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState?.secondaryText == "Couldn't restore · try again" }
    let failed = try #require(screen.emptyState)
    #expect(failed.button.title == "Restore")
    #expect(failed.buttonProperties.isEnabled)
    #expect(await h.server.sent == [Command.restoreBatch(trashId: "batch-1")])
  }

  @Test func a_page_in_trash_with_no_batch_can_only_be_added_again() async throws {
    let h = try await Harness(copy: try copy(others: [trashedPage(yesterday, trashId: nil)]))
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.tap("Previous day")

    let empty = try #require(screen.emptyState)
    #expect(empty.text == "The page for \(DayTitle.text(for: yesterday)) is in Trash.")
    #expect(empty.button.title == "Add a new page")
    #expect(empty.secondaryButton.title == nil)

    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState?.secondaryText == "Couldn't add a page · try again" }
    #expect(await h.server.sent == [Command.ensureDay(yesterday)])
  }

  @Test func create_page_on_a_future_day_says_it_could_not_create_when_offline() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.open(tomorrow)

    let empty = try #require(screen.drawn().emptyState)
    #expect(empty.text == "\(DayTitle.text(for: tomorrow)) hasn't happened yet")
    #expect(empty.button.title == "Create page")

    screen.tapEmptyStateButton()
    try await until { screen.drawn().emptyState?.secondaryText == "Couldn't create a page · try again" }
    let failed = try #require(screen.emptyState)
    #expect(failed.button.title == "Create page")
    #expect(failed.buttonProperties.isEnabled)
    #expect(await h.server.sent == [Command.ensureDay(tomorrow)])
  }
}
