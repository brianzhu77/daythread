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
/// The empty to-do the day's template leaves under `TODO`.
private let slotId = "day:2026-11-26:r0"

private func type(of action: JSONValue) -> String? { action.objectValue?["type"]?.stringValue }

private func heading(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"heading","props":{"level":2},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

private func bullet(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"bulletListItem","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

/// A receipt whose message is `message`.
private func said(_ message: String) -> JSONValue { .object(["message": .string(message)]) }

private let emptySlot = row(slotId, "editor-task:\(slotId)", "")
/// The slot after `i1` was applied: `Book the flights`, planned today.
private let filledSlot = row(slotId, "t1", "Book the flights")
/// The rows `i2`, `i3` and `i4` become once applied, after the slot.
private let dentistRow = row("d-i2", "t2", "Call the dentist")
private let passportRow = row("b-i3", "t-new", "Renew the passport")
private let chargerRow = bullet("b-i4", "Pack the charger")

/// Today's page: `TODO`, its slot, what an apply put after it, a plan row of `Water the plants`, `Notes`, a line
/// reading `walk`, then filler, so the page scrolls.
private func todayLines(slot: String = emptySlot, inserted: [String] = [], walk: String = "Walk") -> [String] {
  [heading("h0", "TODO"), slot] + inserted
    + [row("w1", "t5", "Water the plants"), heading("h3", "Notes"), line("a", walk)]
    + (1...30).map { line("f\($0)", "Line \($0)") }
}

private func todayPage(slot: String = emptySlot, inserted: [String] = [], walk: String = "Walk") -> JSONValue {
  page(today, todayLines(slot: slot, inserted: inserted, walk: walk))
}

/// `Call the dentist` was planned yesterday.
private let yesterdayPage = page(yesterday, [row("y2", "t2", "Call the dentist", on: yesterday)])

/// Today's draft, ready, with its four items in `states` (open unless named): `i1` carries `Book the flights` into the
/// empty slot, `i2` carries `Call the dentist` after it, `i3` is a new to-do `Renew the passport`, `i4` a bullet
/// `Pack the charger`.
private func draftPage(_ states: [String: String] = [:], recipe: Int = DayDraft.currentRecipe) -> JSONValue {
  func state(_ id: String) -> String { states[id] ?? "open" }
  let items = [
    #"{"id":"i1","anchor":"\#(slotId)","place":"fill","taskId":"t1","source":"model","state":"\#(state("i1"))"}"#,
    #"{"id":"i2","anchor":"\#(slotId)","place":"after","taskId":"t2","source":"model","state":"\#(state("i2"))"}"#,
    #"{"id":"i3","anchor":"\#(slotId)","place":"after","block":\#(row("b-i3", "", "Renew the passport")),"source":"model","state":"\#(state("i3"))"}"#,
    #"{"id":"i4","anchor":"\#(slotId)","place":"after","block":\#(bullet("b-i4", "Pack the charger")),"source":"model","state":"\#(state("i4"))"}"#,
  ]
  return draftPage(items: items, recipe: recipe)
}

/// Today's draft, ready, holding `items` (JSON text).
private func draftPage(items: [String], recipe: Int = DayDraft.currentRecipe) -> JSONValue {
  .object([
    "id": .string("draft:\(todayId)"), "type": .string("draft"), "parentId": .string(todayId), "title": .string(""),
    "document": .string(
      #"{"status":"ready","recipe":\#(recipe),"moreOpen":[],"items":[\#(items.joined(separator: ","))]}"#),
  ])
}

/// Made on Nov 12 and planned on no day.
private let flights: JSONValue = {
  var object = task("t1", "Book the flights").objectValue!
  object["createdOn"] = .string("2026-11-12")
  return .object(object)
}()
private let dentist = task("t2", "Call the dentist")
private let water = task("t5", "Water the plants")
/// Set aside with `Not today`: a row of the strip's `Not today`.
private let bike = task("t6", "Fix the bike", paused: true)
private let tasks = [flights, dentist, water, bike]

private let everyItem = ["i1", "i2", "i3", "i4"]

private func applyDraft(_ itemIds: [String]) throws -> JSONValue {
  let ids = itemIds.map { "\"\($0)\"" }.joined(separator: ",")
  return try JSON.parse(#"{"type":"apply-draft","pageId":"day:2026-11-26","itemIds":[\#(ids)],"today":"2026-11-26"}"#)
}

private func skipDraft(_ itemIds: [String]) throws -> JSONValue {
  let ids = itemIds.map { "\"\($0)\"" }.joined(separator: ",")
  return try JSON.parse(#"{"type":"skip-draft","pageId":"day:2026-11-26","itemIds":[\#(ids)]}"#)
}

/// The `set-draft` a Retry's answer hands back, as JSON text.
private let setDraftText =
  #"{"type":"set-draft","pageId":"day:2026-11-26","status":"ready","moreOpen":[],"allowedTaskIds":["t2"],"recipe":5,"items":[]}"#

/// §13.8: a suggestion's `checkmark` and `xmark`, the line's `Apply all` and `Dismiss`, sent and waited for as a row's
/// actions are, their notices and Undo: the server's `undo` for an apply, `reopen-draft` for a skip.
@MainActor
@Suite(.serialized) struct DraftDecisionTests {
  private var thursday: Clock {
    let clock = Clock()
    clock.date = thursdayNoon
    return clock
  }

  private func harness(
    draft: JSONValue = draftPage(), tasks: [JSONValue] = tasks, clock: Clock? = nil, relay: StateRelay? = nil,
    asksForDayDrafts: Bool = false
  ) async throws -> Harness {
    try await Harness(
      copy: try copy(pages: [todayPage(), yesterdayPage, draft], tasks: tasks), clock: clock ?? thursday,
      sleep: neverEnding, relay: relay, asksForDayDrafts: asksForDayDrafts, draftSleep: neverEnding)
  }

  /// Lets the run loop turn, so the strip's height reaches the list, then lays the screen out.
  private func settled(_ day: RowScreen) async throws {
    day.drawn()
    try await turns()
    day.drawn()
  }

  /// Returns once a call waits at the server, or records an issue after ten seconds: a command never sent fails the
  /// test rather than hanging it.
  private func held(_ h: Harness, sourceLocation: SourceLocation = #_sourceLocation) async throws {
    try await eventually({ await h.server.waitingCalls > 0 }, sourceLocation: sourceLocation)
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

  /// What the server answers the apply of `i2` on `from`: its row after the slot, the item applied.
  private func appliedI2(from: Int = 1, walk: String = "Walk", undo operationId: String?) throws -> TestServer.Reply {
    applied(
      try changes(
        from: from, to: from + 1,
        pages: [todayPage(inserted: [dentistRow], walk: walk), draftPage(["i2": "applied"])], undo: operationId),
      receipt: said("Applied"))
  }

  private func suggestionIds(_ day: RowScreen) -> [String]? {
    day.screen.draftView?.suggestions.map(\.id)
  }

  /// `i2` applied; the server's answer leaves the slot this operation's. Returns the operation once the notice shows.
  private func applyWithUndo(_ h: Harness, _ day: RowScreen) async throws -> String {
    await h.server.holdCommands()
    day.screen.suggestionTapped("i2", .apply)
    let operationId = try await answerHeld(h) { try appliedI2(undo: $0) }
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Applied", kind: .done, undoing: operationId))
    return operationId
  }

  /// Every suggestion skipped with `Dismiss`. Returns the skip's operation once the notice shows.
  private func dismissed(_ h: Harness, _ day: RowScreen) async throws -> String {
    await h.server.holdCommands()
    day.factsModel.dismissTapped()
    let skipped = Dictionary(uniqueKeysWithValues: everyItem.map { ($0, "skipped") })
    let operationId = try await answerHeld(h) {
      applied(try changes(from: 1, to: 2, pages: [draftPage(skipped)], undo: $0), receipt: said("Skipped 4"))
    }
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Skipped 4", kind: .skipped, undoing: operationId))
    return operationId
  }

  // MARK: What is sent, and said

  @Test func apply_waits_for_his_words_then_sends_apply_draft_with_that_item() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(suggestionIds(day) == everyItem)

    await h.server.add([savedAs(try changes(from: 1, to: 2, pages: [todayPage(walk: "Walk!")]))])
    await h.server.holdCommands()
    // Typed, and the suggestion applied in the same turn: his words are not handed over yet.
    try day.type("!", atEndOf: "Walk")
    day.screen.suggestionTapped("i2", .apply)
    let operationId = try await answerHeld(h) { try appliedI2(from: 2, walk: "Walk!", undo: $0) }
    try await soon { day.notice != nil }

    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor", "apply-draft"])
    let saved = words(of: sent.first?.objectValue?["document"]?.stringValue)
    #expect(saved.contains("Walk!"))
    #expect(sent.last == (try applyDraft(["i2"])))
    #expect(day.notice == Notice(text: "Applied", kind: .done, undoing: operationId))
    day.close()
  }

  @Test func apply_all_sends_every_suggestion_shown_and_says_the_servers_count() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.holdCommands()
    day.factsModel.applyAllTapped()
    // The server applied three; the bullet was left open.
    let operationId = try await answerHeld(h) {
      applied(
        try changes(
          from: 1, to: 2,
          pages: [
            todayPage(slot: filledSlot, inserted: [dentistRow, passportRow]),
            draftPage(["i1": "applied", "i2": "applied", "i3": "applied"]),
          ], undo: $0),
        receipt: said("Applied 3"))
    }
    try await soon { day.notice != nil }

    #expect(await h.server.sent == [try applyDraft(everyItem)])
    #expect(day.notice == Notice(text: "Applied 3", kind: .done, undoing: operationId))
    try await settled(day)
    #expect(suggestionIds(day) == ["i4"], "what was left stays a suggestion while its state shows it")
    day.close()
  }

  @Test func skip_sends_skip_draft_and_offers_undo_for_ten_seconds() async throws {
    let waits = Waits()
    let h = try await harness()
    let day = try RowScreen(h.model, noticeSleep: { try await waits.wait($0) })
    try await settled(day)

    await h.server.holdCommands()
    day.screen.suggestionTapped("i2", .skip)
    let operationId = try await answerHeld(h) {
      applied(try changes(from: 1, to: 2, pages: [draftPage(["i2": "skipped"])], undo: $0), receipt: said("Skipped"))
    }
    try await soon { day.notice != nil }

    #expect(await h.server.sent == [try skipDraft(["i2"])])
    #expect(day.notice == Notice(text: "Skipped", kind: .skipped, undoing: operationId))
    try await eventually { await waits.requested == [.seconds(10)] }
    try await settled(day)
    #expect(suggestionIds(day) == ["i1", "i3", "i4"])
    day.close()
  }

  @Test func dismiss_skips_every_suggestion_shown() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    _ = try await dismissed(h, day)
    #expect(await h.server.sent == [try skipDraft(everyItem)])
    try await settled(day)
    #expect(suggestionIds(day) == [])
    #expect(day.factsModel.line == nil, "nothing left to suggest")
    day.close()
  }

  // MARK: Undo

  @Test func undo_of_an_apply_sends_undo_and_says_undone() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let operationId = try await applyWithUndo(h, day)

    await h.server.add([applied(try changes(from: 2, to: 3, pages: [todayPage(), draftPage()]))])
    try day.undo()
    try await soon { day.notice?.text == "Undone" }

    #expect(await h.server.sent.last == Command.undo(targetOperationId: operationId))
    #expect(day.notice == Notice(text: "Undone", kind: .undone, undoing: nil))
    try await settled(day)
    #expect(suggestionIds(day) == everyItem)
    day.close()
  }

  @Test func a_refused_undo_of_an_apply_says_cant_undo_edited_since() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    _ = try await applyWithUndo(h, day)

    await h.server.add([
      .outcome(.refused(message: "Cannot undo after later changes; current values kept", owner: "one")),
      .workspace(.unchanged(revision: 2, owner: "one")),
    ])
    try day.undo()
    try await soon { day.notice?.text != "Applied" }
    #expect(day.notice == Notice(text: "Can't undo · edited since", kind: .failed, undoing: nil))
    day.close()
  }

  @Test func undo_of_a_skip_sends_reopen_draft_with_what_it_saw() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let operationId = try await dismissed(h, day)

    await h.server.add([applied(try changes(from: 2, to: 3, pages: [draftPage()]), receipt: said("Undone"))])
    try day.undo()
    try await soon { day.notice?.text == "Undone" }

    let reopen = try JSON.parse(
      #"{"type":"reopen-draft","pageId":"day:2026-11-26","itemIds":["i1","i2","i3","i4"],"skippedBy":"\#(operationId)","seen":{"i1":null,"i2":"2026-11-25"}}"#
    )
    #expect(await h.server.sent.last == reopen)
    #expect(day.notice == Notice(text: "Undone", kind: .undone, undoing: nil))
    try await settled(day)
    #expect(suggestionIds(day) == everyItem)
    day.close()
  }

  @Test func a_skips_undo_stays_when_the_slot_moves_and_an_applys_does_not() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.holdCommands()
    day.screen.suggestionTapped("i2", .skip)
    let skip = try await answerHeld(h) {
      applied(try changes(from: 1, to: 2, pages: [draftPage(["i2": "skipped"])], undo: $0), receipt: said("Skipped"))
    }
    try await soon { day.notice != nil }
    #expect(day.notice?.undoing == skip)

    // He types: his words will take the server's slot. The skip's Undo does not use it.
    try day.type("!", atEndOf: "Walk")
    try await turns()
    #expect(day.notice == Notice(text: "Skipped", kind: .skipped, undoing: skip))
    #expect(!h.model.holdsUndoSlot, "a skip's notice does not hold the slot")

    // His words go first, then the apply of `i3`.
    await h.server.add([savedAs(try changes(from: 2, to: 3, pages: [todayPage(walk: "Walk!")]))])
    await h.server.holdCommands()
    day.screen.suggestionTapped("i3", .apply)
    let apply = try await answerHeld(h) {
      applied(
        try changes(
          from: 3, to: 4,
          pages: [todayPage(inserted: [passportRow], walk: "Walk!"), draftPage(["i2": "skipped", "i3": "applied"])],
          undo: $0),
        receipt: said("Applied"))
    }
    try await soon { day.notice?.undoing == apply }
    #expect(day.notice?.text == "Applied")

    try day.type("?", atEndOf: "Walk!")
    try await soon { day.notice?.undoing == nil }
    #expect(day.notice?.text == "Applied", "the words stay until their time")
    day.close()
  }

  @Test func a_refused_reopen_says_cant_undo_edited_since() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    _ = try await dismissed(h, day)

    await h.server.add([
      .outcome(.refused(message: "Cannot undo after later changes; current values kept", owner: "one")),
      .workspace(.unchanged(revision: 2, owner: "one")),
    ])
    try day.undo()
    try await soon { day.notice?.text != "Skipped 4" }
    #expect(day.notice == Notice(text: "Can't undo · edited since", kind: .failed, undoing: nil))
    day.close()
  }

  // MARK: A suggestion that changed after it was drawn (Review Focus 2)

  @Test func nothing_to_apply_says_not_applied_changed_elsewhere() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.add([
      .outcome(.refused(message: "Nothing to apply", owner: "one")), .workspace(.unchanged(revision: 1, owner: "one")),
    ])
    day.screen.suggestionTapped("i2", .apply)
    try await soon { day.notice != nil }

    #expect(await h.server.sent == [try applyDraft(["i2"])])
    #expect(day.notice == Notice(text: "Not applied · changed elsewhere", kind: .failed, undoing: nil))
    try await settled(day)
    #expect(suggestionIds(day) == everyItem, "the suggestions as they were")
    #expect(day.factsModel.enabled)
    day.close()
  }

  @Test func nothing_to_skip_says_not_skipped_changed_elsewhere() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.add([
      .outcome(.refused(message: "Nothing to skip", owner: "one")), .workspace(.unchanged(revision: 1, owner: "one")),
    ])
    day.factsModel.dismissTapped()
    try await soon { day.notice != nil }

    #expect(await h.server.sent == [try skipDraft(everyItem)])
    #expect(day.notice == Notice(text: "Not skipped · changed elsewhere", kind: .failed, undoing: nil))
    try await settled(day)
    #expect(suggestionIds(day) == everyItem, "the suggestions as they were")
    day.close()
  }

  /// Another device ticked `Call the dentist` (or set it aside, `paused`): the state saying so is held back from the
  /// screen, which still shows its suggestion when he taps, and reaches the model before the state that ends the
  /// hand-over of his words.
  private func dentistDoneWhileHisWordsGo(_ h: Harness, _ relay: StateRelay, paused: Bool = false) async throws {
    relay.hold()
    let changed =
      paused
      ? task("t2", "Call the dentist", version: 2, paused: true)
      : task("t2", "Call the dentist", status: "done", version: 2)
    await h.server.add([
      .workspace(
        .full(
          try copy(revision: 2, pages: [todayPage(), yesterdayPage, draftPage()], tasks: [flights, changed, water, bike]),
          owner: "one"))
    ])
    await h.model.refresh()
    try await soon { !relay.kept.isEmpty }
  }

  @Test(arguments: ["ticked", "set aside"])
  func a_suggestion_gone_after_his_words_were_handed_over_sends_nothing(_ how: String) async throws {
    let relay = StateRelay()
    let h = try await harness(relay: relay)
    let day = try RowScreen(h.model)
    try await settled(day)
    try await dentistDoneWhileHisWordsGo(h, relay, paused: how == "set aside")
    // Were the apply sent, the server would take his words, then the apply.
    await h.server.add([
      savedAs(try changes(from: 2, to: 3, pages: [todayPage(walk: "Walk!")])), try appliedI2(from: 3, undo: nil),
    ])

    try day.type("!", atEndOf: "Walk")
    day.screen.suggestionTapped("i2", .apply)
    try await soon { relay.kept.contains { !$0.drafts.isEmpty } }
    relay.release()
    try await soon { day.notice != nil }

    #expect(day.notice == Notice(text: "Not applied · changed elsewhere", kind: .failed, undoing: nil), "\(how)")
    #expect(await h.server.sent.allSatisfy { type(of: $0) != "apply-draft" }, "\(how): no apply-draft")
    #expect(day.factsModel.enabled)
    day.close()
  }

  /// His typing removed the row a suggestion follows before its decision went. The web's rule (`placeItem`) puts an
  /// item whose anchor is gone at the planning end, so it is still shown there, and the server places it there too:
  /// the apply is sent.
  @Test func a_suggestion_whose_anchor_he_deleted_goes_to_the_planning_end_and_is_sent() async throws {
    let item =
      #"{"id":"i5","anchor":"w1","place":"after","taskId":"t2","source":"model","state":"open"}"#
    let h = try await harness(draft: draftPage(items: [item]))
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.screen.draftView?.suggestions.map(\.anchorId) == ["w1"])

    let without = todayLines().filter { !$0.contains(#""id":"w1""#) }
    await h.server.add([
      savedAs(try changes(from: 1, to: 2, pages: [page(today, without)])),
      applied(
        try changes(
          from: 2, to: 3,
          pages: [page(today, without + [dentistRow]), draftPage(items: [item.replacingOccurrences(of: "open", with: "applied")])]),
        receipt: said("Applied")),
    ])
    // He removes the anchor row's words, then the row, and taps in the same turn: his words are handed over first.
    let watering = try day.line("Water the plants")
    #expect(watering.becomeFirstResponder())
    watering.selectedRange = NSRange(location: 0, length: (watering.text as NSString).length)
    watering.deleteBackward()
    watering.deleteBackward()
    #expect(!day.words.contains("Water the plants"), "the anchor row is gone from the screen")
    day.screen.suggestionTapped("i5", .apply)
    try await soon { day.notice != nil }

    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor", "apply-draft"])
    #expect(sent.last == (try applyDraft(["i5"])))
    #expect(day.notice?.text == "Applied")
    day.close()
  }

  /// The skip's ticket is read from the state that holds its answer: a newer state that reaches the model before the
  /// decision resumes (another device planned the to-do for tomorrow) does not change what the reopen says it saw.
  @Test func the_skips_ticket_is_read_from_the_state_holding_its_answer() async throws {
    let relay = StateRelay()
    let h = try await harness(relay: relay)
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.hold()
    day.screen.suggestionTapped("i2", .skip)
    let skip = try await answerHeld(h) { operationId in
      relay.hold()
      return applied(
        try changes(from: 1, to: 2, pages: [draftPage(["i2": "skipped"])], undo: operationId), receipt: said("Skipped"))
    }
    await h.engine.settled()
    // Another device planned `Call the dentist` for tomorrow; its state follows the answer's, and both reach the model
    // together.
    let tomorrowPage = page(tomorrow, [row("m2", "t2", "Call the dentist", on: tomorrow)])
    await h.server.add([
      .workspace(
        .full(
          try copy(
            revision: 3, pages: [todayPage(), yesterdayPage, tomorrowPage, draftPage(["i2": "skipped"])], tasks: tasks),
          owner: "one"))
    ])
    await h.model.refresh()
    try await soon { relay.kept.contains { $0.workspace?.revision == 3 } }
    relay.release()
    try await soon { day.notice != nil }
    #expect(day.notice?.undoing == skip)

    await h.server.add([applied(try changes(from: 3, to: 4, pages: [draftPage()]))])
    try day.undo()
    try await soon { day.notice?.text == "Undone" }
    let reopen = try JSON.parse(
      #"{"type":"reopen-draft","pageId":"day:2026-11-26","itemIds":["i2"],"skippedBy":"\#(skip)","seen":{"i2":"2026-11-25"}}"#
    )
    #expect(await h.server.sent.last == reopen)
    day.close()
  }

  @Test(arguments: [DraftDecision.apply, .skip])
  func no_draft_for_this_day_says_changed_elsewhere(_ decision: DraftDecision) async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.add([
      .outcome(.refused(message: "No draft for this day", owner: "one")),
      .workspace(.unchanged(revision: 1, owner: "one")),
    ])
    day.screen.suggestionTapped("i2", decision == .apply ? .apply : .skip)
    try await soon { day.notice != nil }
    let text = decision == .apply ? "Not applied · changed elsewhere" : "Not skipped · changed elsewhere"
    #expect(day.notice == Notice(text: text, kind: .failed, undoing: nil))
    day.close()
  }

  @Test func another_refusal_says_not_done() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.add([
      .outcome(.refused(message: "Not a day page", owner: "one")), .workspace(.unchanged(revision: 1, owner: "one")),
    ])
    day.screen.suggestionTapped("i2", .apply)
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil))
    day.close()
  }

  @Test func apply_all_names_only_the_suggestions_still_shown() async throws {
    let relay = StateRelay()
    let h = try await harness(relay: relay)
    let day = try RowScreen(h.model)
    try await settled(day)
    try await dentistDoneWhileHisWordsGo(h, relay)
    await h.server.add([savedAs(try changes(from: 2, to: 3, pages: [todayPage(walk: "Walk!")]))])
    await h.server.holdCommands()

    try day.type("!", atEndOf: "Walk")
    day.factsModel.applyAllTapped()
    try await soon { relay.kept.contains { !$0.drafts.isEmpty } }
    relay.release()
    try await answerHeld(h) {
      applied(
        try changes(
          from: 3, to: 4,
          pages: [
            todayPage(slot: filledSlot, inserted: [passportRow, chargerRow], walk: "Walk!"),
            draftPage(["i1": "applied", "i3": "applied", "i4": "applied"]),
          ], undo: $0),
        receipt: said("Applied 3"))
    }
    try await soon { day.notice != nil }

    let sent = await h.server.sent
    #expect(sent.map { type(of: $0) } == ["save-editor", "apply-draft"])
    #expect(sent.last == (try applyDraft(["i1", "i3", "i4"])))
    #expect(day.notice?.text == "Applied 3")
    day.close()
  }

  /// The command would be built in yesterday's terms: nothing is sent, as for a row's action and the strip's.
  @Test func a_decision_whose_today_changed_while_his_words_went_sends_nothing() async throws {
    let relay = StateRelay()
    let clock = thursday
    let h = try await harness(clock: clock, relay: relay)
    let day = try RowScreen(h.model)
    try await settled(day)
    await h.server.add([savedAs(try changes(from: 1, to: 2)), try appliedI2(from: 2, undo: nil)])

    relay.hold()
    try day.type("!", atEndOf: "Walk")
    day.screen.suggestionTapped("i2", .apply)
    try await soon { relay.kept.contains { !$0.drafts.isEmpty } }
    // Midnight passes meanwhile.
    clock.date = thursdayNoon.addingTimeInterval(86_400)
    h.model.checkToday()
    try await soon { h.model.today == tomorrow }
    relay.release()
    try await soon { !day.editor.pausesRowActions }
    try await turns()

    // Leaving Thursday sends his words of it at once; the decision is not sent.
    #expect(await h.server.sent.allSatisfy { type(of: $0) != "apply-draft" }, "no apply-draft")
    #expect(day.notice == nil, "the screen shows the new today: nothing is said there of the day before")
    day.close()
  }

  @Test func offline_says_not_done() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    // No reply: the server cannot be reached.
    day.screen.suggestionTapped("i2", .apply)
    try await soon { day.notice != nil }
    #expect(day.notice == Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil))
    #expect(day.factsModel.enabled, "enabled again")
    #expect(!day.editor.pausesRowActions)
    try await settled(day)
    #expect(suggestionIds(day) == everyItem)
    day.close()
  }

  // MARK: One action at a time

  @Test func one_action_at_a_time() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.facts.notToday?.rows.map(\.taskId) == ["t6"])
    #expect(try day.swipeTitles("Water the plants").contains("Tomorrow"))

    await h.server.holdCommands()
    day.screen.suggestionTapped("i2", .apply)
    try await held(h)
    #expect(!day.factsModel.enabled, "the line's buttons and the strip's controls")
    #expect(day.editor.pausesRowActions, "the rows' swipes and every suggestion's buttons")
    #expect(h.model.holdsUndoSlot, "an action is out")

    day.screen.suggestionTapped("i3", .apply)
    day.screen.suggestionTapped("i3", .skip)
    day.factsModel.applyAllTapped()
    day.factsModel.dismissTapped()
    day.factsModel.bringBack("t6")
    #expect(try day.swipeTitles("Water the plants").isEmpty, "no row offers its swipe")
    try await turns()
    #expect(await h.server.sent == [try applyDraft(["i2"])], "nothing else was sent")

    // Typing and ticking go on.
    try day.type("!", atEndOf: "Walk")
    #expect(day.words.contains("Walk!"))
    try day.tick("Water the plants")
    #expect(h.status("t5") == .done)

    await h.server.add([try appliedI2(undo: nil)])
    await h.server.release()
    try await soon { day.notice != nil }
    #expect(day.notice?.text == "Applied")
    #expect(day.factsModel.enabled)
    #expect(!day.editor.pausesRowActions)
    day.close()
  }

  // MARK: set-draft and the Undo slot (Review Focus 3)

  @Test func after_an_apply_set_draft_waits_for_its_undo() async throws {
    let waits = Waits()
    let h = try await harness(asksForDayDrafts: true)
    let day = try RowScreen(h.model, noticeSleep: { try await waits.wait($0) })
    try await settled(day)
    #expect(await h.server.draftDates.isEmpty, "the draft stands: nothing is asked by itself")
    let operationId = try await applyWithUndo(h, day)
    #expect(h.model.holdsUndoSlot, "Applied offers the Undo the slot holds")

    // Retry's answer arrives while he is offered the Undo.
    await h.server.addDrafts([
      .success(DayDraftReply(setDraft: setDraftText, owner: "one", modelOn: true, remakeFailed: false))
    ])
    await h.server.add([applied(try changes(from: 2, to: 3, pages: [draftPage(["i2": "applied"])], undo: "op-draft"))])
    day.factsModel.retryTapped()
    try await soon { h.model.sendsWaitingForUndoSlot == 1 }
    #expect(await h.server.sent.allSatisfy { type(of: $0) != "set-draft" })
    #expect(day.notice?.undoing == operationId)

    try await eventually { await waits.requested == [.seconds(8)] }
    await waits.release(0)
    try await soon { day.notice == nil }
    #expect(!h.model.holdsUndoSlot)
    try await soon { h.model.draftAsk(of: todayId) == .done }
    #expect(await h.server.sent.filter { type(of: $0) == "set-draft" } == [try JSON.parse(setDraftText)])
    day.close()
  }

  // MARK: What the page shows after

  @Test func the_line_counts_what_is_left() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.factsModel.line == .segments(count: "4 suggestions", failed: false, offline: false))

    _ = try await applyWithUndo(h, day)
    try await settled(day)
    #expect(day.factsModel.line == .segments(count: "3 suggestions", failed: false, offline: false))
    day.close()
  }

  @Test func an_applied_carried_to_do_is_an_ordinary_row_with_its_marks() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    await h.server.holdCommands()
    day.screen.suggestionTapped("i1", .apply)
    try await answerHeld(h) {
      applied(
        try changes(from: 1, to: 2, pages: [todayPage(slot: filledSlot), draftPage(["i1": "applied"])], undo: $0),
        receipt: said("Applied"))
    }
    try await soon { day.notice != nil }
    try await settled(day)

    #expect(suggestionIds(day) == ["i2", "i3", "i4"])
    // An apply is not a choice: the clock runs from the day the to-do was made.
    #expect(try day.marks("Book the flights") == "Since Nov 12")
    day.close()
  }

  /// The line leaving (its last suggestion applied) takes the strip away while a line holds the keyboard: nothing else
  /// is in it.
  @Test func the_line_being_typed_stays_when_the_line_leaves() async throws {
    let h = try await harness(
      draft: draftPage(["i2": "skipped", "i3": "skipped", "i4": "skipped"]), tasks: [flights, dentist, water])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.factsModel.line == .segments(count: "1 suggestion", failed: false, offline: false))
    #expect(day.facts.isEmpty, "the line is all the strip shows")
    #expect(!day.factsView.isHidden)
    let list = try #require(day.screen.list)
    list.setContentOffset(CGPoint(x: 0, y: 240 - list.adjustedContentInset.top), animated: false)
    try await settled(day)
    let typed = try day.line("Line 8")
    #expect(typed.becomeFirstResponder())
    try await settled(day)
    let before = typed.convert(typed.bounds, to: nil)

    await h.server.add([
      applied(
        try changes(
          from: 1, to: 2,
          pages: [
            todayPage(slot: filledSlot), draftPage(["i1": "applied", "i2": "skipped", "i3": "skipped", "i4": "skipped"]),
          ]),
        receipt: said("Applied"))
    ])
    day.screen.suggestionTapped("i1", .apply)
    try await soon { day.notice != nil }
    try await settled(day)

    #expect(day.factsModel.line == nil, "the line went")
    #expect(day.factsView.isHidden, "and the strip with it")
    #expect(typed.isFirstResponder, "the keyboard stays up")
    let after = typed.convert(typed.bounds, to: nil)
    #expect(abs(after.minY - before.minY) <= 0.5, "the line was at \(before.minY), now \(after.minY)")
    day.close()
  }

  // MARK: The account and the day

  @Test func an_account_change_while_apply_waits_shows_nothing() async throws {
    let relay = StateRelay()
    let h = try await harness(relay: relay)
    let day = try RowScreen(h.model)
    try await settled(day)
    await h.server.hold()
    day.screen.suggestionTapped("i2", .apply)
    try await answerHeld(h) { operationId in
      relay.hold()
      return try appliedI2(undo: operationId)
    }
    await h.engine.settled()

    // The states that held the answer never reach the model; the next one is another account's, with a draft of the
    // same page id.
    relay.discardKept()
    await h.server.add([
      .workspace(.full(try copy(revision: 7, pages: [todayPage(), draftPage()], tasks: tasks), owner: "two"))
    ])
    await h.model.refresh()
    relay.release()
    try await soon { h.model.state.owner == "two" }
    try await soon { day.factsModel.enabled }
    try await turns()
    #expect(day.notice == nil, "nothing of the first account's decision is said under the second")
    day.close()
  }

  @Test func leaving_today_while_apply_is_out_says_nothing_there() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    await h.server.hold()
    day.screen.suggestionTapped("i2", .apply)
    try await held(h)

    day.screen.open(yesterday)
    try await settled(day)
    #expect(day.words == ["Call the dentist"])
    #expect(day.screen.draftView == nil)

    try await answerHeld(h) { try appliedI2(undo: $0) }
    await h.engine.settled()
    // The decision has ended: the strip works again.
    try await soon { day.factsModel.enabled && !day.editor.pausesRowActions }
    try await turns()
    #expect(day.notice == nil, "nothing is said on this day for today")
    day.close()
  }
}
