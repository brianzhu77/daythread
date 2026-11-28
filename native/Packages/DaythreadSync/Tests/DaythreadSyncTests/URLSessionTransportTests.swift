import DaythreadCore
import Foundation
import Testing

@testable import DaythreadSync

private let workspaceJSON = #"{"revision":7,"timezone":"UTC","pages":[],"tasks":[]}"#
private let changesJSON =
  #"{"from":7,"revision":8,"timezone":"UTC","pages":{"upsert":[],"remove":[]},"tasks":{"upsert":[],"remove":[]}}"#
private let basis = OutboxBasis(baseRevision: 7, ownRevisions: [5, 6], readsBeyond: true)
private let action: JSONValue = .object(["type": .string("add-task"), "title": .string("Buy milk")])

private func json(_ text: String?) throws -> JSONValue {
  try JSON.parse(try #require(text))
}

private func expectError(_ expected: TransportError, _ call: () async throws -> Void) async {
  do {
    try await call()
    Issue.record("expected \(expected), but the call succeeded")
  } catch let error as TransportError {
    #expect(error == expected)
  } catch {
    Issue.record("expected \(expected), got \(error)")
  }
}

@Suite struct SignInTests {
  @Test func postsCredentialsAsJSONWithoutAuthorization() async throws {
    let server = StubServer()
    server.answer(
      status: 200,
      json: #"{"token":"tok-1","expiresAt":"2026-12-25T10:30:15.250Z","owner":"user-1"}"#)

    let session = try await server.transport().signIn(
      email: "a@example.com", password: "pw", timezone: "Europe/Paris")

    let request = try #require(server.requests.first)
    #expect(request.method == "POST")
    #expect(request.path == "/api/v1/auth/sign-in")
    #expect(request.query == nil)
    #expect(request.header("Authorization") == nil)
    #expect(request.header("Content-Type") == "application/json")
    #expect(request.header("Accept") == "application/json")
    let body = try #require(try json(request.bodyText).objectValue)
    #expect(body["email"] == .string("a@example.com"))
    #expect(body["password"] == .string("pw"))
    #expect(body["timezone"] == .string("Europe/Paris"))
    #expect(session.token == "tok-1")
    #expect(session.owner == "user-1")
    #expect(session.expiresAt == Date(timeIntervalSince1970: 1_798_194_615.25))
  }

  @Test func readsAnExpiryWithoutFractionalSeconds() async throws {
    let server = StubServer()
    server.answer(
      status: 200, json: #"{"token":"t","expiresAt":"2026-12-25T10:30:15Z","owner":"u"}"#)
    let session = try await server.transport().signIn(email: "a@b.c", password: "p", timezone: "UTC")
    #expect(session.expiresAt == Date(timeIntervalSince1970: 1_798_194_615))
  }

  @Test(arguments: [
    (401, "wrong"), (401, "unconfirmed"), (403, "not-invited"),
  ])
  func aRefusalCarriesTheReason(status: Int, reason: String) async {
    let server = StubServer()
    server.answer(status: status, json: #"{"ok":false,"error":"\#(reason)"}"#)
    await expectError(.refused(status: status, reason: reason)) {
      _ = try await server.transport().signIn(email: "a@b.c", password: "p", timezone: "UTC")
    }
  }

  @Test func aSignInReplyWithoutATokenIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"expiresAt":"2026-12-25T10:30:15Z","owner":"u"}"#)
    await expectError(.unreadable) {
      _ = try await server.transport().signIn(email: "a@b.c", password: "p", timezone: "UTC")
    }
  }

  @Test func aBadExpiryIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"token":"t","expiresAt":"tomorrow","owner":"u"}"#)
    await expectError(.unreadable) {
      _ = try await server.transport().signIn(email: "a@b.c", password: "p", timezone: "UTC")
    }
  }
}

