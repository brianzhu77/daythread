import DaythreadCore
import DaythreadSync
import Foundation
import Testing
import UIKit

@testable import DaythreadEditor
@testable import DaythreadUI

/// Thursday, the day these tests run on.
private let today = LocalDate("2026-11-26")!
private let yesterday = LocalDate("2026-11-25")!
private let tomorrow = LocalDate("2026-11-27")!
private let saturday = LocalDate("2026-11-28")!
/// Noon UTC on Thursday, Nov 26 2026.
private let thursdayNoon = Date(timeIntervalSince1970: 1_795_694_400)

private func type(of action: JSONValue) -> String? { action.objectValue?["type"]?.stringValue }

/// A row's action run from the day screen (`native-phase-1.md` §11.4, §11.5): his words saved first, the command sent
/// and waited for, the notice, and Undo only while the server would take it.
@MainActor
@Suite struct RowActionTests {
  private let water = task("t1", "Water the plants")
  private let read = task("t2", "Read the lease")
  private var thursday: Clock {
    let clock = Clock()
    clock.date = thursdayNoon
    return clock
  }

  private func harness(
    pages: [JSONValue], tasks: [JSONValue], relay: StateRelay? = nil, engineClock: EngineClock? = nil
  ) async throws -> Harness {
    try await Harness(
      copy: try copy(pages: pages, tasks: tasks), clock: thursday, sleep: neverEnding, relay: relay,
      engineClock: engineClock)
  }

  /// Today's page: a line, a plan row of `t1`, a plan row of `t2`, a line.
  private var todayPage: JSONValue {
    page(
      today,
      [
        line("a", "Morning"), row("r1", "t1", "Water the plants"), row("r2", "t2", "Read the lease"),
        line("b", "Walk"),
      ])
  }

  /// What the server answers a move of `t1` to tomorrow on revision `from`: today's page without its row, tomorrow's
  /// with it, and the slot this operation's.
  private func movedToTomorrow(from: Int = 1, operationId: String?) throws -> WorkspaceChanges {
    try changes(
      from: from, to: from + 1,
      pages: [
        page(today, [line("a", "Morning"), row("r2", "t2", "Read the lease"), line("b", "Walk")]),
        page(tomorrow, [row("r1", "t1", "Water the plants", on: tomorrow)]),
      ], undo: operationId)
  }

  /// Answers the call the server holds with `reply`, made with the operation id it was sent under, and returns it.
  @discardableResult
  private func answerHeld(_ h: Harness, _ reply: (String) throws -> TestServer.Reply) async throws -> String {
    await h.server.callHeld()
    let operationId = try #require(await h.server.operationIds.last)
    await h.server.add([try reply(operationId)])
    await h.server.release()
    return operationId
  }

  /// Moves `t1` to tomorrow from its swipe; the server's answer leaves the slot this operation's. Returns the
  /// operation once the notice shows.
  private func moveWithUndo(_ h: Harness, _ day: RowScreen) async throws -> String {
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    let operationId = try await answerHeld(h) { applied(try movedToTomorrow(operationId: $0)) }
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Moved to Fri, Nov 27", kind: .done, undoing: operationId))
    return operationId
  }

  // MARK: His words first

