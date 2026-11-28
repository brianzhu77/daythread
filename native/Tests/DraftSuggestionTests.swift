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
/// The Saturday and Sunday he skipped `Call the dentist` on.
private let saturday = LocalDate("2026-11-21")!
private let sunday = LocalDate("2026-11-22")!
/// Noon UTC on Thursday, Nov 26 2026.
private let thursdayNoon = Date(timeIntervalSince1970: 1_795_694_400)
private let todayId = "day:2026-11-26"
/// The empty to-do the day's template leaves under `TODO`.
private let slotId = "day:2026-11-26:r0"
private let two = Session(token: "token-two", owner: "two", expiresAt: thursdayNoon.addingTimeInterval(86_400 * 30))

private func heading(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"heading","props":{"level":2},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

private func bullet(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"bulletListItem","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

private func said(_ message: String) -> JSONValue { .object(["message": .string(message)]) }

private let emptySlot = row(slotId, "editor-task:\(slotId)", "")
/// The row `i2` becomes once applied, after the slot.
private let dentistRow = row("d-i2", "t2", "Call the dentist")
private let waterRow = row("w1", "t5", "Water the plants")
/// `Water the plants` with a line nested under it.
private let waterWithChild =
  #"{"id":"w1","type":"task","props":{"taskId":"t5","role":"plan","planDate":"2026-11-26"},"content":[{"type":"text","text":"Water the plants","styles":{}}],"children":[\#(line("w1c", "On the balcony"))]}"#

/// Today's page: `TODO`, its slot, what was put after it, `Water the plants`, `Notes`, a line reading `Walk`, then
/// filler, so the page scrolls.
private func todayLines(above: [String] = [], inserted: [String] = [], water: String = waterRow) -> [String] {
  [heading("h0", "TODO")] + above + [emptySlot] + inserted
    + [water, heading("h3", "Notes"), line("a", "Walk")]
    + (1...30).map { line("f\($0)", "Line \($0)") }
}

private func todayPage(above: [String] = [], inserted: [String] = [], water: String = waterRow) -> JSONValue {
  page(today, todayLines(above: above, inserted: inserted, water: water))
}

private let yesterdayPage = page(yesterday, [line("y1", "Yesterday's line")])

/// Saturday's and Sunday's pages, each with a draft whose `Call the dentist` he skipped.
private let skippedDays: [JSONValue] = [saturday, sunday].flatMap { day in
  [
    page(day, [line("l-\(day.value)", "A line")]),
    draft(
      of: "day:\(day.value)",
      items: [#"{"id":"s-\#(day.value)","anchor":"x","place":"after","taskId":"t2","source":"model","state":"skipped"}"#]),
  ]
}

/// Today's draft items, open unless `states` names them: `i1` carries `Book the flights` into the empty slot, `i2`
/// carries `Call the dentist` after it, `i3` is a new to-do `Renew the passport`, `i4` a bullet `Pack the charger`.
private func draftItems(_ states: [String: String] = [:]) -> [String] {
  func state(_ id: String) -> String { states[id] ?? "open" }
  return [
    #"{"id":"i1","anchor":"\#(slotId)","place":"fill","taskId":"t1","source":"model","state":"\#(state("i1"))"}"#,
    #"{"id":"i2","anchor":"\#(slotId)","place":"after","taskId":"t2","source":"model","state":"\#(state("i2"))"}"#,
    #"{"id":"i3","anchor":"\#(slotId)","place":"after","block":\#(row("b-i3", "", "Renew the passport")),"source":"model","state":"\#(state("i3"))"}"#,
    #"{"id":"i4","anchor":"\#(slotId)","place":"after","block":\#(bullet("b-i4", "Pack the charger")),"source":"model","state":"\#(state("i4"))"}"#,
  ]
}

/// A bullet `Buy soil` after `Water the plants`.
private let afterWater =
  #"{"id":"i5","anchor":"w1","place":"after","block":\#(bullet("b-i5", "Buy soil")),"source":"model","state":"open"}"#

/// The draft of `dayPageId` as the server stores it.
private func draft(of dayPageId: String = todayId, status: String = "ready", items: [String]) -> JSONValue {
  .object([
    "id": .string("draft:\(dayPageId)"), "type": .string("draft"), "parentId": .string(dayPageId),
    "title": .string(""),
    "document": .string(
      #"{"status":"\#(status)","recipe":\#(DayDraft.currentRecipe),"moreOpen":[],"items":[\#(items.joined(separator: ","))]}"#
    ),
  ])
}

private func draftPage(_ states: [String: String] = [:]) -> JSONValue { draft(items: draftItems(states)) }

private func withCreatedOn(_ task: JSONValue, _ day: String) -> JSONValue {
  var object = task.objectValue!
  object["createdOn"] = .string(day)
  return .object(object)
}

private let flights = withCreatedOn(task("t1", "Book the flights"), "2026-11-12")
private let dentist = withCreatedOn(task("t2", "Call the dentist"), "2026-11-19")
private let water = task("t5", "Water the plants")
private let tasks = [flights, dentist, water]

private let everyItem = ["i1", "i2", "i3", "i4"]

/// The `set-draft` a Retry's answer hands back, as JSON text.
private let setDraftText =
  #"{"type":"set-draft","pageId":"day:2026-11-26","status":"ready","moreOpen":[],"allowedTaskIds":["t2"],"recipe":5,"items":[]}"#

/// How suggestions arrive above the line he types in (Review Focus 1).
enum SuggestionArrival: String, CaseIterable, Sendable {
  /// A state brings today's draft.
  case aStateBringsTheDraft
  /// An apply's answer takes its suggestion out and brings its row in its place.
  case anApplyBringsItsRow
  /// Retry's draft replaces a failed one.
  case retryReplacesAFailedDraft
}

/// §13.5, §13.6: the draft's suggestions, rows of today's page that are not its lines, each where applying it would
/// put its row, with its `checkmark` and `xmark`.
@MainActor
@Suite(.serialized) struct DraftSuggestionTests {
  private var thursday: Clock {
    let clock = Clock()
    clock.date = thursdayNoon
    return clock
  }

  private func harness(
    pages: [JSONValue]? = nil, asksForDayDrafts: Bool = false, relay: StateRelay? = nil
  ) async throws -> Harness {
    try await Harness(
      copy: try copy(pages: pages ?? ([todayPage(), yesterdayPage, draftPage()] + skippedDays), tasks: tasks),
      clock: thursday, sleep: neverEnding, relay: relay, asksForDayDrafts: asksForDayDrafts, draftSleep: neverEnding)
  }

  /// Lets the run loop turn, so the strip's height reaches the list, then lays the screen out.
  private func settled(_ day: RowScreen) async throws {
    day.drawn()
    try await turns()
    day.drawn()
  }

  /// Loads `pages` as the server's copy at `revision` and waits for the screen to draw it.
  private func load(_ h: Harness, _ day: RowScreen, revision: Int, pages: [JSONValue]) async throws {
    await h.server.add([.workspace(.full(try copy(revision: revision, pages: pages, tasks: tasks), owner: "one"))])
    await h.model.refresh()
    try await soon { h.model.state.workspace?.revision == revision }
    try await settled(day)
  }

  private func held(_ h: Harness, sourceLocation: SourceLocation = #_sourceLocation) async throws {
    try await eventually({ await h.server.waitingCalls > 0 }, sourceLocation: sourceLocation)
  }

  @discardableResult
  private func answerHeld(_ h: Harness, _ reply: (String) throws -> TestServer.Reply) async throws -> String {
    try await held(h)
    let operationId = try #require(await h.server.operationIds.last)
    await h.server.add([try reply(operationId)])
    await h.server.release()
    return operationId
  }

  /// What the server answers the apply of `i2`: its row after the slot, the item applied.
  private func appliedI2(undo operationId: String?) throws -> TestServer.Reply {
    applied(
      try changes(
        from: 1, to: 2, pages: [todayPage(inserted: [dentistRow]), draftPage(["i2": "applied"])], undo: operationId),
      receipt: said("Applied"))
  }

  /// The list's items, a line as its id and a guest as `+<id>`.
  private func items(_ day: RowScreen) -> [String] {
    day.editor.orderedItems.map { item in
      switch item {
      case .line(let id): id
      case .guest(let id): "+" + id
      }
    }
  }

  /// The guests the list draws, in order.
  private func guests(_ day: RowScreen) -> [String] {
    day.editor.orderedItems.compactMap { item in
      if case .guest(let id) = item { id } else { nil }
    }
  }

  /// The cell the list draws guest `id` in.
  private func guestCell(_ day: RowScreen, _ id: String) throws -> GuestRowCell {
    day.drawn()
    let list = try #require(day.screen.list)
    let item = try #require(day.editor.orderedItems.firstIndex(of: .guest(id)), "no guest \(id)")
    let indexPath = IndexPath(item: item, section: 0)
    list.scrollToItem(at: indexPath, at: .centeredVertically, animated: false)
    list.layoutIfNeeded()
    return try #require(list.cellForItem(at: indexPath) as? GuestRowCell, "guest \(id) is not drawn as a guest")
  }

  /// The small text under a guest's words.
  private func detail(_ cell: GuestRowCell) -> NSAttributedString? {
    (cell.contentConfiguration as? UIListContentConfiguration)?.secondaryAttributedText
  }

  private func type(of action: JSONValue) -> String? { action.objectValue?["type"]?.stringValue }

  // MARK: Where they are drawn

  @Test func the_suggestions_are_drawn_where_the_view_places_them() async throws {
    let h = try await harness(
      pages: [todayPage(water: waterWithChild), yesterdayPage, draft(items: draftItems() + [afterWater])] + skippedDays)
    let day = try RowScreen(h.model)
    try await settled(day)

    let shown = try #require(day.screen.draftView?.suggestions.map(\.id))
    #expect(shown == everyItem + ["i5"])
    #expect(guests(day) == shown)
    // Each after the last row of its anchor's whole block: the slot's own row, and the line nested under `Water the
    // plants`.
    #expect(
      Array(items(day).prefix(10)) == ["h0", slotId, "+i1", "+i2", "+i3", "+i4", "w1", "w1c", "+i5", "h3"],
      "\(items(day).prefix(10))")
    #expect(day.factsModel.line == .segments(count: "5 suggestions", failed: false, offline: false))
    day.close()
  }

  @Test func a_fill_suggestion_is_drawn_after_its_empty_row() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let listed = items(day)
    let slot = try #require(listed.firstIndex(of: slotId), "the empty slot is still a row")
    #expect(listed[slot + 1] == "+i1")
    let list = try #require(day.screen.list)
    #expect(list.cellForItem(at: IndexPath(item: slot, section: 0)) is TodoBlockCell, "drawn as his own to-do row")
    day.close()
  }

  @Test func a_suggestion_shows_its_age_or_its_skipped_days() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    let flights = try guestCell(day, "i1")
    #expect(detail(flights)?.string == "Thu 11/12", "the day its to-do was made")
    #expect(flights.accessibilityLabel == "Suggestion, Book the flights, Thu 11/12")

    let dentist = try guestCell(day, "i2")
    #expect(detail(dentist)?.string == "skipped Sat, Sun")
    #expect(dentist.accessibilityLabel == "Suggestion, Call the dentist, skipped Sat 11/21, Sun 11/22")
    #expect(dentist.button(symbol: "checkmark")?.accessibilityLabel == "Apply Call the dentist")
    #expect(dentist.button(symbol: "xmark")?.accessibilityLabel == "Skip Call the dentist")
    #expect(dentist.accessibilityCustomActions?.map(\.name) == ["Apply", "Skip"])

    let passport = try guestCell(day, "i3")
    #expect(detail(passport) == nil, "a new to-do has no age")
    #expect(passport.accessibilityLabel == "Suggestion, Renew the passport")
    day.close()
  }

  @Test func no_suggestions_on_another_day_or_on_today_in_trash() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(guests(day) == everyItem)

    day.screen.open(yesterday)
    try await settled(day)
    #expect(day.words == ["Yesterday's line"])
    #expect(guests(day).isEmpty)

    day.screen.open(nil)
    try await settled(day)
    #expect(guests(day) == everyItem, "today again")
    day.close()

    var trashed = todayPage().objectValue!
    trashed["trashedAt"] = .string("2026-11-26T08:00:00.000Z")
    trashed["trashId"] = .string("batch-1")
    let inTrash = try await harness(pages: [.object(trashed), draftPage()])
    let trashDay = try RowScreen(inTrash.model)
    try await settled(trashDay)
    #expect(trashDay.screen.draftView == nil)
    #expect(guests(trashDay).isEmpty)
    trashDay.close()
  }

  // MARK: What changes them

  @Test func the_suggestion_leaves_in_the_update_that_brings_its_row() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let place = try #require(day.editor.orderedItems.firstIndex(of: .guest("i2")))

    await h.server.holdCommands()
    let checkmark = try #require(try guestCell(day, "i2").button(symbol: "checkmark"))
    checkmark.sendActions(for: .primaryActionTriggered)
    try await held(h)
    let snapshots = day.editor.appliedSnapshots
    try await answerHeld(h) { try appliedI2(undo: $0) }
    try await soon { day.notice != nil }
    try await settled(day)

    #expect(await h.server.sent.last?.objectValue?["itemIds"] == .array([.string("i2")]), "its checkmark applied it")
    #expect(day.editor.appliedSnapshots == snapshots + 1, "one list update")
    #expect(day.editor.orderedItems.firstIndex(of: .line("d-i2")) == place, "its row is where it was: \(items(day))")
    #expect(!guests(day).contains("i2"))
    day.close()
  }

  @Test func typing_does_not_read_the_draft() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let reads = day.screen.draftReads
    let published = h.model.state.published
    #expect(Array(items(day).prefix(7)) == ["h0", slotId, "+i1", "+i2", "+i3", "+i4", "w1"])

    // `Water the plants` nested under the slot: the slot's block now ends with it.
    let water = try day.line("Water the plants")
    #expect(water.becomeFirstResponder())
    water.perform(NSSelectorFromString("pressTab"))
    day.drawn()
    #expect(h.model.state.published == published, "no state has arrived")
    #expect(day.screen.draftReads == reads)
    #expect(Array(items(day).prefix(7)) == ["h0", slotId, "+i1", "+i2", "+i3", "+i4", "w1"], "drawn where they were")

    try await soon { h.model.state.published != published }
    try await settled(day)
    #expect(day.screen.draftReads > reads, "read once a state arrives")
    #expect(Array(items(day).prefix(7)) == ["h0", slotId, "w1", "+i1", "+i2", "+i3", "+i4"], "\(items(day).prefix(7))")
    day.close()
  }

  /// Review Focus 1: suggestions arriving, leaving or changing above the line he types in, also while he composes.
  @Test(arguments: SuggestionArrival.allCases, [false, true])
  func a_state_that_brings_suggestions_keeps_the_typed_line_where_it_is(
    _ arrival: SuggestionArrival, composing: Bool
  ) async throws {
    let failed = draft(status: "failed", items: Array(draftItems().suffix(2)))
    let h = try await harness(
      pages: [
        todayPage(), yesterdayPage,
        arrival == .aStateBringsTheDraft ? nil : arrival == .retryReplacesAFailedDraft ? failed : draftPage(),
      ].compactMap { $0 } + skippedDays,
      asksForDayDrafts: arrival == .retryReplacesAFailedDraft)
    let day = try RowScreen(h.model)
    try await settled(day)
    // Line 8 on screen, under the suggestions, however tall they are.
    #expect(day.editor.scroll(toRow: "f8", animated: false))
    try await settled(day)
    let typed = try day.line("Line 8")
    #expect(typed.becomeFirstResponder())
    typed.selectedRange = NSRange(location: (typed.text as NSString).length, length: 0)
    try await settled(day)
    func compose() {
      guard composing else { return }
      typed.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
    }
    let before = typed.convert(typed.bounds, to: nil)
    let guestsBefore = guests(day)

    switch arrival {
    case .aStateBringsTheDraft:
      compose()
      try await load(h, day, revision: 2, pages: [todayPage(), yesterdayPage, draftPage()] + skippedDays)
    case .anApplyBringsItsRow:
      await h.server.holdCommands()
      day.screen.suggestionTapped("i2", .apply)
      try await held(h)
      // The tap committed what he composed; he composes again while the answer is on its way.
      compose()
      try await answerHeld(h) { try appliedI2(undo: $0) }
      try await soon { day.notice != nil }
      try await settled(day)
    case .retryReplacesAFailedDraft:
      await h.server.addDrafts([
        .success(DayDraftReply(setDraft: setDraftText, owner: "one", modelOn: true, remakeFailed: false))
      ])
      await h.server.add([applied(try changes(from: 1, to: 2, pages: [draftPage()]))])
      compose()
      day.factsModel.retryTapped()
      try await soon { h.model.state.workspace?.revision == 2 }
      try await settled(day)
    }

    #expect(guests(day) != guestsBefore, "the suggestions changed: \(guestsBefore) to \(guests(day))")
    #expect(typed.isFirstResponder, "the keyboard stays up")
    let after = typed.convert(typed.bounds, to: nil)
    #expect(abs(after.minY - before.minY) <= 0.5, "the line was at \(before.minY), now \(after.minY)")
    if composing {
      #expect(typed.markedTextRange != nil, "the composition goes on")
      #expect(typed.text == "Line 8今")
    }
    day.close()
  }

  @Test func a_merge_moves_the_suggestions_with_the_page() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    try day.type("!", atEndOf: "Walk")
    try await soon { !h.model.state.drafts.isEmpty }
    try await settled(day)
    let reads = day.screen.draftReads

    // Another device put a line above the slot before his words were saved; the merged page's save is held.
    await h.server.holdSaves()
    let theirs = todayPage(above: [line("n1", "Pack lunch")])
    await h.server.add([
      .workspace(
        .full(try copy(revision: 2, pages: [theirs, yesterdayPage, draftPage()] + skippedDays, tasks: tasks), owner: "one"))
    ])
    await h.model.refresh()
    try await eventually { await h.server.waitingCalls == 1 }
    try await settled(day)

    #expect(day.words.contains("Walk!") && day.words.contains("Pack lunch"), "\(day.words)")
    #expect(day.screen.draftReads > reads, "read again for the merged page")
    #expect(
      Array(items(day).prefix(8)) == ["h0", "n1", slotId, "+i1", "+i2", "+i3", "+i4", "w1"], "\(items(day).prefix(8))")
    day.close()
    await h.server.release()
  }

  @Test func a_suggestion_whose_anchor_he_deleted_waits_for_the_next_state() async throws {
    let h = try await harness(pages: [todayPage(), yesterdayPage, draft(items: draftItems() + [afterWater])] + skippedDays)
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(items(day).contains("+i5"))
    let published = h.model.state.published

    let water = try day.line("Water the plants")
    #expect(water.becomeFirstResponder())
    water.selectedRange = NSRange(location: 0, length: (water.text as NSString).length)
    water.deleteBackward()
    water.deleteBackward()
    day.drawn()
    #expect(!day.words.contains("Water the plants"), "the row is gone from the screen")
    #expect(h.model.state.published == published, "no state has arrived")
    #expect(!guests(day).contains("i5"), "not drawn until the next state")

    try await soon { h.model.state.published != published }
    try await settled(day)
    // The planning part's end: right after `TODO`, as the slot is no to-do of the workspace.
    #expect(Array(items(day).prefix(3)) == ["h0", "+i5", slotId], "\(items(day).prefix(3))")
    day.close()
  }

  // MARK: While one is acting

  @Test func the_tapped_suggestion_is_dimmed_and_every_suggestion_held() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(try detail(guestCell(day, "i2"))?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor
      == .secondaryLabel)

    await h.server.holdCommands()
    try #require(try guestCell(day, "i2").button(symbol: "checkmark")).sendActions(for: .primaryActionTriggered)
    try await held(h)
    day.drawn()
    #expect(day.editor.actingRow == "i2")
    #expect(try detail(guestCell(day, "i2"))?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor
      == .tertiaryLabel, "dimmed")
    #expect(try detail(guestCell(day, "i1"))?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor
      == .secondaryLabel, "only the one acting")

    try #require(try guestCell(day, "i3").button(symbol: "checkmark")).sendActions(for: .primaryActionTriggered)
    try #require(try guestCell(day, "i4").button(symbol: "xmark")).sendActions(for: .primaryActionTriggered)
    try await turns()
    #expect(await h.server.sent.map { type(of: $0) } == ["apply-draft"], "nothing else is sent")

    try await answerHeld(h) { try appliedI2(undo: $0) }
    try await soon { day.notice != nil }
    try await settled(day)
    #expect(day.editor.actingRow == nil)
    day.close()
  }

  @Test func an_account_change_takes_the_suggestions_away() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(guests(day) == everyItem)

    await h.server.add([.done])
    #expect(await h.model.signOut(discardingUnsent: true) == .signedOut)
    try await soon { h.model.state.workspace == nil }
    try await settled(day)
    #expect(guests(day).isEmpty, "no copy shown: no suggestion of the first account")

    // Their today has the same page id and no draft.
    let theirs = try copy(revision: 5, pages: [todayPage()], tasks: tasks)
    await h.server.add([.session(two), .workspace(.full(theirs, owner: "two"))])
    #expect(await h.model.signIn(email: "two@example.com", password: "secret") == nil)
    try await soon { h.model.state.owner == "two" && h.model.state.workspace != nil }
    try await settled(day)
    #expect(day.words.contains("Walk"))
    #expect(guests(day).isEmpty)
    day.close()
  }

  /// No row of the app's own can be typed with another to-do's id: the row comes in the server's copy, as typed on
  /// another device.
  @Test func a_suggestion_typed_onto_the_page_leaves() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(guests(day) == everyItem)

    try await load(
      h, day, revision: 2, pages: [todayPage(inserted: [dentistRow]), yesterdayPage, draftPage()] + skippedDays)
    #expect(day.words.contains("Call the dentist"))
    #expect(guests(day) == ["i1", "i3", "i4"], "its to-do has its row on the page")
    day.close()
  }

  // MARK: Screenshots

  /// A screenshot host, not a test: today's page with three suggestions under the draft's line, on the simulator's
  /// real screen, held while a shell loop on the Mac takes `xcrun simctl io <udid> screenshot` (it writes `<name>.done`
  /// beside the `<name>.ready` this writes, in the folder `DRAFT_SUGGESTION_SHOTS` names). Runs only when asked:
  /// `TEST_RUNNER_DRAFT_SUGGESTION_SHOTS=<folder> xcodebuild test … -only-testing:DaythreadTests/DraftSuggestionTests`.
  @Test(.enabled(if: !(ProcessInfo.processInfo.environment["DRAFT_SUGGESTION_SHOTS"] ?? "").isEmpty))
  func screenshots_of_the_suggestions() async throws {
    let folder = ProcessInfo.processInfo.environment["DRAFT_SUGGESTION_SHOTS"] ?? ""
    // A carried to-do after a to-do row, one he skipped on Saturday and Sunday, and a line.
    let three = [
      #"{"id":"i1","anchor":"w1","place":"after","taskId":"t1","source":"model","state":"open"}"#,
      #"{"id":"i2","anchor":"w1","place":"after","taskId":"t2","source":"model","state":"open"}"#,
      #"{"id":"i4","anchor":"w1","place":"after","block":\#(line("b-i4", "Pack the charger")),"source":"model","state":"open"}"#,
    ]
    let looks: [(name: String, style: UIUserInterfaceStyle, size: UIContentSizeCategory, acting: Bool)] = [
      ("t12-light-default", .light, .large, false),
      ("t12-dark-default", .dark, .large, false),
      ("t12-light-ax5", .light, .accessibilityExtraExtraExtraLarge, false),
      ("t12-dark-ax5", .dark, .accessibilityExtraExtraExtraLarge, false),
      ("t12-light-default-acting", .light, .large, true),
    ]
    for look in looks {
      let h = try await harness(pages: [todayPage(), yesterdayPage, draft(items: three)] + skippedDays)
      let day = try RowScreen(h.model, size: look.size)
      let scene = try #require(day.window.windowScene)
      day.window.frame = scene.screen.bounds
      day.window.windowLevel = .alert + 1
      day.window.overrideUserInterfaceStyle = look.style
      try await settled(day)
      if look.size.isAccessibilityCategory {
        // At the largest size the suggestions lie under the fold: the page is scrolled to them.
        day.editor.scroll(toRow: "w1", animated: false)
        try await settled(day)
      }
      if look.acting {
        await h.server.hold()
        day.screen.suggestionTapped("i2", .apply)
        try await held(h)
      }
      try await settled(day)
      let ready = URL(fileURLWithPath: "\(folder)/\(look.name).ready")
      let done = URL(fileURLWithPath: "\(folder)/\(look.name).done")
      try? FileManager.default.removeItem(at: done)
      try Data().write(to: ready)
      for _ in 0..<200 where !FileManager.default.fileExists(atPath: done.path) {
        try await Task.sleep(nanoseconds: 100_000_000)
      }
      #expect(FileManager.default.fileExists(atPath: done.path), "no screenshot of \(look.name)")
      try? FileManager.default.removeItem(at: ready)
      if look.acting {
        await h.server.add([.outcome(.refused(message: "Nothing to apply", owner: "one"))])
        await h.server.release()
      }
      day.close()
    }
  }
}