@Suite struct SignOutAndAccountTests {
  @Test func signOutPostsWithTheBearerToken() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"ok":true}"#)
    try await server.transport().signOut(token: "tok-1")
    let request = try #require(server.requests.first)
    #expect(request.method == "POST")
    #expect(request.path == "/api/v1/auth/sign-out")
    #expect(request.header("Authorization") == "Bearer tok-1")
    #expect(request.header("Accept") == "application/json")
    #expect(request.header("Content-Type") == "application/json")
    #expect(request.bodyText == "{}", "an empty body, so the header is true")
  }

  /// The server refuses a v1 write that does not say it is JSON; a read says nothing about a body it does not send.
  @Test func everyPostSaysItIsJSONAndAGetSendsNoBody() async throws {
    let server = StubServer()
    let transport = server.transport()
    server.answer(status: 200, json: #"{"token":"t","owner":"o","expiresAt":"2030-01-01T00:00:00.000Z"}"#)
    _ = try await transport.signIn(email: "a@example.com", password: "pw", timezone: "UTC")
    server.answer(status: 200, json: #"{"ok":true}"#)
    try await transport.signOut(token: "t")
    server.answer(status: 200, json: #"{"status":"already-applied","owner":"o"}"#)
    _ = try await transport.send(token: "t", operationId: "op", action: action, expectedOwner: "o", basis: basis)
    server.answer(status: 200, json: #"{"owner":"o","email":null,"signIn":false}"#)
    _ = try await transport.account(token: nil)
    server.answer(status: 200, json: #"{"owner":"o","unchanged":true,"revision":7}"#)
    _ = try await transport.workspace(token: nil, have: 7)

    let posts = server.requests.filter { $0.method == "POST" }
    #expect(posts.map(\.path) == ["/api/v1/auth/sign-in", "/api/v1/auth/sign-out", "/api/v1/commands"])
    for post in posts {
      #expect(post.header("Content-Type") == "application/json", "\(post.path)")
      #expect(try JSON.parse(try #require(post.bodyText)).objectValue != nil, "\(post.path) sends a JSON object")
    }
    let gets = server.requests.filter { $0.method == "GET" }
    #expect(gets.count == 2)
    for get in gets { #expect(get.body == nil || get.body?.isEmpty == true, "\(get.path)") }
  }

  @Test func signOutTreatsASignedOutSessionAsDone() async throws {
    let server = StubServer()
    server.answer(status: 401, json: #"{"error":"signed-out"}"#)
    try await server.transport().signOut(token: "gone")
  }

  @Test func signOutStillReportsAnOutage() async {
    let server = StubServer()
    server.answer(status: 503, json: #"{"ok":false,"error":"unavailable"}"#)
    await expectError(.server(status: 503)) { try await server.transport().signOut(token: "t") }
  }

  @Test func accountReadsTheOwner() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"owner":"user-1","email":"a@example.com","signIn":true}"#)
    let account = try await server.transport().account(token: "tok-1")
    let request = try #require(server.requests.first)
    #expect(request.method == "GET")
    #expect(request.path == "/api/v1/account")
    #expect(request.header("Authorization") == "Bearer tok-1")
    #expect(request.body == nil)
    #expect(account == Account(owner: "user-1", email: "a@example.com", signIn: true))
  }

  @Test func accountWithSignInOffHasNoEmailAndNoToken() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"owner":"local","email":null,"signIn":false}"#)
    let account = try await server.transport().account(token: nil)
    #expect(server.requests.first?.header("Authorization") == nil)
    #expect(account == Account(owner: "local", email: nil, signIn: false))
  }

  @Test func anAccountReplyWithoutAnOwnerIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"email":"a@b.c","signIn":true}"#)
    await expectError(.unreadable) { _ = try await server.transport().account(token: "t") }
  }
}

@Suite struct WorkspaceTests {
  @Test func askingWithARevisionSendsHave() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"unchanged":true,"revision":7,"owner":"user-1"}"#)
    let reply = try await server.transport().workspace(token: "tok-1", have: 7)
    let request = try #require(server.requests.first)
    #expect(request.method == "GET")
    #expect(request.path == "/api/v1/workspace")
    #expect(request.query == "have=7")
    #expect(request.header("Authorization") == "Bearer tok-1")
    guard case .unchanged(let revision, let owner) = reply else {
      Issue.record("expected unchanged, got \(reply)")
      return
    }
    #expect(revision == 7)
    #expect(owner == "user-1")
  }

  @Test func askingWithoutARevisionSendsNoQueryAndReadsTheWholeWorkspace() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"workspace":\#(workspaceJSON),"owner":"user-1"}"#)
    let reply = try await server.transport().workspace(token: "tok-1", have: nil)
    #expect(server.requests.first?.query == nil)
    guard case .full(let workspace, let owner) = reply else {
      Issue.record("expected full, got \(reply)")
      return
    }
    #expect(workspace.revision == 7)
    #expect(workspace.timezone == "UTC")
    #expect(owner == "user-1")
  }

  @Test func aWorkspaceTheCoreRefusesIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"workspace":{"revision":"seven"},"owner":"u"}"#)
    await expectError(.unreadable) { _ = try await server.transport().workspace(token: "t", have: nil) }
  }

  @Test func aReplyWithNeitherShapeIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"owner":"u"}"#)
    await expectError(.unreadable) { _ = try await server.transport().workspace(token: "t", have: 3) }
  }
}