  @Test func an_action_waits_for_unsaved_words_to_be_saved_first() async throws {
    let h = try await harness(
      pages: [page(today, [line("a", "Morning"), row("r1", "editor-task:r1", "")])], tasks: [])
    let day = try RowScreen(h.model)
    try day.type("Buy milk", atEndOf: "")
    // The caret goes back to the line above: the row being typed in has no swipe.
    _ = try day.line("Morning").becomeFirstResponder()
    try await soon { (try? day.swipeTitles("Buy milk")) == ["Tomorrow", "Not today", "More"] }

    let saved = page(today, [line("a", "Morning"), row("r1", "editor-task:r1", "Buy milk")])
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [saved], tasks: [task("editor-task:r1", "Buy milk")])),
      applied(
        try changes(
          from: 2, to: 3,
          pages: [
            page(today, [line("a", "Morning")]),
            page(tomorrow, [row("r1", "editor-task:r1", "Buy milk", on: tomorrow)]),
          ])),
    ])
    try day.swipe("Buy milk", "Tomorrow")
    try await soon { day.notice != nil }

    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor", "plan-task"])
    #expect(words(of: sent.first?.objectValue?["document"]?.stringValue) == ["Morning", "Buy milk"])
    #expect(sent.last == Command.planTask(taskId: "editor-task:r1", date: tomorrow, from: today, today: today))
    #expect(day.notice?.text == "Moved to Fri, Nov 27")
    #expect(day.words == ["Morning"])
    day.close()
  }

  @Test func an_action_is_not_sent_when_the_pages_draft_cannot_be_saved() async throws {
    for stuck in [false, true] {
      let h = try await harness(pages: [todayPage], tasks: [water, read])
      let day = try RowScreen(h.model)
      try day.type(" the dog", atEndOf: "Walk")
      try await soon { !h.model.state.drafts.isEmpty }
      // Offline: no reply at all. Stuck: the server will not take the document.
      if stuck { await h.server.add([.saved(.refused(message: "The document is not acceptable"))]) }

      try day.swipe("Water the plants", "Not today")
      try await soon { day.notice != nil }

      #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil), "stuck: \(stuck)")
      let sent = await h.server.sent
      #expect(!sent.contains { type(of: $0) == "not-today" }, "stuck: \(stuck)")
      #expect(sent.map { type(of: $0) } == ["save-editor"], "its save was tried; stuck: \(stuck)")
      #expect(day.words == ["Morning", "Water the plants", "Read the lease", "Walk the dog"], "stuck: \(stuck)")
      #expect(h.model.state.drafts.map(\.id) == ["day:2026-11-26"], "the words are kept; stuck: \(stuck)")
      #expect(day.editor.actingRow == nil)
      day.close()
    }
  }

  @Test func the_row_leaves_and_the_caret_goes_to_the_line_above() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    let typing = try day.type(" now", atEndOf: "Water the plants")
    try await soon { !h.model.state.drafts.isEmpty }
    #expect(try day.swipe("Water the plants now") == nil, "the row being typed in has no swipe")

    let typed = [
      line("a", "Morning"), row("r1", "t1", "Water the plants now"), row("r2", "t2", "Read the lease"),
      line("b", "Walk"),
    ]
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [page(today, typed)])),
      applied(try movedToTomorrow(from: 2, operationId: nil)),
    ])
    // The circle's menu reaches the row he types in.
    try day.menu("Water the plants now", "Tomorrow · Fri, Nov 27")
    try await soon { day.notice != nil }
    try await soon { day.words == ["Morning", "Read the lease", "Walk"] }

    #expect(!typing.isFirstResponder)
    let above = try day.line("Morning")
    #expect(above.isFirstResponder, "the keyboard stays, in the line above")
    #expect(above.selectedRange == NSRange(location: 7, length: 0), "at its end")
    #expect(await h.server.sent.map { type(of: $0) } == ["save-editor", "plan-task"])
    day.close()
  }

  @Test func typing_during_an_action_is_merged() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    await h.server.callHeld()

    // He types in another line while the command is out.
    try day.type(" the dog", atEndOf: "Walk")
    try await soon { !h.model.state.drafts.isEmpty }
    try await answerHeld(h) { _ in applied(try movedToTomorrow(operationId: nil)) }
    try await soon { day.notice != nil }

    let merged = ["Morning", "Read the lease", "Walk the dog"]
    try await soon { day.words == merged }
    #expect(day.notice?.undoing == nil, "his words wait to be sent")
    await h.model.saveNow().value
    try await eventually {
      await words(of: h.server.sent.last { type(of: $0) == "save-editor" }?.objectValue?["document"]?.stringValue)
        == merged
    }
    #expect(day.words == merged)
    day.close()
  }

  @Test func a_failure_says_so_and_changes_nothing() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    let before = day.words
    await h.server.add([
      .outcome(.refused(message: "Task not found", owner: "one")), .workspace(.unchanged(revision: 1, owner: "one")),
    ])
    try day.swipe("Water the plants", "Not today")
    try await soon { day.notice != nil }

    #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil))
    #expect(day.words == before)
    #expect(h.model.workspace?.dayPage(today)?.document == h.model.state.workspace?.dayPage(today)?.document)
    #expect(h.model.state.workspace?.revision == 1)
    #expect(day.editor.actingRow == nil)
    day.close()
  }

  // MARK: The notice

  /// On a phone the notice sits directly under the status bar, as the web's phone notice does: the page at its top
  /// keeps the day's title and its first rows uncovered.
  @Test func on_a_phone_the_notice_leaves_the_days_title_uncovered() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    defer { day.close() }
    await h.server.add([applied(try changes(from: 1, to: 2))])
    try day.swipe("Water the plants", "Not today")
    try await soon { day.notice != nil }
    day.drawn()

    let surface = try #require(Self.views(in: day.screen.notice).compactMap { $0 as? UIVisualEffectView }.first)
    let capsule = surface.convert(surface.bounds, to: day.window)
    let statusBar = day.window.safeAreaInsets.top
    #expect(abs(capsule.minY - (statusBar + 8)) <= 1, "the capsule's top is at \(capsule.minY), the status bar ends at \(statusBar)")
    #expect(capsule.minY >= statusBar, "not over the status bar")
    let title = day.screen.headerView.titleButton
    let titleFrame = title.convert(title.bounds, to: day.window)
    #expect(capsule.maxY <= titleFrame.minY, "the capsule ends at \(capsule.maxY), the title starts at \(titleFrame.minY)")
    let first = try day.line("Morning")
    #expect(capsule.maxY <= first.convert(first.bounds, to: day.window).minY, "the page's first line uncovered")
  }

  private static func views(in view: UIView) -> [UIView] {
    [view] + view.subviews.flatMap { views(in: $0) }
  }

  /// The notice after `act` on a copy of `pages` and `tasks`, shown on `shown`'s page, the server answering with
  /// `receipt` and nothing changed.
  private func notice(
    pages: [JSONValue], tasks: [JSONValue], on shown: LocalDate? = nil,
    receipt: JSONValue = .object(["message": .string("Done")]), _ act: (RowScreen) throws -> Void
  ) async throws -> String? {
    let h = try await harness(pages: pages, tasks: tasks)
    let day = try RowScreen(h.model, on: shown)
    await h.server.add([applied(try changes(from: 1, to: 2), receipt: receipt)])
    try act(day)
    try await soon { day.notice != nil }
    defer { day.close() }
    return day.notice?.text
  }

  @Test func the_notices_words() async throws {
    let plan = [page(today, [row("r1", "t1", "Water the plants")])]
    let reference = [page(today, [row("r2", "t2", "Read the lease", reference: true)])]

    #expect(
      try await notice(pages: plan, tasks: [water]) { try $0.swipe("Water the plants", "Tomorrow") }
        == "Moved to Fri, Nov 27")
    #expect(
      try await notice(
        pages: [page(yesterday, [row("r1", "t1", "Water the plants", on: yesterday)]), page(today, [])],
        tasks: [water], on: yesterday
      ) { try $0.swipe("Water the plants", "Bring to today") } == "On today")
    #expect(
      try await notice(pages: reference, tasks: [read]) { try $0.swipe("Read the lease", "Plan for today") }
        == "On today")
    #expect(
      try await notice(pages: reference, tasks: [read]) { try $0.planForToday("Read the lease") }
        == "Planned for today")
    #expect(
      try await notice(pages: plan, tasks: [water]) { try $0.swipe("Water the plants", "Not today") }
        == "Not today — won’t carry over")
    #expect(
      try await notice(pages: plan, tasks: [task("t1", "Water the plants", due: tomorrow)]) {
        try $0.swipe("Water the plants", "Not today")
      } == "Not today — won’t carry over · due Fri still tracked")
    #expect(
      try await notice(
        pages: [page(today, []), page(saturday, [row("r1", "t1", "Water the plants", on: saturday)])],
        tasks: [water], on: saturday
      ) { try $0.swipe("Water the plants", "Not on Sat") } == "Not on Sat 11/28")
    // A stale row: the to-do is planned on Friday, and the server says only this row left.
    #expect(
      try await notice(
        pages: [
          page(today, [row("r1", "t1", "Water the plants")]),
          page(tomorrow, [row("r9", "t1", "Water the plants", on: tomorrow)]),
        ], tasks: [water], receipt: .object(["message": .string("Removed from Thu")])
      ) { try $0.swipe("Water the plants", "Remove from Thu") } == "Removed from Thu · still planned for Fri")
    #expect(
      try await notice(
        pages: plan, tasks: [water],
        receipt: .object([
          "message": .string("Cancelled"), "nextTodos": .array([.object(["on": .string("2026-12-07")])]),
        ])
      ) { try $0.menu("Water the plants", "Cancel task") } == "Cancelled · Next Mon, Dec 7")
    #expect(
      try await notice(pages: plan, tasks: [task("t1", "Water the plants", status: "cancelled")]) {
        try $0.swipe("Water the plants", "Restore")
      } == "Restored")
  }

  // MARK: Undo

  @Test func undo_puts_the_row_back() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    let before = day.words
    let operationId = try await moveWithUndo(h, day)
    try await soon { day.words == ["Morning", "Read the lease", "Walk"] }

    await h.server.add([applied(try changes(from: 2, to: 3, pages: [todayPage]))])
    try day.undo()
    try await soon { day.notice?.kind == .undone }

    #expect(day.notice == Notice(text: "Undone", kind: .undone, undoing: nil))
    #expect(await h.server.sent.last == Command.undo(targetOperationId: operationId))
    try await soon { day.words == before }
    day.close()
  }

  @Test func undo_leaves_the_notice_when_he_types() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)

    try day.type("!", atEndOf: "Walk")
    try await soon { day.notice?.undoing == nil }
    #expect(day.notice?.text == "Moved to Fri, Nov 27", "the words stay until their time")
    day.close()
  }

  @Test func undo_leaves_the_notice_when_he_ticks() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)

    try day.tick("Read the lease")
    try await soon { day.notice?.undoing == nil }
    #expect(day.notice?.text == "Moved to Fri, Nov 27")
    day.close()
  }

  @Test func undo_leaves_the_notice_when_the_slot_moves() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)

    // Another device's change took the slot.
    await h.server.add([
      .workspace(
        .full(
          try copy(revision: 3, pages: [todayPage], tasks: [water, read], undo: marker("op-elsewhere", 3)),
          owner: "one"))
    ])
    await h.model.refresh()
    try await soon { day.notice?.undoing == nil }
    #expect(day.notice?.text == "Moved to Fri, Nov 27")
    day.close()
  }

  @Test func undo_leaves_the_notice_when_a_day_page_is_made() async throws {
    let engineClock = EngineClock(thursdayNoon)
    let h = try await harness(pages: [todayPage], tasks: [water, read], engineClock: engineClock)
    let day = try RowScreen(h.model)
    await h.server.hold()
    try day.swipe("Water the plants", "Not today")
    let operationId = try await answerHeld(h) {
      applied(
        try changes(
          from: 1, to: 2,
          pages: [page(today, [line("a", "Morning"), row("r2", "t2", "Read the lease"), line("b", "Walk")])],
          undo: $0))
    }
    try await soon { day.notice?.undoing == operationId }

    // The engine's day moves on, and it asks for that day's page; the server's answer empties the slot.
    engineClock.now = thursdayNoon.addingTimeInterval(86_400)
    await h.server.add([
      .workspace(.unchanged(revision: 2, owner: "one")),
      applied(try changes(from: 2, to: 3, pages: [page(tomorrow, [])])),
    ])
    await h.model.refresh()
    try await soon { day.notice?.undoing == nil }
    #expect(await h.server.sent.last.flatMap { type(of: $0) } == "ensure-day")
    #expect(day.notice?.text == "Not today — won’t carry over")
    day.close()
  }

  @Test func the_answer_arriving_before_its_state_still_offers_undo() async throws {
    let relay = StateRelay()
    let h = try await harness(pages: [todayPage], tasks: [water, read], relay: relay)
    let day = try RowScreen(h.model)
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    await h.server.callHeld()
    let operationId = try #require(await h.server.operationIds.last)
    await h.server.add([applied(try movedToTomorrow(operationId: operationId))])

    // The answer reaches the model; the state that holds it does not yet.
    relay.hold()
    await h.server.release()
    await h.engine.settled()
    try await turns()
    #expect(day.notice == nil, "nothing is said before the state that holds the answer is known")
    #expect(try day.dimmed("Water the plants"), "the action is still out")

    relay.release()
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Moved to Fri, Nov 27", kind: .done, undoing: operationId))
    day.close()
  }

  @Test func a_refused_undo_says_so() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)

    await h.server.add([
      .outcome(.refused(message: "Cannot undo after later changes; current values kept", owner: "one")),
      .workspace(.unchanged(revision: 2, owner: "one")),
    ])
    try day.undo()
    try await soon { day.notice?.text != "Moved to Fri, Nov 27" }
    #expect(day.notice == Notice(text: "Can't undo · changed since", kind: .failed, undoing: nil))
    day.close()
  }

  @Test func a_failed_undo_says_so() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)

    // No reply: the server cannot be reached.
    try day.undo()
    try await soon { day.notice?.text != "Moved to Fri, Nov 27" }
    #expect(day.notice == Notice(text: "Couldn't undo · your text is kept", kind: .failed, undoing: nil))
    day.close()
  }

  @Test func a_second_action_replaces_the_first_notice() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)
    try await soon { day.words == ["Morning", "Read the lease", "Walk"] }

    await h.server.add([applied(try changes(from: 2, to: 3))])
    try day.swipe("Read the lease", "Not today")
    try await soon { day.notice?.text == "Not today — won’t carry over" }

    #expect(day.notice?.undoing == nil, "the server's slot is not this operation's")
    // Held above the navigation bar, by the navigation controller's view.
    let host = try #require(day.screen.navigationController?.view)
    #expect(Self.views(in: host).filter { $0 is NoticeView }.count == 1, "one notice")
    day.close()
  }

  // MARK: One at a time

  @Test func one_action_at_a_time_on_a_page() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    await h.server.hold()
    try day.swipe("Water the plants", "Not today")
    await h.server.callHeld()

    #expect(try day.dimmed("Water the plants"), "its row is dimmed while it is out")
    #expect(try !day.dimmed("Read the lease"))
    #expect(try day.swipe("Read the lease") == nil, "a second swipe offers nothing")
    try day.menu("Read the lease", "Not today")
    try await turns()
    #expect(await h.server.sent.count == 1, "nothing more was sent")

    // Typing and ticking go on.
    try day.type(" the dog", atEndOf: "Walk")
    #expect(day.words.last == "Walk the dog")
    try day.tick("Read the lease")
    #expect(h.status("t2") == .done)

    try await answerHeld(h) { _ in applied(try changes(from: 1, to: 2)) }
    try await soon { day.notice != nil }
    #expect(try !day.dimmed("Water the plants"))
    #expect(await h.server.sent.filter { type(of: $0) == "not-today" }.count == 1)
    day.close()
  }

  // MARK: More and Pick date

  @Test func more_opens_the_action_sheet_with_the_rest_in_the_webs_order() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    try day.swipe("Water the plants", "More")
    try await soon { day.screen.presentedViewController != nil }

    let sheet = try #require(day.screen.presentedViewController as? UIAlertController)
    #expect(sheet.preferredStyle == .actionSheet)
    #expect(
      sheet.actions.map(\.title) == [
        "This weekend · Sat 11/28", "Next week · Mon 11/30", "Pick date…", "Cancel task", "Cancel",
      ])
    #expect(sheet.actions.map(\.style) == [.default, .default, .default, .destructive, .cancel])
    #expect(await h.server.sent.isEmpty, "opening it sends nothing")
    day.close()
  }

  @Test func pick_date_opens_the_calendar_and_moves_to_the_day_picked() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    try day.menu("Water the plants", "Pick date…")
    try await soon { day.screen.presentedViewController != nil }

    let picker = try #require(day.screen.presentedViewController as? DayPickerViewController)
    picker.loadViewIfNeeded()
    let selection = try #require(picker.calendarView.selectionBehavior as? UICalendarSelectionSingleDate)
    #expect(selection.selectedDate == nil, "nothing selected")
    #expect(!picker.dateSelection(selection, canSelectDate: DateComponents(year: 2026, month: 11, day: 25)))
    #expect(picker.dateSelection(selection, canSelectDate: DateComponents(year: 2026, month: 11, day: 26)))

    await h.server.add([applied(try changes(from: 1, to: 2))])
    picker.dateSelection(selection, didSelectDate: DateComponents(year: 2026, month: 11, day: 30))
    try await soon { day.notice != nil }
    #expect(day.notice?.text == "Moved to Mon, Nov 30")
    #expect(
      await h.server.sent.last
        == Command.planTask(taskId: "t1", date: LocalDate("2026-11-30")!, from: today, today: today))
    try await soon { day.screen.presentedViewController == nil }
    day.close()
  }

  @Test func choosing_from_more_sends_its_command_once_and_says_so() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    try day.swipe("Water the plants", "More")
    try await soon { day.screen.presentedViewController != nil }

    await h.server.add([applied(try changes(from: 1, to: 2))])
    try day.choose("Next week · Mon 11/30")
    try await soon { day.notice != nil }
    #expect(day.notice?.text == "Moved to Mon, Nov 30")
    try await turns()
    #expect(
      await h.server.sent
        == [Command.planTask(taskId: "t1", date: LocalDate("2026-11-30")!, from: today, today: today)])
    day.close()
  }

  // MARK: A menu left open while the row changed

  /// Today's page without `t1`'s row, as another device left it at revision 2.
  private func rowMovedAway(cancelled: Bool = false) throws -> TestServer.Reply {
    let pages =
      cancelled
      ? [todayPage]
      : [
        page(today, [line("a", "Morning"), row("r2", "t2", "Read the lease"), line("b", "Walk")]),
        page(tomorrow, [row("r1", "t1", "Water the plants", on: tomorrow)]),
      ]
    let tasks = [cancelled ? task("t1", "Water the plants", status: "cancelled", version: 2) : water, read]
    return .workspace(.full(try copy(revision: 2, pages: pages, tasks: tasks), owner: "one"))
  }

  @Test func a_choice_from_more_after_the_row_moved_away_sends_nothing() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    try day.swipe("Water the plants", "More")
    try await soon { day.screen.presentedViewController != nil }

    await h.server.add([try rowMovedAway()])
    await h.model.refresh()
    try await soon { !day.words.contains("Water the plants") }
    try day.choose("Next week · Mon 11/30")
    try await turns()

    #expect(await h.server.sent.isEmpty)
    #expect(day.notice == nil)
    // The sheet goes, and nothing takes its place (its dismissal may finish after its own presentation does).
    try await soon { day.screen.presentedViewController == nil }
    day.close()
  }

  @Test func a_choice_from_more_after_the_to_do_was_cancelled_elsewhere_sends_nothing() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    try day.swipe("Water the plants", "More")
    try await soon { day.screen.presentedViewController != nil }

    await h.server.add([try rowMovedAway(cancelled: true)])
    await h.model.refresh()
    try await soon { h.model.workspace?.task("t1")?.status == .cancelled }
    try day.choose("Cancel task")
    try await turns()

    #expect(await h.server.sent.isEmpty, "the row stays, and no longer offers Cancel task")
    #expect(day.notice == nil)
    day.close()
  }

  @Test func a_day_picked_after_the_row_was_removed_sends_nothing() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    try day.menu("Water the plants", "Pick date…")
    try await soon { day.screen.presentedViewController != nil }
    let picker = try #require(day.screen.presentedViewController as? DayPickerViewController)
    picker.loadViewIfNeeded()

    await h.server.add([try rowMovedAway()])
    await h.model.refresh()
    try await soon { !day.words.contains("Water the plants") }
    let selection = try #require(picker.calendarView.selectionBehavior as? UICalendarSelectionSingleDate)
    picker.dateSelection(selection, didSelectDate: DateComponents(year: 2026, month: 11, day: 30))
    try await turns()

    #expect(await h.server.sent.isEmpty)
    #expect(day.notice == nil)
    try await soon { day.screen.presentedViewController == nil }
    day.close()
  }

  // MARK: Checked again once his words are handed over

  @Test func a_row_action_whose_to_do_closed_while_his_words_went_sends_nothing() async throws {
    let relay = StateRelay()
    let h = try await harness(pages: [todayPage], tasks: [water, read], relay: relay)
    let day = try RowScreen(h.model)
    // Another device ticked the to-do: the state saying so is held back from the screen, which still offers Tomorrow.
    relay.hold()
    let ticked = task("t1", "Water the plants", status: "done", version: 2)
    await h.server.add([
      .workspace(.full(try copy(revision: 2, pages: [todayPage], tasks: [ticked, read]), owner: "one"))
    ])
    await h.model.refresh()
    try await soon { !relay.kept.isEmpty }
    // Were the command sent, the server would take his words, then the move.
    let typed = [
      line("a", "Morning"), row("r1", "t1", "Water the plants"), row("r2", "t2", "Read the lease"),
      line("b", "Walk the dog"),
    ]
    await h.server.add([
      savedAs(try changes(from: 2, to: 3, pages: [page(today, typed)])),
      applied(try movedToTomorrow(from: 3, operationId: nil)),
    ])

    // Typed, and Tomorrow swiped in the same turn: the action waits for his words to reach the engine, and the state
    // that says so comes after the one with the tick.
    try day.type(" the dog", atEndOf: "Walk")
    try day.swipe("Water the plants", "Tomorrow")
    try await soon { relay.kept.contains { !$0.drafts.isEmpty } }
    relay.release()
    try await soon { day.notice != nil }

    #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil))
    #expect(await h.server.sent.isEmpty, "no plan-task")
    #expect(day.editor.actingRow == nil)
    // His words are saved by the usual path.
    await h.model.saveNow().value
    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor"])
    #expect(
      words(of: sent.first?.objectValue?["document"]?.stringValue)
        == ["Morning", "Water the plants", "Read the lease", "Walk the dog"])
    day.close()
  }

  @Test func a_row_he_deleted_while_his_words_went_sends_nothing() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    let removed = [line("a", "Morning"), row("r2", "t2", "Read the lease"), line("b", "Walk")]
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [page(today, removed)])),
      applied(try movedToTomorrow(from: 2, operationId: nil)),
    ])

    // Tomorrow swiped, and in the same turn, before his words are handed over, he removes the row's line.
    try day.swipe("Water the plants", "Tomorrow")
    let watering = try day.line("Water the plants")
    #expect(watering.becomeFirstResponder())
    watering.selectedRange = NSRange(location: 0, length: (watering.text as NSString).length)
    watering.deleteBackward()
    watering.deleteBackward()
    #expect(!day.words.contains("Water the plants"), "the row is gone from the screen")
    try await soon { day.notice != nil }

    #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil))
    #expect(await h.server.sent.isEmpty, "no plan-task")
    #expect(day.editor.actingRow == nil)
    await h.model.saveNow().value
    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor"])
    #expect(words(of: sent.first?.objectValue?["document"]?.stringValue) == ["Morning", "Read the lease", "Walk"])
    day.close()
  }

  @Test func an_action_still_offered_is_sent_as_before() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    let typed = [
      line("a", "Morning"), row("r1", "t1", "Water the plants now"), row("r2", "t2", "Read the lease"),
      line("b", "Walk"),
    ]
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [page(today, typed)])),
      applied(try movedToTomorrow(from: 2, operationId: nil)),
    ])

    // He edits the row's own words and moves it from its circle's menu in the same turn: it is the same row, and
    // still offers the move, once his words are handed over.
    try day.type(" now", atEndOf: "Water the plants")
    try day.menu("Water the plants now", "Tomorrow · Fri, Nov 27")
    try await soon { day.notice != nil }

    #expect(day.notice?.text == "Moved to Fri, Nov 27")
    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor", "plan-task"])
    let saved = words(of: sent.first?.objectValue?["document"]?.stringValue)
    #expect(saved == ["Morning", "Water the plants now", "Read the lease", "Walk"])
    #expect(sent.last == Command.planTask(taskId: "t1", date: tomorrow, from: today, today: today))
    day.close()
  }

  @Test func a_choice_from_more_after_typing_keeps_the_indexes_the_screen_holds() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    let typed = [
      line("a", "Morning"), row("r1", "t1", "Water the plants"), row("r2", "t2", "Read the lease"), line("b", "Walk!"),
    ]
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [page(today, typed)])),
      applied(try changes(from: 2, to: 3, tasks: [task("t1", "Water the plants", status: "cancelled", version: 2)])),
    ])

    // Typed, and a choice made from More in the same turn: the workspace with his words is one no state has drawn.
    try day.type("!", atEndOf: "Walk")
    try day.swipe("Water the plants", "More")
    let cached = day.screen.indexedWorkspaces
    try day.choose("Cancel task")
    #expect(day.screen.indexedWorkspaces == cached, "the check read the indexes without adding to them")

    try await soon { day.notice != nil }
    #expect(await h.server.sent.map { type(of: $0) } == ["save-editor", "task-status"])
    day.close()
  }

  @Test func a_request_while_something_is_presented_does_nothing() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    try day.swipe("Water the plants", "More")
    try await soon { day.screen.presentedViewController != nil }

    await h.server.add([applied(try changes(from: 1, to: 2))])
    try day.swipe("Read the lease", "Not today")
    try await turns()
    #expect(await h.server.sent.isEmpty)
    #expect(day.notice == nil)
    #expect(try !day.dimmed("Read the lease"))
    day.close()
  }

  // MARK: Hardening

  @Test func undo_tapped_in_the_turn_after_he_typed_sends_nothing() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)
    let sent = await h.server.sent.count

    // He types, and the button's action runs before the observation's next turn withdraws it.
    try day.type("!", atEndOf: "Walk")
    try day.undo()
    try await turns()

    #expect(await h.server.sent.count == sent, "no undo sent")
    #expect(!(await h.server.sent.contains { type(of: $0) == "undo" }))
    #expect(day.notice == Notice(text: "Moved to Fri, Nov 27", kind: .done, undoing: nil))
    day.close()
  }

  @Test func undo_tapped_while_he_composes_sends_nothing_and_keeps_his_words() async throws {
    let h = try await harness(pages: [todayPage], tasks: [water, read])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)
    try await soon { day.words == ["Morning", "Read the lease", "Walk"] }
    let composed = [line("a", "Morning"), row("r2", "t2", "Read the lease"), line("b", "Walk今")]
    await h.server.add([savedAs(try changes(from: 2, to: 3, pages: [page(today, composed)]))])

    // He is composing in a line when he taps Undo: what he composed is committed first, and the server would refuse
    // an Undo once his words have taken its slot, so none is sent.
    let walk = try day.line("Walk")
    #expect(walk.becomeFirstResponder())
    walk.selectedRange = NSRange(location: 4, length: 0)
    walk.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
    try day.undo()
    try await turns()

    #expect(!(await h.server.sent.contains { type(of: $0) == "undo" }), "no undo sent")
    #expect(day.notice == Notice(text: "Moved to Fri, Nov 27", kind: .done, undoing: nil), "Undo is withdrawn")
    #expect(day.words == ["Morning", "Read the lease", "Walk今"])
    #expect(walk.markedTextRange == nil)
    // His words are saved by the usual path.
    await h.model.saveNow().value
    try await eventually {
      await words(of: h.server.sent.last { type(of: $0) == "save-editor" }?.objectValue?["document"]?.stringValue)
        == ["Morning", "Read the lease", "Walk今"]
    }
    day.close()
  }

  @Test func a_to_do_typed_and_acted_on_in_the_same_turn_is_saved_then_acted_on() async throws {
    let h = try await harness(
      pages: [page(today, [line("a", "Morning"), row("r1", "editor-task:r1", "")])], tasks: [])
    let day = try RowScreen(h.model)
    let saved = page(today, [line("a", "Morning"), row("r1", "editor-task:r1", "Buy milk")])
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [saved], tasks: [task("editor-task:r1", "Buy milk")])),
      applied(try changes(from: 2, to: 3, pages: [page(today, [line("a", "Morning")])])),
    ])

    // Typed, and the action asked in the same turn: the state holding the new to-do has not arrived.
    try day.type("Buy milk", atEndOf: "")
    #expect(h.model.state.workspace?.task("editor-task:r1") == nil)
    let acted = await h.model.act(
      .move(tomorrow), taskId: "editor-task:r1", pageId: "day:2026-11-26", pageDate: today, owner: "one",
      still: { true })

    guard case .done(let text, _) = acted else {
      Issue.record("not done: \(acted)")
      return
    }
    #expect(text == "Moved to Fri, Nov 27")
    #expect(await h.server.sent.map { type(of: $0) } == ["save-editor", "plan-task"])
    day.close()
  }

  @Test func the_states_ending_while_an_action_waits_says_not_done_and_frees_the_row() async throws {
    let relay = StateRelay()
    let h = try await harness(pages: [todayPage], tasks: [water, read], relay: relay)
    let day = try RowScreen(h.model)
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    try await answerHeld(h) { _ in
      relay.hold()
      return applied(try movedToTomorrow(operationId: nil))
    }
    await h.engine.settled()

    relay.finish()
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil))
    #expect(try !day.dimmed("Water the plants"))
    #expect(day.editor.actingRow == nil)

    // A later action runs.
    try day.swipe("Read the lease", "Not today")
    try await eventually { await h.server.sent.count == 2 }
    try await soon { day.editor.actingRow == nil }
    day.close()
  }

  @Test func an_account_change_while_an_action_waits_shows_nothing_under_the_new_account() async throws {
    let relay = StateRelay()
    let h = try await harness(pages: [todayPage], tasks: [water, read], relay: relay)
    let day = try RowScreen(h.model)
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    try await answerHeld(h) { _ in
      relay.hold()
      return applied(try movedToTomorrow(operationId: nil))
    }
    await h.engine.settled()

    // The states that held the answer never reach the model; the next one is another account's.
    relay.discardKept()
    await h.server.add([
      .workspace(.full(try copy(revision: 7, pages: [todayPage], tasks: [water, read]), owner: "two"))
    ])
    await h.model.refresh()
    relay.release()
    try await soon { h.model.state.owner == "two" }
    try await soon { day.editor.actingRow == nil }
    try await turns()
    #expect(day.notice == nil, "nothing of the first account's action is said under the second")
    day.close()
  }

  @Test func leaving_the_day_while_an_action_is_out_shows_nothing_for_it_there() async throws {
    let yesterdayPage = page(yesterday, [row("y1", "t3", "Pay the rent", on: yesterday)])
    let h = try await harness(pages: [todayPage, yesterdayPage], tasks: [water, read, task("t3", "Pay the rent")])
    let day = try RowScreen(h.model)
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    await h.server.callHeld()

    day.screen.open(yesterday)
    day.drawn()
    #expect(day.words == ["Pay the rent"])
    #expect(day.editor.actingRow == nil, "the old row's dimming does not follow him")
    #expect(try !day.dimmed("Pay the rent"))

    try await answerHeld(h) { _ in applied(try movedToTomorrow(operationId: nil)) }
    await h.engine.settled()
    try await turns()
    #expect(day.notice == nil, "nothing is said on this day for the other")

    // A later action on this day runs.
    await h.server.add([applied(try changes(from: 2, to: 3))])
    try day.swipe("Pay the rent", "Bring to today")
    try await soon { day.notice != nil }
    #expect(day.notice?.text == "On today")
    day.close()
  }

  @Test func leaving_the_day_while_a_notice_shows_takes_it_away() async throws {
    let yesterdayPage = page(yesterday, [row("y1", "t3", "Pay the rent", on: yesterday)])
    let h = try await harness(pages: [todayPage, yesterdayPage], tasks: [water, read, task("t3", "Pay the rent")])
    let day = try RowScreen(h.model)
    _ = try await moveWithUndo(h, day)

    day.screen.open(yesterday)
    day.drawn()
    #expect(day.notice == nil)
    day.close()
  }

  // MARK: The marks

  @Test func the_marks_follow_the_drawn_workspace() async throws {
    let clock = thursday
    let saturdayPage = page(saturday, [row("r1", "t1", "Water the plants", on: saturday), line("b", "Walk")])
    let h = try await Harness(
      copy: try copy(pages: [page(today, []), saturdayPage], tasks: [water, read]), clock: clock, sleep: neverEnding)
    let day = try RowScreen(h.model, on: saturday)
    #expect(try day.marks("Water the plants") == nil)

    // A load giving the to-do a Due date redraws its marks.
    await h.server.add([
      .workspace(
        .full(
          try copy(revision: 2, pages: [page(today, []), saturdayPage], tasks: [task("t1", "Water the plants", due: tomorrow), read]),
          owner: "one"))
    ])
    await h.model.refresh()
    try await soon { (try? day.marks("Water the plants")) == "Due tomorrow" }

    // A load that changes nothing a row shows hands the list no new workspace.
    let replaced = day.screen.replacedDocuments.count
    await h.server.add([
      .workspace(
        .full(
          try copy(
            revision: 3, pages: [page(today, []), saturdayPage],
            tasks: [task("t1", "Water the plants", due: tomorrow), task("t2", "Read the whole lease")]), owner: "one"))
    ])
    await h.model.refresh()
    try await soon { h.model.state.workspace?.revision == 3 }
    try await turns()
    #expect(day.screen.replacedDocuments.count == replaced)
    #expect(try day.marks("Water the plants") == "Due tomorrow")

    // At midnight the marks move with today.
    clock.date = Date(timeIntervalSince1970: 1_795_737_601)
    NotificationCenter.default.post(name: UIApplication.significantTimeChangeNotification, object: nil)
    try await soon { (try? day.marks("Water the plants")) == "Due today" }
    #expect(h.model.today == tomorrow)
    day.close()
  }
}
