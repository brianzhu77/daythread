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
/// What the server answers an engine that opens on a copy at revision 5 it still holds.
private let opening: [FakeTransport.Reply] = [
  .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
]

/// A workspace at `revision` holding a day page for each of `days`, the open to-dos `tasks` and the to-dos `cancelled`,
/// cancelled elsewhere: a tick held on one of those is held for him rather than merged.
private func workspace(
  _ revision: Int, timezone: String = "UTC", days: [String] = ["2026-11-25"], tasks: [String] = [],
  cancelled: [String] = []
) throws -> Workspace {
  let pages = days.map { #"{"id":"day:\#($0)","type":"daily","date":"\#($0)","title":"\#($0)","document":"[]"}"# }
  let rows =
    tasks.map { #"{"id":"\#($0)","title":"\#($0)","status":"open","paused":false}"# }
    + cancelled.map { #"{"id":"\#($0)","title":"\#($0)","status":"cancelled","paused":false}"# }
  let text =
    #"{"revision":\#(revision),"timezone":"\#(timezone)","pages":[\#(pages.joined(separator: ","))],"#
    + #""tasks":[\#(rows.joined(separator: ","))]}"#
  return try required(Workspace(try JSON.parse(text)))
}

/// Changes from `from` to `revision` that add the task `added`.
private func changes(from: Int, to revision: Int, adding added: String) throws -> WorkspaceChanges {
  let task = #"{"id":"\#(added)","title":"\#(added)","status":"open","paused":false}"#
  let text =
    #"{"from":\#(from),"revision":\#(revision),"timezone":"UTC","pages":{"upsert":[],"remove":[]},"#
    + #""tasks":{"upsert":[\#(task)],"remove":[]}}"#
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
    basis: OutboxBasis(baseRevision: base, ownRevisions: own, readsBeyond: false))
}

/// `signedIn` is true unless the phase is signed out, as for every engine here that holds a session; tests of a server
/// with sign-in off say false.
private func state(
  _ phase: SyncState.Phase, _ workspace: Workspace?, offline: Bool = false, held: [HeldChange] = [],
  pending: Int = 0, waiting: Int = 0, failure: SyncFailure? = nil, signedIn: Bool? = nil, address: String? = nil,
  owner: String = "user-1"
) -> SyncState {
  // The owner is the shown copy's, so only a state that shows one names it.
  SyncState(
    phase: phase, workspace: workspace, offline: offline, held: held, pending: pending, waiting: waiting,
    failure: failure, signedIn: signedIn ?? (phase != .signedOut), address: address,
    owner: workspace == nil ? nil : owner)
}

/// How the entry `pending(operationId, …)` made reads once the server held it for `reason`.
private func heldTick(_ seq: Int, _ operationId: String, _ reason: HeldChange.Reason) -> HeldChange {
  HeldChange(id: seq, label: "Tick \(operationId)", reason: reason)
}

/// The first account's address, as its account check tells it or as typed at sign-in; the second's, only ever typed.
private let one = "one@example.com"
private let two = "two@example.com"

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

/// Whether `condition` comes to hold while the tasks already started run; gives up after a bounded number of turns,
/// so a test of something that must not happen ends.
private func eventually(_ condition: () async -> Bool) async -> Bool {
  for _ in 0..<2_000 {
    if await condition() { return true }
    await Task.yield()
  }
  return await condition()
}

/// The state a new reader of `states` gets at once, without its number (see `numbered` for it).
private func current(_ engine: SyncEngine) async -> SyncState? {
  await numbered(engine)?.unnumbered
}

/// The state a new reader of `states` gets at once.
private func numbered(_ engine: SyncEngine) async -> SyncState? {
  await engine.states.first { _ in true }
}

/// A memory store that writes down every call that changes it.
actor RecordingStore: WorkspaceStore {
  private let inner = MemoryWorkspaceStore()
  private(set) var log: [String] = []
  private var failing: Set<String> = []
  private var holding: Set<String> = []
  private var held: [String: CheckedContinuation<Void, Never>] = [:]
  private var arrivals: [String: [CheckedContinuation<Void, Never>]] = [:]

  func forget() { log = [] }

  /// Makes the next call named `name` wait, after it arrives, until `letGo(name)`.
  func hold(_ name: String) { holding.insert(name) }

  /// Returns once the held call named `name` is waiting.
  func arrived(_ name: String) async {
    if held[name] != nil { return }
    await withCheckedContinuation { arrivals[name, default: []].append($0) }
  }

  func letGo(_ name: String) {
    holding.remove(name)
    held.removeValue(forKey: name)?.resume()
  }

  private func pause(_ name: String) async {
    guard holding.remove(name) != nil else { return }
    await withCheckedContinuation { call in
      held[name] = call
      for arrival in arrivals.removeValue(forKey: name) ?? [] { arrival.resume() }
    }
  }

  /// Makes the call named `name` throw `StoreRefused` until `heal()`.
  func fail(_ name: String) { failing.insert(name) }
  func heal() { failing = [] }

  private func check(_ name: String) throws {
    if failing.contains(name) { throw StoreRefused() }
  }

  func load() async throws -> (workspace: Workspace, owner: String)? { try await inner.load() }

  func replace(with workspace: Workspace, owner: String) async throws {
    await pause("replace")
    log.append("replace \(owner) \(workspace.revision)")
    try check("replace")
    try await inner.replace(with: workspace, owner: owner)
  }

  func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws {
    log.append("write \(workspace.revision)")
    try check("write")
    try await inner.write(workspace, changed: changed)
  }

  func entries() async throws -> [OutboxEntry] {
    await pause("entries")
    return try await inner.entries()
  }

  func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry {
    await pause("append")
    log.append("append \(entry.operationId)")
    try check("append")
    return try await inner.append(entry)
  }

  func update(_ entry: OutboxEntry) async throws {
    log.append("update \(entry.operationId)")
    try check("update")
    try await inner.update(entry)
  }

  func remove(seq: Int) async throws {
    log.append("remove \(seq)")
    try check("remove")
    try await inner.remove(seq: seq)
  }

  func acknowledge(seq: Int, revision: Int?) async throws {
    log.append("acknowledge \(seq) \(revision.map(String.init) ?? "-")")
    try check("acknowledge")
    try await inner.acknowledge(seq: seq, revision: revision)
  }

  func drafts() async throws -> [PageDraft] {
    try check("drafts")
    return try await inner.drafts()
  }

  func put(_ draft: PageDraft) async throws {
    log.append("put \(draft.owner) \(draft.pageId)")
    try check("put")
    try await inner.put(draft)
  }

  func removeDraft(pageId: String, owner: String) async throws {
    log.append("removeDraft \(owner) \(pageId)")
    try check("removeDraft")
    try await inner.removeDraft(pageId: pageId, owner: owner)
  }

  func eraseKeepingDrafts(except owner: String?) async throws {
    log.append(owner.map { "eraseKeepingDrafts except \($0)" } ?? "eraseKeepingDrafts")
    try check("eraseKeepingDrafts")
    try await inner.eraseKeepingDrafts(except: owner)
  }
}

struct StoreRefused: Error {}

/// A token store whose writes fail.
final class RefusingTokenStore: TokenStore {
  private let inner = MemoryTokenStore()
  init(_ session: Session?) throws { if let session { try inner.write(session) } }
  func read() throws -> Session? { try inner.read() }
  func write(_ session: Session) throws { throw StoreRefused() }
  func clear() throws { try inner.clear() }
}

/// An engine over a fake server, a recording store and a memory token store, with what the store holds before.
private struct Harness {
  let transport: FakeTransport
  let store = RecordingStore()
  let tokens = MemoryTokenStore()
  /// The engine's waits before it tries again: none ends unless the test ends it.
  let waits: Waits
  let engine: SyncEngine

  init(
    _ script: [FakeTransport.Reply] = [], session: Session? = first, copy: Workspace? = nil,
    owner: String = "user-1", entries: [NewOutboxEntry] = [], now: Date = noon,
    reachability: any Reachability = NoReachability()
  ) async throws {
    transport = FakeTransport(script)
    let waits = Waits()
    self.waits = waits
    if let session { try tokens.write(session) }
    if let copy { try await store.replace(with: copy, owner: owner) }
    for entry in entries { _ = try await store.append(entry) }
    await store.forget()
    engine = SyncEngine(
      transport: transport, tokens: tokens, store: store, reachability: reachability,
      sleep: { try await waits.sleep($0) }, now: { now })
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
    let h = try await Harness(opening, copy: copy)
    let seen = Seen()
    let engine = h.engine
    await h.transport.onCall { _ in await seen.add(await current(engine)) }

    await h.engine.start()

    #expect(await seen.first == state(.starting, copy))
    #expect(await h.calls == [.account(token: "tok-1"), .workspace(token: "tok-1", have: 5)])
    #expect(await current(h.engine) == state(.ready, copy, address: one))
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
    #expect(await current(h.engine) == state(.ready, served, signedIn: false, owner: "local"))
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
    let h = try await Harness(opening, copy: copy)

    await h.engine.start()

    #expect(await h.calls == [.account(token: "tok-1"), .workspace(token: "tok-1", have: 5)])
    #expect(await h.log == [])
    #expect(await current(h.engine) == state(.ready, copy, address: one))
  }

  @Test func another_owner_replaces_everything_and_drops_their_outbox() async throws {
    let served = try workspace(9)
    let h = try await Harness(
      [.account(firstAccount), .workspace(.full(served, owner: "user-2"))], copy: try workspace(5),
      entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await h.calls == [.account(token: "tok-1"), .workspace(token: "tok-1", have: 5)])
    #expect(await h.log == ["replace user-2 9"])
    #expect(try await h.kept?.owner == "user-2")
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served, address: one, owner: "user-2"))
  }

  @Test func unchanged_under_another_owner_loads_the_workspace_whole() async throws {
    let served = try workspace(5, tasks: ["theirs"])
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-2")),
        .workspace(.full(served, owner: "user-2")),
      ], copy: try workspace(5))

    await h.engine.start()

    #expect(
      await h.calls == [
        .account(token: "tok-1"), .workspace(token: "tok-1", have: 5), .workspace(token: "tok-1", have: nil),
      ])
    #expect(await h.log == ["replace user-2 5"])
    #expect(await current(h.engine) == state(.ready, served, address: one, owner: "user-2"))
  }

  @Test func ensures_today_in_the_accounts_zone_once() async throws {
    // At 23:30 UTC on the 25th it is already the 26th in Auckland; the copy has only the 25th.
    let served = try workspace(4, timezone: "Pacific/Auckland", days: ["2026-11-25"])
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.full(served, owner: "user-1")), .failure(TransportError.offline),
        .workspace(.unchanged(revision: 4, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: ["day:2026-11-26"], stale: false, owner: "user-1")),
      ], now: lateEvening)

    await h.engine.start()
    await h.engine.refresh()

    // The request still waiting after the first load is not asked for again by the second; it is sent again.
    let sends = await h.transport.sends
    #expect(sends.count == 2)
    #expect(Set(sends.compactMap(\.operationId)).count == 1)
    guard case .send(_, _, let action, _, let basis)? = sends.first else { return }
    #expect(action == .object(["type": .string("ensure-day"), "date": .string("2026-11-26")]))
    #expect(basis == OutboxBasis(baseRevision: 4, ownRevisions: [], readsBeyond: true))
    #expect(await h.calls.count == 5)
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
    let copy = try workspace(5, cancelled: ["op-2"])
    let applied = try changes(from: 5, to: 6, adding: "new")
    let after = try required(copy.applying(applied))
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
        .workspace(.unchanged(revision: 6, owner: "user-1")),
      ], copy: copy, entries: [pending("op-1", base: 5), pending("op-2", base: 5)])

    await h.engine.start()

    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-2", base: 5, own: [6])])
    #expect(try await h.kept?.workspace == after)
    #expect(await h.log == ["write 6", "acknowledge 1 6", "update op-2"])
    #expect(try await h.entries == ["op-2 held(conflict) base 5 own [6]"])
    #expect(await current(h.engine) == state(.ready, after, held: [heldTick(2, "op-2", .conflict)], address: one))
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
    #expect(await h.log == ["replace user-1 8", "acknowledge 1 8"])
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served, address: one))
  }

  @Test func held_entry_stays_and_later_ones_still_go() async throws {
    let copy = try workspace(5, cancelled: ["op-1"])
    let applied = try changes(from: 5, to: 6, adding: "new")
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: ["task:a"], stale: false, owner: "user-1")),
        .outcome(.refused(message: "Not found", owner: "user-1")),
        .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
        .workspace(.unchanged(revision: 6, owner: "user-1")),
      ], copy: copy, entries: [pending("op-1", base: 5), pending("op-2", base: 5), pending("op-3", base: 5)])

    await h.engine.start()

    #expect(
      await h.transport.sends == [send("op-1", base: 5), send("op-2", base: 5), send("op-3", base: 5)])
    #expect(
      try await h.entries == ["op-1 held(conflict) base 5 own []", "op-2 held(Not found) base 5 own []"])
    #expect(
      await current(h.engine)
        == state(
          .ready, try required(copy.applying(applied)),
          held: [heldTick(1, "op-1", .conflict), heldTick(2, "op-2", .gone)], address: one))
    #expect(await h.calls.last == .workspace(token: "tok-1", have: 6), "two held answers, one load")
    #expect(await h.transport.unscripted == [])
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
    #expect(await current(h.engine) == state(.ready, served, address: one))
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
    #expect(await current(h.engine) == state(.ready, served, address: one, owner: "user-2"))
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
    #expect(await current(h.engine) == state(.ready, served, address: one, owner: "user-2"))
  }

  @Test func offline_keeps_everything_and_says_so() async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .failure(TransportError.offline),
      ], copy: copy, entries: [pending("op-1", base: 5)])

    await h.engine.start()

    #expect(await current(h.engine) == state(.ready, copy, offline: true, pending: 1, address: one))
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
    #expect(await h.log == [])
    #expect(await h.calls.count == 3)

    // The retry waits (the test never ends its wait); a refresh sends it again, and an answer clears `offline`.
    let served = try workspace(6, cancelled: ["op-1"])
    await h.transport.add([
      .workspace(.unchanged(revision: 5, owner: "user-1")),
      .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
      .workspace(.full(served, owner: "user-1")),
    ])
    await h.engine.refresh()
    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-1", base: 5)])
    #expect(await current(h.engine) == state(.ready, served, held: [heldTick(1, "op-1", .conflict)], address: one))
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

    #expect(await h.log == ["eraseKeepingDrafts", "replace user-2 3"])
    #expect(try h.tokens.read() == second)
    #expect(await h.transport.sends == [])
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served, address: two, owner: "user-2"))
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
    #expect(await !h.log.contains { $0.hasPrefix("erase") })
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, try required(copy.applying(applied)), address: one))
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

    #expect(await h.log == ["eraseKeepingDrafts", "replace user-2 2"])
    #expect(await h.calls.last == .workspace(token: "tok-2", have: nil))
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served, address: two, owner: "user-2"))
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
    #expect(await current(h.engine) == state(.ready, copy, address: one))
  }

  @Test func sign_out_erases_even_when_the_server_is_unreachable() async throws {
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
        .failure(TransportError.offline),
      ], copy: try workspace(5), entries: [pending("op-1", base: 5)])
    await h.engine.start()

    await h.engine.signOut(discardingUnsent: true)

    #expect(await h.calls.last == .signOut(token: "tok-1"))
    #expect(try h.tokens.read() == nil)
    #expect(try await h.kept == nil)
    #expect(try await h.entries == [])
    #expect(await current(h.engine)?.phase == .signedOut)
    #expect(await current(h.engine)?.workspace == nil)
    #expect(await current(h.engine)?.held == [])
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
    let change = Task { try await engine.enqueue(action: tick("t1"), label: "Tick t1") }
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
    _ = try await change.value
    await engine.settled()
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
      // Not 400: a command the server calls a bad request is held (see below).
      case .refused: TransportError.refused(status: 403, reason: nil)
      case .unlisted: URLError(.badServerResponse)
      }
    }

    /// What the state says about a pass that ended this way.
    var shown: SyncFailure {
      switch self {
      case .server, .wait, .refused: .server
      case .unreadable: .unreadable
      case .unlisted: .unreachable
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

    #expect(await current(h.engine) == state(.ready, copy, pending: 1, failure: failure.shown, address: one))
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
    #expect(await h.log == [])

    let served = try workspace(6, cancelled: ["op-1"])
    await h.transport.add([
      .workspace(.unchanged(revision: 5, owner: "user-1")),
      .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
      .workspace(.full(served, owner: "user-1")),
    ])
    await h.engine.refresh()
    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-1", base: 5)])
    #expect(
      await current(h.engine) == state(.ready, served, held: [heldTick(1, "op-1", .conflict)], address: one),
      "the next answer clears the failure")
  }

  @Test(arguments: Failure.allCases)
  func a_failed_load_keeps_everything_and_leaves_offline_as_it_was(_ failure: Failure) async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [.account(firstAccount), .failure(TransportError.offline), .failure(failure.error)], copy: copy,
      entries: [pending("op-1", base: 5)])

    await h.engine.start()
    #expect(await current(h.engine) == state(.ready, copy, offline: true, pending: 1, address: one))
    await h.engine.refresh()

    #expect(
      await current(h.engine)
        == state(.ready, copy, offline: true, pending: 1, failure: failure.shown, address: one))
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
    let copy = try workspace(5, cancelled: ["op-1"])
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
        .workspace(.unchanged(revision: 5, owner: "user-1")),
      ], copy: copy, entries: [pending("op-1", base: 5)])
    await h.engine.start()
    let before = await current(h.engine)
    await h.store.forget()

    // The change's send is cancelled, then a refresh's load is.
    await h.transport.add([.failure(CancellationError()), .failure(CancellationError())])
    try await h.engine.enqueue(action: tick("t1"), label: "Tick t1")
    await h.engine.settled()
    await h.engine.refresh()

    var after = before
    after?.enqueued = 1
    after?.pending = 1
    #expect(await current(h.engine) == after)
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
        .workspace(.unchanged(revision: 5, owner: "user-1")),
      ], copy: copy)
    await h.engine.start()
    let seen = SeenEntries()
    let store = h.store
    await h.transport.onCall { _ in await seen.add((try? await store.entries()) ?? []) }

    try await h.engine.enqueue(action: tick("t1"), label: "Tick t1")
    await h.engine.settled()

    let sends = await h.transport.sends
    #expect(sends.count == 1)
    let operationId = try required(sends.first?.operationId)
    #expect(UUID(uuidString: operationId) != nil)
    #expect(operationId == operationId.lowercased())
    #expect(
      sends.first
        == .send(
          token: "tok-1", operationId: operationId, action: tick("t1"), expectedOwner: "user-1",
          basis: OutboxBasis(baseRevision: 5, ownRevisions: [], readsBeyond: false)))
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
    // The change is sent with nothing loaded before it; the load after it is the one its hold asks for.
    #expect(await h.calls.count == 4)
    #expect(await h.calls.last == .workspace(token: "tok-1", have: 5))
  }

  @Test func enqueue_with_nothing_shown_is_refused() async throws {
    let empty = try await Harness()
    await #expect(throws: SyncError.notReady) { try await empty.engine.enqueue(action: tick("t1"), label: "Tick t1") }
    #expect(await empty.calls == [])
    #expect(await empty.log == [])

    let signedOut = try await Harness([.failure(TransportError.signedOut)], copy: try workspace(5))
    await signedOut.engine.start()
    await #expect(throws: SyncError.notReady) {
      try await signedOut.engine.enqueue(action: tick("t1"), label: "Tick t1")
    }
    #expect(await signedOut.calls == [.account(token: "tok-1")])
    #expect(await signedOut.log == [])
  }

  @Test func a_change_the_store_refuses_is_reported_and_never_sent() async throws {
    let h = try await Harness(opening, copy: try workspace(5))
    await h.engine.start()
    await h.store.fail("append")

    await #expect(throws: StoreRefused.self) { try await h.engine.enqueue(action: tick("t1"), label: "Tick t1") }

    #expect(await h.transport.sends == [])
    #expect(await h.calls.count == 2)
    #expect(try await h.entries == [])
  }

  @Test func each_read_of_states_starts_with_the_current_state_and_never_repeats_one() async throws {
    let copy = try workspace(5)
    let h = try await Harness(opening, copy: copy)
    let early = h.engine.states

    await h.engine.start()

    var seen: [SyncState] = []
    for await value in early {
      seen.append(value)
      if value.phase == .ready { break }
    }
    #expect(
      seen.map(\.unnumbered)
        == [state(.starting, nil, signedIn: false), state(.starting, copy), state(.ready, copy, address: one)])
    #expect(seen.map(\.published) == [0, 1, 2], "each state is numbered once, in the order published")
    #expect(await current(h.engine) == state(.ready, copy, address: one))
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
    await h.engine.signOut(discardingUnsent: true)
    await gate.open(.workspace(.full(try workspace(9), owner: "user-1")))
    await loading.value

    #expect(await h.log == ["eraseKeepingDrafts except user-1"])
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

    #expect(await h.log == ["eraseKeepingDrafts", "replace user-2 2"])
    #expect(try await h.kept?.owner == "user-2")
    #expect(await current(h.engine) == state(.ready, served, address: two, owner: "user-2"))
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
        .workspace(.full(try workspace(6, tasks: ["new"], cancelled: ["b"]), owner: "user-1")),
      ], copy: copy)
    await h.engine.start()

    let firstChange = Task { try await h.engine.enqueue(action: tick("a"), label: "Tick a") }
    await gate.reached()
    let secondChange = Task { try await h.engine.enqueue(action: tick("b"), label: "Tick b") }
    let store = h.store
    await until { ((try? await store.entries().count) ?? 0) == 2 }
    await gate.open(.outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")))
    _ = try await firstChange.value
    _ = try await secondChange.value
    await h.engine.settled()

    let sends = await h.transport.sends
    #expect(sends.count == 2)
    guard case .send(_, _, let action, _, let basis)? = sends.last else { return }
    #expect(action == tick("b"))
    #expect(basis == OutboxBasis(baseRevision: 5, ownRevisions: [6], readsBeyond: false))
    #expect(await h.transport.maxInFlight == 1)
  }
}