@Suite struct CommandTests {
  private func send(_ server: StubServer) async throws -> CommandOutcome {
    try await server.transport().send(
      token: "tok-1", operationId: "op-1", action: action, expectedOwner: "user-1", basis: basis)
  }

  @Test func theRequestCarriesTheCommandTheServerValidates() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"status":"already-applied","owner":"user-1"}"#)
    _ = try await send(server)
    let request = try #require(server.requests.first)
    #expect(request.method == "POST")
    #expect(request.path == "/api/v1/commands")
    #expect(request.header("Authorization") == "Bearer tok-1")
    #expect(request.header("Content-Type") == "application/json")
    let expected: JSONValue = .object([
      "operationId": .string("op-1"),
      "expectedRevision": .number("7"),
      "action": action,
      "expectedOwner": .string("user-1"),
      "basis": .object([
        "baseRevision": .number("7"),
        "ownRevisions": .array([.number("5"), .number("6")]),
        "readsBeyond": .bool(true),
      ]),
    ])
    #expect(try json(request.bodyText) == expected)
  }

  @Test func appliedCarriesTheReceiptAndTheChanges() async throws {
    let server = StubServer()
    server.answer(
      status: 200,
      json:
        #"{"status":"applied","receipt":{"id":"r1","ok":true},"changes":\#(changesJSON),"owner":"user-1"}"#)
    let outcome = try await send(server)
    guard case .applied(let receipt, let changes, let owner) = outcome else {
      Issue.record("expected applied, got \(outcome)")
      return
    }
    #expect(receipt == .object(["id": .string("r1"), "ok": .bool(true)]))
    #expect(changes.from == 7)
    #expect(changes.revision == 8)
    #expect(owner == "user-1")
  }

  @Test func appliedWithoutChangesIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"status":"applied","receipt":{},"owner":"user-1"}"#)
    await expectError(.unreadable) { _ = try await send(server) }
  }

  @Test func appliedWithChangesTheCoreRefusesIsUnreadable() async {
    let server = StubServer()
    server.answer(
      status: 200, json: #"{"status":"applied","receipt":{},"changes":{"from":"x"},"owner":"user-1"}"#)
    await expectError(.unreadable) { _ = try await send(server) }
  }

  @Test func heldCarriesWhyAndWhich() async throws {
    let server = StubServer()
    server.answer(
      status: 200,
      json: #"{"status":"held","reason":"conflict","rows":["page:a","task:b"],"stale":true,"owner":"user-1"}"#)
    let outcome = try await send(server)
    guard case .held(let reason, let rows, let stale, let owner) = outcome else {
      Issue.record("expected held, got \(outcome)")
      return
    }
    #expect(reason == "conflict")
    #expect(rows == ["page:a", "task:b"])
    #expect(stale)
    #expect(owner == "user-1")
  }

  @Test func heldWithoutRowsIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"status":"held","reason":"conflict","stale":false,"owner":"u"}"#)
    await expectError(.unreadable) { _ = try await send(server) }
  }

  @Test func alreadyAppliedIsItsOwnOutcome() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"status":"already-applied","owner":"user-1"}"#)
    guard case .alreadyApplied(let owner) = try await send(server) else {
      Issue.record("expected alreadyApplied")
      return
    }
    #expect(owner == "user-1")
  }

  @Test func refusedCarriesTheMessage() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"status":"refused","message":"No such page","owner":"user-1"}"#)
    guard case .refused(let message, let owner) = try await send(server) else {
      Issue.record("expected refused")
      return
    }
    #expect(message == "No such page")
    #expect(owner == "user-1")
  }

  @Test func anOwnerMismatchNamesTheServersOwner() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"status":"owner-mismatch","owner":"someone-else"}"#)
    guard case .ownerMismatch(let owner) = try await send(server) else {
      Issue.record("expected ownerMismatch")
      return
    }
    #expect(owner == "someone-else")
  }

  @Test func anUnknownStatusIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"status":"teleported","owner":"u"}"#)
    await expectError(.unreadable) { _ = try await send(server) }
  }

  @Test func aBadRequestIsRefusedWithItsStatus() async {
    let server = StubServer()
    server.answer(status: 400, json: #"{"error":"bad-request"}"#)
    await expectError(.refused(status: 400, reason: "bad-request")) { _ = try await send(server) }
  }
}

