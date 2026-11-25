import DaythreadCore
import Foundation
import Testing

@testable import DaythreadSync

// MARK: - Fixtures

/// 2026-11-25T12:00:00Z: the 25th in UTC.
private let noon = Date(timeIntervalSince1970: 1_795_608_000)
/// 2026-11-25T23:30:00Z: still the 25th in UTC, already the 26th in Auckland.
private let lateEvening = Date(timeIntervalSince1970: 1_795_649_400)

private let first = Session(token: "tok-1", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
private let second = Session(token: "tok-2", owner: "user-2", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
private let firstAgain = Session(
  token: "tok-3", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))

private let firstAccount = Account(owner: "user-1", email: "one@example.com", signIn: true)
private let localAccount = Account(owner: "local", email: nil, signIn: false)

/// A workspace at `revision` holding a day page for each of `days`.
private func workspace(
  _ revision: Int, timezone: String = "UTC", days: [String] = ["2026-11-25"], tasks: [String] = []
) throws -> Workspace {
  let pages = days.map { #"{"id":"day:\#($0)","type":"day","date":"\#($0)","title":"\#($0)","document":"[]"}"# }
  let rows = tasks.map { #"{"id":"\#($0)","title":"\#($0)","status":"open","paused":false}"# }
  let text =
    #"{"revision":\#(revision),"timezone":"\#(timezone)","pages":[\#(pages.joined(separator: ","))],"tasks":[\#(rows.joined(separator: ","))]}"#
  return try required(Workspace(try JSON.parse(text)))
}

/// Changes from `from` to `revision` that add the task `added`.
private func changes(from: Int, to revision: Int, adding added: String) throws -> WorkspaceChanges {
  let task = #"{"id":"\#(added)","title":"\#(added)","status":"open","paused":false}"#
  let text =
    #"{"from":\#(from),"revision":\#(revision),"timezone":"UTC","pages":{"upsert":[],"remove":[]},"tasks":{"upsert":[\#(task)],"remove":[]}}"#
  return try required(WorkspaceChanges(try JSON.parse(text)))
}

private func tick(_ taskId: String) -> JSONValue {
  .object(["type": .string("task-status"), "taskId": .string(taskId), "status": .string("done")])
}

private func pending(_ operationId: String, base: Int, own: [Int] = [], owner: String = "user-1") -> NewOutboxEntry {
  NewOutboxEntry(
    kind: .command, owner: owner, operationId: operationId, action: tick(operationId), baseRevision: base,
    ownRevisions: own, label: "Tick \(operationId)", createdAt: noon, state: .pending, reason: nil)
}

private func send(
  _ operationId: String, base: Int, own: [Int] = [], token: String? = "tok-1", owner: String = "user-1"
) -> FakeTransport.Call {
  .send(
    token: token, operationId: operationId, action: tick(operationId), expectedOwner: owner,
    basis: OutboxBasis(baseRevision: base, ownRevisions: own, readsBeyond: true))
}

private func state(
  _ phase: SyncState.Phase, _ workspace: Workspace?, offline: Bool = false, held: Int = 0
) -> SyncState {
  SyncState(phase: phase, workspace: workspace, offline: offline, held: held)
}

/// What an entry looks like to these tests: its operation, its state and what it learned.
private func describe(_ entries: [OutboxEntry]) -> [String] {
  entries.map { entry in
    let state = entry.state == .held ? "held(\(entry.reason ?? ""))" : "pending"
    return "\(entry.operationId) \(state) base \(entry.baseRevision) own \(entry.ownRevisions)"
  }
}

/// Waits, without sleeping, until `condition` holds; it holds once the tasks already started have run.
private func until(_ condition: () async -> Bool) async {
  while !(await condition()) { await Task.yield() }
}

/// The state a new reader of `states` gets at once.
private func current(_ engine: SyncEngine) async -> SyncState? {
  await engine.states.first { _ in true }
}

/// A memory store that writes down every call that changes it.
actor RecordingStore: WorkspaceStore {
  private let inner = MemoryWorkspaceStore()
  private(set) var log: [String] = []

  func forget() { log = [] }

  func load() async throws -> (workspace: Workspace, owner: String)? { try await inner.load() }

  func replace(with workspace: Workspace, owner: String) async throws {
    log.append("replace \(owner) \(workspace.revision)")
    try await inner.replace(with: workspace, owner: owner)
  }

  func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws {
    log.append("write \(workspace.revision)")
    try await inner.write(workspace, changed: changed)
  }

  func entries() async throws -> [OutboxEntry] { try await inner.entries() }

  func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry {
    log.append("append \(entry.operationId)")
    return try await inner.append(entry)
  }

  func update(_ entry: OutboxEntry) async throws {
    log.append("update \(entry.operationId)")
    try await inner.update(entry)
  }

  func remove(seq: Int) async throws {
    log.append("remove \(seq)")
    try await inner.remove(seq: seq)
  }

  func erase() async throws {
    log.append("erase")
    try await inner.erase()
  }
}

/// An engine over a fake server, a recording store and a memory token store, with what the store holds before.
private struct Harness {
  let transport: FakeTransport
  let store = RecordingStore()
  let tokens = MemoryTokenStore()
  let engine: SyncEngine

  init(
    _ script: [FakeTransport.Reply] = [], session: Session? = first, copy: Workspace? = nil,
    owner: String = "user-1", entries: [NewOutboxEntry] = [], now: Date = noon
  ) async throws {
    transport = FakeTransport(script)
    if let session { try tokens.write(session) }
    if let copy { try await store.replace(with: copy, owner: owner) }
    for entry in entries { _ = try await store.append(entry) }
    await store.forget()
    engine = SyncEngine(transport: transport, tokens: tokens, store: store, now: { now })
  }

  var calls: [FakeTransport.Call] { get async { await transport.calls } }
  var log: [String] { get async { await store.log } }
  var entries: [String] { get async throws { describe(try await store.entries()) } }
  var kept: (workspace: Workspace, owner: String)? { get async throws { try await store.load() } }
}

// MARK: - The rules of the brief

@Suite struct SyncEngineTests {
  @Test func shows_the_stored_copy_before_the_first_request() async throws {
    let copy = try workspace(5)
    let h = try await Harness([.account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1"))], copy: copy)
    let seen = Seen()
    let engine = h.engine
    await h.transport.onCall { _ in await seen.add(await current(engine)) }

    await h.engine.start()

    #expect(await seen.first == state(.starting, copy))
    #expect(await h.calls == [.account(token: "tok-1"), .workspace(token: "tok-1", have: 5)])
    #expect(await current(h.engine) == state(.ready, copy))
  }

  @Test func the_copy_of_another_owner_is_not_shown_before_the_first_request() async throws {
    let h = try await Harness([.failure(TransportError.offline)], session: second, copy: try workspace(5))
    let seen = Seen()
    let engine = h.engine
    await h.transport.onCall { _ in await seen.add(await current(engine)) }

    await h.engine.start()

    #expect(await seen.first == state(.starting, nil))
    #expect(await current(h.engine) == state(.starting, nil, offline: true))
  }

  @Test func local_server_needs_no_sign_in() async throws {
    let served = try workspace(3)
    let h = try await Harness(
      [.account(localAccount), .workspace(.full(served, owner: "local"))], session: nil)

    await h.engine.start()

    #expect(await h.calls == [.account(token: nil), .workspace(token: nil, have: nil)])
    #expect(await current(h.engine) == state(.ready, served))
    let kept = try await h.kept
    #expect(kept?.owner == "local")
    #expect(kept?.workspace == served)
  }

  @Test func no_session_is_signed_out() async throws {
    let refused = try await Harness([.failure(TransportError.signedOut)], session: nil)
    await refused.engine.start()
    #expect(await refused.calls == [.account(token: nil)])
    #expect(await current(refused.engine) == state(.signedOut, nil))

    // A server with sign-in on that answers without refusing still needs a session.
    let asking = try await Harness([.account(Account(owner: "", email: nil, signIn: true))], session: nil)
    await asking.engine.start()
    #expect(await asking.calls == [.account(token: nil)])
    #expect(await current(asking.engine) == state(.signedOut, nil))
  }

  @Test func unchanged_reply_writes_nothing() async throws {
    let copy = try workspace(5)
    let h = try await Harness([.account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1"))], copy: copy)

    await h.engine.start()

    #expect(await h.calls == [.account(token: "tok-1"), .workspace(token: "tok-1", have: 5)])
    #expect(await h.log == [])
    #expect(await current(h.engine) == state(.ready, copy))
  }

  @Test func another_owner_replaces_everything_and_drops_their_outbox() async throws {
    let served = try workspace(9)
    let h = try await Harness(
      [.account(localAccount), .workspace(.full(served, owner: "local"))], session: nil, copy: try workspace(5),
      entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await h.calls == [.account(token: nil), .workspace(token: nil, have: 5)])
    #expect(await h.log == ["replace local 9"])
    #expect(try await h.kept?.owner == "local")
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func unchanged_under_another_owner_loads_the_workspace_whole() async throws {
    let served = try workspace(5, tasks: ["theirs"])
    let h = try await Harness(
      [
        .account(localAccount), .workspace(.unchanged(revision: 5, owner: "local")),
        .workspace(.full(served, owner: "local")),
      ], session: nil, copy: try workspace(5))

    await h.engine.start()

    #expect(
      await h.calls == [
        .account(token: nil), .workspace(token: nil, have: 5), .workspace(token: nil, have: nil),
      ])
    #expect(await h.log == ["replace local 5"])
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func ensures_today_in_the_accounts_zone_once() async throws {
    // At 23:30 UTC on the 25th it is already the 26th in Auckland; the copy has only the 25th.
    let served = try workspace(4, timezone: "Pacific/Auckland", days: ["2026-11-25"])
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.full(served, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: ["day:2026-11-26"], stale: false, owner: "user-1")),
        .workspace(.unchanged(revision: 4, owner: "user-1")),
      ], now: lateEvening)

    await h.engine.start()
    await h.engine.refresh()

    let sends = await h.transport.sends
    #expect(sends.count == 1)
    guard case .send(_, _, let action, _, let basis)? = sends.first else { return }
    #expect(action == .object(["type": .string("ensure-day"), "date": .string("2026-11-26")]))
    #expect(basis == OutboxBasis(baseRevision: 4, ownRevisions: [], readsBeyond: true))
    let entries = try await h.store.entries()
    #expect(entries.count == 1)
    #expect(entries.first?.state == .held)
    #expect(await h.calls.count == 4)
  }

  @Test func drains_in_order_with_the_entrys_base() async throws {
    let held: FakeTransport.Reply = .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1"))
    let h = try await Harness(
      [.account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")), held, held],
      copy: try workspace(5), entries: [pending("op-1", base: 3, own: [4]), pending("op-2", base: 5)])

    await h.engine.start()

    #expect(await h.transport.sends == [send("op-1", base: 3, own: [4]), send("op-2", base: 5)])
    #expect(await h.transport.maxInFlight == 1)
  }

  @Test func applied_changes_are_written_and_later_entries_learn_the_revision() async throws {
    let copy = try workspace(5)
    let applied = try changes(from: 5, to: 6, adding: "new")
    let after = try required(copy.applying(applied))
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
      ], copy: copy, entries: [pending("op-1", base: 5), pending("op-2", base: 5)])

    await h.engine.start()

    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-2", base: 5, own: [6])])
    #expect(try await h.kept?.workspace == after)
    #expect(await h.log == ["write 6", "remove 1", "update op-2", "update op-2"])
    #expect(try await h.entries == ["op-2 held(conflict) base 5 own [6]"])
    #expect(await current(h.engine) == state(.ready, after, held: 1))
  }

  @Test func changes_from_another_base_load_the_workspace_whole() async throws {
    let served = try workspace(8)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.applied(receipt: .object([:]), changes: try changes(from: 7, to: 8, adding: "new"), owner: "user-1")),
        .workspace(.full(served, owner: "user-1")),
      ], copy: try workspace(5), entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(
      await h.calls == [
        .account(token: "tok-1"), .workspace(token: "tok-1", have: 5), send("op-1", base: 5),
        .workspace(token: "tok-1", have: nil),
      ])
    #expect(await h.log == ["replace user-1 8", "remove 1"])
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func held_entry_stays_and_later_ones_still_go() async throws {
    let copy = try workspace(5)
    let applied = try changes(from: 5, to: 6, adding: "new")
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: ["task:a"], stale: false, owner: "user-1")),
        .outcome(.refused(message: "Not found", owner: "user-1")),
        .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
      ], copy: copy, entries: [pending("op-1", base: 5), pending("op-2", base: 5), pending("op-3", base: 5)])

    await h.engine.start()

    #expect(
      await h.transport.sends == [send("op-1", base: 5), send("op-2", base: 5), send("op-3", base: 5)])
    #expect(
      try await h.entries == ["op-1 held(conflict) base 5 own []", "op-2 held(Not found) base 5 own []"])
    #expect(await current(h.engine) == state(.ready, try required(copy.applying(applied)), held: 2))
  }

  @Test func already_applied_removes_the_entry_and_loads_whole() async throws {
    let served = try workspace(6)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.alreadyApplied(owner: "user-1")), .workspace(.full(served, owner: "user-1")),
      ], copy: try workspace(5), entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await h.calls.last == .workspace(token: "tok-1", have: nil))
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func owner_mismatch_stops_and_loads_whole_under_the_new_owner() async throws {
    let served = try workspace(7)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.ownerMismatch(owner: "user-2")), .workspace(.full(served, owner: "user-2")),
      ], copy: try workspace(5), entries: [pending("op-1", base: 5), pending("op-2", base: 5)])

    await h.engine.start()

    #expect(await h.transport.sends == [send("op-1", base: 5)])
    #expect(await h.calls.last == .workspace(token: "tok-1", have: nil))
    #expect(try await h.kept?.owner == "user-2")
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func a_command_reply_under_another_owner_is_never_applied() async throws {
    let served = try workspace(7)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.applied(receipt: .object([:]), changes: try changes(from: 5, to: 6, adding: "x"), owner: "user-2")),
        .workspace(.full(served, owner: "user-2")),
      ], copy: try workspace(5), entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await h.log == ["replace user-2 7"])
    #expect(try await h.kept?.owner == "user-2")
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func offline_keeps_everything_and_says_so() async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .failure(TransportError.offline),
      ], copy: copy, entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await current(h.engine) == state(.ready, copy, offline: true))
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
    #expect(await h.log == [])
    #expect(await h.calls.count == 3)

    // Nothing is retried on its own; the next refresh sends it again, and an answer clears `offline`.
    await h.transport.add([
      .workspace(.unchanged(revision: 5, owner: "user-1")),
      .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
    ])
    await h.engine.refresh()
    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-1", base: 5)])
    #expect(await current(h.engine) == state(.ready, copy, held: 1))
  }

  @Test func a_401_shows_sign_in_and_keeps_the_copy_until_the_next_owner() async throws {
    let copy = try workspace(5)
    let served = try workspace(3)
    let h = try await Harness([.failure(TransportError.signedOut)], copy: copy, entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await current(h.engine) == state(.signedOut, nil))
    #expect(try h.tokens.read() == nil)
    #expect(try await h.kept?.workspace == copy)
    #expect(try await h.entries == ["op-1 pending base 5 own []"])

    await h.transport.add([.session(second), .workspace(.full(served, owner: "user-2"))])
    try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")

    #expect(await h.log == ["erase", "replace user-2 3"])
    #expect(try h.tokens.read() == second)
    #expect(await h.transport.sends == [])
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func signing_in_as_the_same_owner_keeps_the_copy_and_sends_its_outbox() async throws {
    let copy = try workspace(5)
    let applied = try changes(from: 5, to: 6, adding: "new")
    let h = try await Harness([.failure(TransportError.signedOut)], copy: copy, entries: [pending("op-1", base: 5)])
    await h.engine.start()

    await h.transport.add([
      .session(firstAgain), .workspace(.unchanged(revision: 5, owner: "user-1")),
      .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
    ])
    try await h.engine.signIn(email: "one@example.com", password: "pw", timezone: "UTC")

    #expect(await h.transport.sends == [send("op-1", base: 5, token: "tok-3")])
    #expect(await !h.log.contains("erase"))
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, try required(copy.applying(applied))))
  }

  @Test func signing_in_as_another_account_while_signed_in_erases_the_first() async throws {
    let served = try workspace(2)
    let h = try await Harness(
      [.account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1"))], copy: try workspace(5),
      entries: [pending("op-1", base: 5)])
    await h.transport.add([.failure(TransportError.offline)])  // op-1 stays
    await h.engine.start()

    await h.transport.add([.session(second), .workspace(.full(served, owner: "user-2"))])
    try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")

    #expect(await h.log == ["erase", "replace user-2 2"])
    #expect(await h.calls.last == .workspace(token: "tok-2", have: nil))
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served))
  }

  @Test func sign_in_errors_are_thrown_unchanged() async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .failure(TransportError.refused(status: 401, reason: "wrong")),
      ], copy: copy)
    await h.engine.start()

    await #expect(throws: TransportError.refused(status: 401, reason: "wrong")) {
      try await h.engine.signIn(email: "two@example.com", password: "nope", timezone: "UTC")
    }

    #expect(await h.log == [])
    #expect(try h.tokens.read() == first)
    #expect(await current(h.engine) == state(.ready, copy))
  }

  @Test func sign_out_erases_even_when_the_server_is_unreachable() async throws {
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
        .failure(TransportError.offline),
      ], copy: try workspace(5), entries: [pending("op-1", base: 5)])
    await h.engine.start()

    await h.engine.signOut()

    #expect(await h.calls.last == .signOut(token: "tok-1"))
    #expect(try h.tokens.read() == nil)
    #expect(try await h.kept == nil)
    #expect(try await h.entries == [])
    #expect(await current(h.engine)?.phase == .signedOut)
    #expect(await current(h.engine)?.workspace == nil)
    #expect(await current(h.engine)?.held == 0)
  }

  @Test func an_entry_written_but_never_answered_is_sent_again_with_the_same_operation_id() async throws {
    let store = RecordingStore()
    let tokens = MemoryTokenStore()
    try tokens.write(first)
    try await store.replace(with: try workspace(5), owner: "user-1")

    let gate = Gate()
    let dying = FakeTransport([
      .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")), .gated(gate),
    ])
    let engine = SyncEngine(transport: dying, tokens: tokens, store: store, now: { noon })
    await engine.start()
    let change = Task { await engine.enqueue(action: tick("t1"), label: "Tick t1") }
    await gate.reached()
    let operationId = try required(await dying.sends.first?.operationId)

    let reopened = FakeTransport([
      .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
      .outcome(.alreadyApplied(owner: "user-1")), .workspace(.full(try workspace(6), owner: "user-1")),
    ])
    let next = SyncEngine(transport: reopened, tokens: tokens, store: store, now: { noon })
    await next.start()

    #expect(await reopened.sends.map(\.operationId) == [operationId])
    #expect(try await store.entries() == [])

    await gate.open(.failure(TransportError.offline))
    await change.value
  }
}