// MARK: - Acknowledging, sessions and copies

@Suite struct SyncEngineSessionTests {
  @Test func a_failed_acknowledge_keeps_the_entry_and_sends_it_again() async throws {
    let copy = try workspace(5)
    let applied = try changes(from: 5, to: 6, adding: "new")
    let after = try required(copy.applying(applied))
    let h = try await Harness(
      opening + [.outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1"))], copy: copy,
      entries: [pending("op-1", base: 5)])
    await h.store.fail("acknowledge")

    await h.engine.start()

    #expect(try await h.entries == ["op-1 pending base 5 own []"])
    #expect(try await h.kept?.workspace == after)

    // The server answers the replay with the receipt it kept; the copy is already past its base, so it loads whole.
    await h.store.heal()
    await h.transport.add([
      .workspace(.unchanged(revision: 6, owner: "user-1")),
      .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
      .workspace(.full(after, owner: "user-1")),
    ])
    await h.engine.refresh()

    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-1", base: 5)])
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, after, address: one))
  }

  /// An engine that met a 401, then a second engine opened on the same stores, as after a relaunch.
  private func relaunchAfterA401(
    _ script: [FakeTransport.Reply]
  ) async throws -> (h: Harness, next: SyncEngine, transport: FakeTransport, seen: Seen) {
    let h = try await Harness(
      [.failure(TransportError.signedOut)], copy: try workspace(5), entries: [pending("op-1", base: 5)])
    await h.engine.start()
    await h.store.forget()
    let transport = FakeTransport(script)
    let next = SyncEngine(transport: transport, tokens: h.tokens, store: h.store, now: { noon })
    let seen = Seen()
    let reader = Task { for await value in next.states { await seen.add(value) } }
    await next.start()
    reader.cancel()
    return (h, next, transport, seen)
  }

  @Test func after_a_401_the_next_launch_hides_the_copy_and_keeps_its_outbox() async throws {
    let (h, next, transport, seen) = try await relaunchAfterA401([])

    #expect(await transport.calls == [])
    #expect(await current(next) == state(.signedOut, nil))
    #expect(await !seen.all.contains { $0.workspace != nil })
    #expect(await h.log == [])
    #expect(try await h.kept?.workspace == workspace(5))
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
  }

  @Test func after_a_401_and_a_relaunch_the_same_owner_gets_the_copy_and_its_outbox_back() async throws {
    let copy = try workspace(5)
    let applied = try changes(from: 5, to: 6, adding: "new")
    let (h, next, transport, _) = try await relaunchAfterA401([
      .session(firstAgain), .workspace(.unchanged(revision: 5, owner: "user-1")),
      .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
    ])

    try await next.signIn(email: "one@example.com", password: "pw", timezone: "UTC")

    #expect(await !h.log.contains { $0.hasPrefix("erase") })
    #expect(await transport.sends == [send("op-1", base: 5, token: "tok-3")])
    #expect(try await h.entries == [])
    #expect(await current(next) == state(.ready, try required(copy.applying(applied)), address: one))
  }

  @Test func after_a_401_and_a_relaunch_another_owner_erases_first() async throws {
    let served = try workspace(2)
    let (h, next, transport, _) = try await relaunchAfterA401([
      .session(second), .workspace(.full(served, owner: "user-2")),
    ])

    try await next.signIn(email: "two@example.com", password: "pw", timezone: "UTC")

    #expect(await h.log == ["eraseKeepingDrafts", "replace user-2 2"])
    #expect(await transport.sends == [])
    #expect(try await h.entries == [])
    #expect(await current(next) == state(.ready, served, address: two, owner: "user-2"))
  }

  @Test func a_copy_an_erase_could_not_remove_stays_hidden_and_is_not_erased_at_launch() async throws {
    let h = try await Harness(opening + [.done], copy: try workspace(5))
    await h.engine.start()
    await h.store.fail("eraseKeepingDrafts")

    await h.engine.signOut(discardingUnsent: true)

    #expect(await h.log == ["eraseKeepingDrafts except user-1", "eraseKeepingDrafts except user-1"])
    #expect(await current(h.engine) == state(.signedOut, nil))
    #expect(try h.tokens.read() == nil)
    #expect(try await h.kept != nil)

    await h.store.heal()
    await h.store.forget()
    let silent = FakeTransport()
    let next = SyncEngine(transport: silent, tokens: h.tokens, store: h.store, now: { noon })
    let seen = Seen()
    let reader = Task { for await value in next.states { await seen.add(value) } }
    await next.start()
    reader.cancel()

    #expect(await silent.calls == [])
    #expect(await h.log == [])
    #expect(try await h.kept != nil)
    #expect(await current(next) == state(.signedOut, nil))
    #expect(await !seen.all.contains { $0.workspace != nil })
  }

  @Test func a_sign_in_that_cannot_erase_the_previous_account_fails_signed_out() async throws {
    let h = try await Harness(opening + [.session(second)], copy: try workspace(5))
    await h.engine.start()
    await h.store.fail("eraseKeepingDrafts")

    await #expect(throws: StoreRefused.self) {
      try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")
    }

    #expect(await current(h.engine) == state(.signedOut, nil))
    #expect(try h.tokens.read() == nil)
    #expect(
      await h.calls == [
        .account(token: "tok-1"), .workspace(token: "tok-1", have: 5),
        .signIn(email: "two@example.com", timezone: "UTC"),
      ])
  }

  @Test func a_local_copy_without_a_session_is_shown_at_once() async throws {
    let copy = try workspace(5)
    let h = try await Harness(
      [.account(localAccount), .workspace(.unchanged(revision: 5, owner: "local"))], session: nil, copy: copy,
      owner: "local")
    let seen = Seen()
    let engine = h.engine
    await h.transport.onCall { _ in await seen.add(await current(engine)) }

    await h.engine.start()

    #expect(await seen.first == state(.starting, copy, signedIn: false, owner: "local"))
    #expect(await current(h.engine) == state(.ready, copy, signedIn: false, owner: "local"))
  }

  @Test func a_session_for_another_owner_shows_nothing_until_the_load_replaces_the_copy() async throws {
    let served = try workspace(2)
    let h = try await Harness(
      [.account(Account(owner: "user-2", email: nil, signIn: true)), .workspace(.full(served, owner: "user-2"))],
      session: second, copy: try workspace(5))
    let seen = Seen()
    let engine = h.engine
    await h.transport.onCall { _ in await seen.add(await current(engine)) }

    await h.engine.start()

    #expect(await seen.all == [state(.starting, nil), state(.ready, nil)])
    #expect(await current(h.engine) == state(.ready, served, owner: "user-2"))
    #expect(try await h.kept?.owner == "user-2")
  }

  @Test func a_token_that_cannot_be_kept_ends_signed_out() async throws {
    let store = RecordingStore()
    try await store.replace(with: try workspace(5), owner: "user-1")
    let tokens = try RefusingTokenStore(first)
    let transport = FakeTransport(opening + [.session(second)])
    let engine = SyncEngine(transport: transport, tokens: tokens, store: store, now: { noon })
    await engine.start()

    await #expect(throws: StoreRefused.self) {
      try await engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")
    }

    #expect(await current(engine) == state(.signedOut, nil))
    #expect(try tokens.read() == nil)
    #expect(await transport.calls.count == 3)
  }

  @Test func a_sign_in_that_lands_during_a_sign_out_wins() async throws {
    let gate = Gate()
    let served = try workspace(2)
    let h = try await Harness(
      opening + [.gated(gate), .session(second), .workspace(.full(served, owner: "user-2"))], copy: try workspace(5))
    await h.engine.start()

    let signingOut = Task { await h.engine.signOut(discardingUnsent: true) }
    await gate.reached()
    try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")
    await gate.open(.done)
    _ = await signingOut.value

    #expect(try h.tokens.read() == second)
    #expect(try await h.kept?.owner == "user-2")
    #expect(try await h.kept?.workspace == served)
    #expect(await current(h.engine) == state(.ready, served, address: two, owner: "user-2"))
  }
}

