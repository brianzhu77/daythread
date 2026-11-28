import DaythreadSync
import Foundation
import Testing
import UIKit

@testable import DaythreadCore
@testable import DaythreadEditor
@testable import DaythreadUI

/// Thursday, the day these tests run on.
private let today = LocalDate("2026-11-26")!
private let yesterday = LocalDate("2026-11-25")!
private let tomorrow = LocalDate("2026-11-27")!
/// Noon UTC on Thursday, Nov 26 2026.
private let thursdayNoon = Date(timeIntervalSince1970: 1_795_694_400)
private let todayId = "day:2026-11-26"

private func type(of action: JSONValue) -> String? { action.objectValue?["type"]?.stringValue }

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

/// A suggestion of `t1`, open unless told otherwise.
private func item(_ id: String, state: String = "open") -> String {
  #"{"id":"\#(id)","anchor":"a","place":"after","taskId":"t1","state":"\#(state)","block":\#(row("g-" + id, "t1", "Water the plants"))}"#
}

/// The `set-draft` the route hands back, as JSON text.
private let setDraft =
  #"{"type":"set-draft","pageId":"day:2026-11-26","status":"ready","moreOpen":[],"allowedTaskIds":["t1"],"recipe":5,"items":[]}"#

private func reply(
  setDraft text: String? = setDraft, owner: String = "one", remakeFailed: Bool = false
) -> Result<DayDraftReply, TransportError> {
  .success(DayDraftReply(setDraft: text, owner: owner, modelOn: true, remakeFailed: remakeFailed))
}

/// What the server answers the `set-draft` above on `revision`: the draft page written, the slot this command's.
private func drafted(from revision: Int = 1) throws -> TestServer.Reply {
  applied(try changes(from: revision, to: revision + 1, pages: [draftPage()], undo: "op-draft"))
}

/// The day screen in a phone-sized window, as `RowScreen` holds it, with the notice's wait and VoiceOver the test's.
@MainActor
private struct DraftScreen {
  let window: UIWindow
  let screen: DayViewController

  init(
    _ model: AppModel, on day: LocalDate? = nil,
    noticeSleep: @escaping @Sendable (Duration) async throws -> Void = neverEnding, voiceOver: Bool = false
  ) throws {
    screen = DayViewController(model: model, noticeSleep: noticeSleep, voiceOverRunning: { voiceOver })
    // Before it is first drawn: a screen opened on another day never draws today.
    if let day { screen.open(day) }
    window = try testWindow(width: 402)
    window.rootViewController = UINavigationController(rootViewController: screen)
    window.makeKeyAndVisible()
    drawn()
  }

  func drawn() {
    screen.updatePropertiesIfNeeded()
    window.layoutIfNeeded()
  }

  var notice: Notice? { screen.notice.shown }

  private var editor: DocumentViewController {
    screen.children.compactMap { $0 as? DocumentViewController }.first!
  }

  /// Taps the swipe's action named `title` on the row that reads `words`.
  func swipe(_ words: String, _ title: String) throws {
    drawn()
    let list = try #require(screen.list)
    let cell = try #require(list.visibleCells.first { Self.textView(in: $0)?.text == words }, "no row \(words)")
    let indexPath = try #require(list.indexPath(for: cell))
    let swipe = editor.listConfiguration.trailingSwipeActionsConfigurationProvider?(indexPath)
    let action = try #require(swipe?.actions.first { $0.title == title }, "no swipe \(title) on \(words)")
    action.handler(action, UIView(), { _ in })
  }

  /// Puts the caret at the end of the line that reads `words` and types `text` there, as the keyboard does.
  func type(_ text: String, atEndOf words: String) throws {
    drawn()
    let list = try #require(screen.list)
    let line = try #require(list.visibleCells.lazy.compactMap { Self.textView(in: $0) }.first { $0.text == words })
    #expect(line.becomeFirstResponder())
    line.selectedRange = NSRange(location: (line.text as NSString).length, length: 0)
    line.insertText(text)
  }

  func close() {
    window.endEditing(true)
    window.isHidden = true
  }