@Suite struct SaveTests {
  private let saveAction: JSONValue = .object([
    "type": .string("save-editor"), "pageId": .string("day:2026-11-25"), "document": .string("[]"),
  ])

  private func save(_ server: StubServer) async throws -> SaveOutcome {
    try await server.transport().save(
      token: "tok-1", operationId: "op-1", expectedRevision: 7, expectedOwner: "user-1", action: saveAction)
  }

  @Test func theRequestCarriesTheSaveInTheRoutesOrder() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"receipt":{},"changes":\#(changesJSON),"owner":"user-1"}"#)
    _ = try await save(server)
    let request = try #require(server.requests.first)
    #expect(request.method == "POST")
    #expect(request.path == "/api/v1/saves")
    #expect(request.header("Authorization") == "Bearer tok-1")
    #expect(request.header("Content-Type") == "application/json")
    let body = try json(request.bodyText)
    #expect(body.objectValue?.keys == ["operationId", "expectedRevision", "expectedOwner", "action"])
    let expected: JSONValue = .object([
      "operationId": .string("op-1"),
      "expectedRevision": .number("7"),
      "expectedOwner": .string("user-1"),
      "action": saveAction,
    ])
    #expect(body == expected)
  }

  @Test func appliedCarriesTheReceiptAndTheChanges() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"receipt":{"id":"r1"},"changes":\#(changesJSON),"owner":"user-1"}"#)
    guard case .applied(let receipt, let changes, let owner) = try await save(server) else {
      Issue.record("expected applied")
      return
    }
    #expect(receipt == .object(["id": .string("r1")]))
    #expect(changes.from == 7)
    #expect(changes.revision == 8)
    #expect(owner == "user-1")
  }

  @Test func aRefusalCarriesTheServersMessage() async throws {
    let server = StubServer()
    server.answer(status: 409, json: #"{"error":"refused","message":"Page changed elsewhere"}"#)
    guard case .refused(let message) = try await save(server) else {
      Issue.record("expected refused")
      return
    }
    #expect(message == "Page changed elsewhere")
  }

  @Test func anOwnerMismatchNamesTheServersOwner() async throws {
    let server = StubServer()
    server.answer(status: 409, json: #"{"error":"owner-mismatch","owner":"someone-else"}"#)
    guard case .ownerMismatch(let owner) = try await save(server) else {
      Issue.record("expected ownerMismatch")
      return
    }
    #expect(owner == "someone-else")
  }

  @Test func aBadRequestThrows() async {
    let server = StubServer()
    server.answer(status: 400, json: #"{"error":"bad-request"}"#)
    await expectError(.refused(status: 400, reason: "bad-request")) { _ = try await save(server) }
  }

  @Test func a409ThisClientDoesNotKnowIsARefusalWithItsStatus() async {
    let server = StubServer()
    server.answer(status: 409, json: #"{"error":"teleported"}"#)
    await expectError(.refused(status: 409, reason: "teleported")) { _ = try await save(server) }
  }

  @Test func anAppliedReplyWithoutChangesIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: #"{"receipt":{},"owner":"user-1"}"#)
    await expectError(.unreadable) { _ = try await save(server) }
  }
}

@Suite struct DayDraftTests {
  private let date = LocalDate("2026-11-26")!
  private let command = #"{"type":"set-draft","pageId":"day:2026-11-26","status":"ready","recipe":5}"#

  private func ask(_ server: StubServer) async throws -> DayDraftReply {
    try await server.transport().dayDraft(token: "tok-1", date: date, operationId: "op")
  }

  /// The reply as the route writes it, `setDraft` included as JSON text.
  private func reply(_ object: JSONObject) -> String {
    JSON.write(.object(object))
  }

  @Test func day_draft_posts_the_date_and_operation_id() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"setDraft":null,"owner":"user-1","modelOn":false,"remakeFailed":false}"#)
    _ = try await ask(server)
    let request = try #require(server.requests.first)
    #expect(request.method == "POST")
    #expect(request.path == "/api/v1/day-draft")
    #expect(request.query == nil)
    #expect(request.header("Authorization") == "Bearer tok-1")
    #expect(request.header("Content-Type") == "application/json")
    #expect(request.header("Accept") == "application/json")
    #expect(request.bodyText == #"{"date":"2026-11-26","operationId":"op"}"#)
  }

  @Test func day_draft_reads_the_reply() async throws {
    let server = StubServer()
    server.answer(
      status: 200,
      json: reply([
        "setDraft": .string(command), "owner": .string("user-1"), "modelOn": .bool(true),
        "remakeFailed": .bool(false),
      ]))
    #expect(
      try await ask(server) == DayDraftReply(setDraft: command, owner: "user-1", modelOn: true, remakeFailed: false))

    server.answer(
      status: 200,
      json: reply(["setDraft": .null, "owner": .string("user-1"), "modelOn": .bool(false), "remakeFailed": .bool(true)]))
    #expect(
      try await ask(server) == DayDraftReply(setDraft: nil, owner: "user-1", modelOn: false, remakeFailed: true))

    // A reply only ever gains optional fields: one this client does not know is ignored, and a flag left out is false.
    server.answer(status: 200, json: reply(["setDraft": .null, "owner": .string("user-1"), "later": .number("1")]))
    #expect(
      try await ask(server) == DayDraftReply(setDraft: nil, owner: "user-1", modelOn: false, remakeFailed: false))
  }

  @Test func a_day_draft_404_is_refused_not_found() async {
    let server = StubServer()
    server.answer(status: 404, json: #"{"error":"not-found"}"#)
    await expectError(.refused(status: 404, reason: "not-found")) { _ = try await ask(server) }
  }

  @Test func a_day_draft_500_is_a_server_failure() async {
    let server = StubServer()
    server.answer(status: 500, json: #"{"error":"internal"}"#)
    await expectError(.server(status: 500)) { _ = try await ask(server) }
  }

  @Test func a_day_draft_reply_without_its_fields_is_unreadable() async {
    let server = StubServer()
    server.answer(
      status: 200, json: reply(["setDraft": .null, "modelOn": .bool(false), "remakeFailed": .bool(false)]))
    await expectError(.unreadable) { _ = try await ask(server) }

    server.answer(
      status: 200,
      json: reply([
        "setDraft": .number("5"), "owner": .string("user-1"), "modelOn": .bool(false), "remakeFailed": .bool(false),
      ]))
    await expectError(.unreadable) { _ = try await ask(server) }
  }
}

@Suite struct ErrorMapTests {
  private func probe(_ server: StubServer) async throws {
    _ = try await server.transport().account(token: "tok-1")
  }

  @Test(arguments: [
    URLError.Code.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost,
    .cannotConnectToHost, .dataNotAllowed,
  ])
  func networkFailuresAreOffline(code: URLError.Code) async {
    let server = StubServer()
    server.answer(.failure(code))
    await expectError(.offline) { try await probe(server) }
  }

  @Test func aSignedOutReplyIsSignedOut() async {
    let server = StubServer()
    server.answer(status: 401, json: #"{"error":"signed-out"}"#)
    await expectError(.signedOut) { try await probe(server) }
  }

  @Test func a401WithoutThatBodyIsARefusalNotASignOut() async {
    let server = StubServer()
    server.answer(status: 401, json: "nope")
    await expectError(.refused(status: 401, reason: nil)) { try await probe(server) }
  }

  @Test func tooManyTriesCarryTheWaitInSeconds() async {
    let server = StubServer()
    server.answer(status: 429, json: #"{"ok":false,"error":"too-many","retryAfter":42}"#)
    await expectError(.wait(seconds: 42)) {
      _ = try await server.transport().signIn(email: "a@b.c", password: "p", timezone: "UTC")
    }
  }

  @Test(arguments: [500, 502, 503])
  func serverFailuresAreServer(status: Int) async {
    let server = StubServer()
    server.answer(status: status, json: #"{"ok":false,"error":"unavailable"}"#)
    await expectError(.server(status: status)) { try await probe(server) }
  }

  @Test func aSuccessBodyThatDoesNotReadIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: "<html>captive portal</html>")
    await expectError(.unreadable) { try await probe(server) }
  }

  @Test func anEmptySuccessBodyIsUnreadable() async {
    let server = StubServer()
    server.answer(status: 200, json: "")
    await expectError(.unreadable) { try await probe(server) }
  }
}

@Suite struct RequestHygieneTests {
  @Test(arguments: ["", "/", "/daythread", "/daythread/"])
  func aBaseWithOrWithoutATrailingSlashReachesTheSamePath(prefix: String) async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"owner":"u","email":null,"signIn":false}"#)
    let base = try #require(URL(string: "https://\(server.host)\(prefix)"))
    _ = try await server.transport(baseURL: base).account(token: nil)
    let expected = (prefix.hasSuffix("/") ? String(prefix.dropLast()) : prefix) + "/api/v1/account"
    #expect(server.requests.first?.path == expected)
  }

  @Test func theWorkspaceQuerySurvivesATrailingSlashBase() async throws {
    let server = StubServer()
    server.answer(status: 200, json: #"{"unchanged":true,"revision":2,"owner":"u"}"#)
    let base = try #require(URL(string: "https://\(server.host)/"))
    _ = try await server.transport(baseURL: base).workspace(token: "t", have: 2)
    #expect(server.requests.first?.path == "/api/v1/workspace")
    #expect(server.requests.first?.query == "have=2")
  }

  @Test func theDefaultSessionKeepsNoCookiesAndNoCache() {
    let configuration = URLSessionTransport.makeConfiguration()
    #expect(configuration.httpCookieStorage == nil)
    #expect(configuration.httpShouldSetCookies == false)
    #expect(configuration.urlCache == nil)
    #expect(configuration.requestCachePolicy == .reloadIgnoringLocalCacheData)
    _ = URLSessionTransport.makeSession()
  }

  @Test func aCookieTheServerSetsIsNeverSentBack() async throws {
    let server = StubServer()
    server.answer(
      status: 200, json: #"{"owner":"u","email":null,"signIn":false}"#,
      headers: ["Set-Cookie": "dt_session=abc; Path=/; HttpOnly"])
    let transport = server.transport()
    _ = try await transport.account(token: "t")
    _ = try await transport.account(token: "t")
    #expect(server.requests.count == 2)
    for request in server.requests {
      #expect(request.header("Cookie") == nil)
    }
    #expect(HTTPCookieStorage.shared.cookies(for: server.baseURL)?.isEmpty ?? true)
  }
}

@Suite struct SessionDescriptionTests {
  private let session = Session(
    token: "super-secret-token", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 0))

  @Test func theTokenNeverShowsInAnyDescription() {
    var dumped = ""
    dump(session, to: &dumped)
    let texts = [
      "\(session)", String(describing: session), String(reflecting: session), dumped,
      "\(String(describing: [session]))",
    ]
    for text in texts {
      #expect(!text.contains("super-secret-token"))
    }
    #expect(String(describing: session).contains("user-1"))
  }

  @Test func aFailureNeverCarriesTheToken() async {
    let server = StubServer()
    server.answer(status: 401, json: #"{"error":"signed-out"}"#)
    do {
      _ = try await server.transport().account(token: "super-secret-token")
      Issue.record("expected a failure")
    } catch {
      #expect(!"\(error)".contains("super-secret-token"))
      #expect(!String(reflecting: error).contains("super-secret-token"))
    }
  }
}