// MARK: - What a pass that fails leaves behind

@Suite struct SyncEngineFailureTests {
  @Test func a_first_load_that_fails_says_why_with_nothing_shown() async throws {
    let h = try await Harness([.failure(TransportError.server(status: 502))], session: nil)

    await h.engine.start()

    #expect(await current(h.engine) == state(.starting, nil, failure: .server, signedIn: false))
  }

  @Test func a_bad_request_holds_the_command_and_the_next_one_still_goes() async throws {
    let copy = try workspace(5)
    let applied = try changes(from: 5, to: 6, adding: "new")
    let h = try await Harness(
      [
        .account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1")),
        .failure(TransportError.refused(status: 400, reason: "bad-request")),
        .outcome(.applied(receipt: .object([:]), changes: applied, owner: "user-1")),
      ], copy: copy, entries: [pending("op-1", base: 5), pending("op-2", base: 5)])

    await h.engine.start()

    #expect(await h.transport.sends == [send("op-1", base: 5), send("op-2", base: 5)])
    #expect(try await h.entries == ["op-1 held(bad-request) base 5 own []"])
    #expect(
      await current(h.engine)
        == state(.ready, try required(copy.applying(applied)), held: [heldTick(1, "op-1", .refused)], address: one))

    // Held, so no later pass sends it again.
    await h.transport.add([.workspace(.unchanged(revision: 6, owner: "user-1"))])
    await h.engine.refresh()
    #expect(await h.transport.sends.count == 2)
  }

  @Test func a_sign_in_that_cannot_keep_its_token_does_not_stop_a_waiting_sign_out_from_erasing() async throws {
    let gate = Gate()
    let store = RecordingStore()
    try await store.replace(with: try workspace(5), owner: "user-1")
    await store.forget()
    let tokens = try RefusingTokenStore(first)
    let transport = FakeTransport(opening + [.gated(gate), .session(firstAgain)])
    let engine = SyncEngine(transport: transport, tokens: tokens, store: store, now: { noon })
    await engine.start()

    let signingOut = Task { await engine.signOut(discardingUnsent: true) }
    await gate.reached()
    await #expect(throws: StoreRefused.self) {
      try await engine.signIn(email: "one@example.com", password: "pw", timezone: "UTC")
    }
    await gate.open(.done)
    _ = await signingOut.value

    #expect(await store.log == ["eraseKeepingDrafts except user-1"])
    #expect(try await store.load() == nil)
    #expect(try tokens.read() == nil)
    #expect(await current(engine) == state(.signedOut, nil))
  }

  @Test func a_zone_the_system_does_not_know_asks_for_no_day() async throws {
    let served = try workspace(4, timezone: "Mars/Olympus_Mons", days: [])
    let h = try await Harness([.account(firstAccount), .workspace(.full(served, owner: "user-1"))])

    await h.engine.start()

    #expect(await h.transport.sends == [])
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served, address: one))
  }

  @Test func signed_in_follows_the_stored_session() async throws {
    let local = try workspace(3)
    let served = try workspace(4)
    let h = try await Harness(
      [
        .account(localAccount), .workspace(.full(local, owner: "local")), .session(first),
        .workspace(.full(served, owner: "user-1")), .done,
      ], session: nil)

    await h.engine.start()
    #expect(await current(h.engine) == state(.ready, local, signedIn: false, owner: "local"))

    try await h.engine.signIn(email: "one@example.com", password: "pw", timezone: "UTC")
    #expect(await current(h.engine) == state(.ready, served, signedIn: true, address: one))

    await h.engine.signOut(discardingUnsent: true)
    #expect(await current(h.engine) == state(.signedOut, nil, signedIn: false))
  }
}

// MARK: - What is drawn, and a change accepted at once

private let today = LocalDate("2026-11-25")

/// A to-do's row as the server writes it.
private func row(_ id: String, title: String? = nil, status: String = "open", version: Int = 1) -> String {
  let doneOn = status == "done" ? #""2026-11-25""# : "null"
  return
    #"{"id":"\#(id)","title":"\#(title ?? id)","status":"\#(status)","paused":false,"doneOn":\#(doneOn),"#
    + #""version":\#(version)}"#
}