  private static func textView(in view: UIView) -> UITextView? {
    if let view = view as? UITextView { return view }
    return view.subviews.lazy.compactMap { textView(in: $0) }.first
  }
}

/// §13.3: when the app asks for today's draft, at most twice by itself for a page in a run, and what it does with the
/// answer, `set-draft` held back while an Undo that the server's slot holds is offered.
@MainActor
@Suite struct DraftAskTests {
  private let water = task("t1", "Water the plants")
  private var thursday: Clock {
    let clock = Clock()
    clock.date = thursdayNoon
    return clock
  }

  /// Today's page: a line and a plan row of `t1`.
  private var todayPage: JSONValue { page(today, [line("a", "Morning"), row("r1", "t1", "Water the plants")]) }

  private func harness(
    pages: [JSONValue]? = nil, clock: Clock? = nil,
    draftSleep: @escaping @Sendable (Duration) async throws -> Void = neverEnding
  ) async throws -> Harness {
    try await Harness(
      copy: try copy(pages: pages ?? [todayPage], tasks: [water]), clock: clock ?? thursday, sleep: neverEnding,
      asksForDayDrafts: true, draftSleep: draftSleep)
  }

  private func todays(_ h: Harness) throws -> Page {
    try #require(h.model.workspace?.dayPage(today))
  }

  /// Asks for today's draft from the model, as the screen does when it draws today, and waits for the answer.
  private func asked(_ h: Harness, _ answer: Result<DayDraftReply, TransportError>) async throws {
    await h.server.addDrafts([answer])
    h.model.todayDrawn(try todays(h))
    try await soon { !(h.model.draftAsk(of: todayId)?.inFlight(at: thursdayNoon) ?? true) }
  }

  private func setDrafts(_ h: Harness) async -> [JSONValue] {
    await h.server.sent.filter { type(of: $0) == "set-draft" }
  }

  // MARK: When it asks

