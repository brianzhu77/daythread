import DaythreadCore
import DaythreadSync
import Foundation
import Testing

/// What the tests' server does with a day draft's ask, which the screens' tests rely on.
@Suite struct TestServerTests {
  private let date = LocalDate("2026-11-26")!
  private let reply = DayDraftReply(setDraft: nil, owner: "user-1", modelOn: false, remakeFailed: false)

  @Test func a_held_day_draft_waits_for_its_own_release() async throws {
    let server = TestServer()
    await server.holdDrafts()
    let asking = Task { try await server.dayDraft(token: nil, date: date, operationId: "op") }
    await server.draftHeld()
    #expect(await server.waitingCalls == 0, "not held with the other calls")

    // The other calls' release does not let it through; an answer queued while it waits is the one it gets.
    await server.release()
    await server.addDrafts([.success(reply)])
    #expect(await server.waitingDrafts == 1)

    await server.releaseDrafts()
    #expect(try await asking.value == reply)
    #expect(await server.draftDates == [date])
    #expect(await server.unscripted == 0)
  }

  @Test func a_day_draft_with_no_answer_queued_is_offline_and_not_unscripted() async {
    let server = TestServer()
    await #expect(throws: TransportError.offline) {
      try await server.dayDraft(token: nil, date: date, operationId: "op")
    }
    #expect(await server.unscripted == 0)
  }
}
