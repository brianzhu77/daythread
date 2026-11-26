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

/// The day's page holding one line of text, so the list has a first row.
private func pageWithALine(_ date: LocalDate) -> String {
  let block = Block(
    id: "line-\(date.value)", type: "paragraph", props: [:],
    content: .array([.object(["type": .string("text"), "text": .string("A line"), "styles": .object([:])])]),
    children: [])
  let page: JSONValue = .object([
    "id": .string("day:\(date.value)"), "type": .string("daily"), "date": .string(date.value), "title": .string(""),
    "document": .string(Document.write([block])),
  ])
  return JSON.write(page)
}

/// Today's page and an open to-do, and `others` pages; nothing for yesterday unless `others` has it.
private func copy(revision: Int = 1, others: [String] = [], todayHasALine: Bool = false) throws -> Workspace {
  let task = #"{"id":"t-open","title":"Water the plants","status":"open","paused":false,"doneOn":null,"version":1}"#
  let pages = ([todayHasALine ? pageWithALine(today) : dayPage(today)] + others).joined(separator: ",")
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
  /// The navigation bar's button with this accessibility label or title.
  fileprivate func item(_ name: String) -> UIBarButtonItem? {
    // The bar is filled when the screen is first drawn, as before any tap.
    updatePropertiesIfNeeded()
    let items = (navigationItem.leftBarButtonItems ?? []) + (navigationItem.rightBarButtonItems ?? [])
    return items.first { $0.accessibilityLabel == name || $0.title == name }
  }

  /// The navigation bar's trailing buttons from the leading edge to the trailing edge, by what VoiceOver says.
  fileprivate var trailingButtons: [String] { (navigationItem.rightBarButtonItems ?? []).reversed().compactMap(\.name) }

  /// The day's title as the header's button shows it.
  fileprivate var shownTitle: String? { headerView.titleButton.configuration?.title }

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

/// The screen in a phone-sized window in its navigation controller, laid out.
@MainActor
private func onScreen(_ screen: DayViewController) throws -> UIWindow {
  let window = try testWindow(width: 402)
  window.rootViewController = UINavigationController(rootViewController: screen)
  window.makeKeyAndVisible()
  screen.updatePropertiesIfNeeded()
  window.layoutIfNeeded()
  return window
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

  @Test func on_today_the_bar_holds_previous_next_and_more() {
    #expect(
      DayControls.controls(for: today, today: today, regularWidth: false, hasHeld: false, hasMore: true)
        == DayControls(navigationBar: [.previousDay, .nextDay, .more], canGoNext: false))
  }

  @Test func on_yesterday_the_phone_has_no_today_button_and_next_is_on() {
    #expect(
      DayControls.controls(for: yesterday, today: today, regularWidth: false, hasHeld: false, hasMore: true)
        == DayControls(navigationBar: [.previousDay, .nextDay, .more], canGoNext: true))
  }

  @Test func at_regular_width_today_comes_before_the_chevrons_while_another_day_is_open() {
    #expect(
      DayControls.controls(for: yesterday, today: today, regularWidth: true, hasHeld: false, hasMore: true)
        == DayControls(navigationBar: [.today, .previousDay, .nextDay, .more], canGoNext: true))
    #expect(
      DayControls.controls(for: tomorrow, today: today, regularWidth: true, hasHeld: false, hasMore: true)
        == DayControls(navigationBar: [.today, .previousDay, .nextDay, .more], canGoNext: false))
    #expect(
      DayControls.controls(for: today, today: today, regularWidth: true, hasHeld: false, hasMore: true).navigationBar
        == [.previousDay, .nextDay, .more])
  }

  @Test func not_saved_comes_before_more_only_while_a_change_is_held_and_more_only_with_something_in_it() {
    func bar(held: Bool, more: Bool) -> [DayControls.Item] {
      DayControls.controls(for: today, today: today, regularWidth: false, hasHeld: held, hasMore: more).navigationBar
    }
    #expect(bar(held: true, more: true) == [.previousDay, .nextDay, .held, .more])
    #expect(bar(held: true, more: false) == [.previousDay, .nextDay, .held])
    #expect(bar(held: false, more: false) == [.previousDay, .nextDay])
  }

  @Test func the_quiet_controls_are_in_the_navigation_bar_with_no_title_and_no_toolbar() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()

    #expect(screen.title == nil)
    #expect(screen.navigationItem.title == nil)
    #expect(screen.navigationItem.prompt == nil)
    #expect(screen.navigationItem.leftBarButtonItems ?? [] == [])
    #expect(screen.toolbarItems ?? [] == [])
    #expect(screen.trailingButtons == ["Previous day", "Next day", "More"])
    #expect(screen.item("Next day")?.isEnabled == false)
    for name in ["Previous day", "Next day", "More"] {
      let item = try #require(screen.item(name))
      #expect(item.hidesSharedBackground, "\(name) has no capsule")
      #expect(item.tintColor == .secondaryLabel, "\(name) is quiet")
    }
    #expect(screen.item("Previous day")?.image == UIImage(systemName: "chevron.left"))
    #expect(screen.item("Next day")?.image == UIImage(systemName: "chevron.right"))
    #expect(screen.item("More")?.image == UIImage(systemName: "ellipsis"))

    screen.tap("Previous day")
    #expect(screen.date == yesterday)
    #expect(screen.shownTitle == DayTitle.short(for: yesterday))
    #expect(screen.trailingButtons == ["Previous day", "Next day", "More"])
    #expect(screen.item("Next day")?.isEnabled == true)

    screen.tap("Next day")
    #expect(screen.date == today)
    #expect(screen.shownTitle == DayTitle.short(for: today))
    #expect(screen.item("Next day")?.isEnabled == false)
  }

  @Test func at_regular_width_a_today_button_shows_while_another_day_is_open() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.traitOverrides.horizontalSizeClass = .regular
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()
    #expect(screen.trailingButtons == ["Previous day", "Next day", "More"])

    screen.tap("Previous day")
    #expect(screen.trailingButtons == ["Today", "Previous day", "Next day", "More"])
    let todayItem = try #require(screen.item("Today"))
    #expect(todayItem.hidesSharedBackground, "Today has no capsule")
    #expect(todayItem.tintColor == .secondaryLabel, "Today is quiet")

    screen.tap("Today")
    #expect(screen.date == today)
    #expect(screen.trailingButtons == ["Previous day", "Next day", "More"])
  }

  @Test func not_saved_appears_before_more_while_a_change_is_held() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()

    try await heldTick(on: h)

    #expect(screen.drawn().trailingButtons == ["Previous day", "Next day", "Not saved", "More"])
    #expect(screen.item("Not saved")?.tintColor == .systemRed)
    #expect(screen.item("Not saved")?.hidesSharedBackground == true)
  }

  @Test func the_header_names_the_day_and_moves_with_it() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()

    let header = screen.headerView
    #expect(screen.shownTitle == DayTitle.short(for: today))
    #expect(header.relativeLabel.text == "Today")
    #expect(!header.relativeLabel.isHidden)
    #expect(header.titleButton.accessibilityLabel == DayHeading(for: today, today: today).accessibilityLabel)
    #expect(header.statusLabel.isHidden, "nothing to say")

    screen.tap("Previous day")
    #expect(screen.shownTitle == DayTitle.short(for: yesterday))
    #expect(header.relativeLabel.text == "Yesterday")

    screen.tap("Previous day")
    let twoBack = try #require(yesterday.adding(days: -1))
    #expect(header.relativeLabel.isHidden, "two days back has no word")
    #expect(header.titleButton.accessibilityLabel == DayHeading(for: twoBack, today: today).accessibilityLabel)
  }

  @Test func the_status_line_is_in_the_header_and_not_the_prompt() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()

    // The server has no reply scripted: the pass fails for lack of network.
    await h.model.refresh()
    try await until { h.model.state.offline }

    #expect(screen.drawn().headerView.statusLabel.text == "Offline · showing what was last loaded")
    #expect(!screen.headerView.statusLabel.isHidden)
    #expect(screen.navigationItem.prompt == nil)
  }

  @Test func the_title_opens_the_day_picker_anchored_to_it() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    let window = try onScreen(screen)

    screen.headerView.titleButton.sendActions(for: .primaryActionTriggered)

    let picker = try #require(screen.presentedViewController as? DayPickerViewController)
    #expect(picker.popoverPresentationController?.sourceItem === screen.headerView.titleButton)
    screen.dismiss(animated: false)
    window.isHidden = true
  }

  @Test func the_list_measures_the_header_again_when_it_grows_and_shrinks() async throws {
    let twoBack = try #require(yesterday.adding(days: -1))
    let h = try await Harness(copy: try copy(others: [pageWithALine(twoBack)], todayHasALine: true))
    let screen = DayViewController(model: h.model)
    let window = try onScreen(screen)
    let list = try #require(screen.list)
    /// The header's height, and the space between it and the first row, as drawn now.
    func drawn() throws -> (height: CGFloat, gap: CGFloat) {
      screen.updatePropertiesIfNeeded()
      // A self-sized supplementary settles over two passes.
      window.layoutIfNeeded()
      window.layoutIfNeeded()
      let first = try #require(list.cellForItem(at: IndexPath(item: 0, section: 0)), "the page's first row")
      let header = screen.headerView.convert(screen.headerView.bounds, to: list)
      return (header.height, first.frame.minY - header.maxY)
    }
    let resting = try drawn()
    #expect(resting.gap >= -0.5)

    // The status line appears under the title: the header grows, and the rows move down with it.
    await h.model.refresh()
    try await until { h.model.state.offline }
    let offline = try drawn()
    #expect(offline.height > resting.height + 1, "taller: \(offline.height) after \(resting.height)")
    #expect(abs(offline.gap - resting.gap) < 0.5, "the first row below the header: gap \(offline.gap)")

    // Back online the line goes, and no gap is left behind.
    await h.server.add([.workspace(.unchanged(revision: 1, owner: "one"))])
    await h.model.refresh()
    try await until { !h.model.state.offline }
    let online = try drawn()
    #expect(abs(online.height - resting.height) < 0.5)
    #expect(abs(online.gap - resting.gap) < 0.5, "no gap left: \(online.gap)")

    // A day with no relative word has a shorter header; again the rows follow it.
    screen.open(twoBack)
    let plain = try drawn()
    #expect(plain.height < resting.height - 1, "shorter: \(plain.height) after \(resting.height)")
    #expect(abs(plain.gap - resting.gap) < 0.5, "no gap left: \(plain.gap)")

    screen.open(nil)
    let back = try drawn()
    #expect(abs(back.height - resting.height) < 0.5)
    #expect(abs(back.gap - resting.gap) < 0.5)
    window.isHidden = true
  }

  @Test func the_header_is_the_lists_first_row_and_stays_on_a_day_without_a_page() async throws {
    let h = try await Harness(copy: try copy())
    let screen = DayViewController(model: h.model)
    let window = try onScreen(screen)
    let list = try #require(screen.list)

    // The header is drawn in the list, above its rows, and scrolls with them.
    #expect(screen.headerView.isDescendant(of: list))
    let header = screen.headerView.convert(screen.headerView.bounds, to: list)
    #expect(header.minY >= 0)
    #expect(header.height > 0)
    #expect(list.backgroundView == nil)

    screen.tap("Previous day")
    window.layoutIfNeeded()
    #expect(screen.emptyState?.text == "No page for \(DayTitle.text(for: yesterday))")
    #expect(screen.headerView.isDescendant(of: list), "the header is how he leaves the day")
    let background = try #require(list.backgroundView)
    background.layoutIfNeeded()
    #expect(screen.emptyView.isDescendant(of: background))
    let headerBottom = screen.headerView.convert(screen.headerView.bounds, to: background).maxY
    let empty = screen.emptyView.convert(screen.emptyView.bounds, to: background)
    #expect(empty.minY >= headerBottom - 0.5, "the empty state is under the header")
    #expect(empty.height > 0)
    window.isHidden = true
  }

  @Test func today_follows_the_day_and_another_day_stays() async throws {
    let clock = Clock()
    let h = try await Harness(copy: try copy(), clock: clock)
    let following = DayViewController(model: h.model)
    let staying = DayViewController(model: h.model)
    following.loadViewIfNeeded()
    staying.loadViewIfNeeded()
    staying.tap("Previous day")
    #expect(following.drawn().shownTitle == DayTitle.short(for: today))
    #expect(staying.drawn().shownTitle == DayTitle.short(for: yesterday))

    await h.server.hold()
    #expect(h.model.tick(taskId: "t-open"))
    await h.server.callHeld()

    clock.date = Date(timeIntervalSince1970: 1_795_651_201)  // 2026-11-26T00:00:01Z
    h.model.checkToday()

    #expect(h.model.today == tomorrow)
    #expect(following.drawn().shownTitle == DayTitle.short(for: tomorrow))
    #expect(staying.drawn().shownTitle == DayTitle.short(for: yesterday))
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
    #expect(screen.shownTitle == DayTitle.short(for: yesterday))
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
    #expect(screen.drawn().shownTitle == DayTitle.short(for: tomorrow))

    clock.date = Date(timeIntervalSince1970: 1_795_651_201)  // 2026-11-26T00:00:01Z
    h.model.checkToday()
    #expect(screen.drawn().shownTitle == DayTitle.short(for: tomorrow))
    #expect(screen.headerView.relativeLabel.text == "Today", "the day shown is today")

    clock.date = Date(timeIntervalSince1970: 1_795_737_601)  // 2026-11-27T00:00:01Z
    h.model.checkToday()
    #expect(screen.drawn().shownTitle == DayTitle.short(for: LocalDate("2026-11-27")!))
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

    screen.open(nil)
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
