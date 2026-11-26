import DaythreadCore
import DaythreadSync
import Foundation
import Testing
import UIKit

@testable import DaythreadUI

private func task(_ id: String, _ title: String, _ status: String, doneOn: String? = nil) -> String {
  let done = doneOn.map { #""\#($0)""# } ?? "null"
  return #"{"id":"\#(id)","title":"\#(title)","status":"\#(status)","paused":false,"doneOn":\#(done),"version":1}"#
}

/// A copy with a page for `day`, so the engine asks for none, and an open, a done and a cancelled to-do.
private func copy(revision: Int = 1, timezone: String = "UTC", day: String = "2026-11-25") throws -> Workspace {
  let page = #"{"id":"day:\#(day)","type":"daily","date":"\#(day)","title":"","document":"[]"}"#
  let tasks = [
    task("t-open", "Water the plants", "open"), task("t-done", "Call the bank", "done", doneOn: "2026-11-24"),
    task("t-cancelled", "Fix the gate", "cancelled"),
  ]
  let text =
    #"{"revision":\#(revision),"timezone":"\#(timezone)","pages":[\#(page)],"tasks":[\#(tasks.joined(separator: ","))]}"#
  return try #require(Workspace(try JSON.parse(text)))
}

/// What the server answers for the open to-do ticked on revision 1.
private func ticked() throws -> WorkspaceChanges {
  let row = task("t-open", "Water the plants", "done", doneOn: "2026-11-25").replacingOccurrences(
    of: #""version":1"#, with: #""version":2"#)
  let text =
    #"{"from":1,"revision":2,"timezone":"UTC","pages":{"upsert":[],"remove":[]},"#
    + #""tasks":{"upsert":[\#(row)],"remove":[]}}"#
  return try #require(WorkspaceChanges(try JSON.parse(text)))
}

private let two = Session(token: "token-two", owner: "two", expiresAt: noon.addingTimeInterval(86_400 * 30))

/// What was drawn each time the engine published.
@MainActor
private final class Samples {
  var statuses: [TodoTask.Status?] = []
}

/// A tap changes what is drawn in the turn it is made, and what is drawn never goes back before the server answers.
@MainActor
@Suite struct TickTests {
  @Test func the_drawn_workspace_has_the_tick_when_tick_returns() async throws {
    let h = try await Harness(copy: try copy())

    #expect(h.model.tick(taskId: "t-open"))

    #expect(h.status("t-open") == .done)
    #expect(h.model.state.workspace?.task("t-open")?.status == .open)
  }

  @Test func it_stays_ticked_through_the_engines_acceptance_and_the_servers_answer() async throws {
    let h = try await Harness(copy: try copy())
    await h.server.add([.outcome(.applied(receipt: .object([:]), changes: try ticked(), owner: "one"))])
    await h.server.hold()

    #expect(h.model.tick(taskId: "t-open"))
    let samples = Samples()
    let states = h.engine.states
    let sampling = Task { [model = h.model] in
      for await _ in states { samples.statuses.append(model.workspace?.task("t-open")?.status) }
    }
    await h.server.callHeld()
    try await until { [model = h.model] in model.state.pending == 1 }
    #expect(h.status("t-open") == .done)
    await h.server.release()
    await h.engine.settled()
    try await until { [model = h.model] in model.state.workspace?.revision == 2 }
    sampling.cancel()

    #expect(!samples.statuses.isEmpty)
    #expect(samples.statuses.allSatisfy { $0 == .done })
    #expect(h.status("t-open") == .done)
    // Nothing of the tap is replayed once the server's copy holds it.
    #expect(h.model.workspace == h.model.state.workspace)
  }

  @Test func a_tap_on_a_done_to_do_reopens_it() async throws {
    let h = try await Harness(copy: try copy())

    #expect(h.model.tick(taskId: "t-done"))

    #expect(h.status("t-done") == .open)
    #expect(h.model.workspace?.task("t-done")?.doneOn == nil)
  }

  @Test func a_cancelled_to_do_is_not_ticked() async throws {
    let h = try await Harness(copy: try copy())

    #expect(!h.model.tick(taskId: "t-cancelled"))

    #expect(h.status("t-cancelled") == .cancelled)
    #expect(h.model.workspace == h.model.state.workspace)
  }

  @Test func a_to_do_the_copy_lacks_is_not_ticked() async throws {
    let h = try await Harness(copy: try copy())

    #expect(!h.model.tick(taskId: "t-missing"))

    #expect(h.model.workspace == h.model.state.workspace)
  }

  @Test func a_second_tap_within_half_a_second_is_dropped_and_a_later_one_is_not() async throws {
    let clock = Clock()
    let h = try await Harness(copy: try copy(), clock: clock)

    #expect(h.model.tick(taskId: "t-open"))
    clock.date = noon.addingTimeInterval(0.3)
    #expect(!h.model.tick(taskId: "t-open"))
    #expect(h.status("t-open") == .done)
    // Another to-do has its own guard.
    #expect(h.model.tick(taskId: "t-done"))
    clock.date = noon.addingTimeInterval(0.6)
    #expect(h.model.tick(taskId: "t-open"))
    #expect(h.status("t-open") == .open)
  }

  @Test func a_change_the_engine_could_not_store_goes_back_to_what_the_copy_has() async throws {
    let h = try await Harness(copy: try copy())
    await h.store.refuseAppend()

    #expect(h.model.tick(taskId: "t-open"))
    #expect(h.status("t-open") == .done)

    try await until { [h] in h.status("t-open") == .open }
    #expect(h.model.workspace == h.model.state.workspace)
    #expect(h.model.state.pending == 0)
  }

  @Test func signing_out_drops_every_record() async throws {
    let h = try await Harness(copy: try copy())
    // A refresh holds the engine inside a store write, so the tick waits to be accepted.
    await h.store.holdReplace()
    await h.server.add([.workspace(.full(try copy(), owner: "one")), .done])
    let refreshing = Task { [model = h.model] in await model.refresh() }
    await h.store.replaceHeld()

    #expect(h.model.tick(taskId: "t-open"))
    #expect(h.status("t-open") == .done)
    let signingOut = Task { [model = h.model] in await model.signOut(discardingUnsent: true) }
    await h.store.releaseReplace()
    #expect(await signingOut.value == .signedOut)
    await refreshing.value
    try await until { [model = h.model] in model.state.phase == .signedOut }
    await h.engine.settled()
    #expect(h.model.workspace == nil)
    // The tick may have gone to the server under its own account before the sign-out; nothing goes after it.
    let sentBefore = await h.server.sent.count

    // Another account whose copy has a to-do with the same id, open.
    await h.server.add([.session(two), .workspace(.full(try copy(), owner: "two"))])
    #expect(await h.model.signIn(email: "two@example.com", password: "secret") == nil)
    try await until { [model = h.model] in model.state.workspace != nil }
    await h.engine.settled()

    #expect(h.status("t-open") == .open)
    #expect(h.model.workspace == h.model.state.workspace)
    #expect(h.model.state.pending == 0)
    #expect(h.model.state.held.isEmpty)
    #expect(await h.server.sent.count == sentBefore)
  }

  @Test func the_tick_is_dated_the_accounts_day() async throws {
    // At noon UTC it is already Thursday in Kiritimati (UTC+14), whatever the device's zone.
    let h = try await Harness(copy: try copy(timezone: "Pacific/Kiritimati", day: "2026-11-26"))
    await h.server.hold()

    #expect(h.model.today == LocalDate("2026-11-26"))
    #expect(h.model.tick(taskId: "t-open"))
    await h.server.callHeld()

    let sent = await h.server.sent
    #expect(sent.count == 1)
    #expect(sent.first?.objectValue?["today"]?.stringValue == h.model.today.value)
    await h.server.release()
  }
}

/// The day screen with the server holding every reply: a tap on the circle, through the screen, the model and the
/// engine, is drawn in the cell before the turn ends.
@MainActor
@Suite struct DayTickTests {
  /// Today's page holding the open to-do as its one block.
  private func copyWithTheToDoOnTodaysPage() throws -> Workspace {
    let block = Block(
      id: "b1", type: "task", props: ["taskId": .string("t-open")],
      content: .array([.object(["type": .string("text"), "text": .string("Water the plants"), "styles": .object([:])])]),
      children: [])
    let page: JSONValue = .object([
      "id": .string("day:2026-11-25"), "type": .string("daily"), "date": .string("2026-11-25"), "title": .string(""),
      "document": .string(Document.write([block])),
    ])
    let todo = task("t-open", "Water the plants", "open")
    let text = #"{"revision":1,"timezone":"UTC","pages":[\#(JSON.write(page))],"tasks":[\#(todo)]}"#
    return try #require(Workspace(try JSON.parse(text)))
  }

  private func circle(in view: UIView) -> UIButton? {
    if let button = view as? UIButton, button.accessibilityLabel == "Complete Water the plants" { return button }
    return view.subviews.lazy.compactMap { circle(in: $0) }.first
  }

  @Test func a_tap_on_the_circle_is_drawn_in_the_same_turn() async throws {
    let h = try await Harness(copy: try copyWithTheToDoOnTodaysPage())
    await h.server.hold()
    let screen = DayViewController(model: h.model)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    window.rootViewController = screen
    window.makeKeyAndVisible()
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()
    screen.view.layoutIfNeeded()
    let before = try #require(circle(in: screen.view), "no circle for the to-do")
    #expect(before.accessibilityValue == "not done")

    before.sendActions(for: .primaryActionTriggered)

    // Before any await, so the engine has not even stored the entry. Read before a layout pass too: a layout pass
    // runs the screen's observed update, which would redraw it even if the tap's own redraw were gone.
    #expect(before.accessibilityValue == "done", "redrawn by the tap itself")
    screen.view.layoutIfNeeded()
    let after = try #require(circle(in: screen.view))
    #expect(after === before, "the same cell, redrawn in place")
    #expect(after.accessibilityValue == "done")
    let done = try #require(UIImage(systemName: "checkmark.circle.fill"))
    #expect(after.configuration?.image?.isEqual(done) == true)

    // Not waited for: with the wiring broken nothing reaches the server, and the test must still end.
    await h.server.release()
    await h.engine.settled()
  }
}
