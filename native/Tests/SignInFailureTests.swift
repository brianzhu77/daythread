import DaythreadCore
import DaythreadSync
@testable import DaythreadUI
import Foundation
import Testing

/// A server whose sign-in fails with `error`, writing down the zone it was given. Nothing else is asked of it here.
private actor RefusingServer: ServerTransport {
  let error: TransportError
  private(set) var timezones: [String] = []

  init(_ error: TransportError) {
    self.error = error
  }

  func signIn(email: String, password: String, timezone: String) async throws -> Session {
    timezones.append(timezone)
    throw error
  }

  func signOut(token: String) async throws { throw TransportError.offline }
  func account(token: String?) async throws -> Account { throw TransportError.offline }
  func workspace(token: String?, have: Int?) async throws -> WorkspaceReply { throw TransportError.offline }
  func send(
    token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis
  ) async throws -> CommandOutcome { throw TransportError.offline }
  func save(
    token: String?, operationId: String, expectedRevision: Int, expectedOwner: String, action: JSONValue
  ) async throws -> SaveOutcome { throw TransportError.offline }
  func dayDraft(token: String?, date: LocalDate, operationId: String) async throws -> DayDraftReply {
    throw TransportError.offline
  }
}

@MainActor
private func model(_ server: RefusingServer) throws -> AppModel {
  // Sign-in fails before anything is stored, so the token store is never written.
  let engine = SyncEngine(
    transport: server, tokens: KeychainTokenStore(service: "app.daythread.tests.unused.\(UUID().uuidString)"),
    store: try SwiftDataWorkspaceStore.open(at: nil))
  return AppModel(engine: engine, keepsChanges: true, now: Date.init, states: nil, asksForDayDrafts: false)
}

@MainActor
@Suite struct SignInFailureTests {
  @Test(arguments: [
    (TransportError.refused(status: 401, reason: "wrong"), SignInFailure.wrong),
    (.refused(status: 401, reason: "unconfirmed"), .unconfirmed),
    (.refused(status: 403, reason: "not-invited"), .notInvited),
    (.wait(seconds: 240), .wait(seconds: 240)),
    (.offline, .offline),
    (.refused(status: 403, reason: "wrong"), .unavailable),
    (.refused(status: 401, reason: "not-invited"), .unavailable),
    (.refused(status: 400, reason: nil), .unavailable),
    (.signedOut, .unavailable),
    (.server(status: 503), .unavailable),
    (.unreadable, .unavailable),
  ])
  func eachRefusalHasItsFailure(error: TransportError, failure: SignInFailure) async throws {
    let signIn = try model(RefusingServer(error))
    #expect(await signIn.signIn(email: "someone@example.com", password: "secret") == failure)
  }

  @Test func signsInWithTheDevicesZone() async throws {
    let server = RefusingServer(.offline)
    _ = try await model(server).signIn(email: "someone@example.com", password: "secret")
    #expect(await server.timezones == [TimeZone.current.identifier])
  }
}