/// A workspace at `revision` holding today's page (unless `days` says otherwise) and `rows`, with the server's Undo
/// slot when `undo` is given (as JSON text).
private func board(
  _ revision: Int, days: [String] = ["2026-11-25"], rows: [String], undo: String? = nil
) throws -> Workspace {
  let pages = days.map { #"{"id":"day:\#($0)","type":"daily","date":"\#($0)","title":"\#($0)","document":"[]"}"# }
  let text =
    #"{"revision":\#(revision),"timezone":"UTC","pages":[\#(pages.joined(separator: ","))],"#
    + #""tasks":[\#(rows.joined(separator: ","))]\#(undo.map { #","undo":\#($0)"# } ?? "")}"#
  return try required(Workspace(try JSON.parse(text)))
}

/// Changes from `from` to `revision` that write `rows`, and leave the server's Undo slot as `undo` when given.
private func upserting(from: Int, to revision: Int, _ rows: [String], undo: String? = nil) throws -> WorkspaceChanges {
  let text =
    #"{"from":\#(from),"revision":\#(revision),"timezone":"UTC","pages":{"upsert":[],"remove":[]},"#
    + #""tasks":{"upsert":[\#(rows.joined(separator: ","))],"remove":[]}\#(undo.map { #","undo":\#($0)"# } ?? "")}"#
  return try required(WorkspaceChanges(try JSON.parse(text)))
}

/// The server's Undo slot for the command `operationId`, as JSON text.
private func marker(_ operationId: String, _ revision: Int) -> String {
  #"{"operationId":"\#(operationId)","revision":\#(revision)}"#
}

/// The tick the app sends for `taskId`.
private func done(_ taskId: String) -> JSONValue {
  Command.taskStatus(taskId: taskId, status: .done, today: today)
}

private func task(_ id: String, in workspace: Workspace?) -> TodoTask? {
  workspace?.tasks.first { $0.id == id }
}

@Suite struct SyncEnginePredictionTests {
  @Test func a_tick_is_drawn_before_the_server_is_asked() async throws {
    let gate = Gate()
    let h = try await Harness(opening + [.gated(gate)], copy: try board(5, rows: [row("t1")]))
    await h.engine.start()

    let ticket = try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)

    let drawn = await current(h.engine)
    #expect(ticket == 1)
    #expect(drawn?.enqueued == 1)
    #expect(task("t1", in: drawn?.workspace)?.status == .done)
    #expect(await h.transport.answered.allSatisfy { $0.operationId == nil })

    await h.transport.add([.workspace(.full(try board(6, rows: [row("t1", status: "cancelled")]), owner: "user-1"))])
    await gate.open(.outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")))
    await h.engine.settled()
  }

  @Test func the_servers_answer_replaces_the_prediction() async throws {
    let copy = try board(5, rows: [row("t1")])
    // The server moved the version further than the prediction's one step.
    let answer = try upserting(from: 5, to: 6, [row("t1", status: "done", version: 7)])
    let h = try await Harness(
      opening + [.outcome(.applied(receipt: .object([:]), changes: answer, owner: "user-1"))], copy: copy)
    await h.engine.start()

    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await h.engine.settled()

    let drawn = await current(h.engine)?.workspace
    #expect(drawn == copy.applying(answer))
    #expect(task("t1", in: drawn)?.version == 7)
    #expect(try await h.entries == [])
  }

  @Test func a_tick_made_offline_is_drawn_by_a_new_engine_on_the_same_store() async throws {
    let h = try await Harness(copy: try board(5, rows: [row("t1")]))
    await h.transport.goOffline()
    await h.engine.start()
    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await h.engine.settled()

    let gate = Gate()
    let transport = FakeTransport([.gated(gate)])
    let next = SyncEngine(transport: transport, tokens: h.tokens, store: h.store, now: { noon })
    let starting = Task { await next.start() }
    await gate.reached()

    let drawn = await current(next)
    #expect(await transport.answered == [])
    #expect(task("t1", in: drawn?.workspace)?.status == .done)
    #expect(drawn?.enqueued == 0)

    await gate.open(.failure(TransportError.offline))
    await starting.value
  }

  @Test func twenty_ticks_offline_are_all_drawn_and_sent_in_the_order_made() async throws {
    let ids = (0..<20).map { "t\($0)" }
    let h = try await Harness(copy: try board(5, rows: ids.map { row($0) }))
    await h.transport.goOffline()
    await h.engine.start()
    for id in ids { try await h.engine.enqueue(action: done(id), label: #"ticked "\#(id)""#) }
    await h.engine.settled()
    let drawnOffline = await current(h.engine)?.workspace
    #expect(ids.allSatisfy { task($0, in: drawnOffline)?.status == .done })
    let made = try await h.store.entries().map(\.operationId)

    // A new engine on the same store draws all twenty before any reply.
    let gate = Gate()
    let relaunched = FakeTransport([.gated(gate)])
    let next = SyncEngine(transport: relaunched, tokens: h.tokens, store: h.store, now: { noon })
    let starting = Task { await next.start() }
    await gate.reached()
    let drawnAfterRelaunch = await current(next)?.workspace
    #expect(await relaunched.answered == [])
    #expect(ids.allSatisfy { task($0, in: drawnAfterRelaunch)?.status == .done })
    #expect(await current(next)?.pending == 20)
    await gate.open(offline)
    await starting.value

    let answers = try ids.enumerated().map { index, id in
      FakeTransport.Reply.outcome(
        .applied(
          receipt: .object([:]),
          changes: try upserting(from: 5 + index, to: 6 + index, [row(id, status: "done", version: 2)]),
          owner: "user-1"))
    }
    await h.transport.add([.account(firstAccount), .workspace(.unchanged(revision: 5, owner: "user-1"))] + answers)
    let allDone = Seen()
    let engine = h.engine
    await h.transport.onCall { call in
      guard call.operationId != nil else { return }
      await allDone.add(await current(engine))
    }
    await h.transport.comeBack()
    await h.engine.refresh()

    #expect(await h.transport.sends.compactMap(\.operationId) == made)
    let seenAtEachSend = await allDone.all
    #expect(seenAtEachSend.count == 20)
    for (index, seen) in seenAtEachSend.enumerated() {
      #expect(ids.allSatisfy { task($0, in: seen.workspace)?.status == .done }, "before answer \(index + 1)")
    }
    let final = await current(h.engine)?.workspace
    #expect(final?.revision == 25)
    #expect(ids.allSatisfy { task($0, in: final)?.status == .done })
    #expect(try await h.entries == [])
  }

  @Test func a_load_that_changes_the_same_to_do_keeps_his_tap_on_top() async throws {
    let h = try await Harness(
      opening + [.failure(TransportError.offline)], copy: try board(5, rows: [row("t1", title: "Call Ann")]))
    await h.engine.start()
    try await h.engine.enqueue(action: done("t1"), label: #"ticked "Call Ann""#)
    await h.engine.settled()

    let renamed = try board(6, rows: [row("t1", title: "Call Ann back", version: 4)])
    await h.transport.add([.workspace(.full(renamed, owner: "user-1")), .failure(TransportError.offline)])
    await h.engine.refresh()

    let drawn = task("t1", in: await current(h.engine)?.workspace)
    #expect(drawn?.title == "Call Ann back")
    #expect(drawn?.status == .done)
    #expect(try await h.kept?.workspace == renamed, "the prediction is never stored")
  }

  @Test func a_tick_says_it_reads_nothing_beyond_its_row() async throws {
    let held: FakeTransport.Reply = .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1"))
    let h = try await Harness(
      [
        .account(firstAccount),
        .workspace(.full(try board(5, days: [], rows: [row("t1", status: "cancelled")]), owner: "user-1")), held,
        held, .workspace(.unchanged(revision: 5, owner: "user-1")), held,
      ])
    await h.engine.start()

    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await h.engine.settled()

    let sent = await h.transport.sends.compactMap { call -> (String?, Bool)? in
      guard case .send(_, _, let action, _, let basis) = call else { return nil }
      return (Command.type(of: action), basis.readsBeyond)
    }
    // The tick's hold loads, and today still has no page, so the load asks for it once more.
    #expect(sent.map(\.0) == ["ensure-day", "task-status", "ensure-day"])
    #expect(sent.map(\.1) == [true, false, true])
  }

  @Test func an_already_applied_tick_stays_drawn_until_the_load_brings_it() async throws {
    // The server applied the tick earlier, but its reply never reached the device: the copy lacks it.
    let tick = NewOutboxEntry(
      kind: .command, owner: "user-1", operationId: "op-1", action: done("t1"), baseRevision: 5, ownRevisions: [],
      label: #"ticked "t1""#, createdAt: noon, state: .pending, reason: nil)
    let gate = Gate()
    let h = try await Harness(
      opening + [.outcome(.alreadyApplied(owner: "user-1")), .gated(gate)],
      copy: try board(5, rows: [row("t1")]), entries: [tick])

    let starting = Task { await h.engine.start() }
    await gate.reached()
    #expect(task("t1", in: await current(h.engine)?.workspace)?.status == .done, "while the load is in flight")

    await gate.open(.failure(TransportError.offline))
    await starting.value
    #expect(task("t1", in: await current(h.engine)?.workspace)?.status == .done, "after the load failed")
    #expect(try await h.entries == ["op-1 pending base 5 own []"], "so it is sent again later")
  }

  @Test func an_already_applied_tick_is_no_longer_pending_once_its_load_is_in() async throws {
    let gate = Gate()
    let served = try board(6, rows: [row("t1", status: "done", version: 2), row("t2")])
    let h = try await Harness(
      opening + [.outcome(.alreadyApplied(owner: "user-1")), .workspace(.full(served, owner: "user-1")), .gated(gate)],
      copy: try board(5, rows: [row("t1"), row("t2")]),
      entries: [stored("op-1", done("t1")), stored("op-2", done("t2"))])

    let starting = Task { await h.engine.start() }
    await gate.reached()

    // The second tick is in flight: nothing else is published until it is answered.
    let shown = await current(h.engine)
    #expect(shown?.pending == 1, "the first is acknowledged and said so")
    #expect(task("t1", in: shown?.workspace)?.status == .done)

    await gate.open(offline)
    await starting.value
  }

  @Test func enqueue_before_a_copy_is_shown_throws_and_gives_no_ticket() async throws {
    let empty = try await Harness()
    await #expect(throws: SyncError.notReady) { try await empty.engine.enqueue(action: done("t1"), label: "t1") }
    #expect(await current(empty.engine)?.enqueued == 0)

    let h = try await Harness(
      opening + [
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")),
        .workspace(.unchanged(revision: 5, owner: "user-1")), .done,
      ],
      copy: try board(5, rows: [row("t1", status: "cancelled")]))
    await h.engine.start()
    #expect(try await h.engine.enqueue(action: done("t1"), label: "t1") == 1)
    await h.engine.settled()
    await h.engine.signOut(discardingUnsent: true)
    await #expect(throws: SyncError.notReady) { try await h.engine.enqueue(action: done("t1"), label: "t1") }
    #expect(await current(h.engine)?.enqueued == 1)
  }

  @Test func the_address_is_published_once_the_server_has_told_it() async throws {
    let h = try await Harness(
      opening + [.done, .session(second), .workspace(.full(try board(2, rows: []), owner: "user-2"))],
      copy: try board(5, rows: []))
    #expect(await current(h.engine)?.address == nil)

    await h.engine.start()
    #expect(await current(h.engine)?.address == "one@example.com")

    await h.engine.signOut(discardingUnsent: true)
    #expect(await current(h.engine)?.address == nil)

    try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")
    #expect(await current(h.engine)?.address == "two@example.com")
  }
}

// MARK: - A held change, a waiting one, and a command that is waited for

/// An entry as a store holds it before the engine opens, for `action`.
private func stored(
  _ operationId: String, _ action: JSONValue, label: String = "", base: Int = 5, own: [Int] = [],
  heldFor reason: String? = nil
) -> NewOutboxEntry {
  NewOutboxEntry(
    kind: .command, owner: "user-1", operationId: operationId, action: action, baseRevision: base,
    ownRevisions: own, label: label, createdAt: noon, state: reason == nil ? .pending : .held, reason: reason)
}

/// The day before `noon`'s, a day with no page in these tests.
private let yesterday = LocalDate("2026-11-24")!

private let conflict: FakeTransport.Reply = .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1"))

/// Changes from `from` to `revision` that add the day page for `date`, and leave the server's Undo slot as `undo`
/// (JSON text) when given.
private func addingDay(from: Int, to revision: Int, _ date: String, undo: String? = nil) throws -> WorkspaceChanges {
  let page = #"{"id":"day:\#(date)","type":"daily","date":"\#(date)","title":"\#(date)","document":"[]"}"#
  let text =
    #"{"from":\#(from),"revision":\#(revision),"timezone":"UTC","pages":{"upsert":[\#(page)],"remove":[]},"#
    + #""tasks":{"upsert":[],"remove":[]}\#(undo.map { #","undo":\#($0)"# } ?? "")}"#
  return try required(WorkspaceChanges(try JSON.parse(text)))
}

/// What the server can answer a change with, and how the held change then reads.
struct Answer: Sendable, CustomTestStringConvertible {
  let name: String
  /// Nil for an entry already stored as held with `stored`.
  let reply: FakeTransport.Reply?
  let stored: String?
  let reason: HeldChange.Reason
  var testDescription: String { name }

  /// The server's own held or refused outcome is followed by a load; a 400 and a stored hold are not.
  var loads: Bool {
    guard case .outcome? = reply else { return false }
    return true
  }

  static let all: [Answer] = [
    Answer(name: "held: conflict", reply: held("conflict"), stored: nil, reason: .conflict),
    Answer(name: "held: changed-since", reply: held("changed-since"), stored: nil, reason: .changedSince),
    Answer(name: "held: maybe-applied", reply: held("maybe-applied"), stored: nil, reason: .maybeApplied),
    Answer(name: "refused: Task not found", reply: refused("Task not found"), stored: nil, reason: .gone),
    Answer(name: "refused: Saved elsewhere", reply: refused("Saved elsewhere"), stored: nil, reason: .conflict),
    Answer(name: "refused: Something else", reply: refused("Something else"), stored: nil, reason: .refused),
    Answer(
      name: "a 400", reply: .failure(TransportError.refused(status: 400, reason: "bad-request")), stored: nil,
      reason: .refused),
    Answer(name: "stored: bad-request", reply: nil, stored: "bad-request", reason: .refused),
  ]

  private static func held(_ reason: String) -> FakeTransport.Reply {
    .outcome(.held(reason: reason, rows: [], stale: false, owner: "user-1"))
  }

  private static func refused(_ message: String) -> FakeTransport.Reply {
    .outcome(.refused(message: message, owner: "user-1"))
  }
}

@Suite struct SyncEngineHeldTests {
  @Test func a_held_tick_shows_the_servers_state_and_is_named() async throws {
    let copy = try board(5, rows: [row("t1", title: "Water the plants")])
    // Someone else cancelled the to-do after revision 5: that is why the server held the tick, and why the app cannot
    // merge it.
    let served = try board(6, rows: [row("t1", title: "Water the plants", status: "cancelled", version: 3)])
    let h = try await Harness(opening + [conflict, .workspace(.full(served, owner: "user-1"))], copy: copy)
    await h.engine.start()

    try await h.engine.enqueue(action: done("t1"), label: #"ticked "Water the plants""#)
    await h.engine.settled()

    let shown = await current(h.engine)
    #expect(await h.calls.last == .workspace(token: "tok-1", have: 5), "loaded in the same pass")
    #expect(shown?.workspace == served)
    #expect(task("t1", in: shown?.workspace)?.status == .cancelled)
    #expect(shown?.held == [HeldChange(id: 1, label: #"ticked "Water the plants""#, reason: .conflict)])
    #expect(shown?.pending == 0)
    #expect(await h.transport.unscripted == [])
  }

  @Test func keep_after_a_held_tick_is_sent_on_the_loaded_revision() async throws {
    let copy = try board(5, rows: [row("t1")])
    let served = try board(6, rows: [row("t1", title: "t1 renamed", status: "cancelled", version: 3)])
    let answer = try upserting(from: 6, to: 7, [row("t1", title: "t1 renamed", status: "done", version: 4)])
    let h = try await Harness(opening + [conflict, .workspace(.full(served, owner: "user-1"))], copy: copy)
    await h.engine.start()
    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await h.engine.settled()

    await h.transport.add([applied(answer)])
    await h.engine.keep(1)
    await h.engine.settled()

    guard case .send(_, _, _, _, let basis)? = await h.transport.sends.last else {
      Issue.record("Keep mine sent nothing")
      return
    }
    #expect(basis == OutboxBasis(baseRevision: 6, ownRevisions: [], readsBeyond: false))
    #expect(await current(h.engine)?.held == [])
    #expect(await current(h.engine)?.workspace == served.applying(answer))
    #expect(await h.transport.unscripted == [])
  }

  @Test func two_held_answers_in_one_pass_load_once() async throws {
    let h = try await Harness(
      opening + [conflict, conflict, .workspace(.unchanged(revision: 5, owner: "user-1"))],
      copy: try board(5, rows: [row("a", status: "cancelled"), row("b", status: "cancelled")]),
      entries: [stored("op-a", done("a"), label: #"ticked "a""#), stored("op-b", done("b"), label: #"ticked "b""#)])

    await h.engine.start()

    let loads = await h.calls.filter { if case .workspace = $0 { true } else { false } }
    #expect(loads == [.workspace(token: "tok-1", have: 5), .workspace(token: "tok-1", have: 5)])
    #expect(await h.transport.sends.count == 2)
    #expect(await current(h.engine)?.held.map(\.id) == [1, 2])
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_load_after_a_held_tick_that_finds_no_page_for_today_asks_for_it_in_the_same_pass() async throws {
    let copy = try board(5, rows: [row("t1")])
    // Today's page was deleted and the to-do cancelled elsewhere since revision 5.
    let served = try board(6, days: [], rows: [row("t1", status: "cancelled")])
    let h = try await Harness(
      opening + [
        conflict, .workspace(.full(served, owner: "user-1")), applied(try addingDay(from: 6, to: 7, "2026-11-25")),
      ], copy: copy)
    await h.engine.start()

    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await h.engine.settled()

    let sent = await h.transport.sends.compactMap { call -> String? in
      guard case .send(_, _, let action, _, _) = call else { return nil }
      return Command.type(of: action)
    }
    #expect(sent == ["task-status", "ensure-day"])
    #expect(await current(h.engine)?.workspace?.dayPage(try required(today)) != nil)
    #expect(try await h.store.entries().map(\.state) == [.held])
    #expect(await h.transport.unscripted == [])
  }

  @Test(arguments: Answer.all)
  func each_answer_reads_as_its_reason(_ answer: Answer) async throws {
    let tick = stored("op-1", done("t1"), label: #"ticked "t1""#, heldFor: answer.stored)
    let h = try await Harness(
      opening + (answer.reply.map { [$0] } ?? [])
        + (answer.loads ? [.workspace(.unchanged(revision: 5, owner: "user-1"))] : []),
      copy: try board(5, rows: [row("t1", status: "cancelled")]), entries: [tick])

    await h.engine.start()

    let held = await current(h.engine)?.held
    #expect(held == [HeldChange(id: 1, label: #"ticked "t1""#, reason: answer.reason)])
    let keepable: [HeldChange.Reason] = [.conflict, .changedSince, .maybeApplied]
    #expect(held?.first?.canKeep == keepable.contains(answer.reason))
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_later_tick_on_the_same_to_do_waits_and_one_on_another_goes() async throws {
    let copy = try board(5, rows: [row("a"), row("b")])
    let answer = try upserting(from: 5, to: 6, [row("b", status: "done", version: 2)])
    let h = try await Harness(
      opening + [.outcome(.applied(receipt: .object([:]), changes: answer, owner: "user-1"))], copy: copy,
      entries: [stored("op-held", done("a"), heldFor: "conflict")])
    await h.engine.start()

    try await h.engine.enqueue(action: done("a"), label: #"ticked "a""#)
    try await h.engine.enqueue(action: done("b"), label: #"ticked "b""#)
    await h.engine.settled()

    let sent = await h.transport.sends.compactMap { call -> JSONValue? in
      guard case .send(_, _, let action, _, _) = call else { return nil }
      return action
    }
    #expect(sent == [done("b")])
    let shown = await current(h.engine)
    #expect(shown?.waiting == 1)
    #expect(shown?.pending == 0)
    #expect(task("a", in: shown?.workspace)?.status == .done, "a waiting tick is drawn")
    #expect(task("b", in: shown?.workspace)?.version == 2)
    #expect(try await h.store.entries().map(\.state) == [.held, .pending])
  }

  @Test func keep_sends_it_again_on_the_current_revision() async throws {
    let copy = try board(7, rows: [row("a")])
    let answer = try upserting(from: 7, to: 8, [row("a", status: "done", version: 2)])
    let h = try await Harness(
      [.account(firstAccount), .workspace(.unchanged(revision: 7, owner: "user-1"))], copy: copy,
      entries: [
        stored("op-held", done("a"), label: #"ticked "a""#, base: 5, own: [6], heldFor: "conflict"),
        stored("op-waiting", done("a"), base: 5),
      ])
    await h.engine.start()
    #expect(await h.transport.sends == [], "the later tick waits")

    await h.transport.add([
      .outcome(.applied(receipt: .object([:]), changes: answer, owner: "user-1")), conflict,
      // Cancelled elsewhere after his first tick went in: the waiting one cannot be merged.
      .workspace(.full(try board(9, rows: [row("a", status: "cancelled", version: 3)]), owner: "user-1")),
    ])
    await h.engine.keep(1)
    await h.engine.settled()

    let sends = await h.transport.sends
    #expect(sends.map(\.operationId) == ["op-held", "op-waiting"])
    guard case .send(_, _, _, _, let basis)? = sends.first else { return }
    #expect(basis == OutboxBasis(baseRevision: 7, ownRevisions: [], readsBeyond: false))
    #expect(await current(h.engine)?.held.map(\.id) == [2])
    #expect(await h.transport.unscripted == [])
  }

  @Test func keep_does_nothing_for_a_change_that_cannot_be_kept() async throws {
    let h = try await Harness(
      opening, copy: try board(5, rows: [row("a")]),
      entries: [stored("op-held", done("a"), heldFor: "Task not found")])
    await h.engine.start()

    await h.engine.keep(1)
    await h.engine.settled()

    #expect(await h.transport.sends == [])
    #expect(try await h.entries == ["op-held held(Task not found) base 5 own []"])
  }

  @Test func discard_removes_it_and_lets_the_waiting_one_go() async throws {
    let copy = try board(5, rows: [row("a")])
    let answer = try upserting(from: 5, to: 6, [row("a", status: "done", version: 2)])
    let h = try await Harness(
      opening, copy: copy,
      entries: [stored("op-held", done("a"), heldFor: "conflict"), stored("op-waiting", done("a"))])
    await h.engine.start()

    await h.transport.add([.outcome(.applied(receipt: .object([:]), changes: answer, owner: "user-1"))])
    await h.engine.discard(1)
    await h.engine.settled()

    #expect(await h.transport.sends.map(\.operationId) == ["op-waiting"])
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, try required(copy.applying(answer)), address: one))
  }

  @Test func the_to_do_is_deleted_elsewhere() async throws {
    let h = try await Harness(
      opening, copy: try board(5, rows: [row("a", title: "Water the plants")]),
      entries: [
        stored("op-held", done("a"), heldFor: "conflict"),
        stored("op-waiting", done("a"), label: #"ticked "Water the plants""#),
      ])
    await h.engine.start()

    let emptied = try board(6, rows: [])
    await h.transport.add([.workspace(.full(emptied, owner: "user-1"))])
    await h.engine.refresh()
    #expect(await current(h.engine)?.workspace == emptied, "nothing is drawn for a to-do that is gone")
    #expect(await current(h.engine)?.waiting == 1)

    await h.transport.add([
      .outcome(.refused(message: "Task not found", owner: "user-1")),
      .workspace(.unchanged(revision: 6, owner: "user-1")),
    ])
    await h.engine.discard(1)
    await h.engine.settled()

    let held = await current(h.engine)?.held
    #expect(held == [HeldChange(id: 2, label: #"ticked "Water the plants""#, reason: .gone)])
    #expect(held?.first?.canKeep == false)
    #expect(await current(h.engine)?.workspace == emptied)
  }

  @Test func a_held_ensure_day_is_removed_not_shown() async throws {
    let missing = try board(4, days: [], rows: [])
    let h = try await Harness([.account(firstAccount), .workspace(.full(missing, owner: "user-1")), conflict])

    await h.engine.start()

    #expect(await h.transport.sends.count == 1)
    #expect(await current(h.engine)?.held == [])
    #expect(try await h.entries == [])
    #expect(await h.transport.unscripted == [], "a held request for today's page asks for no load")

    // Asked again after the next load, while today still has no page.
    await h.transport.add([.workspace(.unchanged(revision: 4, owner: "user-1")), conflict])
    await h.engine.refresh()
    let asked = await h.transport.sends.compactMap { call -> String? in
      guard case .send(_, _, let action, _, _) = call else { return nil }
      return Command.type(of: action)
    }
    #expect(asked == ["ensure-day", "ensure-day"])
    #expect(Set(await h.transport.sends.compactMap(\.operationId)).count == 2)
    #expect(try await h.entries == [])
  }

  @Test func the_engines_own_request_for_todays_page_is_not_counted_as_pending() async throws {
    let missing = try board(4, days: [], rows: [])
    let h = try await Harness([.account(firstAccount), .workspace(.full(missing, owner: "user-1")), offline])

    await h.engine.start()

    let shown = await current(h.engine)
    #expect(shown?.offline == true)
    #expect(shown?.pending == 0, "he did not make it")
    #expect(try await h.store.entries().map(\.asksForADay) == [true], "still sent when the network is back")
  }

  @Test func a_held_ensure_day_left_in_the_store_is_removed_at_start() async throws {
    let leftover = stored("op-day", Command.ensureDay(yesterday), heldFor: "conflict")
    let h = try await Harness(opening, copy: try board(5, rows: []), entries: [leftover])
    let seen = SeenEntries()
    let store = h.store
    await h.transport.onCall { _ in await seen.add((try? await store.entries()) ?? []) }

    await h.engine.start()

    #expect(await seen.first == [], "removed before the first request")
    #expect(try await h.entries == [])
    #expect(await current(h.engine)?.held == [])
  }

  @Test func todays_page_in_trash_is_not_asked_for_again() async throws {
    let text = """
      {"revision":5,"timezone":"UTC","pages":[{"id":"day:2026-11-25","type":"daily","date":"2026-11-25",\
      "title":"2026-11-25","document":"[]","trashedAt":"2026-11-25T08:00:00.000Z","trashId":"trash-1"}],"tasks":[]}
      """
    let trashed = try required(Workspace(try JSON.parse(text)))
    let h = try await Harness([.account(firstAccount), .workspace(.full(trashed, owner: "user-1"))])

    await h.engine.start()

    #expect(await h.transport.sends == [])
    #expect(try await h.entries == [])
    #expect(await h.log == ["replace user-1 5"])
  }

  @Test func perform_sends_once_after_the_queue_and_stores_nothing() async throws {
    let copy = try board(5, rows: [row("t1")])
    let ticked = try upserting(from: 5, to: 6, [row("t1", status: "done", version: 2)])
    let added = try addingDay(from: 6, to: 7, "2026-11-24")
    let h = try await Harness(
      opening + [.failure(TransportError.offline)], copy: copy, entries: [stored("op-tick", done("t1"))])
    await h.engine.start()
    #expect(await current(h.engine)?.pending == 1)
    await h.store.forget()

    let seen = SeenEntries()
    let store = h.store
    await h.transport.onCall { _ in await seen.add((try? await store.entries()) ?? []) }
    await h.transport.add([
      .outcome(.applied(receipt: .object([:]), changes: ticked, owner: "user-1")),
      .outcome(.applied(receipt: .object([:]), changes: added, owner: "user-1")),
    ])
    let action = Command.ensureDay(yesterday)
    let performed = await h.engine.perform(action: action)

    #expect(performed.answer != nil, "applied")
    #expect(await current(h.engine)?.workspace?.dayPage(yesterday) != nil, "in before it returns")
    let sends = await h.transport.sends
    #expect(sends.count == 3)
    #expect(sends.dropFirst().first?.operationId == "op-tick")
    guard case .send(_, let operationId, let sent, let owner, let basis)? = sends.last else { return }
    #expect(sent == action)
    #expect(owner == "user-1")
    #expect(basis == OutboxBasis(baseRevision: 6, ownRevisions: [], readsBeyond: true))
    #expect(UUID(uuidString: operationId) != nil)
    #expect(operationId == operationId.lowercased())
    #expect(operationId != "op-tick")
    #expect(await seen.all.last == [], "never stored, not even while it is sent")
    #expect(await !h.log.contains { $0.hasPrefix("append") })
    #expect(try await h.entries == [])
  }

  @Test func perform_offline_answers_offline_and_leaves_no_entry() async throws {
    let h = try await Harness(opening, copy: try board(5, rows: []))
    await h.engine.start()
    await h.transport.goOffline()

    let performed = await h.engine.perform(action: Command.ensureDay(yesterday))

    #expect(performed == .offline)
    #expect(try await h.entries == [])
    #expect(await h.log == [])
    #expect(await current(h.engine)?.offline == true)

    // Never replayed once the network is back.
    await h.transport.comeBack()
    await h.transport.add([.workspace(.unchanged(revision: 5, owner: "user-1"))])
    await h.engine.refresh()
    #expect(await h.transport.sends.count == 1)
  }

  @Test func perform_refused_gives_the_servers_reason() async throws {
    let unchanged: FakeTransport.Reply = .workspace(.unchanged(revision: 5, owner: "user-1"))
    let h = try await Harness(
      opening + [
        .outcome(.refused(message: "Nothing to restore", owner: "user-1")), unchanged,
        .outcome(.held(reason: "conflict", rows: [], stale: false, owner: "user-1")), unchanged,
        .failure(TransportError.refused(status: 400, reason: "bad-request")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    let restore = Command.restoreBatch(trashId: "trash-1")
    #expect(await h.engine.perform(action: restore) == .refused("Nothing to restore"))
    #expect(await h.engine.perform(action: restore) == .refused("conflict"))
    #expect(await h.engine.perform(action: restore) == .refused("bad-request"))
    #expect(await h.transport.sends.count == 3, "a hold that is not stale is not sent again")
    #expect(try await h.entries == [])
    #expect(await current(h.engine)?.held == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_refused_command_is_followed_by_a_load_before_it_is_answered() async throws {
    // Restored elsewhere already: the server has yesterday's page back and nothing in Trash.
    let served = try board(6, days: ["2026-11-24", "2026-11-25"], rows: [])
    let h = try await Harness(
      opening + [
        .outcome(.refused(message: "Nothing to restore", owner: "user-1")), .workspace(.full(served, owner: "user-1")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    #expect(await h.engine.perform(action: Command.restoreBatch(trashId: "trash-1")) == .refused("Nothing to restore"))

    #expect(await h.calls.last == .workspace(token: "tok-1", have: 5))
    #expect(await current(h.engine)?.workspace == served, "loaded before it is answered")
    #expect(await h.transport.sends.count == 1)
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_command_held_because_the_copy_is_behind_is_sent_again_once_after_a_load() async throws {
    let served = try board(6, rows: [row("t1")])
    let h = try await Harness(
      opening + [
        .outcome(.held(reason: "changed-since", rows: [], stale: true, owner: "user-1")),
        .workspace(.full(served, owner: "user-1")),
        applied(try addingDay(from: 6, to: 7, "2026-11-24")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    let action = Command.ensureDay(yesterday)
    #expect(await h.engine.perform(action: action).answer != nil, "applied")

    #expect(await current(h.engine)?.workspace?.dayPage(yesterday) != nil, "in before it returns")
    let sends = await h.transport.sends
    #expect(sends.count == 2)
    guard case .send(_, let firstId, let firstAction, _, let firstBasis)? = sends.first,
      case .send(_, let secondId, let secondAction, _, let secondBasis)? = sends.last
    else { return }
    #expect(firstAction == action)
    #expect(secondAction == action)
    #expect(secondId == firstId, "the same operation")
    #expect(firstBasis == OutboxBasis(baseRevision: 5, ownRevisions: [], readsBeyond: true))
    #expect(secondBasis == OutboxBasis(baseRevision: 6, ownRevisions: [], readsBeyond: true))
    #expect(try await h.entries == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_command_held_as_stale_twice_is_refused_and_not_sent_a_third_time() async throws {
    let stale: FakeTransport.Reply = .outcome(.held(reason: "conflict", rows: ["page:x"], stale: true, owner: "user-1"))
    let h = try await Harness(
      opening + [
        stale, .workspace(.full(try board(6, rows: []), owner: "user-1")), stale,
        .workspace(.full(try board(7, rows: []), owner: "user-1")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    #expect(await h.engine.perform(action: Command.ensureDay(yesterday)) == .refused("conflict"))

    #expect(await h.transport.sends.count == 2)
    #expect(await current(h.engine)?.workspace?.revision == 7, "try again is built on what the server has")
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_queued_command_is_never_answered_with_another_commands_refusal() async throws {
    let forbidden = TransportError.refused(status: 403, reason: "forbidden")
    let added = try addingDay(from: 6, to: 7, "2026-11-24")
    let tickAnswer = try upserting(from: 5, to: 6, [row("t1", status: "done", version: 2)])

    // Two commands wait behind a tick in flight; the server refuses the first outright.
    let gate = Gate()
    let h = try await Harness(
      opening + [.gated(gate), .failure(forbidden), applied(added)], copy: try board(5, rows: [row("t1")]))
    await h.engine.start()
    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await gate.reached()
    let requested = await h.engine.passRequests
    let restoring = Task { await h.engine.perform(action: Command.restoreBatch(trashId: "trash-1")) }
    await until { await h.engine.passRequests == requested + 1 }
    let starting = Task { await h.engine.perform(action: Command.ensureDay(yesterday)) }
    await until { await h.engine.passRequests == requested + 2 }
    await gate.open(applied(tickAnswer))

    #expect(await restoring.value == .refused("forbidden"))
    #expect(await starting.value.answer != nil, "sent, and answered with its own outcome")
    #expect(await h.transport.sends.count == 3)
  }

  @Test func a_command_not_sent_after_a_refused_tick_reads_offline() async throws {
    let gate = Gate()
    let h = try await Harness(opening + [.gated(gate)], copy: try board(5, rows: [row("t1")]))
    await h.engine.start()
    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await gate.reached()
    let requested = await h.engine.passRequests
    let performing = Task { await h.engine.perform(action: Command.ensureDay(yesterday)) }
    await until { await h.engine.passRequests == requested + 1 }

    await gate.open(.failure(TransportError.refused(status: 403, reason: "forbidden")))

    let performed = await performing.value
    #expect(performed == .offline, "never the tick's reason")
    // The pass the command asked for may already be sending the tick again by now, so the count of sends is not
    // fixed; what must hold is that the command itself was never sent.
    let sent = await h.transport.sends.compactMap { call -> String? in
      guard case .send(_, _, let action, _, _) = call else { return nil }
      return Command.type(of: action)
    }
    #expect(!sent.isEmpty && !sent.contains("ensure-day"))
  }

  @Test func a_command_taken_from_the_queue_as_a_sign_out_begins_is_answered_signed_out() async throws {
    let h = try await Harness(opening + [.done], copy: try board(5, rows: [row("t1")]))
    await h.engine.start()
    let answer = Answered()
    let engine = h.engine

    // The pass's drain holds the store section while it reads the outbox.
    await h.store.hold("entries")
    Task { await answer.set(await engine.perform(action: Command.ensureDay(yesterday))) }
    await h.store.arrived("entries")
    // A tick waits for the section, then holds it while the pass waits to take the command from the queue.
    await h.store.hold("append")
    let enqueuing = Task { try? await engine.enqueue(action: done("t1"), label: #"ticked "t1""#) }
    try #require(await eventually { await engine.sectionWaiters == 1 })
    await h.store.letGo("entries")
    await h.store.arrived("append")
    try #require(await eventually { await engine.sectionWaiters == 1 }, "the pass waits to take the command")
    // The sign-out waits behind the pass, so it wins the section between the command leaving the queue and its send.
    let signingOut = Task { await engine.signOut(discardingUnsent: true) }
    try #require(await eventually { await engine.sectionWaiters == 2 })
    await h.store.letGo("append")
    _ = await enqueuing.value
    #expect(await signingOut.value == 0)
    await h.engine.settled()

    #expect(await eventually { await answer.value != nil }, "answered, not left waiting")
    #expect(await answer.value == .signedOut)
    #expect(await h.transport.sends == [])
  }

  @Test func a_sign_out_while_the_load_before_a_resend_is_written_answers_signed_out() async throws {
    let h = try await Harness(
      opening + [
        .outcome(.held(reason: "changed-since", rows: [], stale: true, owner: "user-1")),
        .workspace(.full(try board(6, rows: []), owner: "user-1")), .done,
      ], copy: try board(5, rows: []))
    await h.engine.start()
    let answer = Answered()
    let engine = h.engine

    await h.store.hold("replace")
    Task { await answer.set(await engine.perform(action: Command.ensureDay(yesterday))) }
    await h.store.arrived("replace")
    let signingOut = Task { await engine.signOut(discardingUnsent: true) }
    try #require(await eventually { await engine.sectionWaiters == 1 })
    await h.store.letGo("replace")
    #expect(await signingOut.value == 0)
    await h.engine.settled()

    #expect(await eventually { await answer.value != nil }, "answered, not left waiting")
    #expect(await answer.value == .signedOut)
    #expect(await h.transport.sends.count == 1, "not sent again once the sign-out began")
  }

  @Test func a_sign_out_while_the_load_before_a_resend_is_in_flight_answers_signed_out() async throws {
    let gate = Gate()
    let h = try await Harness(
      opening + [.outcome(.held(reason: "changed-since", rows: [], stale: true, owner: "user-1")), .gated(gate), .done],
      copy: try board(5, rows: []))
    await h.engine.start()
    let answer = Answered()
    let engine = h.engine

    Task { await answer.set(await engine.perform(action: Command.ensureDay(yesterday))) }
    await gate.reached()
    #expect(await h.engine.signOut(discardingUnsent: true) == 0)
    await gate.open(.workspace(.full(try board(6, rows: []), owner: "user-1")))
    await h.engine.settled()

    #expect(await eventually { await answer.value != nil }, "answered, not left waiting")
    #expect(await answer.value == .signedOut)
    #expect(await h.transport.sends.count == 1)
  }

  @Test func perform_while_signed_out_answers_signedOut() async throws {
    let h = try await Harness([.failure(TransportError.signedOut)], copy: try board(5, rows: []))
    await h.engine.start()

    #expect(await h.engine.perform(action: Command.ensureDay(yesterday)) == .signedOut)
    #expect(await h.calls == [.account(token: "tok-1")])
  }

  // MARK: The answer, its receipt, and the state that holds it

  @Test func perform_answers_with_the_receipt_and_the_operation_id() async throws {
    let receipt: JSONValue = .object(["revision": .number("6"), "message": .string("Moved to Tue, Nov 24")])
    let h = try await Harness(
      opening + [
        .outcome(.applied(receipt: receipt, changes: try addingDay(from: 5, to: 6, "2026-11-24"), owner: "user-1")),
        .outcome(.alreadyApplied(owner: "user-1")),
        .workspace(.full(try board(7, days: ["2026-11-23", "2026-11-24", "2026-11-25"], rows: []), owner: "user-1")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    let answer = try #require(await h.engine.perform(action: Command.ensureDay(yesterday)).answer)
    let sent = await h.transport.sends.last?.operationId
    #expect(answer.operationId == sent)
    #expect(answer.receipt == receipt)

    let again = try #require(await h.engine.perform(action: Command.ensureDay(LocalDate("2026-11-23")!)).answer)
    let sentAgain = await h.transport.sends.last?.operationId
    #expect(again.operationId == sentAgain)
    #expect(again.operationId != answer.operationId)
    #expect(again.receipt == nil, "already applied: the server sent no receipt")
    #expect(await h.transport.unscripted == [])
  }

  @Test func perform_held_then_sent_again_answers_with_its_one_operation_id() async throws {
    let h = try await Harness(
      opening + [
        .outcome(.held(reason: "changed-since", rows: [], stale: true, owner: "user-1")),
        .workspace(.full(try board(6, rows: []), owner: "user-1")),
        applied(try addingDay(from: 6, to: 7, "2026-11-24")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    let answer = try #require(await h.engine.perform(action: Command.ensureDay(yesterday)).answer)

    #expect(await h.transport.sends.map(\.operationId) == [answer.operationId, answer.operationId])
    #expect(await h.transport.unscripted == [])
  }

  @Test func perform_answer_names_the_state_that_holds_it() async throws {
    let earlier = LocalDate("2026-11-23")!
    let h = try await Harness(
      opening + [
        applied(try addingDay(from: 5, to: 6, "2026-11-24")),
        // Changes that do not start from the copy's revision: the answer is in once the whole load is.
        applied(try addingDay(from: 9, to: 10, "2026-11-23")),
        .workspace(.full(try board(10, days: ["2026-11-23", "2026-11-24", "2026-11-25"], rows: []), owner: "user-1")),
      ], copy: try board(5, rows: []))
    let published = Published(h.engine)
    await h.engine.start()

    for date in [yesterday, earlier] {
      let answer = try #require(await h.engine.perform(action: Command.ensureDay(date)).answer)

      let states = await published.all(through: h.engine)
      #expect(states.map(\.published) == Array(0..<states.count), "each state is numbered once, in order")
      let holding = try #require(states.first { $0.published == answer.published })
      #expect(holding.workspace?.dayPage(date) != nil, "the state it names holds it")
      #expect(
        states.filter { $0.published < answer.published }.allSatisfy { $0.workspace?.dayPage(date) == nil },
        "no earlier one does")
    }
    #expect(await h.transport.unscripted == [])
  }

  @Test func the_undo_slot_follows_the_copy() async throws {
    let h = try await Harness(opening, copy: try board(5, rows: [row("t1")]))
    await h.engine.start()
    #expect(await current(h.engine)?.undoSlot == nil)

    // A command takes the slot.
    await h.transport.add([applied(try addingDay(from: 5, to: 6, "2026-11-24", undo: marker("op-move", 6)))])
    _ = try #require(await h.engine.perform(action: Command.ensureDay(yesterday)).answer)
    #expect(await current(h.engine)?.undoSlot == UndoMarker(operationId: "op-move", revision: 6))

    // So does a tick.
    let ticked = try upserting(from: 6, to: 7, [row("t1", status: "done", version: 2)], undo: marker("op-tick", 7))
    await h.transport.add([applied(ticked)])
    try await h.engine.enqueue(action: done("t1"), label: #"ticked "t1""#)
    await h.engine.settled()
    #expect(await current(h.engine)?.undoSlot == UndoMarker(operationId: "op-tick", revision: 7))

    // A day page made empties it.
    await h.transport.add([applied(try addingDay(from: 7, to: 8, "2026-11-23", undo: "null"))])
    _ = try #require(await h.engine.perform(action: Command.ensureDay(LocalDate("2026-11-23")!)).answer)
    #expect(await current(h.engine)?.undoSlot == nil)

    // A load: the slot is the workspace's only while it is of the workspace's own revision.
    await h.transport.add([
      .workspace(.full(try board(9, rows: [row("t1")], undo: marker("op-elsewhere", 9)), owner: "user-1"))
    ])
    await h.engine.refresh()
    #expect(await current(h.engine)?.undoSlot == UndoMarker(operationId: "op-elsewhere", revision: 9))
    await h.transport.add([
      .workspace(.full(try board(10, rows: [row("t1")], undo: marker("op-elsewhere", 9)), owner: "user-1"))
    ])
    await h.engine.refresh()
    #expect(await current(h.engine)?.undoSlot == nil)
    #expect(await h.transport.unscripted == [])
  }

  @Test func an_applied_answer_whose_whole_load_brings_another_account_is_not_answered_applied() async throws {
    let h = try await Harness(
      opening + [
        // Changes from another revision than the copy's, so the workspace is loaded whole; it comes back as another
        // account's.
        applied(try addingDay(from: 9, to: 10, "2026-11-24")),
        .workspace(.full(try board(3, days: ["2026-11-24", "2026-11-25"], rows: []), owner: "user-2")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    let performed = await h.engine.perform(action: Command.ensureDay(yesterday))

    #expect(performed == .signedOut, "never a state of another account")
    #expect(await current(h.engine)?.owner == "user-2")
    #expect(await h.transport.unscripted == [])
  }

  @Test func the_undo_slot_is_the_shown_accounts_own() async throws {
    let h = try await Harness(opening, copy: try board(5, rows: [], undo: marker("op-one", 5)))
    await h.engine.start()
    #expect(await current(h.engine)?.undoSlot == UndoMarker(operationId: "op-one", revision: 5))

    // The server answers as another account whose copy holds a slot of its own revision.
    await h.transport.add([.workspace(.full(try board(2, rows: [], undo: marker("op-two", 2)), owner: "user-2"))])
    await h.engine.refresh()
    #expect(await current(h.engine)?.owner == "user-2")
    #expect(await current(h.engine)?.undoSlot == UndoMarker(operationId: "op-two", revision: 2))

    // And as the first again, whose copy now holds none: nothing, not the other account's.
    await h.transport.add([.workspace(.full(try board(6, rows: []), owner: "user-1"))])
    await h.engine.refresh()
    #expect(await current(h.engine)?.owner == "user-1")
    #expect(await current(h.engine)?.undoSlot == nil)
    #expect(await h.transport.unscripted == [])
  }

  @Test func unsent_says_whether_anything_of_his_waits() async throws {
    let nothing = try await Harness(opening, copy: try board(5, rows: [row("t1")]))
    await nothing.engine.start()
    #expect(await current(nothing.engine)?.unsent == false)

    let pendingTick = try await Harness(
      opening + [offline], copy: try board(5, rows: [row("t1")]), entries: [stored("op-1", done("t1"))])
    await pendingTick.engine.start()
    #expect(await current(pendingTick.engine)?.pending == 1)
    #expect(await current(pendingTick.engine)?.unsent == true)

    let heldTick = try await Harness(
      opening, copy: try board(5, rows: [row("t1")]), entries: [stored("op-1", done("t1"), heldFor: "conflict")])
    await heldTick.engine.start()
    #expect(await current(heldTick.engine)?.held.count == 1)
    #expect(await current(heldTick.engine)?.unsent == true)

    let waitingTick = try await Harness(
      opening, copy: try board(5, rows: [row("t1")]),
      entries: [stored("op-1", done("t1"), heldFor: "conflict"), stored("op-2", undone("t1"))])
    await waitingTick.engine.start()
    #expect(await current(waitingTick.engine)?.waiting == 1)
    #expect(await current(waitingTick.engine)?.pending == 0)
    #expect(await current(waitingTick.engine)?.unsent == true)

    let draft = try await Harness(opening, copy: try board(5, rows: []))
    await draft.engine.start()
    let words = #"[{"id":"p1","type":"paragraph","props":{},"content":[{"type":"text","text":"Walk","styles":{}}],"children":[]}]"#
    try await draft.engine.keepDraft(
      pageId: "day:2026-11-25", document: words, singleDeleteIds: [], startedFrom: "[]", expectedOwner: "user-1")
    #expect(await current(draft.engine)?.unsent == true)

    // The engine's own request for today's page, not sent for want of a network, is not his.
    let ownRequest = try await Harness(opening + [offline], copy: try board(5, days: [], rows: []))
    await ownRequest.engine.start()
    #expect(try await ownRequest.store.entries().map(\.asksForADay) == [true])
    #expect(await current(ownRequest.engine)?.unsent == false)
  }

  @Test func an_undo_refused_is_reported_as_refused() async throws {
    let message = "Cannot undo after later changes; current values kept"
    let h = try await Harness(
      opening + [
        .outcome(.refused(message: message, owner: "user-1")), .workspace(.unchanged(revision: 5, owner: "user-1")),
      ], copy: try board(5, rows: []))
    await h.engine.start()

    #expect(await h.engine.perform(action: Command.undo(targetOperationId: "op-move")) == .refused(message))
    #expect(await h.calls.last == .workspace(token: "tok-1", have: 5), "after a load")
    #expect(await h.transport.unscripted == [])
  }
}

// MARK: - A held tick merged with what changed on the server

/// The untick the app sends for `taskId`.
private func undone(_ taskId: String) -> JSONValue {
  Command.taskStatus(taskId: taskId, status: .open, today: today)
}

/// The basis of each command sent, with its operation id, in order.
private func bases(_ calls: [FakeTransport.Call]) -> [String] {
  calls.compactMap { call in
    guard case .send(_, let operationId, _, _, let basis) = call else { return nil }
    return "\(operationId) base \(basis.baseRevision) own \(basis.ownRevisions)"
  }
}

/// Every state the engine publishes from the moment it is made, in order.
private final class Published: Sendable {
  private let seen = Seen()
  private let reading: Task<Void, Never>

  init(_ engine: SyncEngine) {
    let seen = seen
    let states = engine.states
    reading = Task { for await state in states { await seen.add(state) } }
  }

  deinit { reading.cancel() }

  /// What was published up to and including the engine's current state.
  func all(through engine: SyncEngine) async -> [SyncState] {
    let last = await numbered(engine)
    await until { await seen.all.last == last }
    return await seen.all
  }
}

@Suite struct SyncEngineMergeTests {
  private let label = #"ticked "Water the plants""#
  private let copy: Workspace
  /// Someone renamed the to-do after revision 5 and left its status alone.
  private let renamed: Workspace

  init() throws {
    copy = try board(5, rows: [row("t1", title: "Water the plants")])
    renamed = try board(6, rows: [row("t1", title: "Water the plants twice", version: 3)])
  }

  @Test func a_tick_held_for_a_change_to_its_words_is_sent_again_and_both_stand() async throws {
    let answer = try upserting(from: 6, to: 7, [row("t1", title: "Water the plants twice", status: "done", version: 4)])
    let h = try await Harness(
      opening + [conflict, .workspace(.full(renamed, owner: "user-1")), applied(answer)], copy: copy,
      entries: [stored("op-1", done("t1"), label: label)])
    let published = Published(h.engine)

    await h.engine.start()
    await h.engine.settled()

    #expect(bases(await h.transport.sends) == ["op-1 base 5 own []", "op-1 base 6 own []"])
    #expect(await published.all(through: h.engine).allSatisfy { $0.held == [] })
    let shown = await current(h.engine)
    #expect(shown?.workspace == renamed.applying(answer))
    #expect(task("t1", in: shown?.workspace)?.title == "Water the plants twice")
    #expect(task("t1", in: shown?.workspace)?.status == .done)
    #expect(try await h.entries == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func the_tick_stays_drawn_while_it_is_settled() async throws {
    let answer = try upserting(from: 6, to: 7, [row("t1", title: "Water the plants twice", status: "done", version: 4)])
    let h = try await Harness(
      opening + [conflict, .workspace(.full(renamed, owner: "user-1")), applied(answer)], copy: copy)
    await h.engine.start()
    let published = Published(h.engine)

    try await h.engine.enqueue(action: done("t1"), label: label)
    await h.engine.settled()

    let states = await published.all(through: h.engine)
    // The first is the state before the tap.
    #expect(task("t1", in: states.first?.workspace)?.status == .open)
    let after = states.dropFirst()
    #expect(after.count > 2, "the held answer, the load and the resend were each said")
    #expect(after.allSatisfy { task("t1", in: $0.workspace)?.status == .done })
    #expect(after.allSatisfy { $0.held == [] })
    #expect(await h.transport.sends.count == 2)
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_tick_the_server_already_has_is_dropped() async throws {
    let served = try board(6, rows: [row("t1", title: "Water the plants", status: "done", version: 2)])
    let h = try await Harness(
      opening + [conflict, .workspace(.full(served, owner: "user-1"))], copy: copy,
      entries: [stored("op-1", done("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    #expect(await h.transport.sends.count == 1)
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served, address: one))
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_tick_on_a_to_do_cancelled_elsewhere_is_held_and_asked_about() async throws {
    let served = try board(6, rows: [row("t1", title: "Water the plants", status: "cancelled", version: 2)])
    let h = try await Harness(
      opening + [conflict, .workspace(.full(served, owner: "user-1"))], copy: copy,
      entries: [stored("op-1", done("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    let shown = await current(h.engine)
    #expect(shown?.held == [HeldChange(id: 1, label: label, reason: .conflict)])
    #expect(shown?.held.first?.canKeep == true)
    #expect(task("t1", in: shown?.workspace)?.status == .cancelled)
    #expect(await h.transport.sends.count == 1)
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_tick_on_a_to_do_deleted_elsewhere_is_held_with_discard_only() async throws {
    let served = try board(6, rows: [])
    let h = try await Harness(
      opening + [conflict, .workspace(.full(served, owner: "user-1"))], copy: copy,
      entries: [stored("op-1", done("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    let shown = await current(h.engine)
    #expect(shown?.held == [HeldChange(id: 1, label: label, reason: .gone)])
    #expect(shown?.held.first?.canKeep == false)
    #expect(shown?.workspace == served)
    #expect(await h.transport.sends.count == 1)
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_tick_merged_once_and_held_again_is_asked_about() async throws {
    let h = try await Harness(
      opening + [conflict, .workspace(.full(renamed, owner: "user-1")), conflict], copy: copy,
      entries: [stored("op-1", done("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    #expect(bases(await h.transport.sends) == ["op-1 base 5 own []", "op-1 base 6 own []"])
    let shown = await current(h.engine)
    #expect(shown?.held == [HeldChange(id: 1, label: label, reason: .conflict)])
    #expect(task("t1", in: shown?.workspace)?.status == .open)
    #expect(await h.transport.unscripted == [], "no third send, and no second load")

    // Another pass in the same launch does not try it again.
    await h.transport.add([.workspace(.unchanged(revision: 6, owner: "user-1"))])
    await h.engine.refresh()
    #expect(await h.transport.sends.count == 2)
    #expect(await current(h.engine)?.held.map(\.id) == [1])
  }

  @Test func an_untick_is_merged_the_same_way() async throws {
    let ticked = try board(5, rows: [row("t1", title: "Water the plants", status: "done", version: 2)])
    let served = try board(6, rows: [row("t1", title: "Water the plants twice", status: "done", version: 3)])
    let answer = try upserting(from: 6, to: 7, [row("t1", title: "Water the plants twice", version: 4)])
    let h = try await Harness(
      opening + [conflict, .workspace(.full(served, owner: "user-1")), applied(answer)], copy: ticked,
      entries: [stored("op-1", undone("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    #expect(bases(await h.transport.sends) == ["op-1 base 5 own []", "op-1 base 6 own []"])
    let shown = await current(h.engine)
    #expect(shown?.held == [])
    #expect(task("t1", in: shown?.workspace)?.status == .open)
    #expect(task("t1", in: shown?.workspace)?.title == "Water the plants twice")
    #expect(try await h.entries == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func the_load_failing_leaves_the_tick_pending_and_drawn() async throws {
    let h = try await Harness(
      opening + [conflict, offline], copy: copy, entries: [stored("op-1", done("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    let shown = await current(h.engine)
    #expect(shown?.held == [])
    #expect(shown?.pending == 1)
    #expect(shown?.offline == true)
    #expect(task("t1", in: shown?.workspace)?.status == .done)
    #expect(try await h.entries == ["op-1 pending base 5 own []"])
    #expect(await h.waits.asked == [.seconds(2)], "the retry schedule sends it again")
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_later_tick_on_the_same_to_do_follows_the_merged_one() async throws {
    let first = try upserting(from: 6, to: 7, [row("t1", title: "Water the plants twice", status: "done", version: 4)])
    let second = try upserting(from: 7, to: 8, [row("t1", title: "Water the plants twice", version: 5)])
    let h = try await Harness(
      opening + [conflict, .workspace(.full(renamed, owner: "user-1")), applied(first), applied(second)], copy: copy,
      entries: [stored("op-1", done("t1"), label: label), stored("op-2", undone("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    // The untick is not sent while the tick before it is being settled.
    #expect(
      bases(await h.transport.sends) == ["op-1 base 5 own []", "op-1 base 6 own []", "op-2 base 5 own [7]"])
    let shown = await current(h.engine)
    #expect(shown?.held == [])
    #expect(task("t1", in: shown?.workspace)?.status == .open)
    #expect(try await h.entries == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_later_tick_held_after_the_passs_load_is_settled_by_the_next_passs_load() async throws {
    let first = try upserting(from: 6, to: 7, [row("t1", title: "Water the plants twice", status: "done", version: 4)])
    // Renamed again after his tick went in; still done, so his untick is sent again.
    let renamedAgain = try board(8, rows: [row("t1", title: "Water the plants at noon", status: "done", version: 5)])
    let second = try upserting(from: 8, to: 9, [row("t1", title: "Water the plants at noon", version: 6)])
    let h = try await Harness(
      opening + [
        conflict, .workspace(.full(renamed, owner: "user-1")), applied(first), conflict,
        .workspace(.full(renamedAgain, owner: "user-1")), applied(second),
      ], copy: copy,
      entries: [stored("op-1", done("t1"), label: label), stored("op-2", undone("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    #expect(
      bases(await h.transport.sends) == [
        "op-1 base 5 own []", "op-1 base 6 own []", "op-2 base 5 own [7]", "op-2 base 8 own []",
      ])
    let loads = await h.calls.filter { if case .workspace = $0 { true } else { false } }
    #expect(
      loads == [
        .workspace(token: "tok-1", have: 5), .workspace(token: "tok-1", have: 5), .workspace(token: "tok-1", have: 7),
      ], "the opening load, the load after the first hold, and the next pass's opening load")
    let shown = await current(h.engine)
    #expect(shown?.held == [])
    #expect(shown?.pending == 0)
    #expect(task("t1", in: shown?.workspace)?.status == .open)
    #expect(task("t1", in: shown?.workspace)?.title == "Water the plants at noon")
    #expect(try await h.entries == [])
    #expect(await h.transport.unscripted == [])
  }

  private static let maybeApplied: FakeTransport.Reply = .outcome(
    .held(reason: "maybe-applied", rows: [], stale: false, owner: "user-1"))

  @Test(arguments: [false, true])
  func a_tick_that_may_already_be_applied_and_is_not_on_the_server_is_asked_about(renamedToo: Bool) async throws {
    // His tick may have gone in and been unticked elsewhere since: the app cannot tell, so it asks.
    let served = try board(
      6, rows: [row("t1", title: renamedToo ? "Water the plants twice" : "Water the plants", version: 3)])
    let h = try await Harness(
      opening + [Self.maybeApplied, .workspace(.full(served, owner: "user-1"))], copy: copy,
      entries: [stored("op-1", done("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    #expect(await h.transport.sends.count == 1, "never sent again by the app")
    let shown = await current(h.engine)
    #expect(shown?.held == [HeldChange(id: 1, label: label, reason: .maybeApplied)])
    #expect(shown?.held.first?.canKeep == true)
    #expect(task("t1", in: shown?.workspace)?.status == .open)
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_tick_that_may_already_be_applied_and_is_on_the_server_is_dropped() async throws {
    let served = try board(6, rows: [row("t1", title: "Water the plants", status: "done", version: 2)])
    let h = try await Harness(
      opening + [Self.maybeApplied, .workspace(.full(served, owner: "user-1"))], copy: copy,
      entries: [stored("op-1", done("t1"), label: label)])

    await h.engine.start()
    await h.engine.settled()

    #expect(await h.transport.sends.count == 1)
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.ready, served, address: one))
    #expect(await h.transport.unscripted == [])
  }
}

// MARK: - Trying again, one pass at launch, and signing out with changes

private let offline: FakeTransport.Reply = .failure(TransportError.offline)

private func applied(_ changes: WorkspaceChanges) -> FakeTransport.Reply {
  .outcome(.applied(receipt: .object([:]), changes: changes, owner: "user-1"))
}

@Suite struct SyncEngineRetryTests {
  @Test func after_a_failed_send_it_tries_again_after_2_5_15_then_30_seconds() async throws {
    let answer = try upserting(from: 5, to: 6, [row("t1", status: "done", version: 2)])
    let h = try await Harness(
      opening + [offline], copy: try board(5, rows: [row("t1")]), entries: [stored("op-1", done("t1"))])
    await h.engine.start()
    await until { await h.waits.asked.count == 1 }

    for retry in 1...4 {
      await h.transport.add([offline])
      await h.waits.elapse()
      await until { await h.waits.asked.count == retry + 1 }
    }
    #expect(await h.waits.asked == [.seconds(2), .seconds(5), .seconds(15), .seconds(30), .seconds(30)])
    #expect(await h.transport.sends.count == 5)

    await h.transport.add([applied(answer)])
    await h.waits.elapse()
    await until { await h.transport.sends.count == 6 }
    await h.engine.settled()

    #expect(try await h.entries == [])
    #expect(await h.waits.asked.count == 5, "no further wait once the transport answers")
    #expect(await h.waits.inProgress == 0)
  }

  @Test func a_429_waits_as_long_as_it_was_told_when_that_is_longer() async throws {
    let h = try await Harness(
      opening + [.failure(TransportError.wait(seconds: 60))], copy: try board(5, rows: [row("t1")]),
      entries: [stored("op-1", done("t1"))])
    await h.engine.start()
    await until { await h.waits.asked.count == 1 }
    #expect(await h.waits.asked == [.seconds(60)])

    // A wait shorter than the schedule's gives the schedule's.
    await h.transport.add([.failure(TransportError.wait(seconds: 1))])
    await h.waits.elapse()
    await until { await h.waits.asked.count == 2 }
    #expect(await h.waits.asked == [.seconds(60), .seconds(5)])
  }

  @Test func nothing_to_send_means_no_retry() async throws {
    let empty = try await Harness(copy: try board(5, rows: [row("t1")]))
    await empty.transport.goOffline()
    await empty.engine.start()
    #expect(await current(empty.engine)?.offline == true)
    // A command waited for is not an entry: it is answered, not tried again.
    #expect(await empty.engine.perform(action: Command.ensureDay(yesterday)) == .offline)
    await empty.engine.settled()
    #expect(await empty.waits.asked == [])

    let behind = try await Harness(
      opening + [offline], copy: try board(5, rows: [row("t1")]),
      entries: [stored("op-held", done("t1"), heldFor: "conflict"), stored("op-waiting", done("t1"))])
    await behind.engine.start()
    await behind.engine.refresh()
    #expect(await current(behind.engine)?.offline == true)
    #expect(await current(behind.engine)?.waiting == 1)
    #expect(await behind.transport.sends == [])
    #expect(await behind.waits.asked == [])
  }

  @Test func the_network_coming_back_sends_at_once() async throws {
    let answer = try upserting(from: 5, to: 6, [row("t1", status: "done", version: 2)])
    let network = FiredReachability()
    let h = try await Harness(
      opening + [offline], copy: try board(5, rows: [row("t1")]), entries: [stored("op-1", done("t1"))],
      reachability: network)
    await h.engine.start()
    await until { await h.waits.asked.count == 1 }

    // The pass that failed was offline, so the one the network's return asks for loads first.
    await h.transport.add([.workspace(.unchanged(revision: 5, owner: "user-1")), applied(answer)])
    network.fire()
    await until { await h.transport.sends.count == 2 }
    await h.engine.settled()

    #expect(try await h.entries == [])
    #expect(await h.waits.asked == [.seconds(2)], "the 2 s wait was cut short, and none follows")
    #expect(await h.waits.cancelled == 1)
    #expect(await current(h.engine)?.failure == nil)
    #expect(await h.transport.unscripted == [])
  }

  @Test func the_network_coming_back_after_an_offline_launch_loads_once() async throws {
    let network = FiredReachability()
    let h = try await Harness(copy: try board(5, rows: [row("t1")]), reachability: network)
    await h.transport.goOffline()
    await h.engine.start()
    #expect(await current(h.engine)?.offline == true)
    #expect(await h.waits.asked == [], "nothing to send, so no retry is planned")

    await h.transport.comeBack()
    await h.transport.add(opening)
    network.fire()

    #expect(await eventually { await current(h.engine)?.offline == false })
    await h.engine.settled()
    #expect(await h.transport.answered == [.account(token: "tok-1"), .workspace(token: "tok-1", have: 5)])
    #expect(await h.engine.passRequests == 2)
    #expect(await current(h.engine) == state(.ready, try board(5, rows: [row("t1")]), address: one))
  }

  @Test func the_network_coming_back_asks_for_nothing_when_not_offline() async throws {
    let network = FiredReachability()
    let h = try await Harness(opening, copy: try board(5, rows: [row("t1")]), reachability: network)
    await h.engine.start()

    network.fire()

    #expect(await !eventually { await h.engine.passRequests > 1 })
    #expect(await h.calls.count == 2)
  }

  @Test func the_network_coming_back_asks_for_nothing_when_signed_out() async throws {
    let network = FiredReachability()
    let h = try await Harness(opening, copy: try board(5, rows: [row("t1")]), reachability: network)
    await h.engine.start()
    // Signed out with the network gone: the server could not be told, so the screen is offline and shows sign-in.
    await h.transport.goOffline()
    #expect(await h.engine.signOut(discardingUnsent: true) == 0)
    #expect(await current(h.engine) == state(.signedOut, nil, offline: true))
    let requested = await h.engine.passRequests

    await h.transport.comeBack()
    network.fire()

    #expect(await !eventually { await h.engine.passRequests > requested })
    #expect(await h.calls.count == 3)
  }

  @Test func signed_out_stops_the_retries() async throws {
    // The server no longer knows the session.
    let expired = try await Harness(
      opening + [offline], copy: try board(5, rows: [row("t1")]), entries: [stored("op-1", done("t1"))])
    await expired.engine.start()
    await until { await expired.waits.asked.count == 1 }
    await expired.transport.add([.failure(TransportError.signedOut)])
    await expired.engine.refresh()
    await until { await expired.waits.cancelled == 1 }
    let asked = await expired.engine.passRequests
    await expired.waits.elapse()
    await expired.engine.settled()
    #expect(await expired.engine.passRequests == asked)
    #expect(await expired.waits.asked.count == 1)

    // He signs out.
    let leaving = try await Harness(
      opening + [offline, .done], copy: try board(5, rows: [row("t1")]), entries: [stored("op-1", done("t1"))])
    await leaving.engine.start()
    await until { await leaving.waits.asked.count == 1 }
    #expect(await leaving.engine.signOut(discardingUnsent: true) == 0)
    await until { await leaving.waits.cancelled == 1 }
    await leaving.engine.settled()
    #expect(await leaving.waits.asked.count == 1)
    #expect(await leaving.transport.sends.count == 1)
  }

  @Test func a_launch_runs_one_pass() async throws {
    let gate = Gate()
    let h = try await Harness(
      [.gated(gate), .workspace(.unchanged(revision: 5, owner: "user-1"))], copy: try board(5, rows: []))

    // The scene becomes active while the launch's account check is in flight.
    let starting = Task { await h.engine.start() }
    await gate.reached()
    let refreshing = Task { await h.engine.refresh() }
    await until { await h.engine.passRequests == 2 }
    await gate.open(.account(firstAccount))
    await starting.value
    await refreshing.value

    #expect(await h.calls == [.account(token: "tok-1"), .workspace(token: "tok-1", have: 5)])
    #expect(await current(h.engine) == state(.ready, try board(5, rows: []), address: one))

    // With no session, the server is asked once who it is, and the refresh asks nothing more.
    let nobody = try await Harness([.failure(TransportError.signedOut)], session: nil)
    await nobody.engine.start()
    await nobody.engine.refresh()
    #expect(await nobody.calls == [.account(token: nil)])
    #expect(await current(nobody.engine) == state(.signedOut, nil))
  }

  @Test func a_hidden_copy_learns_that_sign_in_is_off() async throws {
    // A copy with no session is hidden at launch and asks nothing; the scene's refresh still asks who the server is.
    let served = try board(3, rows: [])
    let h = try await Harness(
      [.account(localAccount), .workspace(.full(served, owner: "local"))], session: nil,
      copy: try board(5, rows: []))
    await h.engine.start()
    #expect(await h.calls == [])
    #expect(await current(h.engine) == state(.signedOut, nil))

    await h.engine.refresh()

    #expect(await h.calls == [.account(token: nil), .workspace(token: nil, have: 5)])
    #expect(await current(h.engine) == state(.ready, served, signedIn: false, owner: "local"))
  }

  @Test func nothing_of_the_account_is_sent_once_a_sign_out_has_begun() async throws {
    let answer = try upserting(from: 5, to: 6, [row("t1", status: "done", version: 2)])
    let gate = Gate()
    let h = try await Harness(
      opening + [offline], copy: try board(5, rows: [row("t1"), row("t2")]), entries: [stored("op-1", done("t1"))])
    await h.engine.start()
    let sentBefore = await h.transport.sends.count

    // What a pass in the window would get, were it to ask.
    await h.transport.add([
      .gated(gate), .workspace(.unchanged(revision: 5, owner: "user-1")), applied(answer), applied(answer),
      applied(answer),
    ])
    let signingOut = Task { await h.engine.signOut(discardingUnsent: true) }
    await gate.reached()

    await #expect(throws: SyncError.notReady) { try await h.engine.enqueue(action: done("t2"), label: "t2") }
    let performing = Task { await h.engine.perform(action: Command.ensureDay(yesterday)) }
    let refreshing = Task { await h.engine.refresh() }
    #expect(await performing.value == .signedOut)
    await refreshing.value
    await h.engine.settled()
    #expect(await h.transport.sends.count == sentBefore, "nothing of his is sent while he signs out")

    await gate.open(.done)
    #expect(await signingOut.value == 0)
    await h.engine.settled()
    #expect(await h.transport.sends.count == sentBefore)
    #expect(try await h.entries == [])
    #expect(try await h.kept == nil)
    #expect(await current(h.engine) == state(.signedOut, nil))
  }

  /// A change not sent is pending (nil) or held for a reason.
  @Test(arguments: [nil, "conflict"])
  func signing_out_with_changes_not_sent_asks_first(heldFor reason: String?) async throws {
    let h = try await Harness(
      opening + (reason == nil ? [offline] : []), copy: try board(5, rows: [row("t1")]),
      entries: [stored("op-1", done("t1"), heldFor: reason)])
    await h.engine.start()
    await h.transport.goOffline()

    #expect(await h.engine.signOut(discardingUnsent: false) == 1)
    #expect(try h.tokens.read() == first)
    let left = try await h.store.entries()
    #expect(left.map(\.operationId) == ["op-1"])
    #expect(left.map(\.state) == [reason == nil ? .pending : .held])
    #expect(await current(h.engine)?.phase == .ready)
    #expect(await current(h.engine)?.pending == (reason == nil ? 1 : 0))
    #expect(await current(h.engine)?.held.count == (reason == nil ? 0 : 1))

    #expect(await h.engine.signOut(discardingUnsent: true) == 0)
    #expect(try h.tokens.read() == nil)
    #expect(try await h.entries == [])
    #expect(try await h.kept == nil)
    let sentBefore = await h.transport.sends.count

    // Another account signs in: nothing of the first is held, pending, drawn or sent.
    let served = try board(2, rows: [row("t9")])
    await h.transport.comeBack()
    await h.transport.add([.session(second), .workspace(.full(served, owner: "user-2"))])
    try await h.engine.signIn(email: two, password: "pw", timezone: "UTC")
    await h.waits.elapse()
    await h.engine.settled()

    #expect(await current(h.engine) == state(.ready, served, address: two, owner: "user-2"), "nothing of the first held or pending")
    #expect(await h.transport.sends.count == sentBefore)
    #expect(try await h.entries == [])
    #expect(try await h.kept?.owner == "user-2")
  }

  @Test func signing_out_online_sends_what_is_pending_first() async throws {
    let answer = try upserting(from: 5, to: 6, [row("t1", status: "done", version: 2)])
    let h = try await Harness(
      opening + [offline], copy: try board(5, rows: [row("t1")]), entries: [stored("op-1", done("t1"))])
    await h.engine.start()
    #expect(await current(h.engine)?.pending == 1)

    await h.transport.add([applied(answer), .done])
    #expect(await h.engine.signOut(discardingUnsent: false) == 0)

    let calls = await h.calls
    #expect(calls.suffix(2).first?.operationId == "op-1", "the tick is sent first")
    #expect(calls.last == .signOut(token: "tok-1"))
    #expect(try h.tokens.read() == nil)
    #expect(try await h.entries == [])
    #expect(await current(h.engine) == state(.signedOut, nil))
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

/// What a `perform` answered, once it has.
actor Answered {
  private(set) var value: Performed?
  func set(_ performed: Performed) { value = performed }
}

actor SeenEntries {
  private(set) var all: [[OutboxEntry]] = []
  var first: [OutboxEntry]? { all.first }
  func add(_ value: [OutboxEntry]) { all.append(value) }
}
