import DaythreadSync
import Foundation
import SwiftUI
import Testing
import UIKit

@testable import DaythreadCore
@testable import DaythreadEditor
@testable import DaythreadUI

/// Thursday, the day these tests run on.
private let today = LocalDate("2026-11-26")!
private let yesterday = LocalDate("2026-11-25")!
/// Noon UTC on Thursday, Nov 26 2026.
private let thursdayNoon = Date(timeIntervalSince1970: 1_795_694_400)
private let todayId = "day:2026-11-26"
private let two = Session(token: "token-two", owner: "two", expiresAt: thursdayNoon.addingTimeInterval(86_400 * 30))

/// The draft of `dayPageId` as the server stores it: a hidden page under the day page, its document an object.
private func draftPage(
  of dayPageId: String = todayId, status: String = "ready", recipe: Int = DayDraft.currentRecipe,
  items: [String] = []
) -> JSONValue {
  .object([
    "id": .string("draft:\(dayPageId)"), "type": .string("draft"), "parentId": .string(dayPageId),
    "title": .string(""),
    "document": .string(
      #"{"status":"\#(status)","recipe":\#(recipe),"moreOpen":[],"items":[\#(items.joined(separator: ","))]}"#),
  ])
}

/// A suggestion carrying `taskId`, after the page's first line.
private func suggestion(_ id: String, _ taskId: String, _ words: String, state: String = "open") -> String {
  #"{"id":"\#(id)","anchor":"a","place":"after","taskId":"\#(taskId)","state":"\#(state)","block":\#(row("g-" + id, taskId, words))}"#
}

/// Three open to-dos with no row on today's page, each offered by `drafted`'s suggestions, and one that has its row.
private let tasks = [
  task("t1", "Water the plants"), task("t2", "Call mum"), task("t3", "Book the dentist"), task("t4", "Fix the gate"),
]
private let three = [
  suggestion("s2", "t2", "Call mum"), suggestion("s3", "t3", "Book the dentist"),
  suggestion("s4", "t4", "Fix the gate"),
]

/// Today's page: a line, a plan row of `t1`, `Notes`, then filler, so the page scrolls. Nothing on it gives the strip
/// a fact: only the draft's line can show.
private let todayLines =
  [line("a", "Morning"), row("r1", "t1", "Water the plants"), line("notes", "Notes")]
  + (1...30).map { line("f\($0)", "Line \($0)") }
private let todayPage = page(today, todayLines)

private func trashed(_ page: JSONValue) -> JSONValue {
  var object = page.objectValue!
  object["trashedAt"] = .string("2026-11-26T08:00:00.000Z")
  object["trashId"] = .string("batch-1")
  return .object(object)
}

private func reply(setDraft text: String?) -> Result<DayDraftReply, TransportError> {
  .success(DayDraftReply(setDraft: text, owner: "one", modelOn: true, remakeFailed: false))
}

/// A wait that ends only when opened, and that cancelling does not end: as a wait that had already run out when its
/// task was cancelled.
private actor Gate {
  private(set) var waiting = 0
  private var continuations: [CheckedContinuation<Void, Never>] = []

  func wait() async {
    waiting += 1
    await withCheckedContinuation { continuations.append($0) }
  }

  func open() {
    for continuation in continuations { continuation.resume() }
    continuations = []
  }
}

/// Lets the run loop turn, so the strip's height reaches the list, then lays the screen out.
@MainActor
private func settled(_ day: RowScreen) async throws {
  day.drawn()
  try await turns()
  day.drawn()
}

/// §13.4: the draft's line, the strip's first row on today: nothing, `Preparing…`, the count with `Apply all` and
/// `Dismiss`, `Couldn’t draft` with `Retry`, or `Offline`, read when a state is drawn.
@MainActor
@Suite(.serialized) struct DraftLineViewTests {
  private var thursday: Clock {
    let clock = Clock()
    clock.date = thursdayNoon
    return clock
  }

  private func harness(
    pages: [JSONValue] = [todayPage], asksForDayDrafts: Bool = true,
    draftSleep: @escaping @Sendable (Duration) async throws -> Void = neverEnding
  ) async throws -> Harness {
    try await Harness(
      copy: try copy(pages: pages, tasks: tasks), clock: thursday, sleep: neverEnding,
      asksForDayDrafts: asksForDayDrafts, draftSleep: draftSleep)
  }

  /// Loads `pages` as the server's copy at `revision` and waits for the screen to draw it.
  private func load(_ h: Harness, _ day: RowScreen, revision: Int, pages: [JSONValue]) async throws {
    await h.server.add([.workspace(.full(try copy(revision: revision, pages: pages, tasks: tasks), owner: "one"))])
    await h.model.refresh()
    try await soon { h.model.state.workspace?.revision == revision }
    try await settled(day)
  }

  private func shown(_ day: RowScreen) -> DraftLine? { day.factsModel.line }

  /// The line drawn on its own, `width` points wide at `size`, laid out; the frames its parts report are read from
  /// the model.
  private func drawnLine(_ line: DraftLine, size: UIContentSizeCategory, width: CGFloat = 402) throws
    -> (DayFactsModel, UIWindow)
  {
    let model = DayFactsModel()
    model.show(line: line)
    let host = UIHostingController(rootView: DayFactsView(model: model))
    host.safeAreaRegions = []
    let window = try testWindow(width: width)
    let root = UIViewController()
    root.traitOverrides.preferredContentSizeCategory = size
    window.rootViewController = root
    window.makeKeyAndVisible()
    root.addChild(host)
    root.view.addSubview(host.view)
    host.didMove(toParent: root)
    let height = host.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height
    host.view.frame = CGRect(x: 0, y: 0, width: width, height: height)
    window.layoutIfNeeded()
    host.view.layoutIfNeeded()
    return (model, window)
  }

  private static func holds<T: UIView>(_ type: T.Type, in view: UIView) -> Bool {
    view is T || view.subviews.contains { holds(type, in: $0) }
  }

  // MARK: What it says

  @Test func no_line_with_no_draft_and_no_ask() async throws {
    // The model asks by itself only when told to: here the ask is never made.
    let h = try await harness(asksForDayDrafts: false)
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(h.model.draftAsk(of: todayId) == nil)
    #expect(shown(day) == nil)
    #expect(day.screen.draftView == nil)
    #expect(day.factsModel.isEmpty)
    #expect(day.factsView.isHidden, "a page with no facts and no line has no strip")
    day.close()
  }

  @Test func preparing_while_the_ask_is_out() async throws {
    let h = try await harness()
    await h.server.holdDrafts()
    let day = try RowScreen(h.model)
    await h.server.draftHeld()
    try await settled(day)
    #expect(shown(day) == .preparing)
    #expect(shown(day)?.spoken == "Preparing\u{2026}")
    #expect(!day.factsView.isHidden)
    #expect(Self.holds(UIActivityIndicatorView.self, in: day.factsView), "the system's progress view")
    await h.server.releaseDrafts()
    day.close()
  }

  @Test func the_count_and_its_buttons() async throws {
    let h = try await harness(pages: [todayPage, draftPage(items: three)])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(await h.server.draftDates.isEmpty, "the draft stands: nothing is asked")
    #expect(day.screen.draftView?.suggestions.count == 3)
    #expect(shown(day) == .segments(count: "3 suggestions", failed: false, offline: false))
    #expect(!day.factsView.isHidden)
    day.close()

    let one = try await harness(pages: [todayPage, draftPage(items: [three[0]])])
    let oneDay = try RowScreen(one.model)
    try await settled(oneDay)
    #expect(shown(oneDay) == .segments(count: "1 suggestion", failed: false, offline: false))
    oneDay.close()

    let (model, window) = try drawnLine(.segments(count: "3 suggestions", failed: false, offline: false), size: .large)
    for part in [DraftLinePart.applyAll, .dismiss] {
      let frame = try #require(model.lineFrames[part], "\(part) drawn")
      #expect(frame.height >= 43.99 && frame.width >= 43.99, "\(part): \(frame.size)")
    }
    #expect(model.lineFrames[.retry] == nil)
    window.isHidden = true
  }

  @Test func the_lines_buttons_report_only_while_enabled() throws {
    let model = DayFactsModel()
    model.show(line: .segments(count: "3 suggestions", failed: true, offline: false))
    var reports: [String] = []
    model.onApplyAll = { reports.append("apply all") }
    model.onDismiss = { reports.append("dismiss") }
    model.onRetry = { reports.append("retry") }

    model.enabled = false
    model.applyAllTapped()
    model.dismissTapped()
    model.retryTapped()
    #expect(reports.isEmpty)

    model.enabled = true
    model.applyAllTapped()
    model.dismissTapped()
    model.retryTapped()
    #expect(reports == ["apply all", "dismiss", "retry"])
  }

  @Test func couldnt_draft_after_a_failed_ask_with_nothing_stored() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    // Nothing queued: the ask fails for lack of network.
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 1) }
    try await settled(day)
    #expect(shown(day) == .segments(count: nil, failed: true, offline: false))
    #expect(shown(day)?.spoken == "Couldn\u{2019}t draft")
    day.close()

    let (model, window) = try drawnLine(.segments(count: nil, failed: true, offline: false), size: .large)
    let retry = try #require(model.lineFrames[.retry], "Retry drawn")
    #expect(retry.height >= 43.99 && retry.width >= 43.99, "Retry: \(retry.size)")
    #expect(model.lineFrames[.applyAll] == nil && model.lineFrames[.dismiss] == nil)
    window.isHidden = true
  }

  @Test func retry_asks_again() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 1) }
    try await settled(day)
    #expect(shown(day) == .segments(count: nil, failed: true, offline: false))
    let reads = day.screen.draftReads

    await h.server.holdDrafts()
    day.factsModel.retryTapped()
    try await eventually { await h.server.draftDates == [today, today] }
    await h.server.draftHeld()
    try await settled(day)
    #expect(shown(day) == .preparing, "Preparing again while the second ask runs")

    await h.server.releaseDrafts()
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 2) }
    try await settled(day)
    #expect(shown(day) == .segments(count: nil, failed: true, offline: false))
    #expect(day.screen.draftReads == reads, "the ask's changes redraw the line, not the draft")
    day.close()
  }

  @Test func a_stored_failed_draft_says_so_beside_its_suggestions() async throws {
    let open = [three[0], three[1]]
    let h = try await harness(pages: [todayPage, draftPage(status: "failed", items: open)])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(await h.server.draftDates.isEmpty, "a failed draft with every item open stands")
    #expect(shown(day) == .segments(count: "2 suggestions", failed: true, offline: false))
    #expect(shown(day)?.spoken == "2 suggestions, Couldn\u{2019}t draft")

    let skipped = [suggestion("s2", "t2", "Call mum", state: "skipped"), three[1]]
    try await load(h, day, revision: 2, pages: [todayPage, draftPage(status: "failed", items: skipped)])
    #expect(shown(day) == .segments(count: "1 suggestion", failed: false, offline: false), "one decided: settled")
    day.close()
  }

  @Test func offline_with_nothing_stored_says_offline() async throws {
    let h = try await harness()
    await h.model.refresh()
    try await soon { h.model.state.offline }
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(await h.server.draftDates.isEmpty)
    #expect(shown(day) == .segments(count: nil, failed: false, offline: true))
    #expect(shown(day)?.spoken == "Offline")
    #expect(!day.factsView.isHidden)
    day.close()
  }

  @Test func offline_with_a_stored_draft_shows_its_line() async throws {
    let h = try await harness(pages: [todayPage, draftPage(items: three)])
    await h.model.refresh()
    try await soon { h.model.state.offline }
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(shown(day) == .segments(count: "3 suggestions", failed: false, offline: false))
    day.close()
  }

  @Test func a_stale_drafts_suggestions_stay_while_it_is_asked_again() async throws {
    let h = try await harness(pages: [todayPage, draftPage(recipe: 4, items: [three[0]])])
    await h.server.holdDrafts()
    let day = try RowScreen(h.model)
    await h.server.draftHeld()
    try await settled(day)
    #expect(h.model.draftAsk(of: todayId)?.inFlight(at: thursdayNoon) == true, "a settled recipe-4 draft is asked for")
    #expect(shown(day) == .segments(count: "1 suggestion", failed: false, offline: false), "not Preparing…")
    #expect(day.screen.draftView?.suggestions.map(\.words) == ["Call mum"])
    await h.server.releaseDrafts()
    day.close()
  }

  @Test func a_ready_draft_with_nothing_open_has_no_line() async throws {
    let decided = [suggestion("s2", "t2", "Call mum", state: "applied")]
    let h = try await harness(pages: [todayPage, draftPage(items: decided)])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(await h.server.draftDates.isEmpty)
    #expect(day.screen.draftView?.suggestions.isEmpty == true)
    #expect(shown(day) == nil)
    #expect(day.factsView.isHidden)
    day.close()
  }

  @Test func no_line_on_another_day_or_on_today_in_trash() async throws {
    let yesterdayPage = page(yesterday, [line("a", "Rent")])
    let h = try await harness(pages: [
      todayPage, draftPage(items: three), yesterdayPage, draftPage(of: "day:2026-11-25", status: "failed", items: three),
    ])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(shown(day) != nil)

    day.screen.open(yesterday)
    try await settled(day)
    #expect(shown(day) == nil, "yesterday")
    #expect(day.screen.draftView == nil)

    day.screen.open(nil)
    try await settled(day)
    #expect(shown(day) == .segments(count: "3 suggestions", failed: false, offline: false), "today again")
    day.close()

    let inTrash = try await harness(pages: [trashed(todayPage), draftPage(status: "failed", items: three)])
    let trashedDay = try RowScreen(inTrash.model)
    try await settled(trashedDay)
    #expect(await inTrash.server.draftDates.isEmpty)
    #expect(shown(trashedDay) == nil, "today in Trash")
    #expect(trashedDay.screen.draftView == nil)
    trashedDay.close()
  }

  @Test func an_account_change_empties_the_line() async throws {
    let h = try await harness(pages: [todayPage, draftPage(items: three)])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(shown(day) != nil)

    await h.server.add([.done])
    #expect(await h.model.signOut(discardingUnsent: true) == .signedOut)
    try await soon { h.model.state.workspace == nil }
    try await settled(day)
    #expect(shown(day) == nil, "no copy shown: no line of the first account")
    #expect(day.screen.draftView == nil)
    #expect(day.factsView.isHidden)

    let theirs = try copy(revision: 5, pages: [page(today, [line("a", "Morning")])], tasks: [])
    await h.server.add([.session(two), .workspace(.full(theirs, owner: "two"))])
    // Made from the first account's workspace: dropped, and the ask is over.
    await h.server.addDrafts([reply(setDraft: nil)])
    #expect(await h.model.signIn(email: "two@example.com", password: "secret") == nil)
    try await soon { h.model.state.owner == "two" && h.model.state.workspace != nil }
    try await soon { h.model.draftAsk(of: todayId) == .done }
    try await settled(day)
    #expect(shown(day) == nil, "their page has no draft")
    day.close()
  }

  // MARK: When it is read

  @Test func the_line_is_not_worked_out_on_a_keystroke() async throws {
    let h = try await harness(pages: [todayPage, draftPage(items: three)])
    let day = try RowScreen(h.model)
    try await settled(day)
    let reads = day.screen.draftReads
    let published = h.model.state.published

    try day.type("!", atEndOf: "Notes")
    day.drawn()
    #expect(h.model.state.published == published, "no state has arrived")
    #expect(day.screen.draftReads == reads)

    try await soon { h.model.state.published != published }
    day.drawn()
    #expect(day.screen.draftReads > reads, "read once a state arrives")
    day.close()
  }

  @Test func the_line_being_typed_stays_when_the_line_appears() async throws {
    let nothingOpen = draftPage(items: [suggestion("s2", "t2", "Call mum", state: "applied")])
    let h = try await harness(pages: [todayPage, nothingOpen])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.factsView.isHidden)
    let notes = try day.line("Notes")
    #expect(notes.becomeFirstResponder())
    try await settled(day)
    let before = notes.convert(notes.bounds, to: nil)

    // Another device's draft arrives.
    try await load(h, day, revision: 2, pages: [todayPage, draftPage(items: three)])
    #expect(shown(day) == .segments(count: "3 suggestions", failed: false, offline: false))
    #expect(!day.factsView.isHidden, "the strip appeared")
    #expect(notes.isFirstResponder, "the keyboard stays up")
    let after = notes.convert(notes.bounds, to: nil)
    #expect(abs(after.minY - before.minY) <= 0.5, "the line was at \(before.minY), now \(after.minY)")
    day.close()
  }

  // MARK: How it looks and reads

  @Test func at_the_largest_text_size_the_buttons_go_under_the_words() throws {
    let (model, window) = try drawnLine(
      .segments(count: "3 suggestions", failed: false, offline: false), size: .accessibilityExtraExtraExtraLarge)
    let words = try #require(model.lineFrames[.words], "the count drawn")
    let applyAll = try #require(model.lineFrames[.applyAll], "Apply all drawn")
    #expect(applyAll.minY >= words.maxY - 0.5, "Apply all at \(applyAll), the count at \(words)")
    window.isHidden = true

    let (large, largeWindow) = try drawnLine(.segments(count: "3 suggestions", failed: false, offline: false), size: .large)
    let wordsLarge = try #require(large.lineFrames[.words])
    let applyAllLarge = try #require(large.lineFrames[.applyAll])
    #expect(applyAllLarge.minY < wordsLarge.maxY, "at the default size the buttons are beside the words")
    largeWindow.isHidden = true
  }

  /// SwiftUI builds no accessibility tree for a unit test to read: the words VoiceOver hears are the value's, and the
  /// view gives each segment's words their own element before that segment's buttons, each button its own.
  @Test func voiceover_reads_the_line_and_each_button() throws {
    #expect(DraftLine.segments(count: "3 suggestions", failed: false, offline: false).spokenSegments == ["3 suggestions"])
    #expect(
      DraftLine.segments(count: "3 suggestions", failed: true, offline: false).spokenSegments
        == ["3 suggestions", "Couldn\u{2019}t draft"])
    let (model, window) = try drawnLine(.segments(count: "3 suggestions", failed: true, offline: false), size: .large)
    #expect(Set(model.lineFrames.keys) == [.words, .applyAll, .dismiss, .retry], "the words, then three buttons")
    window.isHidden = true
  }

  // MARK: The ask's 60 seconds

  /// Cancelling the lost wait does not stop it once its sleep has run out: the answer came in between, and the ask
  /// is not lost.
  @Test func a_wait_that_ran_out_as_the_answer_came_marks_nothing_failed() async throws {
    let gate = Gate()
    let h = try await harness(draftSleep: { _ in await gate.wait() })
    h.model.holdsUndoSlot = true
    await h.server.addDrafts([reply(setDraft: draftText)])
    let page = try #require(h.model.workspace?.dayPage(today))
    h.model.todayDrawn(page)
    try await soon { h.model.sendsWaitingForUndoSlot == 1 }
    try await eventually { await gate.waiting == 1 }

    await gate.open()
    try await turns()
    #expect(h.model.draftAsk(of: todayId)?.inFlight(at: thursdayNoon) == true, "the answer is in hand")

    await h.server.add([
      applied(try changes(from: 1, to: 2, pages: [draftPage(items: three)], undo: "op-draft"))
    ])
    h.model.holdsUndoSlot = false
    try await soon { h.model.draftAsk(of: todayId) == .done }
  }

  private var draftText: String {
    #"{"type":"set-draft","pageId":"day:2026-11-26","status":"ready","moreOpen":[],"allowedTaskIds":["t2"],"recipe":5,"items":[]}"#
  }
}
