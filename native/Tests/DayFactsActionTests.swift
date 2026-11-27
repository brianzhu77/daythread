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
private let saturday = LocalDate("2026-11-28")!
private let monday = LocalDate("2026-11-30")!
/// Noon UTC on Thursday, Nov 26 2026.
private let thursdayNoon = Date(timeIntervalSince1970: 1_795_694_400)

private func type(of action: JSONValue) -> String? { action.objectValue?["type"]?.stringValue }

private func heading(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"heading","props":{"level":2},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

/// A bullet holding `words` then the chip, as an event is written on a page.
private func event(_ id: String, _ words: String, _ chip: String) -> String {
  #"{"id":"\#(id)","type":"bulletListItem","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}},\#(chip)],"children":[]}"#
}

private func trashed(_ page: JSONValue) -> JSONValue {
  var object = page.objectValue!
  object["trashedAt"] = .string("2026-11-26T08:00:00.000Z")
  object["trashId"] = .string("batch-1")
  return .object(object)
}

/// The command the strip sends, written out as the server receives it: no `from`.
private func planTask(_ taskId: String, on date: LocalDate) -> JSONValue {
  .object([
    "type": .string("plan-task"), "taskId": .string(taskId), "date": .string(date.value),
    "today": .string(today.value),
  ])
}

/// The strip's actions on today's screen (`native-phase-1.md` §12.4): `Bring back` and a day of `Another day` plan a
/// set-aside to-do with one command, sent and waited for as a row's action is, with the notice and `Undo`; and one
/// action at a time for the whole screen.
@MainActor
@Suite(.serialized) struct DayFactsActionTests {
  private let water = task("t1", "Water the plants")
  /// Set aside on Thursday with `Not today`.
  private let bike = task("t-aside", "Fix the bike", paused: true)
  private let shed = task("t-shed", "Sort the shed", paused: true)

  private var thursday: Clock {
    let clock = Clock()
    clock.date = thursdayNoon
    return clock
  }

  /// Today's page: a line, a plan row of `t1`, a line reading `walk`.
  private func todayLines(walk: String = "Walk") -> [String] {
    [line("a", "Morning"), row("r1", "t1", "Water the plants"), line("b", walk)]
  }

  private var todayPage: JSONValue { page(today, todayLines()) }

  private func harness(
    pages: [JSONValue]? = nil, tasks: [JSONValue]? = nil, clock: Clock? = nil, relay: StateRelay? = nil
  ) async throws -> Harness {
    try await Harness(
      copy: try copy(pages: pages ?? [todayPage], tasks: tasks ?? [water, bike]), clock: clock ?? thursday,
      sleep: neverEnding, relay: relay)
  }

  /// What the server answers `Bring back` of `t-aside` on revision `from`: today's page with its new plan row, the
  /// to-do no longer set aside, the slot this operation's when `undo` names it.
  private func broughtBack(from: Int = 1, walk: String = "Walk", undo operationId: String?) throws
    -> WorkspaceChanges
  {
    try changes(
      from: from, to: from + 1,
      pages: [page(today, todayLines(walk: walk) + [row("r9", "t-aside", "Fix the bike")])],
      tasks: [task("t-aside", "Fix the bike", version: 2)], undo: operationId)
  }

  /// What the server answers a move of `t-aside` to `date`.
  private func moved(to date: LocalDate, from: Int = 1, undo operationId: String?) throws -> WorkspaceChanges {
    try changes(
      from: from, to: from + 1, pages: [page(date, [row("s1", "t-aside", "Fix the bike", on: date)])],
      tasks: [task("t-aside", "Fix the bike", version: 2)], undo: operationId)
  }

  /// Answers the call the server holds with `reply`, made with the operation id it was sent under, and returns it.
  @discardableResult
  private func answerHeld(_ h: Harness, _ reply: (String) throws -> TestServer.Reply) async throws -> String {
    try await held(h)
    let operationId = try #require(await h.server.operationIds.last)
    await h.server.add([try reply(operationId)])
    await h.server.release()
    return operationId
  }

  /// Returns once a call waits at the server, or records an issue after ten seconds: a command never sent fails the
  /// test rather than hanging it.
  private func held(_ h: Harness, sourceLocation: SourceLocation = #_sourceLocation) async throws {
    try await eventually({ await h.server.waitingCalls > 0 }, sourceLocation: sourceLocation)
  }

  /// Lets the run loop turn, so the strip's height reaches the list, then lays the screen out.
  private func settled(_ day: RowScreen) async throws {
    day.drawn()
    try await turns()
    day.drawn()
  }

  private func listed(_ day: RowScreen) -> [String] {
    day.facts.notToday?.rows.map(\.taskId) ?? []
  }

  private func item(_ day: RowScreen, _ title: String) throws -> RowMenu.Item {
    try #require(day.facts.notToday?.menu.items.first { $0.title == title }, "no \(title)")
  }

  /// `Bring back` of `t-aside`; the server's answer leaves the slot this operation's. Returns the operation once the
  /// notice shows.
  private func bringBackWithUndo(_ h: Harness, _ day: RowScreen) async throws -> String {
    await h.server.hold()
    day.factsModel.bringBack("t-aside")
    let operationId = try await answerHeld(h) { applied(try broughtBack(undo: $0)) }
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "On today", kind: .done, undoing: operationId))
    return operationId
  }

  // MARK: What is sent, and said

  @Test func bring_back_waits_for_unsaved_words_then_sends_plan_task_without_from() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(listed(day) == ["t-aside"])

    await h.server.add([savedAs(try changes(from: 1, to: 2, pages: [page(today, todayLines(walk: "Walk the dog"))]))])
    await h.server.holdCommands()
    // Typed, and Bring back tapped in the same turn: his words are not handed over yet.
    try day.type(" the dog", atEndOf: "Walk")
    day.factsModel.bringBack("t-aside")
    let operationId = try await answerHeld(h) { applied(try broughtBack(from: 2, walk: "Walk the dog", undo: $0)) }
    try await soon { day.notice != nil }

    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor", "plan-task"])
    #expect(words(of: sent.first?.objectValue?["document"]?.stringValue) == ["Morning", "Water the plants", "Walk the dog"])
    #expect(sent.last == planTask("t-aside", on: today))
    #expect(day.notice == Notice(text: "On today", kind: .done, undoing: operationId))
    day.close()
  }

  @Test func another_day_sends_that_day_and_says_the_short_form() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.hold()
    day.factsModel.choose(try item(day, "This weekend · Sat 11/28"), for: "t-aside")
    let operationId = try await answerHeld(h) { applied(try moved(to: saturday, undo: $0)) }
    try await soon { day.notice != nil }

    #expect(await h.server.sent == [planTask("t-aside", on: saturday)])
    #expect(day.notice == Notice(text: "Moved to Sat 11/28", kind: .done, undoing: operationId))
    day.close()
  }

  @Test func pick_date_opens_the_calendar_from_the_menus_button() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    day.factsModel.notTodayOpen = true
    try await settled(day)
    let menuFrame = try #require(day.factsModel.menuFrames["t-aside"], "the row's menu button is laid out")

    day.factsModel.choose(try item(day, "Pick date…"), for: "t-aside")
    try await soon { day.screen.presentedViewController != nil }
    let picker = try #require(day.screen.presentedViewController as? DayPickerViewController)
    picker.loadViewIfNeeded()
    let selection = try #require(picker.calendarView.selectionBehavior as? UICalendarSelectionSingleDate)
    #expect(selection.selectedDate == nil, "nothing selected")
    #expect(!picker.dateSelection(selection, canSelectDate: DateComponents(year: 2026, month: 11, day: 25)))
    #expect(picker.dateSelection(selection, canSelectDate: DateComponents(year: 2026, month: 11, day: 26)))
    let popover = try #require(picker.popoverPresentationController)
    #expect(popover.sourceView === day.factsView, "anchored in the strip")
    #expect(popover.sourceRect == menuFrame, "at the row's menu button")
    #expect(await h.server.sent.isEmpty, "opening it sends nothing")
    day.close()
  }

  @Test func a_day_picked_moves_the_to_do_there_and_today_brings_it_back() async throws {
    for (picked, words) in [(monday, "Moved to Mon 11/30"), (today, "On today")] {
      let h = try await harness()
      let day = try RowScreen(h.model)
      try await settled(day)
      day.factsModel.choose(try item(day, "Pick date…"), for: "t-aside")
      try await soon { day.screen.presentedViewController != nil }
      let picker = try #require(day.screen.presentedViewController as? DayPickerViewController)
      picker.loadViewIfNeeded()
      let selection = try #require(picker.calendarView.selectionBehavior as? UICalendarSelectionSingleDate)

      await h.server.add([applied(try changes(from: 1, to: 2))])
      let components = DateComponents(year: 2026, month: 11, day: picked == today ? 26 : 30)
      picker.dateSelection(selection, didSelectDate: components)
      try await soon { day.notice != nil }

      #expect(day.notice?.text == words, "picked \(picked.value)")
      #expect(await h.server.sent == [planTask("t-aside", on: picked)], "picked \(picked.value)")
      try await soon { day.screen.presentedViewController == nil }
      day.close()
    }
  }

  // MARK: A choice made on a list that changed

  @Test func a_choice_made_after_the_to_do_left_the_list_sends_nothing() async throws {
    let elsewhere: [(String, [JSONValue], [JSONValue])] = [
      (
        "brought back elsewhere", [page(today, todayLines() + [row("r9", "t-aside", "Fix the bike")])],
        [water, task("t-aside", "Fix the bike", version: 2)]
      ),
      ("ticked", [todayPage], [water, task("t-aside", "Fix the bike", status: "done", version: 2, paused: true)]),
      ("deleted", [todayPage], [water]),
      ("its title emptied", [todayPage], [water, task("t-aside", "", version: 2, paused: true)]),
    ]
    for (what, pages, tasks) in elsewhere {
      let h = try await harness()
      let day = try RowScreen(h.model)
      try await settled(day)
      let weekend = try item(day, "This weekend · Sat 11/28")

      // The menu was opened on the list as it was; a load changes it before the choice is made.
      await h.server.add([.workspace(.full(try copy(revision: 2, pages: pages, tasks: tasks), owner: "one"))])
      await h.model.refresh()
      try await soon { h.model.state.workspace?.revision == 2 }
      try await settled(day)
      #expect(listed(day).isEmpty, "\(what)")
      day.factsModel.choose(weekend, for: "t-aside")
      day.factsModel.bringBack("t-aside")
      try await turns()

      #expect(await h.server.sent.isEmpty, "\(what): nothing sent")
      #expect(day.notice == nil, "\(what)")
      #expect(day.factsModel.acting == nil && day.factsModel.enabled, "\(what)")
      day.close()
    }

    // The screen moved to another day before the choice.
    let h = try await harness(pages: [todayPage, page(yesterday, [line("y", "Before")])])
    let day = try RowScreen(h.model)
    try await settled(day)
    let weekend = try item(day, "This weekend · Sat 11/28")
    day.screen.open(yesterday)
    try await settled(day)
    day.factsModel.choose(weekend, for: "t-aside")
    day.factsModel.onBringBack?("t-aside")
    try await turns()
    #expect(await h.server.sent.isEmpty, "another day: nothing sent")
    day.close()
  }

  @Test func a_day_picked_after_the_to_do_left_the_list_sends_nothing() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    day.factsModel.choose(try item(day, "Pick date…"), for: "t-aside")
    try await soon { day.screen.presentedViewController != nil }
    let picker = try #require(day.screen.presentedViewController as? DayPickerViewController)
    picker.loadViewIfNeeded()

    // Brought back on another device while the calendar is open.
    await h.server.add([
      .workspace(
        .full(
          try copy(
            revision: 2, pages: [page(today, todayLines() + [row("r9", "t-aside", "Fix the bike")])],
            tasks: [water, task("t-aside", "Fix the bike", version: 2)]), owner: "one"))
    ])
    await h.model.refresh()
    try await soon { listed(day).isEmpty }
    let selection = try #require(picker.calendarView.selectionBehavior as? UICalendarSelectionSingleDate)
    picker.dateSelection(selection, didSelectDate: DateComponents(year: 2026, month: 11, day: 30))
    try await turns()

    #expect(await h.server.sent.isEmpty)
    #expect(day.notice == nil)
    try await soon { day.screen.presentedViewController == nil }
    day.close()
  }

  @Test func a_day_picked_that_is_before_today_by_now_sends_nothing() async throws {
    let clock = thursday
    let h = try await harness(clock: clock)
    let day = try RowScreen(h.model)
    try await settled(day)
    day.factsModel.choose(try item(day, "Pick date…"), for: "t-aside")
    try await soon { day.screen.presentedViewController != nil }
    let picker = try #require(day.screen.presentedViewController as? DayPickerViewController)
    picker.loadViewIfNeeded()

    // Midnight passes while the calendar is open; Thursday is yesterday now.
    clock.date = thursdayNoon.addingTimeInterval(86_400)
    h.model.checkToday()
    try await soon { h.model.today == LocalDate("2026-11-27")! }
    let selection = try #require(picker.calendarView.selectionBehavior as? UICalendarSelectionSingleDate)
    picker.dateSelection(selection, didSelectDate: DateComponents(year: 2026, month: 11, day: 26))
    try await turns()

    #expect(!(await h.server.sent.contains { type(of: $0) == "plan-task" }))
    #expect(day.notice == nil)
    day.close()
  }

  // MARK: Waited for

  @Test func the_row_leaves_when_the_state_holding_the_answer_arrives() async throws {
    let relay = StateRelay()
    let h = try await harness(tasks: [water, bike, shed], relay: relay)
    let day = try RowScreen(h.model)
    day.factsModel.notTodayOpen = true
    try await settled(day)
    #expect(day.facts.notToday?.title == "Not today · 2")

    await h.server.hold()
    day.factsModel.bringBack("t-aside")
    try await held(h)
    #expect(day.factsModel.acting == "t-aside", "its words are dimmed while it is out")
    let operationId = try #require(await h.server.operationIds.last)
    await h.server.add([applied(try broughtBack(undo: operationId))])

    // The answer reaches the model; the state that holds it does not yet.
    relay.hold()
    await h.server.release()
    await h.engine.settled()
    try await turns()
    #expect(day.notice == nil, "nothing is said before the state that holds the answer")
    #expect(listed(day) == ["t-aside", "t-shed"], "still listed")
    #expect(day.factsModel.acting == "t-aside", "and still dimmed")

    relay.release()
    try await soon { day.notice != nil }
    #expect(day.notice?.text == "On today")
    // The screen draws the state on its next update, which may come after the notice.
    try await soon { listed(day) == ["t-shed"] }
    #expect(day.facts.notToday?.title == "Not today · 1")
    #expect(day.factsModel.acting == nil)
    #expect(day.factsModel.notTodayOpen, "the fold stays open")

    // The last one leaves: the part goes, and the fold is closed.
    await h.server.add([
      applied(
        try changes(
          from: 2, to: 3, pages: [page(today, todayLines() + [row("r9", "t-aside", "Fix the bike")])],
          tasks: [task("t-shed", "Sort the shed", version: 2)]))
    ])
    day.factsModel.bringBack("t-shed")
    try await soon { day.facts.notToday == nil }
    #expect(!day.factsModel.notTodayOpen)
    day.close()
  }

  @Test func a_failure_changes_nothing_and_says_so() async throws {
    for refused in [true, false] {
      let h = try await harness()
      let day = try RowScreen(h.model)
      try await settled(day)
      // Refused: the server will not do it. Offline: no reply at all.
      if refused {
        await h.server.add([
          .outcome(.refused(message: "Task not found", owner: "one")), .workspace(.unchanged(revision: 1, owner: "one")),
        ])
      }
      day.factsModel.bringBack("t-aside")
      try await soon { day.notice != nil }

      #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil), "refused: \(refused)")
      #expect(await h.server.sent == [planTask("t-aside", on: today)], "refused: \(refused)")
      #expect(listed(day) == ["t-aside"], "still listed; refused: \(refused)")
      #expect(day.factsModel.enabled, "enabled again; refused: \(refused)")
      #expect(day.factsModel.acting == nil)
      day.close()
    }
  }

  // MARK: Undo

  @Test func undo_brings_the_to_do_back_to_the_list() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let operationId = try await bringBackWithUndo(h, day)
    try await soon { listed(day).isEmpty }

    await h.server.hold()
    try day.undo()
    try await held(h)
    #expect(!day.factsModel.enabled, "the strip is disabled while the Undo is out")
    #expect(day.factsModel.acting == nil, "the to-do is not in the list to be dimmed")
    try await answerHeld(h) { _ in applied(try changes(from: 2, to: 3, pages: [todayPage], tasks: [bike])) }
    try await soon { day.notice?.kind == .undone }

    #expect(day.notice == Notice(text: "Undone", kind: .undone, undoing: nil))
    #expect(await h.server.sent.last == Command.undo(targetOperationId: operationId))
    try await soon { listed(day) == ["t-aside"] }
    #expect(day.factsModel.enabled)
    day.close()
  }

  @Test func undo_leaves_the_notice_when_he_types() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    _ = try await bringBackWithUndo(h, day)

    try day.type("!", atEndOf: "Walk")
    try await soon { day.notice?.undoing == nil }
    #expect(day.notice?.text == "On today", "the words stay until their time")
    day.close()
  }

  // MARK: One at a time

  @Test func one_action_at_a_time_across_the_strip_and_the_rows() async throws {
    let bank = task("t2", "Call the bank")
    let h = try await harness(
      pages: [page(today, todayLines() + [row("r2", "t2", "Call the bank")])], tasks: [water, bike, bank])
    let day = try RowScreen(h.model)
    try await settled(day)

    // A row's action is out.
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    try await held(h)
    #expect(!day.factsModel.enabled, "every control of the strip is disabled")
    day.factsModel.bringBack("t-aside")
    // The screen's own check, as a control drawn before it was disabled would reach it.
    day.factsModel.onBringBack?("t-aside")
    day.factsModel.onAnotherDay?("t-aside", saturday)
    try await turns()
    #expect(await h.server.sent.count == 1, "nothing more was sent")
    try await answerHeld(h) { _ in applied(try changes(from: 1, to: 2)) }
    try await soon { day.notice != nil && day.factsModel.enabled }

    // A strip action is out.
    await h.server.hold()
    day.factsModel.bringBack("t-aside")
    try await held(h)
    #expect(day.factsModel.acting == "t-aside")
    #expect(!day.factsModel.enabled)
    #expect(day.editor.actingRow == nil, "no row of the page is dimmed")
    #expect(try day.swipe("Water the plants") == nil, "the page's rows offer no swipe")
    #expect(try day.swipe("Call the bank") == nil)
    try day.menu("Water the plants", "Not today")
    try await turns()
    #expect(await h.server.sent.count == 2, "a row's action sends nothing")

    // Typing and ticking go on.
    try day.type(" the dog", atEndOf: "Walk")
    #expect(day.words.contains("Walk the dog"))
    try day.tick("Water the plants")
    #expect(h.status("t1") == .done)

    try await answerHeld(h) { _ in applied(try changes(from: 2, to: 3, tasks: [task("t-aside", "Fix the bike", version: 2)])) }
    try await soon { day.notice?.text == "On today" }
    #expect(day.factsModel.acting == nil)
    #expect(day.factsModel.enabled)
    #expect(try day.swipeTitles("Call the bank") == ["Tomorrow", "Not today", "More"], "the rows' swipe is back")
    #expect(await h.server.sent.filter { type(of: $0) == "plan-task" }.count == 2)
    day.close()
  }

  @Test func a_row_action_out_on_today_holds_the_rows_of_another_day() async throws {
    let bank = task("t2", "Call the bank")
    let h = try await harness(
      pages: [todayPage, page(saturday, [row("s1", "t2", "Call the bank", on: saturday)])], tasks: [water, bike, bank])
    let day = try RowScreen(h.model)
    try await settled(day)
    await h.server.hold()
    try day.swipe("Water the plants", "Tomorrow")
    try await held(h)

    day.screen.open(saturday)
    try await settled(day)
    #expect(day.words == ["Call the bank"])
    #expect(try day.swipe("Call the bank") == nil, "no swipe while today's action is out")

    try await answerHeld(h) { _ in applied(try changes(from: 1, to: 2)) }
    await h.engine.settled()
    try await soon { (try? day.swipe("Call the bank")) != nil }
    #expect(day.notice == nil, "nothing is said on this day for today's row")
    day.close()
  }

  // MARK: A day without its page

  @Test func with_todays_page_being_made_bring_back_is_disabled() async throws {
    let h = try await harness(pages: [])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.screen.content == .askingForToday)
    #expect(listed(day) == ["t-aside"], "listed")
    #expect(!day.factsModel.enabled, "disabled while today's page is being made")
    day.factsModel.onBringBack?("t-aside")
    try await turns()
    #expect(!(await h.server.sent.contains { type(of: $0) == "plan-task" }))
    #expect(day.notice == nil)

    // The page arrives.
    await h.server.add([.workspace(.full(try copy(revision: 2, pages: [todayPage], tasks: [water, bike]), owner: "one"))])
    await h.model.refresh()
    try await soon { h.model.state.workspace?.revision == 2 }
    try await settled(day)
    #expect(day.factsModel.enabled)
    day.close()
  }

  @Test func with_todays_page_in_trash_bring_back_is_sent_with_no_page_to_wait_for() async throws {
    let h = try await harness(pages: [trashed(todayPage)])
    let day = try RowScreen(h.model)
    try await settled(day)
    guard case .inTrash? = day.screen.content else {
      Issue.record("today is \(String(describing: day.screen.content))")
      return
    }
    #expect(day.factsModel.enabled)

    await h.server.add([applied(try changes(from: 1, to: 2, tasks: [task("t-aside", "Fix the bike", version: 2)]))])
    day.factsModel.bringBack("t-aside")
    try await soon { day.notice != nil }
    #expect(await h.server.sent == [planTask("t-aside", on: today)])
    #expect(day.notice?.text == "On today")
    day.close()
  }

  // MARK: Leaving, and another account

  @Test func an_account_change_while_bring_back_waits_shows_nothing() async throws {
    let relay = StateRelay()
    let h = try await harness(relay: relay)
    let day = try RowScreen(h.model)
    try await settled(day)
    await h.server.hold()
    day.factsModel.bringBack("t-aside")
    try await answerHeld(h) { _ in
      relay.hold()
      return applied(try broughtBack(undo: nil))
    }
    await h.engine.settled()

    // The states that held the answer never reach the model; the next one is another account's, with a to-do of the
    // same id set aside.
    relay.discardKept()
    await h.server.add([.workspace(.full(try copy(revision: 7, pages: [todayPage], tasks: [water, bike]), owner: "two"))])
    await h.model.refresh()
    relay.release()
    try await soon { h.model.state.owner == "two" }
    try await soon { day.factsModel.enabled }
    try await turns()
    #expect(day.notice == nil, "nothing of the first account's action is said under the second")
    #expect(day.factsModel.acting == nil, "nothing dimmed")
    #expect(listed(day) == ["t-aside"], "their own list")
    day.close()
  }

  @Test func leaving_today_while_bring_back_is_out_says_nothing_there() async throws {
    let h = try await harness(pages: [todayPage, page(yesterday, [line("y", "Before")])])
    let day = try RowScreen(h.model)
    try await settled(day)
    await h.server.hold()
    day.factsModel.bringBack("t-aside")
    try await held(h)

    day.screen.open(yesterday)
    try await settled(day)
    #expect(day.words == ["Before"])
    #expect(day.factsModel.acting == nil, "the dimming stays with today")

    try await answerHeld(h) { _ in applied(try broughtBack(undo: nil)) }
    await h.engine.settled()
    try await turns()
    #expect(day.notice == nil, "nothing is said on this day for today")
    try await soon { day.factsModel.enabled }
    day.close()
  }

  // MARK: The events line

  /// Today's page: filler, then the `Events` heading and its events, then more filler.
  private var pageWithEvents: JSONValue {
    let filler = (1...20).map { line("f\($0)", "Line \($0)") }
    let events = [
      heading("h1", "Events"), event("ev1", "Standup with Lu ", chip("e-standup", on: today, at: "10:30")),
    ]
    let after = (21...40).map { line("f\($0)", "Line \($0)") }
    return page(today, filler + events + after)
  }

  @Test func the_events_line_scrolls_to_the_events_heading() async throws {
    let h = try await harness(pages: [pageWithEvents], tasks: [water])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.facts.eventsHeadingId == "h1")

    day.factsModel.eventsTapped()
    let list = try #require(day.screen.list)
    // The heading's row at the top of what the list shows, under its top inset.
    try await soon {
      // Read without `cell(_:)`, which records an issue while the row is not on screen yet.
      var view: UIView? = day.lines.first { $0.text == "Events" }
      while let found = view, !(found is UICollectionViewCell) { view = found.superview }
      guard let row = view?.frame else { return false }
      return list.contentOffset.y > 0 && abs(row.minY - (list.contentOffset.y + list.adjustedContentInset.top)) <= 1
    }
    #expect(await h.server.sent.isEmpty)
    day.close()
  }

  @Test func with_no_events_heading_the_events_line_is_not_a_button() async throws {
    let filler = (1...40).map { line("f\($0)", "Line \($0)") }
    let events = [event("ev1", "Standup with Lu ", chip("e-standup", on: today, at: "10:30"))]
    let h = try await harness(pages: [page(today, filler + events)], tasks: [water])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.facts.events != nil)
    #expect(day.facts.eventsHeadingId == nil)

    let list = try #require(day.screen.list)
    let before = list.contentOffset
    day.factsModel.eventsTapped()
    try await turns()
    #expect(list.contentOffset == before, "nothing scrolls")
    day.close()
  }
}