// MARK: - The additions

@Suite struct SyncEngineAdditionTests {
  @Test func refreshes_during_a_load_run_one_after_another() async throws {
    let gate = Gate()
    let unchanged: FakeTransport.Reply = .workspace(.unchanged(revision: 5, owner: "user-1"))
    let h = try await Harness([.account(firstAccount), unchanged, .gated(gate), unchanged], copy: try workspace(5))
    await h.engine.start()

    let loading = Task { await h.engine.refresh() }
    await gate.reached()
    let again = Task { await h.engine.refresh() }
    let andAgain = Task { await h.engine.refresh() }
    await until { await h.engine.passRequests == 4 }
    await gate.open(unchanged)
    await loading.value
    await again.value
    await andAgain.value

    #expect(
      await h.calls == [
        .account(token: "tok-1"), .workspace(token: "tok-1", have: 5), .workspace(token: "tok-1", have: 5),
        .workspace(token: "tok-1", have: 5),
      ])
    #expect(await h.transport.maxInFlight == 1)
  }

  enum Failure: String, CaseIterable, Sendable {
    case server, unreadable, wait, refused, unlisted

    var error: any Error {
      switch self {
      case .server: TransportError.server(status: 503)
      case .unreadable: TransportError.unreadable
      case .wait: TransportError.wait(seconds: 30)
      case .refused: TransportError.refused(status: 400, reason: nil)
      case .unlisted: URLError(.badServerResponse)
      }
    }
  }

  @Test(arguments: Failure.allCases)
  func a_failed_command_keeps_everything_and_is_tried_again_later(_ failure: Failure) async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")), .failure(failure.error),
      ], copy: copy, entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await current(h.engine) == state(.ready, copy))
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
    #expect(await h.log == [])

    await h.transport.add([
      .workspace(.unchanged(revision: 5, owner: "user-1")),
      .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
    ])
    await h.engine.refresh()
    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-1", base: 5)])
  }

  @Test(arguments: Failure.allCases)
  func a_failed_load_keeps_everything_and_leaves_offline_as_it_was(_ failure: Failure) async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [.account(firstAccount), .failure(TransportError.offline), .failure(failure.error)], copy: copy,
      entries: [pending("op-1", base: 5)])

    await h.engine.start()
    #expect(await current(h.engine) == state(.ready, copy, offline: true))
    await h.engine.refresh()

    #expect(await current(h.engine) == state(.ready, copy, offline: true))
    #expect(await h.transport.sends == [])
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
    #expect(await h.log == [])
  }

  @Test func a_signed_out_reply_to_a_command_keeps_the_copy_and_the_outbox() async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .failure(TransportError.signedOut),
      ], copy: copy, entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await current(h.engine) == state(.signedOut, nil))
    #expect(try h.tokens.read() == nil)
    #expect(try await h.kept?.workspace == copy)
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
  }

  @Test func cancellation_changes_nothing() async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
      ], copy: copy, entries: [pending("op-1", base: 5)])
    await h.engine.start()
    let before = await current(h.engine)
    await h.store.forget()

    // The change's send is cancelled, then a refresh's load is.
    await h.transport.add([.failure(CancellationError()), .failure(CancellationError())])
    await h.engine.enqueue(action: tick("t1"), label: "Tick t1")
    await h.engine.refresh()

    #expect(await current(h.engine) == before)
    #expect(await h.log.count == 1)  // the enqueued entry, and nothing after it
    let entries = try await h.store.entries()
    #expect(entries.map(\.state) == [.held, .pending])
  }

  @Test func enqueue_writes_the_entry_before_anything_is_sent() async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
      ], copy: copy)
    await h.engine.start()
    let seen = SeenEntries()
    let store = h.store
    await h.transport.onCall { _ in await seen.add((try? await store.entries()) ?? []) }

    await h.engine.enqueue(action: tick("t1"), label: "Tick t1")

    let sends = await h.transport.sends
    #expect(sends.count == 1)
    let operationId = try required(sends.first?.operationId)
    #expect(UUID(uuidString: operationId) != nil)
    #expect(operationId == operationId.lowercased())
    #expect(
      sends.first
        == .send(
          token: "tok-1", operationId: operationId, action: tick("t1"), expectedOwner: "user-1",
          basis: OutboxBasis(baseRevision: 5, ownRevisions: [], readsBeyond: true)))
    let kept = try required(await seen.first?.first)
    #expect(await seen.first?.count == 1)
    #expect(kept.operationId == operationId)
    #expect(kept.owner == "user-1")
    #expect(kept.kind == .command)
    #expect(kept.action == tick("t1"))
    #expect(kept.baseRevision == 5)
    #expect(kept.label == "Tick t1")
    #expect(kept.createdAt == noon)
    #expect(kept.state == .pending)
    #expect(await h.calls.count == 3)  // the change is sent; nothing is loaded for it
  }

  @Test func enqueue_with_nothing_shown_does_nothing() async throws {
    let empty = try await Harness()
    await empty.engine.enqueue(action: tick("t1"), label: "Tick t1")
    #expect(await empty.calls == [])
    #expect(await empty.log == [])

    let signedOut = try await Harness([.failure(TransportError.signedOut)], copy: try workspace(5))
    await signedOut.engine.start()
    await signedOut.engine.enqueue(action: tick("t1"), label: "Tick t1")
    #expect(await signedOut.calls == [.account(token: "tok-1")])
    #expect(await signedOut.log == [])
  }

  @Test func each_read_of_states_starts_with_the_current_state_and_never_repeats_one() async throws {
    let copy = try workspace(5)
    let h = try await Harness([.account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1"))], copy: copy)
    let early = h.engine.states

    await h.engine.start()

    var seen: [SyncState] = []
    for await value in early {
      seen.append(value)
      if value.phase == .ready { break }
    }
    #expect(seen == [state(.starting, nil), state(.starting, copy), state(.ready, copy)])
    #expect(await current(h.engine) == state(.ready, copy))
  }

  @Test func a_stream_whose_reader_stops_is_forgotten() async throws {
    let h = try await Harness()
    #expect(h.engine.subscriberCount == 0)
    do {
      let stream = h.engine.states
      #expect(h.engine.subscriberCount == 1)
      _ = stream
    }
    #expect(h.engine.subscriberCount == 0)

    let engine = h.engine
    let reader = Task { for await _ in engine.states {} }
    await until { engine.subscriberCount == 1 }
    reader.cancel()
    await reader.value
    #expect(h.engine.subscriberCount == 0)
  }

  // MARK: Interleavings

  @Test func sign_out_during_a_load_never_applies_its_reply() async throws {
    let gate = Gate()
    let h = try await Harness(
      [.account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")), .gated(gate), .done],
      copy: try workspace(5))
    await h.engine.start()

    let loading = Task { await h.engine.refresh() }
    await gate.reached()
    await h.engine.signOut()
    await gate.open(.workspace(.full(try workspace(9), owner: "user-1")))
    await loading.value

    #expect(await h.log == ["erase"])
    #expect(try await h.kept == nil)
    #expect(await current(h.engine) == state(.signedOut, nil))
  }

  @Test func sign_in_during_a_load_never_applies_the_previous_accounts_reply() async throws {
    let gate = Gate()
    let served = try workspace(2)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")), .gated(gate),
        .session(second), .workspace(.full(served, owner: "user-2")),
      ], copy: try workspace(5))
    await h.engine.start()
    let recorded = Seen()
    let engine = h.engine
    let watcher = Task { for await value in engine.states { await recorded.add(value) } }

    let loading = Task { await h.engine.refresh() }
    await gate.reached()
    let signingIn = Task { try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC") }
    _ = await h.engine.states.first { $0.phase == .ready && $0.workspace == nil }
    await gate.open(.workspace(.full(try workspace(9), owner: "user-1")))
    try await signingIn.value
    await loading.value
    watcher.cancel()

    #expect(await h.log == ["erase", "replace user-2 2"])
    #expect(try await h.kept?.owner == "user-2")
    #expect(await current(h.engine) == state(.ready, served))
    #expect(await !recorded.all.contains { $0.workspace?.revision == 9 })
  }

  @Test func an_entry_made_while_a_command_is_in_flight_learns_its_revision() async throws {
    let gate = Gate()
    let copy = try workspace(5)
    let applied = try changes(from: 5, to: 6, adding: "new")
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")), .gated(gate),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
      ], copy: copy)
    await h.engine.start()

    let firstChange = Task { await h.engine.enqueue(action: tick("a"), label: "Tick a") }
    await gate.reached()
    let secondChange = Task { await h.engine.enqueue(action: tick("b"), label: "Tick b") }
    let store = h.store
    await until { ((try? await store.entries().count) ?? 0) == 2 }
    await gate.open(.outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")))
    await firstChange.value
    await secondChange.value

    let sends = await h.transport.sends
    #expect(sends.count == 2)
    guard case .send(_, _, let action, _, let basis)? = sends.last else { return }
    #expect(action == tick("b"))
    #expect(basis == OutboxBasis(baseRevision: 5, ownRevisions: [6], readsBeyond: true))
    #expect(await h.transport.maxInFlight == 1)
  }
}

/// States a callback saw, in order.
actor Seen {
  private(set) var all: [SyncState] = []
  var first: SyncState? { all.first }
  func add(_ value: SyncState?) {
    if let value { all.append(value) }
  }
}

actor SeenEntries {
  private(set) var all: [[OutboxEntry]] = []
  var first: [OutboxEntry]? { all.first }
  func add(_ value: [OutboxEntry]) { all.append(value) }
}
