import DaythreadCore
import Foundation
import Synchronization
import Testing

@testable import DaythreadSync

// MARK: - Fixtures

/// 2026-11-25T12:00:00Z: the 25th in UTC.
private let noon = Date(timeIntervalSince1970: 1_795_608_000)
private let today = LocalDate("2026-11-25")!
private let day = "day:2026-11-25"
private let session = Session(token: "tok-1", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
/// What the server answers an engine that opens on a copy at revision 5 it still holds.
private let opening: [FakeTransport.Reply] = [
  .account(Account(owner: "user-1", email: "one@example.com", signIn: true)),
  .workspace(.unchanged(revision: 5, owner: "user-1")),
]

private func paragraph(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"paragraph","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

/// The new to-do's row he typed; `planned` as the server writes it back once the save made its to-do.
private func todoRow(_ words: String, planned: Bool = false) -> String {
  let props =
    planned ? #"{"taskId":"editor-task:r1","role":"plan","planDate":"2026-11-25"}"# : #"{"taskId":"editor-task:r1"}"#
  return
    #"{"id":"r1","type":"task","props":\#(props),"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

/// The day page as the server has it before he types.
private let baseDocument = "[\(paragraph("p1", "Morning"))]"

/// The day page with a second line holding `words`.
private func typed(_ words: String) -> String { "[\(paragraph("p1", "Morning")),\(paragraph("p2", words))]" }

private func withTodo(_ words: String = "Buy milk", planned: Bool = false, more: String? = nil) -> String {
  let extra = more.map { ",\(paragraph("p3", $0))" } ?? ""
  return "[\(paragraph("p1", "Morning")),\(todoRow(words, planned: planned))\(extra)]"
}

private func dayPage(_ document: String, trashedAt: String? = nil) -> JSONValue {
  var page: JSONObject = [
    "id": .string(day), "type": .string("daily"), "date": .string("2026-11-25"), "title": .string("2026-11-25"),
    "document": .string(document),
  ]
  if let trashedAt { page["trashedAt"] = .string(trashedAt) }
  return .object(page)
}

private func todo(_ status: String, version: Int = 1) -> JSONValue {
  .object([
    "id": .string("editor-task:r1"), "title": .string("Buy milk"), "status": .string(status),
    "paused": .bool(false), "version": .number(String(version)),
  ])
}

private func served(
  _ revision: Int = 5, document: String = baseDocument, tasks: [JSONValue] = [], trashedAt: String? = nil
) -> Workspace {
  Workspace(
    .object([
      "revision": .number(String(revision)), "timezone": .string("UTC"),
      "pages": .array([dayPage(document, trashedAt: trashedAt)]),
      "tasks": .array(tasks),
    ]))!
}

/// Changes from `from` to `revision` that leave the day page holding `document`, when given, and write `tasks`.
private func changes(
  from: Int, to revision: Int, document: String? = nil, pages: [JSONValue]? = nil, tasks: [JSONValue] = []
) throws -> WorkspaceChanges {
  try required(
    WorkspaceChanges(
      .object([
        "from": .number(String(from)), "revision": .number(String(revision)), "timezone": .string("UTC"),
        "pages": .object(["upsert": .array(pages ?? document.map { [dayPage($0)] } ?? []), "remove": .array([])]),
        "tasks": .object(["upsert": .array(tasks), "remove": .array([])]),
      ])))
}

/// The server's answer to a save that left the page holding `document`. Its receipt names the revision the save
/// made: `revision`, unless `receipt` says otherwise (a replay answers with the workspace as it is now).
private func saved(
  from: Int, to revision: Int, document: String? = nil, tasks: [JSONValue] = [], receipt: Int? = nil
) throws -> FakeTransport.Reply {
  .saved(
    .applied(
      receipt: .object(["revision": .number(String(receipt ?? revision))]),
      changes: try changes(from: from, to: revision, document: document, tasks: tasks), owner: "user-1"))
}

/// A save as the server received it; `action` is the whole action as written text, which the server fingerprints.
private struct ReceivedSave: Equatable {
  let operationId: String
  let expectedRevision: Int
  let expectedOwner: String
  let expectedContent: String?
  let document: String?
  let action: String
}

private func received(_ calls: [FakeTransport.Call]) -> [ReceivedSave] {
  calls.compactMap { call in
    guard case .save(_, let operationId, let expectedRevision, let expectedOwner, let action) = call else {
      return nil
    }
    let object = action.objectValue
    return ReceivedSave(
      operationId: operationId, expectedRevision: expectedRevision, expectedOwner: expectedOwner,
      expectedContent: object?["expectedContent"]?.stringValue, document: object?["document"]?.stringValue,
      action: JSON.write(action))
  }
}

private func tick(_ taskId: String) -> JSONValue {
  Command.taskStatus(taskId: taskId, status: .done, today: today)
}

/// Waits, without sleeping, until `condition` holds; it holds once the tasks already started have run. Gives up
/// after a bounded number of turns and records it, so a test of the wrong code fails rather than hangs.
private func until(
  _ condition: () async -> Bool, sourceLocation: SourceLocation = #_sourceLocation
) async {
  for _ in 0..<100_000 {
    if await condition() { return }
    await Task.yield()
  }
  Issue.record("the condition never came to hold", sourceLocation: sourceLocation)
}

/// The state a new reader of `states` gets at once.
private func current(_ engine: SyncEngine) async -> SyncState? {
  await engine.states.first { _ in true }
}

private func waiting(_ pageId: String = day) -> [DraftStatus] { [DraftStatus(id: pageId, state: .waiting)] }
private func behind(_ pageId: String = day) -> [DraftStatus] { [DraftStatus(id: pageId, state: .behind)] }
private func stuck(_ reason: String, _ pageId: String = day) -> [DraftStatus] {
  [DraftStatus(id: pageId, state: .stuck(reason))]
}

/// The server's words when it refuses a save, from the shared cases.
private func refusal(_ name: String) throws -> String {
  try required(try StoreFixtures.json("saves/\(name).json").objectValue?["refused"]?.stringValue)
}

/// A page that is not a day's, so no day page is asked for when it goes.
private let notes = "notes"

private func notesPage(_ document: String, trashedAt: String? = nil) -> JSONValue {
  var page: JSONObject = [
    "id": .string(notes), "type": .string("document"), "date": .null, "title": .string("Notes"),
    "document": .string(document),
  ]
  if let trashedAt { page["trashedAt"] = .string(trashedAt) }
  return .object(page)
}

/// The day page, as it was unless given, and the notes page when given.
private func servedWithNotes(_ revision: Int, _ notesPage: JSONValue?, day document: String = baseDocument) -> Workspace {
  Workspace(
    .object([
      "revision": .number(String(revision)), "timezone": .string("UTC"),
      "pages": .array([dayPage(document)] + (notesPage.map { [$0] } ?? [])), "tasks": .array([]),
    ]))!
}

/// The engine's clock, which a test moves on.
private final class TestClock: Sendable {
  private let current = Mutex(noon)
  var now: Date { current.withLock { $0 } }
  func set(_ date: Date) { current.withLock { $0 = date } }
}

/// A tick stored before the engine opens, for `taskId`, built on `base`.
private func storedTick(
  _ operationId: String, _ taskId: String, base: Int, heldFor reason: String? = nil
) -> NewOutboxEntry {
  NewOutboxEntry(
    kind: .command, owner: "user-1", operationId: operationId, action: tick(taskId), baseRevision: base,
    ownRevisions: [], label: "Tick \(taskId)", createdAt: noon, state: reason == nil ? .pending : .held,
    reason: reason)
}

/// An engine over a fake server, a recording store holding `copy` and a memory token store holding `session`.
private struct DraftHarness {
  let transport: FakeTransport
  let store = RecordingStore()
  let tokens = MemoryTokenStore()
  /// The engine's waits, the 450 ms after a change and those before it tries again: none ends unless the test
  /// ends it.
  let waits = Waits()
  let clock = TestClock()
  let engine: SyncEngine

  init(
    _ script: [FakeTransport.Reply] = [], session signedIn: Session? = session, copy: Workspace? = served(),
    entries: [NewOutboxEntry] = [], reachability: any Reachability = NoReachability()
  ) async throws {
    transport = FakeTransport(script)
    if let signedIn { try tokens.write(signedIn) }
    if let copy { try await store.replace(with: copy, owner: "user-1") }
    for entry in entries { _ = try await store.append(entry) }
    await store.forget()
    let waits = waits
    let clock = clock
    engine = SyncEngine(
      transport: transport, tokens: tokens, store: store, reachability: reachability,
      sleep: { try await waits.sleep($0) }, now: { clock.now })
  }

  var drafts: [PageDraft] { get async throws { try await store.drafts() } }
  var saves: [ReceivedSave] { get async { received(await transport.calls) } }
}

// MARK: - Tests

@Suite struct SyncEngineDraftTests {
  @Test func a_draft_is_in_the_store_before_the_call_returns_and_drawn() async throws {
    let h = try await DraftHarness(opening)
    await h.engine.start()

    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: ["gone-1"], startedFrom: baseDocument)

    let drafts = try await h.drafts
    #expect(drafts.count == 1)
    let draft = try #require(drafts.first)
    #expect(draft.owner == "user-1")
    #expect(draft.document == typed("Walk"))
    #expect(draft.baseDocument == baseDocument)
    #expect(draft.base == ContentKey.of(baseDocument))
    #expect(draft.singleDeleteIds == ["gone-1"])
    #expect(draft.sent == nil)
    let state = await current(h.engine)
    #expect(state?.workspace?.page(day)?.document == typed("Walk"))
    #expect(state?.drafts == waiting())
    #expect(try await h.store.load()?.workspace.page(day)?.document == baseDocument, "the copy is still the server's")
    #expect(await h.saves == [])
  }

  @Test func a_draft_is_drawn_by_a_new_engine_on_the_same_store() async throws {
    let h = try await DraftHarness(opening)
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    let gate = Gate()
    let transport = FakeTransport([.gated(gate)])
    let waits = Waits()
    let next = SyncEngine(
      transport: transport, tokens: h.tokens, store: h.store, sleep: { try await waits.sleep($0) }, now: { noon })
    let starting = Task { await next.start() }
    await gate.reached()

    let state = await current(next)
    #expect(state?.workspace?.page(day)?.document == typed("Walk"))
    #expect(state?.drafts == waiting())

    await gate.open(.failure(TransportError.offline))
    await starting.value
  }

  @Test func the_save_goes_450_ms_after_the_last_change() async throws {
    let h = try await DraftHarness(opening + [try saved(from: 5, to: 6, document: typed("Walk the dog"))])
    await h.engine.start()

    for (count, words) in ["Walk", "Walk the", "Walk the dog"].enumerated() {
      try await h.engine.keepDraft(pageId: day, document: typed(words), singleDeleteIds: [], startedFrom: baseDocument)
      await until { await h.waits.asked.count == count + 1 }
    }
    await until {
      let (asked, cancelled, inProgress) = (await h.waits.asked.count, await h.waits.cancelled, await h.waits.inProgress)
      return asked == 3 && cancelled == 2 && inProgress == 1
    }
    #expect(await h.waits.asked == Array(repeating: .milliseconds(450), count: 3))
    #expect(await h.saves == [])

    await h.waits.elapse()
    await until { await h.saves.count == 1 }
    await h.engine.settled()

    let calls = await h.transport.saves
    #expect(calls.count == 1)
    guard case .save(let token, let operationId, let revision, let owner, let action)? = calls.first else { return }
    #expect(token == "tok-1")
    #expect(revision == 5)
    #expect(owner == "user-1")
    #expect(
      action
        == Command.saveEditor(
          pageId: day, expectedContent: ContentKey.of(baseDocument), document: typed("Walk the dog"),
          singleDeleteIds: [], today: today, at: noon))
    #expect(!operationId.isEmpty)
    #expect(await h.transport.unscripted == [])
  }

  @Test func saveNow_sends_without_the_wait() async throws {
    let h = try await DraftHarness(opening + [try saved(from: 5, to: 6, document: typed("Walk"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await until { await h.waits.inProgress == 1 }

    await h.engine.saveNow()

    #expect(await h.saves.map(\.document) == [typed("Walk")])
    await until { await h.waits.cancelled == 1 }
    #expect(await h.waits.inProgress == 0, "the wait it cut short was cancelled")
    // And ending it now sends nothing.
    await h.waits.elapse()
    await h.engine.settled()
    #expect(await h.saves.count == 1)
  }

  @Test func the_answer_removes_the_draft_and_the_page_is_the_servers() async throws {
    let h = try await DraftHarness(opening + [try saved(from: 5, to: 6, document: typed("Walk"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()

    #expect(try await h.drafts == [])
    let state = await current(h.engine)
    #expect(state?.drafts == [])
    #expect(state?.workspace?.revision == 6)
    #expect(state?.workspace?.page(day)?.document == typed("Walk"))
    let kept = try await h.store.load()
    #expect(kept?.workspace.revision == 6)
    #expect(kept?.workspace.page(day)?.document == typed("Walk"))
    #expect(await h.store.log.contains("removeDraft user-1 \(day)"))
  }

  @Test func typing_while_a_save_is_on_its_way_waits_for_its_answer_then_goes_as_the_next_save() async throws {
    let gate = Gate()
    let h = try await DraftHarness(opening + [.gated(gate)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    let saving = Task { await h.engine.saveNow() }
    await gate.reached()

    #expect(await current(h.engine)?.drafts == [DraftStatus(id: day, state: .sending)])
    let first = try #require(await h.saves.first)
    #expect(
      try await h.drafts.first?.sent
        == PageDraft.Sent(operationId: first.operationId, document: typed("Walk"), action: first.action))

    try await h.engine.keepDraft(pageId: day, document: typed("Walk the dog"), singleDeleteIds: [], startedFrom: baseDocument)
    #expect(try await h.drafts.first?.document == typed("Walk the dog"), "kept at once, while the save is away")
    #expect(try await h.drafts.first?.sent?.document == typed("Walk"))
    #expect(await current(h.engine)?.workspace?.page(day)?.document == typed("Walk the dog"))

    await h.transport.add([try saved(from: 6, to: 7, document: typed("Walk the dog"))])
    await gate.open(try saved(from: 5, to: 6, document: typed("Walk")))
    await saving.value

    let rebased = try #require(try await h.drafts.first)
    #expect(rebased.baseDocument == typed("Walk"))
    #expect(rebased.base == ContentKey.of(typed("Walk")))
    #expect(rebased.sent == nil)
    #expect(rebased.document == typed("Walk the dog"))

    await until { await h.waits.inProgress == 1 }
    await h.waits.elapse()
    await until { await h.saves.count == 2 }
    await h.engine.settled()

    let saves = await h.saves
    #expect(saves.count == 2)
    #expect(saves.last?.operationId != first.operationId)
    #expect(saves.last?.document == typed("Walk the dog"))
    #expect(saves.last?.expectedContent == ContentKey.of(typed("Walk")))
    #expect(saves.last?.expectedRevision == 6)
    #expect(await h.transport.maxInFlight == 1)
    #expect(try await h.drafts == [])
    #expect(await current(h.engine)?.workspace?.page(day)?.document == typed("Walk the dog"))
  }

  @Test func a_save_that_was_not_answered_goes_again_as_it_was() async throws {
    // The server took the request, and its answer was lost on the way back.
    let h = try await DraftHarness(opening + [.failure(TransportError.offline)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: ["r-a", "r-b"], startedFrom: baseDocument)
    await h.engine.saveNow()
    let first = try #require(await h.saves.first)
    #expect(
      first.action
        == JSON.write(
          Command.saveEditor(
            pageId: day, expectedContent: ContentKey.of(baseDocument), document: typed("Walk"),
            singleDeleteIds: ["r-a", "r-b"], today: today, at: noon)))
    #expect(await current(h.engine)?.drafts == [DraftStatus(id: day, state: .offline)])

    // Past midnight he types more, and one row he had removed is back while another is gone.
    h.clock.set(noon.addingTimeInterval(12 * 3600 + 300))
    try await h.engine.keepDraft(pageId: day, document: typed("Walk the dog"), singleDeleteIds: ["r-b", "r-c"], startedFrom: baseDocument)
    #expect(
      try await h.drafts.first?.sent
        == PageDraft.Sent(operationId: first.operationId, document: typed("Walk"), action: first.action))

    await h.transport.add([
      try saved(from: 5, to: 6, document: typed("Walk")), try saved(from: 6, to: 7, document: typed("Walk the dog")),
    ])
    // The retry's wait and the one after his newer words.
    await until { await h.waits.inProgress == 2 }
    await h.waits.elapse()
    await until { await h.saves.count == 3 }
    await h.engine.settled()

    let saves = await h.saves
    #expect(saves[1] == first, "the retry is the same request")
    #expect(saves[1].action.utf8.elementsEqual(first.action.utf8), "its action is the first one's, as written")
    #expect(saves[2].action.contains(#""today":"2026-11-26""#), "the next save is made now")
    #expect(saves[2].operationId != first.operationId)
    #expect(saves[2].document == typed("Walk the dog"))
    #expect(saves[2].expectedContent == ContentKey.of(typed("Walk")))
    #expect(saves[2].expectedRevision == 6)
    #expect(try await h.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func with_no_connection_the_draft_waits_and_is_retried_on_the_schedule() async throws {
    let h = try await DraftHarness(opening)
    await h.engine.start()
    await h.transport.goOffline()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    for count in 2...5 {
      await until { await h.waits.inProgress == 1 }
      await h.waits.elapse()
      await until { await h.waits.asked.count == count }
    }

    await h.engine.settled()
    #expect(
      await h.waits.asked == [.milliseconds(450), .seconds(2), .seconds(5), .seconds(15), .seconds(30)])
    let saves = await h.saves
    #expect(saves.count == 4)
    #expect(Set(saves.map(\.operationId)).count == 1, "every try is the same save")
    let state = await current(h.engine)
    #expect(state?.offline == true)
    #expect(state?.drafts == [DraftStatus(id: day, state: .offline)])
    #expect(state?.workspace?.page(day)?.document == typed("Walk"))
    #expect(try await h.drafts.first?.sent?.operationId == saves.first?.operationId)
  }

  @Test func the_network_coming_back_sends_it() async throws {
    let network = FiredReachability()
    let h = try await DraftHarness(opening, reachability: network)
    await h.engine.start()
    await h.transport.goOffline()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await until { await h.waits.inProgress == 1 }
    await h.waits.elapse()
    await until { await h.waits.asked.count == 2 }

    await h.transport.comeBack()
    await h.transport.add([.workspace(.unchanged(revision: 5, owner: "user-1")), try saved(from: 5, to: 6)])
    network.fire()
    await until { await h.saves.count == 2 }
    await h.engine.settled()

    #expect(try await h.drafts == [])
    #expect(await h.waits.asked == [.milliseconds(450), .seconds(2)], "the wait was cut short, and none follows")
    let state = await current(h.engine)
    #expect(state?.offline == false)
    #expect(state?.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_tick_on_a_to_do_typed_into_a_draft_is_sent_after_that_drafts_save() async throws {
    let answer = try saved(from: 5, to: 6, document: withTodo(planned: true), tasks: [todo("open")], receipt: 6)
    let ticked = try changes(from: 6, to: 7, tasks: [todo("done", version: 2)])
    let h = try await DraftHarness(
      opening + [answer, .outcome(.applied(receipt: .object([:]), changes: ticked, owner: "user-1"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    #expect(await current(h.engine)?.workspace?.task("editor-task:r1")?.status == .open)

    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()

    let drawn = await current(h.engine)
    #expect(drawn?.workspace?.task("editor-task:r1")?.status == .done)
    #expect(drawn?.waiting == 1)
    #expect(drawn?.pending == 0)
    #expect(await h.transport.sends == [], "the tick waits for the save that makes its to-do")

    await h.engine.saveNow()

    let calls = await h.transport.calls.suffix(2)
    #expect(calls.first?.isSave == true)
    guard case .send(_, _, let action, _, let basis)? = calls.last else {
      Issue.record("the tick was not sent after the save")
      return
    }
    #expect(action == tick("editor-task:r1"))
    #expect(basis.ownRevisions == [6], "the save is his own change")
    let state = await current(h.engine)
    #expect(state?.workspace?.task("editor-task:r1")?.status == .done)
    #expect(state?.waiting == 0)
    #expect(state?.pending == 0)
    #expect(try await h.store.entries().isEmpty)
  }

  @Test
  func an_answer_that_comes_back_to_newer_words_leaves_them_and_puts_the_draft_behind_when_the_server_changed_what_was_sent()
    async throws
  {
    let gate = Gate()
    let h = try await DraftHarness(opening + [.gated(gate)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    let saving = Task { await h.engine.saveNow() }
    await gate.reached()
    try await h.engine.keepDraft(pageId: day, document: withTodo(more: "Then call"), singleDeleteIds: [], startedFrom: baseDocument)

    // The server marks the new to-do's row as planned for the day: the page is not what was sent.
    await gate.open(try saved(from: 5, to: 6, document: withTodo(planned: true), tasks: [todo("open")]))
    await saving.value
    await h.waits.elapse()
    await h.engine.settled()

    #expect(await h.saves.count == 1, "no second save leaves")
    let draft = try #require(try await h.drafts.first)
    #expect(draft.baseDocument == withTodo())
    #expect(draft.base == ContentKey.of(withTodo()))
    #expect(draft.sent == nil)
    #expect(draft.document == withTodo(more: "Then call"))
    let state = await current(h.engine)
    #expect(state?.drafts == behind())
    #expect(state?.workspace?.page(day)?.document == withTodo(more: "Then call"))
    let theirs = try #require(try await h.store.load()?.workspace.page(day)?.document)
    #expect(theirs == withTodo(planned: true))
    // The screen's merge: what was sent, his newer words, and the server's page.
    let merged = PageMerge.merge(base: draft.baseDocument, mine: draft.document, theirs: theirs)
    #expect(merged.document == withTodo(planned: true, more: "Then call"))
    #expect(!merged.bothChanged)
  }

  @Test func typing_back_to_the_page_as_it_was_removes_the_draft_and_sends_nothing() async throws {
    let h = try await DraftHarness(opening)
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await until { await h.waits.inProgress == 1 }

    try await h.engine.keepDraft(pageId: day, document: baseDocument, singleDeleteIds: [], startedFrom: baseDocument)

    #expect(try await h.drafts == [])
    #expect(await current(h.engine)?.drafts == [])
    await until { await h.waits.cancelled == 1 }
    #expect(await h.waits.inProgress == 0, "its wait was cancelled")
    await h.waits.elapse()
    await h.engine.saveNow()
    #expect(await h.saves == [])
  }

  @Test func nothing_is_sent_or_kept_once_a_sign_out_that_erases_has_begun() async throws {
    let gate = Gate()
    let h = try await DraftHarness(opening + [.gated(gate)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    let leaving = Task { await h.engine.signOut(discardingUnsent: true) }
    await gate.reached()

    await #expect(throws: SyncError.notReady) {
      try await h.engine.keepDraft(pageId: day, document: typed("Walk on"), singleDeleteIds: [], startedFrom: baseDocument)
    }
    await h.engine.saveNow()
    await h.waits.elapse()
    await h.engine.settled()
    #expect(await h.saves == [])
    #expect(try await h.drafts.first?.document == typed("Walk"), "nothing newer was kept")

    await gate.open(.done)
    #expect(await leaving.value == 0)
    await h.engine.settled()
    #expect(await h.saves == [])
    #expect(try await h.drafts == [])
    #expect(await current(h.engine)?.drafts == [])
  }

  @Test func keepDraft_before_a_copy_is_shown_throws() async throws {
    let gate = Gate()
    let h = try await DraftHarness([.gated(gate)], copy: nil)
    let starting = Task { await h.engine.start() }
    await gate.reached()

    await #expect(throws: SyncError.notReady) {
      try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    }
    #expect(try await h.drafts == [])

    await gate.open(.failure(TransportError.offline))
    await starting.value
  }

  @Test func a_replayed_answer_teaches_the_saves_own_revision_not_the_servers_current_one() async throws {
    // A replay answers with the workspace as it is now (revision 8: others wrote since), and its receipt with the
    // revision the save made (6).
    let replay = try saved(from: 5, to: 8, document: withTodo(planned: true), tasks: [todo("open")], receipt: 6)
    let ticked = try changes(from: 8, to: 9, tasks: [todo("done", version: 2)])
    let h = try await DraftHarness(
      opening + [replay, .outcome(.applied(receipt: .object([:]), changes: ticked, owner: "user-1"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()

    await h.engine.saveNow()

    guard case .send(_, _, _, _, let basis)? = await h.transport.sends.last else {
      Issue.record("the tick was not sent")
      return
    }
    #expect(basis.baseRevision == 5)
    #expect(basis.ownRevisions == [6])
  }

  @Test func a_tick_learns_a_replayed_saves_revision_after_the_copy_moved_past_it() async throws {
    // The first send lands as revision 6 and its answer is lost. A load then brings revision 7, another device's
    // write to something else. (Here that load does not yet hold the to-do, so the tick still waits for the save.)
    let elsewhere: JSONValue = .object([
      "id": .string("other"), "title": .string("Other"), "status": .string("open"), "paused": .bool(false),
      "version": .number("1"),
    ])
    let moved = served(7, tasks: [elsewhere])
    // The resend is answered as a replay: changes from the workspace as it is now, the receipt the save's own.
    let replay = try saved(
      from: 7, to: 7, document: withTodo(planned: true), tasks: [todo("open")], receipt: 6)
    let ticked = try changes(from: 7, to: 8, tasks: [todo("done", version: 2)])
    let h = try await DraftHarness(
      opening + [
        .failure(TransportError.offline), .workspace(.full(moved, owner: "user-1")), replay,
        .outcome(.applied(receipt: .object([:]), changes: ticked, owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()
    await h.engine.saveNow()

    await h.engine.refresh()

    let saves = await h.saves
    #expect(saves.count == 2)
    #expect(saves.last?.operationId == saves.first?.operationId)
    #expect(saves.last?.expectedRevision == 7)
    guard case .send(_, _, _, _, let basis)? = await h.transport.sends.last else {
      Issue.record("the tick was not sent")
      return
    }
    #expect(basis.baseRevision == 5)
    #expect(basis.ownRevisions == [6])
    #expect(await h.transport.unscripted == [])
  }

  @Test func an_entry_that_did_not_wait_for_the_save_does_not_learn_its_revision() async throws {
    // Built at revision 3 and waiting behind a held tick on the same to-do: revisions 4 and 5 are not its own, and
    // the save was checked against the copy's revision, not against the entry's base.
    let h = try await DraftHarness(
      opening + [try saved(from: 5, to: 6, document: typed("Walk"))], copy: served(5, tasks: [todo("open")]),
      entries: [
        storedTick("op-held", "editor-task:r1", base: 3, heldFor: "conflict"),
        storedTick("op-waiting", "editor-task:r1", base: 3),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()

    #expect(await h.saves.count == 1)
    let waiting = try #require(try await h.store.entries().first { $0.operationId == "op-waiting" })
    #expect(waiting.ownRevisions == [], "it must still see what revisions 4 and 5 did to its row")
    #expect(await h.transport.sends == [])
  }

  @Test func a_store_that_cannot_be_read_back_does_not_lose_what_was_sent() async throws {
    let gate = Gate()
    let h = try await DraftHarness(opening + [.gated(gate)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    // The write that records what is sent lands; reading the drafts back after it does not.
    await h.store.fail("drafts")
    let saving = Task { await h.engine.saveNow() }
    await gate.reached()
    let first = try #require(await h.saves.first)

    try await h.engine.keepDraft(pageId: day, document: typed("Walk the dog"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.store.heal()
    #expect(try await h.drafts.first?.sent?.operationId == first.operationId, "his newer words kept what was sent")

    await h.transport.add([
      try saved(from: 5, to: 6, document: typed("Walk")), try saved(from: 6, to: 7, document: typed("Walk the dog")),
    ])
    await gate.open(.failure(TransportError.offline))
    await saving.value
    await until { await h.waits.inProgress == 2 }
    await h.waits.elapse()
    await until { await h.saves.count == 3 }
    await h.engine.settled()

    let saves = await h.saves
    #expect(saves[1].operationId == first.operationId)
    #expect(saves[1].document == typed("Walk"))
    #expect(try await h.drafts == [])
  }

  @Test func an_answer_that_arrives_after_a_sign_in_to_another_account_is_dropped() async throws {
    let gate = Gate()
    let other = Session(token: "tok-2", owner: "user-2", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
    let theirs = served(1, document: typed("Theirs"))
    let h = try await DraftHarness(
      opening + [.gated(gate), .session(other), .workspace(.full(theirs, owner: "user-2"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    let saving = Task { await h.engine.saveNow() }
    await gate.reached()

    let signingIn = Task { try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC") }
    await until { await h.store.log.contains("eraseKeepingDrafts") }
    await gate.open(try saved(from: 5, to: 6, document: typed("Walk")))
    try await signingIn.value
    await saving.value
    await h.engine.settled()

    #expect(await !h.store.log.contains { $0.hasPrefix("write") }, "the answer was never written")
    let kept = try await h.store.load()
    #expect(kept?.owner == "user-2")
    #expect(kept?.workspace.page(day)?.document == typed("Theirs"))
    let state = await current(h.engine)
    #expect(state?.workspace?.page(day)?.document == typed("Theirs"))
    #expect(state?.drafts == [])
    #expect(await h.saves.count == 1)
    #expect(try await h.drafts.map(\.owner) == ["user-1"], "the first account's draft is still there")
  }

  @Test func an_answer_that_arrives_after_an_erasing_sign_out_began_is_dropped() async throws {
    let answerGate = Gate()
    let signOutGate = Gate()
    let h = try await DraftHarness(opening + [.gated(answerGate), .gated(signOutGate)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    let saving = Task { await h.engine.saveNow() }
    await answerGate.reached()
    let leaving = Task { await h.engine.signOut(discardingUnsent: true) }
    await signOutGate.reached()

    await answerGate.open(try saved(from: 5, to: 6, document: typed("Walk")))
    await saving.value
    await h.engine.settled()
    #expect(await !h.store.log.contains { $0.hasPrefix("write") || $0.hasPrefix("removeDraft") })
    #expect(try await h.drafts.first?.sent != nil, "untouched while the sign-out waits for the server")

    await signOutGate.open(.done)
    #expect(await leaving.value == 0)
    #expect(try await h.drafts == [])
    #expect(try await h.store.load() == nil)
    #expect(await current(h.engine)?.drafts == [])
  }

  // MARK: Behind the server's page, refusals, accounts

  @Test func a_load_that_changes_the_page_puts_its_draft_behind_and_sends_nothing() async throws {
    let h = try await DraftHarness(
      opening + [.workspace(.full(served(6, document: typed("Theirs")), owner: "user-1"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.refresh()
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    #expect(await h.saves == [])
    let state = await current(h.engine)
    #expect(state?.drafts == behind())
    #expect(state?.workspace?.revision == 6)
    #expect(state?.workspace?.page(day)?.document == typed("Walk"), "his words are still drawn")
    let draft = try #require(try await h.drafts.first)
    #expect(draft.base == ContentKey.of(baseDocument))
    #expect(draft.baseDocument == baseDocument)
    #expect(draft.document == typed("Walk"))
    #expect(await h.waits.asked.allSatisfy { $0 == .milliseconds(450) }, "nor is it tried again later")
    #expect(await h.transport.unscripted == [])
  }

  @Test func page_changed_elsewhere_is_followed_by_a_load_and_the_draft_is_behind() async throws {
    let h = try await DraftHarness(
      opening + [
        .saved(.refused(message: try refusal("page-changed-elsewhere"))),
        .workspace(.full(served(6, document: typed("Theirs")), owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()

    #expect(await h.transport.calls.last == .workspace(token: "tok-1", have: 5))
    #expect(await h.saves.count == 1)
    #expect(try await h.drafts.first?.sent == nil)
    #expect(try await h.drafts.first?.document == typed("Walk"))
    let state = await current(h.engine)
    #expect(state?.drafts == behind())
    #expect(state?.workspace?.revision == 6)
    #expect(state?.workspace?.page(day)?.document == typed("Walk"))
    #expect(await h.waits.asked.allSatisfy { $0 == .milliseconds(450) }, "nothing is tried again")
    #expect(await h.transport.unscripted == [])
  }

  @Test func page_changed_elsewhere_with_the_page_as_it_was_is_tried_again_on_the_schedule() async throws {
    let h = try await DraftHarness(
      opening + [
        .saved(.refused(message: try refusal("page-changed-elsewhere"))),
        .workspace(.unchanged(revision: 5, owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()

    #expect(await h.saves.count == 1, "not again within the pass")
    #expect(await h.waits.asked.last == .seconds(2))
    #expect(await current(h.engine)?.drafts == [DraftStatus(id: day, state: .retrying)])

    await h.transport.add([try saved(from: 5, to: 6, document: typed("Walk"))])
    await h.waits.elapse()
    await until { await h.saves.count == 2 }
    await h.engine.settled()
    #expect(try await h.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func saved_elsewhere_with_the_page_as_it_was_sends_the_same_save_once_more() async throws {
    let savedElsewhere = try refusal("saved-elsewhere")
    // Another device wrote something else: the revision moved, this page did not.
    let moved = served(6, tasks: [otherTask])
    let h = try await DraftHarness(
      opening + [
        .saved(.refused(message: savedElsewhere)), .workspace(.full(moved, owner: "user-1")),
        .saved(.refused(message: savedElsewhere)),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()

    let saves = await h.saves
    #expect(saves.count == 2, "once more, and not a third time in the pass")
    #expect(saves.map(\.expectedRevision) == [5, 6])
    #expect(saves.last?.operationId == saves.first?.operationId)
    #expect(saves.last?.action == saves.first?.action)
    let calls = await h.transport.calls
    #expect(calls.count == 5, "one load between them")
    #expect(calls.dropFirst(3).first == .workspace(token: "tok-1", have: 5))
    #expect(try await h.drafts.first?.sent?.operationId == saves.first?.operationId, "kept as sent, for the retry")
    #expect(await h.waits.asked.last == .seconds(2))
    #expect(await current(h.engine)?.drafts == [DraftStatus(id: day, state: .retrying)])

    await h.transport.add([try saved(from: 6, to: 7, document: typed("Walk"))])
    await h.waits.elapse()
    await until { await h.saves.count == 3 }
    await h.engine.settled()
    #expect(await h.saves.last?.operationId == saves.first?.operationId)
    #expect(try await h.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func saved_elsewhere_with_the_page_changed_puts_the_draft_behind() async throws {
    let h = try await DraftHarness(
      opening + [
        .saved(.refused(message: try refusal("saved-elsewhere"))),
        .workspace(.full(served(6, document: typed("Theirs")), owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()

    #expect(await h.saves.count == 1)
    #expect(try await h.drafts.first?.sent == nil)
    let state = await current(h.engine)
    #expect(state?.drafts == behind())
    #expect(state?.workspace?.page(day)?.document == typed("Walk"))
    #expect(await h.waits.asked.allSatisfy { $0 == .milliseconds(450) })
    #expect(await h.transport.unscripted == [])
  }

  @Test func rebasing_a_draft_sends_it_on_the_servers_page() async throws {
    let h = try await DraftHarness(
      opening + [
        .workspace(.full(served(6, document: typed("Theirs")), owner: "user-1")),
        .workspace(.full(served(7, document: typed("Theirs again")), owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: ["gone-1"], startedFrom: baseDocument)
    await h.engine.refresh()
    #expect(await current(h.engine)?.drafts == behind())
    let merged = "[\(paragraph("p1", "Morning")),\(paragraph("p2", "Theirs again")),\(paragraph("p3", "Walk"))]"

    // The page moved again before the screen's merge was handed over.
    await h.engine.refresh()
    let before = try await h.drafts
    #expect(try await h.engine.rebaseDraft(pageId: day, baseDocument: typed("Theirs"), document: merged) == false)
    #expect(try await h.drafts == before)
    #expect(await current(h.engine)?.drafts == behind())
    await h.engine.settled()
    #expect(await h.saves == [])

    await h.transport.add([try saved(from: 7, to: 8, document: merged)])
    let asked = await h.waits.asked.count
    #expect(try await h.engine.rebaseDraft(pageId: day, baseDocument: typed("Theirs again"), document: merged))
    await h.engine.settled()

    let saves = await h.saves
    #expect(saves.count == 1)
    #expect(saves.first?.expectedContent == ContentKey.of(typed("Theirs again")))
    #expect(saves.first?.expectedRevision == 7)
    #expect(saves.first?.document == merged)
    let action = try saves.first.map { try JSON.parse($0.action) }
    #expect(action?.objectValue?["singleDeleteIds"] == nil, "the merge names no rows")
    #expect(await h.waits.asked.count == asked, "saved at once, with no wait")
    #expect(try await h.drafts == [])
    #expect(await current(h.engine)?.workspace?.page(day)?.document == merged)
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_save_whose_answer_was_lost_then_a_relaunch_is_recognised() async throws {
    let h = try await DraftHarness(opening + [.failure(TransportError.offline)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()
    let first = try #require(await h.saves.first)
    try await h.engine.keepDraft(pageId: day, document: typed("Walk the dog"), singleDeleteIds: [], startedFrom: baseDocument)

    // The app is quit and opened again; the first save had landed as revision 6.
    let transport = FakeTransport([
      .account(Account(owner: "user-1", email: "one@example.com", signIn: true)),
      .workspace(.full(served(6, document: typed("Walk")), owner: "user-1")),
      try saved(from: 6, to: 6, document: typed("Walk"), receipt: 6),
      try saved(from: 6, to: 7, document: typed("Walk the dog")),
    ])
    let waits = Waits()
    let next = SyncEngine(
      transport: transport, tokens: h.tokens, store: h.store, sleep: { try await waits.sleep($0) }, now: { noon })
    await next.start()
    await next.settled()

    let saves = received(await transport.calls)
    #expect(saves.count == 2)
    #expect(saves.first?.operationId == first.operationId, "the recorded save goes first, as it was")
    #expect(saves.first?.action == first.action)
    #expect(saves.first?.expectedRevision == 6)
    #expect(saves.last?.operationId != first.operationId)
    #expect(saves.last?.document == typed("Walk the dog"))
    #expect(saves.last?.expectedContent == ContentKey.of(typed("Walk")))
    #expect(try await h.drafts == [])
    #expect(await current(next)?.workspace?.page(day)?.document == typed("Walk the dog"))
    #expect(await transport.unscripted == [])
  }

  @Test func the_page_in_trash_or_gone_holds_the_draft() async throws {
    let trashed = servedWithNotes(6, notesPage(baseDocument, trashedAt: "2026-11-25T12:00:00.000Z"))
    let h = try await DraftHarness(
      opening + [.workspace(.full(trashed, owner: "user-1"))], copy: servedWithNotes(5, notesPage(baseDocument)))
    await h.engine.start()
    try await h.engine.keepDraft(pageId: notes, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.refresh()
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()
    #expect(await current(h.engine)?.drafts == stuck("This page is in Trash", notes))
    #expect(await h.saves == [])

    await h.transport.add([.workspace(.full(servedWithNotes(7, nil), owner: "user-1"))])
    await h.engine.refresh()
    await h.engine.saveNow()
    #expect(await current(h.engine)?.drafts == stuck("This page is gone", notes))
    #expect(await h.saves == [])
    #expect(try await h.drafts.map(\.document) == [typed("Walk")], "kept for him")

    // A load that brings the page back lets it go.
    let applied = try changes(from: 8, to: 9, pages: [notesPage(typed("Walk"))])
    await h.transport.add([
      .workspace(.full(servedWithNotes(8, notesPage(baseDocument)), owner: "user-1")),
      .saved(.applied(receipt: .object(["revision": .number("9")]), changes: applied, owner: "user-1")),
    ])
    await h.engine.refresh()
    let saves = await h.saves
    #expect(saves.count == 1)
    #expect(saves.first?.expectedContent == ContentKey.of(baseDocument))
    #expect(saves.first?.expectedRevision == 8)
    #expect(try await h.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_document_the_server_refuses_holds_the_draft() async throws {
    let h = try await DraftHarness(
      opening + [
        .saved(.refused(message: "Invalid editor document")), .workspace(.unchanged(revision: 5, owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()

    #expect(await current(h.engine)?.drafts == stuck("Invalid editor document"))
    #expect(try await h.drafts.first?.sent == nil)
    await h.engine.refresh()
    await h.engine.saveNow()
    #expect(await h.saves.count == 1, "not sent again")
    #expect(await h.waits.asked.allSatisfy { $0 == .milliseconds(450) }, "nor tried again later")

    // His next words take it out of that state; a 400 and a 413 hold it again.
    let refusals: [(status: Int, reason: String?, held: String)] = [
      (400, "bad-request", "bad-request"), (413, nil, "refused"),
    ]
    for (count, refusal) in refusals.enumerated() {
      await h.transport.add([.failure(TransportError.refused(status: refusal.status, reason: refusal.reason))])
      try await h.engine.keepDraft(pageId: day, document: typed("Walk \(count)"), singleDeleteIds: [], startedFrom: baseDocument)
      #expect(await current(h.engine)?.drafts == waiting())
      await until { await h.waits.inProgress == 1 }
      await h.waits.elapse()
      await until { await h.saves.count == count + 2 }
      await h.engine.settled()
      #expect(await current(h.engine)?.drafts == stuck(refusal.held))
      #expect(try await h.drafts.first?.sent == nil)
    }
    #expect(await h.waits.asked.allSatisfy { $0 == .milliseconds(450) })

    // The next launch tries it once more.
    let transport = FakeTransport(opening + [try saved(from: 5, to: 6, document: typed("Walk 1"))])
    let waits = Waits()
    let next = SyncEngine(
      transport: transport, tokens: h.tokens, store: h.store, sleep: { try await waits.sleep($0) }, now: { noon })
    await next.start()
    await next.settled()
    #expect(received(await transport.calls).map(\.document) == [typed("Walk 1")])
    #expect(try await h.drafts == [])
  }

  @Test func discardDraft_removes_it_and_the_page_is_the_servers_again() async throws {
    let h = try await DraftHarness(
      opening + [.workspace(.full(served(6, document: typed("Theirs")), owner: "user-1"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.refresh()
    #expect(await h.engine.draft(of: day)?.document == typed("Walk"))

    await h.engine.discardDraft(pageId: day)

    #expect(try await h.drafts == [])
    #expect(await h.engine.draft(of: day) == nil)
    let state = await current(h.engine)
    #expect(state?.drafts == [])
    #expect(state?.workspace?.page(day)?.document == typed("Theirs"))
    await h.waits.elapse()
    await h.engine.saveNow()
    #expect(await h.saves == [])
  }

  @Test func another_accounts_draft_is_not_drawn_not_sent_and_still_there() async throws {
    let other = Session(token: "tok-2", owner: "user-2", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
    let back = Session(token: "tok-3", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
    let h = try await DraftHarness(opening + [.failure(TransportError.signedOut)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    // His session ends: signed out, with the copy and the draft kept out of sight.
    await h.engine.refresh()
    #expect(await current(h.engine)?.phase == .signedOut)

    // Another account, whose day page has the same id and the same words.
    await h.transport.add([.session(other), .workspace(.full(served(1), owner: "user-2"))])
    try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    let theirs = await current(h.engine)
    #expect(theirs?.drafts == [])
    #expect(theirs?.workspace?.page(day)?.document == baseDocument)
    #expect(await h.engine.draft(of: day) == nil)
    #expect(await h.saves == [])
    #expect(try await h.drafts.map(\.owner) == ["user-1"])
    #expect(try await h.drafts.first?.document == typed("Walk"))

    // He signs back in: his draft is drawn again, and saved under his account.
    let gate = Gate()
    await h.transport.add([.session(back), .workspace(.full(served(5), owner: "user-1")), .gated(gate)])
    let signingIn = Task { try await h.engine.signIn(email: "one@example.com", password: "pw", timezone: "UTC") }
    await gate.reached()
    let mine = await current(h.engine)
    #expect(mine?.workspace?.page(day)?.document == typed("Walk"))
    #expect(mine?.drafts == [DraftStatus(id: day, state: .sending)])
    await gate.open(try saved(from: 5, to: 6, document: typed("Walk")))
    try await signingIn.value
    await h.engine.settled()

    let saves = await h.saves
    #expect(saves.count == 1)
    #expect(saves.first?.expectedOwner == "user-1")
    #expect(saves.first?.document == typed("Walk"))
    #expect(try await h.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func an_owner_mismatch_on_a_save_loads_and_stops() async throws {
    let theirs = served(1, document: typed("Theirs"))
    let h = try await DraftHarness(
      opening + [.saved(.ownerMismatch(owner: "user-2")), .workspace(.full(theirs, owner: "user-2"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()
    await h.engine.settled()

    #expect(await h.transport.calls.last == .workspace(token: "tok-1", have: nil))
    #expect(await h.saves.count == 1)
    #expect(try await h.store.load()?.owner == "user-2")
    let kept = try #require(try await h.drafts.first)
    #expect(kept.owner == "user-1")
    #expect(kept.document == typed("Walk"))
    #expect(kept.sent == nil)
    let state = await current(h.engine)
    #expect(state?.drafts == [])
    #expect(state?.workspace?.page(day)?.document == typed("Theirs"))
    #expect(await h.transport.unscripted == [])
  }

  @Test func signing_out_with_a_draft_asks_first() async throws {
    let h = try await DraftHarness(opening + [.failure(TransportError.offline), .done])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    #expect(await h.engine.signOut(discardingUnsent: false) == 1)

    #expect(await h.saves.count == 1, "its wait was cut short and the save tried")
    #expect(try await h.drafts.count == 1)
    let state = await current(h.engine)
    #expect(state?.phase == .ready)
    #expect(state?.signedIn == true)
    #expect(state?.workspace?.page(day)?.document == typed("Walk"))

    #expect(await h.engine.signOut(discardingUnsent: true) == 0)
    #expect(try await h.drafts == [])
    #expect(try await h.store.load() == nil)
    #expect(await current(h.engine)?.phase == .signedOut)
  }

  @Test func a_tick_on_a_to_do_a_draft_made_waits_for_that_saves_resend_after_a_load_brought_the_to_do() async throws {
    // The first send lands as revision 6 and its answer is lost; a load then brings revision 7, which holds the
    // to-do the save made.
    let landed = served(7, document: withTodo(planned: true), tasks: [todo("open"), otherTask])
    let replay = try saved(
      from: 7, to: 7, document: withTodo(planned: true), tasks: [todo("open"), otherTask], receipt: 6)
    let ticked = try changes(from: 7, to: 8, tasks: [todo("done", version: 2)])
    let gate = Gate()
    let h = try await DraftHarness(
      opening + [
        .failure(TransportError.offline), .workspace(.full(landed, owner: "user-1")), .gated(gate),
        .outcome(.applied(receipt: .object([:]), changes: ticked, owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()
    await h.engine.saveNow()

    let refreshing = Task { await h.engine.refresh() }
    await gate.reached()
    #expect(await h.transport.sends == [], "the tick waits for the answer to the save that made its to-do")
    #expect(await current(h.engine)?.waiting == 1)
    await gate.open(replay)
    await refreshing.value

    let saves = await h.saves
    #expect(saves.count == 2)
    #expect(saves.last?.operationId == saves.first?.operationId)
    guard case .send(_, _, let action, _, let basis)? = await h.transport.sends.last else {
      Issue.record("the tick was not sent")
      return
    }
    #expect(action == tick("editor-task:r1"))
    #expect(basis.baseRevision == 5)
    #expect(basis.ownRevisions == [6], "the save is his own change")
    #expect(try await h.store.entries().isEmpty)
    #expect(await h.transport.unscripted == [])
  }

  // MARK: Fix round 1

  @Test func a_first_keystroke_on_a_page_a_load_just_changed_is_behind_not_sent() async throws {
    let h = try await DraftHarness(
      opening + [.workspace(.full(served(6, document: typed("Theirs")), owner: "user-1"))])
    await h.engine.start()
    // The screen still shows the page as it was when a load brings another device's lines; his keystroke on the
    // page it shows reaches the engine after the load.
    await h.engine.refresh()

    try await h.engine.keepDraft(
      pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    let draft = try #require(try await h.drafts.first)
    #expect(draft.baseDocument == baseDocument)
    #expect(draft.base == ContentKey.of(baseDocument))
    #expect(await current(h.engine)?.drafts == behind())
    #expect(await h.saves == [], "his page must not replace the one the load brought")
  }

  @Test func a_first_keystroke_after_a_saves_answer_removed_its_draft_is_behind_when_the_server_changed_the_page()
    async throws
  {
    let h = try await DraftHarness(
      opening + [try saved(from: 5, to: 6, document: withTodo(planned: true), tasks: [todo("open")])])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()
    #expect(try await h.drafts == [], "the answer removed the draft")

    // The screen types on the page it sent, before it has drawn the server's.
    try await h.engine.keepDraft(
      pageId: day, document: withTodo(more: "Then call"), singleDeleteIds: [], startedFrom: withTodo())
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    #expect(try await h.drafts.first?.baseDocument == withTodo())
    #expect(await current(h.engine)?.drafts == behind())
    #expect(await h.saves.count == 1)
  }

  @Test func a_first_keystroke_after_discardDraft_is_behind_when_it_was_typed_on_the_page_before() async throws {
    let h = try await DraftHarness(
      opening + [.workspace(.full(served(6, document: typed("Theirs")), owner: "user-1"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.refresh()
    await h.engine.discardDraft(pageId: day)

    // A keystroke made before the screen drew the server's page again.
    try await h.engine.keepDraft(
      pageId: day, document: typed("Walk on"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    #expect(try await h.drafts.first?.baseDocument == baseDocument)
    #expect(await current(h.engine)?.drafts == behind())
    #expect(await h.saves == [])
  }

  @Test func merging_gives_the_pair_only_for_a_draft_behind_the_servers_page() async throws {
    let moved = servedWithNotes(
      6, notesPage(baseDocument, trashedAt: "2026-11-25T12:00:00.000Z"), day: typed("Theirs"))
    let h = try await DraftHarness(
      opening + [.workspace(.full(moved, owner: "user-1"))], copy: servedWithNotes(5, notesPage(baseDocument)))
    // Another account's draft of the same page, which would be behind were it his.
    try await h.store.put(
      PageDraft(
        pageId: day, owner: "user-2", base: ContentKey.of("[]"), baseDocument: "[]", document: typed("Theirs"),
        singleDeleteIds: [], sent: nil, changedAt: noon))
    await h.engine.start()

    #expect(await h.engine.merging(day) == nil, "no draft of his, and another account's is not his")
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.keepDraft(
      pageId: notes, document: typed("Note"), singleDeleteIds: [], startedFrom: baseDocument)
    #expect(await h.engine.merging(day) == nil, "a draft that is not behind")

    await h.engine.refresh()

    let pair = try #require(await h.engine.merging(day))
    #expect(pair.baseDocument == baseDocument)
    #expect(pair.theirs == typed("Theirs"))
    #expect(await current(h.engine)?.drafts.first { $0.id == notes }?.state == .stuck("This page is in Trash"))
    #expect(await h.engine.merging(notes) == nil, "a stuck draft")
  }

  @Test(arguments: [false, true])
  func signing_out_as_another_account_leaves_the_first_accounts_draft(discarding: Bool) async throws {
    let other = Session(token: "tok-2", owner: "user-2", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
    let back = Session(token: "tok-3", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))
    let h = try await DraftHarness(opening + [.failure(TransportError.signedOut)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.refresh()
    await h.transport.add([.session(other), .workspace(.full(served(1), owner: "user-2")), .done])
    try await h.engine.signIn(email: "two@example.com", password: "pw", timezone: "UTC")

    #expect(await h.engine.signOut(discardingUnsent: discarding) == 0)

    #expect(try await h.store.load() == nil)
    #expect(try await h.drafts.map(\.owner) == ["user-1"], "the first account's words are not his to erase")
    #expect(try await h.drafts.first?.document == typed("Walk"))

    let gate = Gate()
    await h.transport.add([.session(back), .workspace(.full(served(5), owner: "user-1")), .gated(gate)])
    let signingIn = Task { try await h.engine.signIn(email: "one@example.com", password: "pw", timezone: "UTC") }
    await gate.reached()
    #expect(await current(h.engine)?.workspace?.page(day)?.document == typed("Walk"))
    await gate.open(try saved(from: 5, to: 6, document: typed("Walk")))
    try await signingIn.value
    await h.engine.settled()
    #expect(try await h.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func rebasing_with_no_draft_answers_false_and_keeps_nothing() async throws {
    let h = try await DraftHarness(opening)
    await h.engine.start()

    #expect(try await h.engine.rebaseDraft(pageId: day, baseDocument: baseDocument, document: typed("Walk")) == false)

    await h.engine.settled()
    #expect(try await h.drafts == [])
    #expect(await current(h.engine)?.drafts == [])
    #expect(await h.saves == [])
  }

  @Test func an_expired_receipt_is_followed_by_a_load_and_the_draft_is_behind() async throws {
    let h = try await DraftHarness(
      opening + [
        .saved(.refused(message: "This change was already applied \u{00B7} reload")),
        .workspace(.full(served(6, document: typed("Walk")), owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)

    await h.engine.saveNow()

    #expect(await h.transport.calls.last == .workspace(token: "tok-1", have: 5))
    #expect(await h.saves.count == 1)
    #expect(try await h.drafts.first?.sent == nil)
    #expect(await current(h.engine)?.drafts == behind())
    #expect(await h.waits.asked.allSatisfy { $0 == .milliseconds(450) })
    #expect(await h.transport.unscripted == [])
  }

  @Test func discarding_a_draft_drops_the_ticks_on_the_to_dos_only_it_had() async throws {
    let h = try await DraftHarness(
      opening, copy: served(5, tasks: [otherTask]),
      entries: [storedTick("op-held", "other", base: 5, heldFor: "conflict")])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()

    await h.engine.discardDraft(pageId: day)

    #expect(try await h.store.entries().map(\.operationId) == ["op-held"], "a tick on a to-do that is not his to drop")
    let state = await current(h.engine)
    #expect(state?.pending == 0)
    #expect(state?.waiting == 0)
    #expect(state?.workspace?.task("editor-task:r1") == nil)
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()
    #expect(await h.transport.sends == [])
    #expect(await h.saves == [])
  }

  @Test func a_page_moved_to_trash_holds_a_save_whose_answer_was_lost_until_it_is_restored() async throws {
    // The first send lands as revision 6 and its answer is lost; elsewhere the page goes to Trash, then comes back.
    let trashed = served(
      7, document: withTodo(planned: true), tasks: [todo("open")], trashedAt: "2026-11-25T12:30:00.000Z")
    let restored = served(8, document: withTodo(planned: true), tasks: [todo("open")])
    let replay = try saved(from: 8, to: 8, document: withTodo(planned: true), tasks: [todo("open")], receipt: 6)
    let ticked = try changes(from: 8, to: 9, tasks: [todo("done", version: 2)])
    let h = try await DraftHarness(
      opening + [
        .failure(TransportError.offline), .workspace(.full(trashed, owner: "user-1")),
        .workspace(.full(restored, owner: "user-1")), replay,
        .outcome(.applied(receipt: .object([:]), changes: ticked, owner: "user-1")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()
    await h.engine.saveNow()
    let first = try #require(await h.saves.first)

    await h.engine.refresh()

    #expect(await h.saves.count == 1, "not sent into a page in Trash")
    #expect(await h.transport.sends == [], "the tick waits for the save's answer")
    let state = await current(h.engine)
    #expect(state?.drafts == stuck("This page is in Trash"))
    #expect(state?.waiting == 1)
    #expect(try await h.drafts.first?.sent?.operationId == first.operationId, "what was sent is kept")

    await h.engine.refresh()

    let saves = await h.saves
    #expect(saves.count == 2)
    #expect(saves.last?.operationId == first.operationId)
    #expect(saves.last?.action == first.action)
    guard case .send(_, _, _, _, let basis)? = await h.transport.sends.last else {
      Issue.record("the tick was not sent")
      return
    }
    #expect(basis.ownRevisions == [6])
    #expect(try await h.drafts == [])
    #expect(try await h.store.entries().isEmpty)
    #expect(await h.transport.unscripted == [])
  }

  // MARK: Fix round 2

  @Test func a_discarding_sign_out_after_an_owner_mismatch_erases_the_shown_accounts_drafts_only() async throws {
    let theirs = served(1, document: typed("Theirs"))
    let h = try await DraftHarness(
      opening + [.saved(.ownerMismatch(owner: "user-2")), .workspace(.full(theirs, owner: "user-2")), .done])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()
    // The session still names user-1; the copy shown, and the draft he is told about, are user-2's.
    try await h.engine.keepDraft(
      pageId: day, document: typed("Theirs too"), singleDeleteIds: [], startedFrom: typed("Theirs"))
    #expect(await current(h.engine)?.drafts == waiting())

    #expect(await h.engine.signOut(discardingUnsent: true) == 0)

    let left = try await h.drafts
    #expect(left.map(\.owner) == ["user-1"], "the drafts discarded are the ones shown")
    #expect(left.first?.document == typed("Walk"))
  }

  @Test func discarding_a_draft_whose_save_is_on_its_way_keeps_the_tick_on_the_to_do_it_makes() async throws {
    let gate = Gate()
    let h = try await DraftHarness(opening + [.gated(gate)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()
    let saving = Task { await h.engine.saveNow() }
    await gate.reached()

    await h.engine.discardDraft(pageId: day)

    #expect(try await h.store.entries().count == 1, "the save on its way makes the to-do")
    let ticked = try changes(from: 6, to: 7, tasks: [todo("done", version: 2)])
    await h.transport.add([.outcome(.applied(receipt: .object([:]), changes: ticked, owner: "user-1"))])
    await gate.open(try saved(from: 5, to: 6, document: withTodo(planned: true), tasks: [todo("open")]))
    await saving.value
    await h.engine.settled()

    guard case .send(_, _, let action, _, let basis)? = await h.transport.sends.last else {
      Issue.record("the tick was not sent after the answer")
      return
    }
    #expect(action == tick("editor-task:r1"))
    #expect(basis.ownRevisions == [6])
    #expect(try await h.store.entries().isEmpty)
    #expect(await current(h.engine)?.workspace?.task("editor-task:r1")?.status == .done)
  }

  @Test func discarding_one_pages_draft_keeps_a_tick_on_a_to_do_another_pages_draft_made() async throws {
    let h = try await DraftHarness(opening, copy: servedWithNotes(5, notesPage(baseDocument)))
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.keepDraft(pageId: notes, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    try await h.engine.enqueue(action: tick("editor-task:r1"), label: #"ticked "Buy milk""#)
    await h.engine.settled()

    await h.engine.discardDraft(pageId: day)

    #expect(try await h.store.entries().count == 1, "the notes page's draft still makes the to-do")
    #expect(await current(h.engine)?.workspace?.task("editor-task:r1")?.status == .done)
  }

  @Test func a_refusal_of_a_save_whose_draft_was_discarded_does_not_hold_the_next_draft() async throws {
    let gate = Gate()
    let h = try await DraftHarness(opening + [.gated(gate)])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    let saving = Task { await h.engine.saveNow() }
    await gate.reached()
    await h.engine.discardDraft(pageId: day)
    try await h.engine.keepDraft(
      pageId: day, document: typed("Walk on"), singleDeleteIds: [], startedFrom: baseDocument)

    await gate.open(.saved(.refused(message: "Invalid editor document")))
    await saving.value
    await h.engine.settled()

    #expect(await current(h.engine)?.drafts == waiting(), "that refusal was of words he threw away")
    await h.transport.add([try saved(from: 5, to: 6, document: typed("Walk on"))])
    await h.waits.elapse()
    await until { await h.saves.count == 2 }
    await h.engine.settled()
    #expect(try await h.drafts == [])
  }

  @Test func a_discarding_sign_out_leaves_no_discarded_draft_in_memory_when_the_store_cannot_be_read() async throws {
    let h = try await DraftHarness(opening + [.done])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.store.fail("drafts")

    #expect(await h.engine.signOut(discardingUnsent: true) == 0)

    #expect(await h.engine.drafts.isEmpty)
    await h.store.heal()
    #expect(try await h.drafts == [])
  }

  // MARK: A keystroke on its way when a save landed

  @Test func a_keystroke_on_its_way_when_a_save_landed_starts_from_what_was_sent() async throws {
    let h = try await DraftHarness(
      opening + [
        try saved(from: 5, to: 6, document: typed("Walk")), try saved(from: 6, to: 7, document: typed("Walk on")),
      ])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()
    #expect(try await h.drafts == [], "the answer removed the draft")

    // The screen made this keystroke on the page as it was before the save; it reaches the engine after the answer.
    try await h.engine.keepDraft(
      pageId: day, document: typed("Walk on"), singleDeleteIds: [], startedFrom: baseDocument)

    let draft = try #require(try await h.drafts.first)
    #expect(draft.baseDocument == typed("Walk"))
    #expect(draft.base == ContentKey.of(typed("Walk")))
    #expect(await current(h.engine)?.drafts == waiting())
    await h.engine.saveNow()
    let saves = await h.saves
    #expect(saves.count == 2)
    #expect(saves.last?.expectedContent == ContentKey.of(typed("Walk")))
    #expect(saves.last?.document == typed("Walk on"))
    #expect(try await h.drafts == [])
    #expect(await h.transport.unscripted == [])
  }

  @Test func a_keystroke_on_its_way_when_a_save_landed_that_the_server_changed_is_merged_with_what_was_sent()
    async throws
  {
    let h = try await DraftHarness(
      opening + [try saved(from: 5, to: 6, document: withTodo(planned: true), tasks: [todo("open")])])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: withTodo(), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()
    #expect(try await h.drafts == [], "the answer removed the draft")

    try await h.engine.keepDraft(
      pageId: day, document: withTodo(more: "Then call"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    let draft = try #require(try await h.drafts.first)
    #expect(draft.baseDocument == withTodo())
    #expect(draft.base == ContentKey.of(withTodo()))
    #expect(await current(h.engine)?.drafts == behind())
    #expect(await h.saves.count == 1, "nothing is sent over the server's page")
    let theirs = try #require(try await h.store.load()?.workspace.page(day)?.document)
    let merged = PageMerge.merge(base: draft.baseDocument, mine: draft.document, theirs: theirs)
    #expect(merged.document == withTodo(planned: true, more: "Then call"))
    #expect(!merged.bothChanged, "his line is not doubled")
  }

  @Test func a_keystroke_typed_on_neither_the_copys_page_nor_a_landed_saves_base_is_taken_as_given() async throws {
    let h = try await DraftHarness(opening + [try saved(from: 5, to: 6, document: typed("Walk"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()

    try await h.engine.keepDraft(
      pageId: day, document: typed("Theirs too"), singleDeleteIds: [], startedFrom: typed("Theirs"))
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    #expect(try await h.drafts.first?.baseDocument == typed("Theirs"))
    #expect(await current(h.engine)?.drafts == behind())
    #expect(await h.saves.count == 1)
  }

  @Test func a_discarded_draft_forgets_the_save_that_landed_before_it() async throws {
    let h = try await DraftHarness(opening + [try saved(from: 5, to: 6, document: typed("Walk"))])
    await h.engine.start()
    try await h.engine.keepDraft(pageId: day, document: typed("Walk"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.saveNow()
    try await h.engine.keepDraft(
      pageId: day, document: typed("Walk on"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.engine.discardDraft(pageId: day)

    // A keystroke on the page as it was before the save, made before the screen drew the server's page again.
    try await h.engine.keepDraft(
      pageId: day, document: typed("Walk off"), singleDeleteIds: [], startedFrom: baseDocument)
    await h.waits.elapse()
    await h.engine.saveNow()
    await h.engine.settled()

    #expect(try await h.drafts.first?.baseDocument == baseDocument)
    #expect(await current(h.engine)?.drafts == behind())
    #expect(await h.saves.count == 1)
  }

  @Test func two_devices() async throws {
    let server = try PageServer()
    let one = try await Device(server)
    let two = try await Device(server)
    await one.engine.start()
    await two.engine.start()

    // Both type in the morning's line and add one of their own, offline from each other.
    let mine = "[\(paragraph("p1", "Morning run")),\(paragraph("pa", "Call mom"))]"
    let theirs = "[\(paragraph("p1", "Morning tea")),\(paragraph("pb", "Buy bread"))]"
    try await one.engine.keepDraft(pageId: day, document: mine, singleDeleteIds: [], startedFrom: baseDocument)
    try await two.engine.keepDraft(pageId: day, document: theirs, singleDeleteIds: [], startedFrom: baseDocument)

    await one.engine.saveNow()
    await two.engine.saveNow()
    #expect(await current(one.engine)?.drafts == [])
    #expect(await current(two.engine)?.drafts == behind())

    // The second merges onto the first's page and saves; the first, meanwhile, typed again.
    #expect(try await two.merge())
    await two.engine.settled()
    let more = "[\(paragraph("p1", "Morning run")),\(paragraph("pa", "Call mom")),\(paragraph("pc", "Then the gym"))]"
    // Typed on the page his own save made.
    try await one.engine.keepDraft(pageId: day, document: more, singleDeleteIds: [], startedFrom: mine)
    await one.engine.saveNow()
    #expect(await current(one.engine)?.drafts == behind())
    #expect(try await one.merge())
    await one.engine.settled()
    await two.engine.refresh()

    let settled = await server.document
    #expect(try await one.page == settled)
    #expect(try await two.page == settled)
    #expect(await current(one.engine)?.workspace?.page(day)?.document == settled)
    #expect(await current(two.engine)?.workspace?.page(day)?.document == settled)
    #expect(try await one.store.drafts() == [])
    #expect(try await two.store.drafts() == [])
    let lines = Document.blocks(settled).map { InlineText.plain($0.content, pageDate: nil) }
    for words in ["Morning run", "Morning tea", "Call mom", "Buy bread", "Then the gym"] {
      #expect(lines.count { $0 == words } == 1, "\(words) once")
    }
    #expect(lines.count == 5)
  }
}

/// Another device's to-do, written elsewhere.
private let otherTask: JSONValue = .object([
  "id": .string("other"), "title": .string("Other"), "status": .string("open"), "paused": .bool(false),
  "version": .number("1"),
])

/// One server's state for two devices, held by the test: the day page, the revision and the saves it took. A save
/// is checked as `applyCommand` and `save-editor` check it: an operation it took before is answered with that
/// receipt; then the revision; then the page's key.
private actor PageServer: ServerTransport {
  private var revision = 5
  private(set) var document = baseDocument
  private var receipts: [String: Int] = [:]
  private let savedElsewhere: String
  private let pageChanged: String

  init() throws {
    savedElsewhere = try refusal("saved-elsewhere")
    pageChanged = try refusal("page-changed-elsewhere")
  }

  func signIn(email: String, password: String, timezone: String) async throws -> Session {
    throw TransportError.offline
  }

  func signOut(token: String) async throws {}

  func account(token: String?) async throws -> Account {
    Account(owner: "user-1", email: "one@example.com", signIn: true)
  }

  func workspace(token: String?, have: Int?) async throws -> WorkspaceReply {
    have == revision ? .unchanged(revision: revision, owner: "user-1") : .full(served(revision, document: document), owner: "user-1")
  }

  func send(
    token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis
  ) async throws -> CommandOutcome {
    throw TransportError.offline
  }

  func save(
    token: String?, operationId: String, expectedRevision: Int, expectedOwner: String, action: JSONValue
  ) async throws -> SaveOutcome {
    if let made = receipts[operationId] {
      return .applied(
        receipt: .object(["revision": .number(String(made))]),
        changes: try changes(from: revision, to: revision, document: document), owner: "user-1")
    }
    guard expectedRevision == revision else { return .refused(message: savedElsewhere) }
    let object = action.objectValue
    guard object?["expectedContent"]?.stringValue == ContentKey.of(document) else {
      return .refused(message: pageChanged)
    }
    guard let next = object?["document"]?.stringValue else {
      throw TransportError.refused(status: 400, reason: "bad-request")
    }
    document = next
    revision += 1
    receipts[operationId] = revision
    return .applied(
      receipt: .object(["revision": .number(String(revision))]),
      changes: try changes(from: revision - 1, to: revision, document: next), owner: "user-1")
  }
}

/// A device: an engine with its own store and session, on the shared server.
private struct Device {
  let store = MemoryWorkspaceStore()
  let tokens = MemoryTokenStore()
  let waits = Waits()
  let engine: SyncEngine

  init(_ server: PageServer) async throws {
    try tokens.write(session)
    let waits = waits
    engine = SyncEngine(
      transport: server, tokens: tokens, store: store, sleep: { try await waits.sleep($0) }, now: { noon })
  }

  /// The day page as this device's copy has it: the server's, as last loaded.
  var page: String? { get async throws { try await store.load()?.workspace.page(day)?.document } }

  /// What the screen does with a draft behind the server's page: merges what it started from, his words and the
  /// server's page, and hands the result back on that page.
  func merge() async throws -> Bool {
    let pair = try #require(await engine.merging(day))
    let draft = try #require(await engine.draft(of: day))
    let merged = PageMerge.merge(base: pair.baseDocument, mine: draft.document, theirs: pair.theirs)
    return try await engine.rebaseDraft(pageId: day, baseDocument: pair.theirs, document: merged.document)
  }
}