  @Test func it_asks_once_when_todays_page_is_shown() async throws {
    let h = try await harness()
    let day = try DraftScreen(h.model)
    try await eventually { await h.server.draftDates == [today] }
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 1) }

    for revision in 2...4 {
      await h.server.add([.workspace(.full(try copy(revision: revision, pages: [todayPage], tasks: [water]), owner: "one"))])
      await h.model.refresh()
      try await soon { h.model.state.workspace?.revision == revision }
      day.drawn()
    }
    try await turns()
    #expect(await h.server.draftDates == [today], "once for the page in this run")
    day.close()
  }

  @Test func it_does_not_ask_offline_signed_out_on_another_day_or_with_a_draft_that_stands() async throws {
    let drafts: [(String, JSONValue, Int)] = [
      ("a failed draft, all open", draftPage(status: "failed", items: [item("i1")]), 0),
      ("an unsettled draft of recipe 4", draftPage(status: "preparing", recipe: 4, items: [item("i1")]), 0),
      ("a settled draft of recipe 4", draftPage(status: "ready", recipe: 4), 1),
    ]
    for (name, draft, asks) in drafts {
      let h = try await harness(pages: [todayPage, draft])
      let day = try DraftScreen(h.model)
      try await turns()
      #expect(await h.server.draftDates.count == asks, "\(name)")
      day.close()
    }

    let shown = try await harness(pages: [todayPage, page(yesterday, [line("y", "Rent")])])
    let onYesterday = try DraftScreen(shown.model, on: yesterday)
    try await turns()
    #expect(await shown.server.draftDates.isEmpty, "yesterday shown")
    onYesterday.close()

    let offline = try await harness()
    await offline.model.refresh()
    try await soon { offline.model.state.offline }
    let offlineDay = try DraftScreen(offline.model)
    try await turns()
    #expect(await offline.server.draftDates.isEmpty, "offline")
    offlineDay.close()

    let signedOut = try await harness()
    let page = try todays(signedOut)
    await signedOut.server.add([.done])
    #expect(await signedOut.model.signOut(discardingUnsent: true) == .signedOut)
    signedOut.model.todayDrawn(page)
    try await turns()
    #expect(await signedOut.server.draftDates.isEmpty, "signed out")
  }

  @Test func coming_online_with_today_shown_asks() async throws {
    let h = try await harness()
    await h.model.refresh()
    try await soon { h.model.state.offline }
    let day = try DraftScreen(h.model)
    try await turns()
    #expect(await h.server.draftDates.isEmpty)

    await h.server.add([.workspace(.unchanged(revision: 1, owner: "one"))])
    await h.model.refresh()
    try await soon { !h.model.state.offline }
    try await eventually { await h.server.draftDates == [today] }
    try await turns()
    #expect(await h.server.draftDates == [today])
    day.close()
  }

  @Test func a_failed_ask_is_asked_again_once_when_he_comes_back() async throws {
    let h = try await harness(pages: [todayPage, page(yesterday, [line("y", "Rent")])])
    let day = try DraftScreen(h.model)
    // Nothing queued: each ask fails for lack of network.
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 1) }

    // Today shown again after another day.
    day.screen.open(yesterday)
    day.drawn()
    day.screen.open(nil)
    day.drawn()
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 2) }
    #expect(await h.server.draftDates == [today, today])

    // The app back in the foreground with today shown: twice by itself is all.
    day.screen.becameActive()
    day.drawn()
    try await turns()
    #expect(await h.server.draftDates.count == 2)

    h.model.retryDraft(try todays(h))
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 3) }
    #expect(await h.server.draftDates.count == 3, "Retry always asks")
    day.close()
  }

  @Test func an_ask_with_no_answer_in_sixty_seconds_is_lost() async throws {
    let waits = Waits()
    let h = try await harness(draftSleep: { try await waits.wait($0) })
    await h.server.holdDrafts()
    h.model.todayDrawn(try todays(h))
    await h.server.draftHeld()
    #expect(h.model.draftAsk(of: todayId)?.inFlight(at: thursdayNoon) == true)
    try await eventually { await waits.requested == [.seconds(60)] }

    await waits.release(0)
    try await soon { h.model.draftAsk(of: todayId)?.inFlight(at: thursdayNoon) == false }
    #expect(h.model.draftAsk(of: todayId) == .failed(failures: 1))

    h.model.cameBackToToday(try todays(h))
    try await eventually { await h.server.waitingDrafts == 2 }
    let second = DraftAsk.asking(since: thursdayNoon, failures: 1)
    #expect(h.model.draftAsk(of: todayId) == second)

    // The first ask's late answer is not this run's latest word on the page.
    await h.server.addDrafts([reply(remakeFailed: true)])
    await h.server.releaseFirstDraft()
    try await eventually { await h.server.waitingDrafts == 1 }
    try await turns()
    #expect(h.model.draftAsk(of: todayId) == second)
  }

  @Test func a_lost_asks_late_answer_still_sends_its_draft() async throws {
    let waits = Waits()
    let h = try await harness(draftSleep: { try await waits.wait($0) })
    await h.server.holdDrafts()
    h.model.todayDrawn(try todays(h))
    await h.server.draftHeld()
    try await eventually { await waits.requested == [.seconds(60)] }
    await waits.release(0)
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 1) }
    h.model.cameBackToToday(try todays(h))
    try await eventually { await h.server.waitingDrafts == 2 }
    let second = DraftAsk.asking(since: thursdayNoon, failures: 1)

    // The draft was made and paid for: it is stored, and the newer ask is left as it is.
    await h.server.add([try drafted()])
    await h.server.addDrafts([reply()])
    await h.server.releaseFirstDraft()
    let sent = try JSON.parse(setDraft)
    try await eventually { await setDrafts(h) == [sent] }
    try await soon { h.model.state.workspace?.page("draft:\(todayId)") != nil }
    try await turns()
    #expect(h.model.draftAsk(of: todayId) == second)
    await h.server.releaseDrafts()
  }

  @Test func an_ask_out_past_sixty_seconds_while_the_app_was_away_is_asked_again() async throws {
    let clock = thursday
    // The model's wait never runs out, as when the app was suspended past the 60 seconds before it fired.
    let h = try await harness(clock: clock)
    await h.server.holdDrafts()
    h.model.todayDrawn(try todays(h))
    await h.server.draftHeld()

    clock.date = thursdayNoon.addingTimeInterval(61)
    #expect(h.model.draftAsk(of: todayId)?.inFlight(at: clock.date) == false)
    h.model.cameBackToToday(try todays(h))
    try await eventually { await h.server.draftDates.count == 2 }
    #expect(h.model.draftAsk(of: todayId) == .asking(since: clock.date, failures: 1))
    h.model.cameBackToToday(try todays(h))
    try await turns()
    #expect(await h.server.draftDates.count == 2, "the new ask is in flight")
    await h.server.releaseDrafts()
  }

  @Test func an_answer_waiting_for_the_undo_slot_is_not_lost() async throws {
    let clock = thursday
    let waits = Waits()
    let h = try await harness(
      pages: [todayPage, page(tomorrow, [])], clock: clock, draftSleep: { try await waits.wait($0) })
    await h.server.holdDrafts()
    // With VoiceOver the notice has no timer: the slot is held until he dismisses it.
    let day = try DraftScreen(h.model, voiceOver: true)
    await h.server.draftHeld()
    try await eventually { await waits.requested == [.seconds(60)] }

    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    await h.server.callHeld()
    let operationId = try #require(await h.server.operationIds.last)
    await h.server.add([
      applied(
        try changes(
          from: 1, to: 2,
          pages: [page(today, [line("a", "Morning")]), page(tomorrow, [row("r1", "t1", "Water the plants", on: tomorrow)])],
          undo: operationId))
    ])
    await h.server.release()
    try await soon { day.notice?.undoing == operationId }

    await h.server.add([try drafted(from: 2)])
    await h.server.addDrafts([reply()])
    await h.server.releaseDrafts()
    try await soon { h.model.sendsWaitingForUndoSlot == 1 }

    // The 60 seconds run out, and more, while the answer waits for the slot.
    await waits.release(0)
    clock.date = thursdayNoon.addingTimeInterval(120)
    try await turns()
    #expect(h.model.draftAsk(of: todayId)?.inFlight(at: clock.date) == true)
    h.model.cameBackToToday(try todays(h))
    h.model.retryDraft(try todays(h))
    try await turns()
    #expect(await h.server.draftDates == [today], "no second request")
    #expect(await setDrafts(h).isEmpty)

    day.screen.notice.swipedUp()
    try await soon { h.model.draftAsk(of: todayId) == .done }
    #expect(await setDrafts(h) == [try JSON.parse(setDraft)])
    day.close()
  }

  // MARK: The answer

  @Test func remake_failed_counts_as_a_failed_ask() async throws {
    let h = try await harness()
    try await asked(h, reply(remakeFailed: true))
    #expect(h.model.draftAsk(of: todayId) == .failed(failures: 1))
    #expect(await setDrafts(h).isEmpty)
  }

  @Test func not_found_counts_as_a_failed_ask() async throws {
    let h = try await harness()
    try await asked(h, .failure(.refused(status: 404, reason: "not-found")))
    #expect(h.model.draftAsk(of: todayId) == .failed(failures: 1))
  }

  @Test func set_draft_null_loads_the_workspace() async throws {
    let h = try await harness()
    let loads = await h.server.loadsAnswered
    await h.server.add([.workspace(.unchanged(revision: 1, owner: "one"))])
    try await asked(h, reply(setDraft: nil))
    #expect(h.model.draftAsk(of: todayId) == .done)
    #expect(await h.server.loadsAnswered == loads + 1)
    #expect(await h.server.sent.isEmpty, "no command sent")
  }

  @Test func set_draft_is_sent_as_its_own_write_with_no_notice() async throws {
    let h = try await harness()
    await h.server.add([try drafted()])
    await h.server.addDrafts([reply()])
    let day = try DraftScreen(h.model)
    try await soon { h.model.draftAsk(of: todayId) == .done }

    #expect(await h.server.sent == [try JSON.parse(setDraft)])
    #expect(try await h.store.entries().isEmpty, "nothing kept in the outbox")
    #expect(h.model.state.workspace?.page("draft:\(todayId)") != nil, "the state holding it has arrived")
    try await turns()
    #expect(day.notice == nil)
    day.close()
  }

  @Test func a_send_that_fails_is_tried_once_more() async throws {
    let h = try await harness()
    await h.server.holdCommands()
    await h.server.addDrafts([reply()])
    h.model.todayDrawn(try todays(h))
    // The first send finds no network.
    await h.server.callHeld()
    await h.server.release()
    await h.server.holdCommands()
    await h.server.callHeld()
    await h.server.add([try drafted()])
    await h.server.release()
    try await soon { h.model.draftAsk(of: todayId) == .done }

    #expect(await setDrafts(h).count == 2)
    let workspace = try #require(h.model.workspace)
    let page = try todays(h)
    let view = DraftView.of(page: page, in: workspace, index: TodoIndex(workspace))
    #expect(
      DraftLine.state(view: view, ask: h.model.draftAsk(of: todayId), offline: h.model.state.offline, at: thursdayNoon)
        == .ready)
  }

  @Test func already_drafted_is_success() async throws {
    let h = try await harness()
    await h.server.add([
      .outcome(.refused(message: "This day already has its draft", owner: "one")),
      .workspace(.unchanged(revision: 1, owner: "one")),
    ])
    try await asked(h, reply())
    #expect(h.model.draftAsk(of: todayId) == .done)
    #expect(await setDrafts(h).count == 1)
  }

  @Test func another_refusal_or_a_400_is_a_failed_ask() async throws {
    for refusal in ["Page not found", "bad-request"] {
      let h = try await harness()
      await h.server.add([
        .outcome(.refused(message: refusal, owner: "one")), .workspace(.unchanged(revision: 1, owner: "one")),
      ])
      try await asked(h, reply())
      #expect(h.model.draftAsk(of: todayId) == .failed(failures: 1), "\(refusal)")
      try await turns()
      #expect(await setDrafts(h).count == 1, "not sent again: \(refusal)")
    }
  }

  // MARK: The server's Undo slot

  @Test(arguments: [false, true])
  func set_draft_waits_while_the_undo_slot_is_held(voiceOver: Bool) async throws {
    let waits = Waits()
    let h = try await harness(pages: [todayPage, page(tomorrow, [])])
    await h.server.holdDrafts()
    let day = try DraftScreen(h.model, noticeSleep: { try await waits.wait($0) }, voiceOver: voiceOver)
    await h.server.draftHeld()

    // A row action: out, then its notice offering Undo.
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    await h.server.callHeld()
    #expect(h.model.holdsUndoSlot, "an action is out")
    let operationId = try #require(await h.server.operationIds.last)
    await h.server.add([
      applied(
        try changes(
          from: 1, to: 2,
          pages: [page(today, [line("a", "Morning")]), page(tomorrow, [row("r1", "t1", "Water the plants", on: tomorrow)])],
          undo: operationId))
    ])
    await h.server.release()
    try await soon { day.notice?.undoing == operationId }
    #expect(h.model.holdsUndoSlot, "the notice offers Undo")

    // The draft's answer arrives while he is offered the Undo.
    await h.server.add([try drafted(from: 2)])
    await h.server.addDrafts([reply()])
    await h.server.releaseDrafts()
    try await soon { h.model.sendsWaitingForUndoSlot == 1 }
    #expect(await setDrafts(h).isEmpty, "voiceOver: \(voiceOver)")
    #expect(h.model.draftAsk(of: todayId)?.inFlight(at: thursdayNoon) == true)

    if voiceOver {
      #expect(await waits.requested.isEmpty, "with a button the notice does not leave on a timer")
      day.screen.notice.swipedUp()
    } else {
      try await eventually { await waits.requested == [.seconds(8)] }
      await waits.release(0)
    }
    try await soon { day.notice == nil }
    #expect(!h.model.holdsUndoSlot)
    try await soon { h.model.draftAsk(of: todayId) == .done }
    #expect(await setDrafts(h) == [try JSON.parse(setDraft)], "voiceOver: \(voiceOver)")
    day.close()
  }

  @Test func a_skips_notice_does_not_hold_set_draft() async throws {
    // A stale draft (an older recipe) with one open suggestion of a to-do not on the page: shown, and asked for again.
    let call = task("t2", "Call mum")
    let suggestion =
      #"{"id":"s2","anchor":"a","place":"after","taskId":"t2","state":"open","block":\#(row("g-s2", "t2", "Call mum"))}"#
    let h = try await Harness(
      copy: try copy(pages: [todayPage, draftPage(recipe: 4, items: [suggestion])], tasks: [water, call]),
      clock: thursday, sleep: neverEnding, asksForDayDrafts: true, draftSleep: neverEnding)
    await h.server.holdDrafts()
    let day = try DraftScreen(h.model)
    await h.server.draftHeld()
    #expect(day.screen.draftView?.suggestions.map(\.id) == ["s2"])

    // He skips it while the ask is out: the notice offers the skip's Undo, which does not use the server's slot.
    let skipped = suggestion.replacingOccurrences(of: #""state":"open""#, with: #""state":"skipped""#)
    await h.server.holdCommands()
    day.screen.suggestionTapped("s2", .skip)
    try await eventually { await h.server.waitingCalls > 0 }
    let skip = try #require(await h.server.operationIds.last)
    await h.server.add([
      applied(
        try changes(from: 1, to: 2, pages: [draftPage(recipe: 4, items: [skipped])], undo: skip),
        receipt: .object(["message": .string("Skipped")]))
    ])
    await h.server.release()
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Skipped", kind: .skipped, undoing: skip))
    #expect(!h.model.holdsUndoSlot)

    // The ask's answer arrives: its `set-draft` goes without waiting for the notice.
    await h.server.add([try drafted(from: 2)])
    await h.server.addDrafts([reply()])
    await h.server.releaseDrafts()
    try await soon { h.model.draftAsk(of: todayId) == .done }
    #expect(await setDrafts(h).count == 1)
    #expect(day.notice?.undoing == skip, "sent while the skip's Undo still shows")
    day.close()
  }

  // MARK: The account and the day

  @Test func the_answer_of_another_owner_is_dropped() async throws {
    let h = try await harness()
    try await asked(h, reply(owner: "someone"))
    #expect(h.model.draftAsk(of: todayId) == .done)
    try await turns()
    #expect(await h.server.sent.isEmpty)
  }

  @Test func an_account_change_while_set_draft_waits_sends_nothing() async throws {
    let h = try await harness()
    h.model.holdsUndoSlot = true
    await h.server.addDrafts([reply()])
    h.model.todayDrawn(try todays(h))
    try await soon { h.model.sendsWaitingForUndoSlot == 1 }
    #expect(await h.server.sent.isEmpty)

    await h.server.add([
      .workspace(.full(try copy(revision: 7, pages: [todayPage], tasks: [water]), owner: "two"))
    ])
    await h.model.refresh()
    try await soon { h.model.state.owner == "two" }
    h.model.holdsUndoSlot = false
    try await soon { h.model.sendsWaitingForUndoSlot == 0 }
    try await turns()
    #expect(await h.server.sent.isEmpty, "nothing of the first account's goes into the second's")
  }

  @Test func an_ask_of_a_forgotten_run_sends_nothing() async throws {
    let h = try await harness()
    h.model.holdsUndoSlot = true
    await h.server.addDrafts([reply()])
    h.model.todayDrawn(try todays(h))
    try await soon { h.model.sendsWaitingForUndoSlot == 1 }

    // Signed out and in again as the same account: the asks of the run before are forgotten.
    await h.server.add([.done])
    #expect(await h.model.signOut(discardingUnsent: true) == .signedOut)
    await h.server.add([
      .session(one),
      .workspace(.full(try copy(revision: 1, pages: [todayPage], tasks: [water]), owner: "one")),
    ])
    #expect(await h.model.signIn(email: "one@example.com", password: "secret") == nil)
    try await soon { h.model.state.phase == .ready && h.model.state.owner == "one" }
    #expect(h.model.draftAsk(of: todayId) == nil)

    h.model.holdsUndoSlot = false
    try await soon { h.model.sendsWaitingForUndoSlot == 0 }
    try await turns()
    #expect(await setDrafts(h).isEmpty, "the owner matches, but the ask is of a run forgotten")
  }

  @Test func midnight_during_an_ask_asks_for_the_new_today() async throws {
    let clock = thursday
    let h = try await harness(pages: [todayPage, page(tomorrow, [line("f", "Friday")])], clock: clock)
    await h.server.holdDrafts()
    let day = try DraftScreen(h.model)
    await h.server.draftHeld()

    clock.date = thursdayNoon.addingTimeInterval(12 * 3600 + 1)
    h.model.checkToday()
    #expect(h.model.today == tomorrow)
    day.drawn()
    try await eventually { await h.server.draftDates == [today, tomorrow] }
    await h.server.releaseDrafts()
    day.close()
  }

  @Test func a_rebuilt_screen_does_not_ask_again() async throws {
    let h = try await harness()
    let first = try DraftScreen(h.model)
    try await soon { h.model.draftAsk(of: todayId) == .failed(failures: 1) }
    first.close()

    let second = try DraftScreen(h.model)
    try await turns()
    #expect(await h.server.draftDates == [today])
    second.close()
  }

  @Test func the_page_never_waits() async throws {
    let h = try await harness()
    await h.server.holdDrafts()
    let day = try DraftScreen(h.model)
    await h.server.draftHeld()

    let typed = page(today, [line("a", "Morning!"), row("r1", "t1", "Water the plants")])
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [typed])),
      applied(try changes(from: 2, to: 3, tasks: [task("t1", "Water the plants", status: "done", version: 2)])),
    ])
    try day.type("!", atEndOf: "Morning")
    h.model.saveNow()
    try await eventually { await h.server.sent.count == 1 }
    try await soon { h.model.state.workspace?.revision == 2 }
    h.model.tick(taskId: "t1")
    try await soon { h.model.state.workspace?.revision == 3 }

    #expect(await h.server.sent.map { type(of: $0) } == ["save-editor", "task-status"])
    #expect(h.model.draftAsk(of: todayId)?.inFlight(at: thursdayNoon) == true, "the ask is still out")
    await h.server.releaseDrafts()
    day.close()
  }

  // MARK: The index's drafts

  @Test func a_state_parses_only_the_drafts_it_changed() async throws {
    let yesterdayPage = page(yesterday, [line("y", "Rent")])
    let drafts = [draftPage(of: "day:2026-11-25"), draftPage(status: "failed")]
    let h = try await Harness(
      copy: try copy(pages: [todayPage, yesterdayPage] + drafts, tasks: [water]), clock: thursday,
      sleep: neverEnding)
    let day = try DraftScreen(h.model)
    #expect(day.screen.newestIndex?.draftsParsed == 2)

    // A page changes, and no draft.
    let paidYesterday = page(yesterday, [line("y", "Rent paid")])
    await h.server.add([
      .workspace(.full(try copy(revision: 2, pages: [todayPage, paidYesterday] + drafts, tasks: [water]), owner: "one"))
    ])
    await h.model.refresh()
    try await soon { h.model.state.workspace?.revision == 2 }
    day.drawn()
    #expect(day.screen.indexedWorkspaces.first?.revision == 2)
    #expect(day.screen.newestIndex?.draftsParsed == 0)

    // Today's draft changes.
    await h.server.add([
      .workspace(
        .full(
          try copy(
            revision: 3, pages: [todayPage, paidYesterday, drafts[0], draftPage(status: "ready")], tasks: [water]),
          owner: "one"))
    ])
    await h.model.refresh()
    try await soon { h.model.state.workspace?.revision == 3 }
    day.drawn()
    #expect(day.screen.indexedWorkspaces.first?.revision == 3)
    #expect(day.screen.newestIndex?.draftsParsed == 1)
    day.close()
  }
}
