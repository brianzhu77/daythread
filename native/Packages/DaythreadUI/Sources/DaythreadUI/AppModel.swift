import DaythreadCore
import DaythreadSync
import Foundation
import Observation
import os

/// Why a sign-in did not go through, in the cases the screen tells apart.
public enum SignInFailure: Equatable, Sendable {
  case wrong, unconfirmed, notInvited
  /// Too many tries; the seconds to wait.
  case wait(seconds: Int)
  case offline, unavailable

  init(_ error: any Error) {
    switch error as? TransportError {
    case .refused(status: 401, reason: "wrong"?)?: self = .wrong
    case .refused(status: 401, reason: "unconfirmed"?)?: self = .unconfirmed
    case .refused(status: 403, reason: "not-invited"?)?: self = .notInvited
    case .wait(let seconds)?: self = .wait(seconds: seconds)
    case .offline?: self = .offline
    default: self = .unavailable
    }
  }
}

/// What the screens draw from: the engine's latest state, followed for as long as the model lives, with the ticks this
/// model has made and the engine has not yet drawn replayed over it.
///
/// The record of a tick: the engine's answer cannot come in the frame of the tap, since it is an actor that writes to
/// disk first. So `tick` records the action and draws it at once, and the record goes only when the engine draws it
/// too: once `enqueue` has returned its ticket and a state with `enqueued` at or past that ticket has arrived, in
/// either order. A record whose entry the engine could not store goes at once. Every record goes when the account
/// changes, so nothing of one account is drawn under another.
@MainActor
@Observable
public final class AppModel {
  /// The engine's latest state; until its first arrives (it sends one as soon as it is asked), the state of an engine
  /// that has not started.
  public private(set) var state = SyncState()
  /// Pages whose document does not write back byte for byte (Debug builds only); nil when every page does.
  private(set) var roundTrip: RoundTrip?
  /// False when the device's store could not be opened and changes live in memory for this launch only.
  public let keepsChanges: Bool

  struct RoundTrip: Equatable {
    let failing: Int
    let total: Int
  }

  /// An action handed to the engine and not yet drawn by it; `ticket` once `enqueue` has returned it.
  private struct Record {
    let id: Int
    let action: JSONValue
    var ticket: Int?
  }

  /// In the order made, which is the order the engine is handed them.
  private var records: [Record] = []
  @ObservationIgnored private var nextRecord = 0
  /// When each to-do was last ticked, for the double-tap guard.
  @ObservationIgnored private var lastTicks: [String: Date] = [:]
  @ObservationIgnored private let engine: SyncEngine
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private var following: Task<Void, Never>?
  @ObservationIgnored private var auditedRevision: Int?

  /// Counts the times a page stopped having calls waiting: its last call answered, or its calls dropped. Observed, so a screen that held back an outside change
  /// while it was ahead (`isWriting`) looks again once it is not.
  private(set) var answeredWrites = 0
  /// The calls for pages' words not yet handed to the engine, in the order made; `callInFlight` is the one it is
  /// answering. A single task hands them over one at a time (`sendCalls`), so they reach the engine in that order.
  @ObservationIgnored private var queuedCalls: [QueuedCall] = []
  @ObservationIgnored private var callInFlight: WritingCall?
  @ObservationIgnored private var sendingCalls: Task<Void, Never>?
  /// Pages whose last document the engine did not store: the screen holds words the engine does not have.
  @ObservationIgnored private var unstored: Set<String> = []
  /// The pages a day screen edits, by how many screens edit each: their drafts are merged by the screen.
  @ObservationIgnored private var openPages: [String: Int] = [:]
  /// For each draft of a page that is not open and was behind, the revision whose copy it was merged with, so each
  /// behind state is merged once.
  @ObservationIgnored private var mergedAt: [String: Int] = [:]

  /// The web drops a second tap on the same to-do this soon after the first.
  private static let doubleTap: TimeInterval = 0.5

  public init(engine: SyncEngine, keepsChanges: Bool = true, now: @escaping () -> Date = Date.init) {
    self.engine = engine
    self.keepsChanges = keepsChanges
    self.now = now
    today = LocalDate.today(in: TimeZone.current.identifier, at: now())
  }

  isolated deinit {
    following?.cancel()
  }

  /// What screens draw: the engine's workspace with this model's not-yet-accepted actions replayed over it. Replaying
  /// one the engine already draws changes nothing a screen shows: it sets the same status again.
  public var workspace: Workspace? {
    records.reduce(state.workspace) { $0?.predicting($1.action) }
  }

  /// The account's day: today in the workspace's zone, or the device's before there is a workspace. It moves only in
  /// `checkToday`, which runs whenever a state arrives, so a tick and the screen it is made on read the same day.
  public private(set) var today: LocalDate

  /// When `today` next changes, unless the zone does, and how long until then; both by the model's clock, which a
  /// timer must count from rather than the device's.
  public var nextDayChange: (at: Date, in: TimeInterval) {
    let now = now()
    let change = DayClock.nextChange(after: now, timezone: zone)
    return (change, change.timeIntervalSince(now))
  }

  /// Moves `today` to the account's day of this moment. The screen calls it at `nextDayChange` and whenever the day
  /// may have changed while nothing was looking (the app becoming active, the system's clock or zone changing).
  public func checkToday() {
    let day = LocalDate.today(in: zone, at: now())
    if day != today { today = day }
  }

  private var zone: String {
    state.workspace?.timezone ?? TimeZone.current.identifier
  }

  /// Follows the engine's states, then shows the device's copy and asks the server. Calling it again does nothing.
  public func start() {
    guard following == nil else { return }
    let states = engine.states
    following = Task { [weak self] in
      for await state in states {
        guard let self else { return }
        self.receive(state)
      }
    }
    let engine = engine
    Task { await engine.start() }
  }

  /// Nil once signed in.
  public func signIn(email: String, password: String) async -> SignInFailure? {
    do {
      try await engine.signIn(email: email, password: password, timezone: TimeZone.current.identifier)
      forgetTicks()
      return nil
    } catch {
      return SignInFailure(error)
    }
  }

  public enum SignOutAnswer: Equatable, Sendable {
    case signedOut
    /// Nobody was signed out: this many changes are not sent yet, and he is asked before they are erased.
    case unsent(Int)
  }

  /// Without `discardingUnsent`, tries once to send what is waiting, and signs out only when nothing is left unsent.
  public func signOut(discardingUnsent: Bool) async -> SignOutAnswer {
    // The words he typed a moment ago are counted too: everything handed over first reaches the engine.
    _ = await Self.answer(enqueue(.flush))
    let unsent = await engine.signOut(discardingUnsent: discardingUnsent)
    guard unsent == 0 else { return .unsent(unsent) }
    forgetTicks()
    return .signedOut
  }

  public func refresh() async {
    await engine.refresh()
  }

  // MARK: Changes

  private static let tickLog = Logger(subsystem: "app.daythread.Daythread", category: "tick")

  /// Works out the status from what is drawn, records the action, and hands it to the engine.
  /// Returns false when nothing was done: the to-do cannot be ticked, or the same to-do was tapped under 500 ms ago.
  @discardableResult
  public func tick(taskId: String) -> Bool {
    guard let drawn = workspace, let task = drawn.task(taskId) else { return false }
    let status: TodoTask.Status
    switch task.status {
    case .open: status = .done
    case .done: status = .open
    case .cancelled, .other: return false
    }
    let time = now()
    if let last = lastTicks[taskId], time.timeIntervalSince(last) < Self.doubleTap { return false }
    lastTicks[taskId] = time

    let action = Command.taskStatus(taskId: taskId, status: status, today: today)
    let label = ChangeLabel.text(for: action, in: drawn)
    let id = nextRecord
    nextRecord += 1
    records.append(Record(id: id, action: action))
    let engine = engine
    Task { [weak self] in
      // An account change between the tap and this turn dropped the record; its action is not that account's.
      guard self?.records.contains(where: { $0.id == id }) == true else { return }
      let ticket: Int?
      do {
        ticket = try await engine.enqueue(action: action, label: label)
      } catch {
        // Nothing shown yet, or signing out: the tap simply does not count. Anything else is the store refusing a
        // change he made, and this line is the only trace of it. The error's type only: never his words or ids.
        if error as? SyncError != .notReady {
          Self.tickLog.error("A tick was not stored: \(String(describing: type(of: error)), privacy: .public)")
        }
        ticket = nil
      }
      self?.accepted(id, ticket: ticket)
    }
    return true
  }

  public func keep(_ id: Int) async {
    await engine.keep(id)
  }

  public func discard(_ id: Int) async {
    await engine.discard(id)
  }

  /// Sends `action` and waits for the server; nothing is stored, so nothing is sent later.
  public func perform(_ action: JSONValue) async -> Performed {
    await engine.perform(action: action)
  }

  /// `enqueue` returned; a nil ticket means nothing was stored, and the circle goes back to what the copy has.
  private func accepted(_ id: Int, ticket: Int?) {
    guard let index = records.firstIndex(where: { $0.id == id }) else { return }
    guard let ticket else {
      records.remove(at: index)
      return
    }
    records[index].ticket = ticket
    dropDrawnRecords()
  }

  /// Drops the records the engine's latest state draws.
  private func dropDrawnRecords() {
    let enqueued = state.enqueued
    if records.contains(where: { $0.ticket.map { $0 <= enqueued } ?? false }) {
      records.removeAll { $0.ticket.map { $0 <= enqueued } ?? false }
    }
  }

  /// The account changed or nobody is signed in: nothing of one account is drawn, sent or merged under another.
  private func forgetTicks() {
    if !records.isEmpty { records = [] }
    lastTicks = [:]
    dropQueuedCalls()
    if !unstored.isEmpty {
      unstored = []
      answeredWrites += 1
    }
    mergedAt = [:]
  }

  private func receive(_ state: SyncState) {
    self.state = state
    checkToday()
    if state.phase == .signedOut {
      forgetTicks()
    } else {
      dropDrawnRecords()
      mergeDraftsNotOpen()
    }
    #if DEBUG
      if let workspace = state.workspace { audit(workspace) }
    #endif
  }

  // MARK: Audit

  private static let auditLog = Logger(subsystem: "app.daythread.Daythread", category: "audit")

  /// Checks each new revision once, off the main actor; a result that a newer revision overtook is dropped.
  private func audit(_ workspace: Workspace) {
    guard workspace.revision != auditedRevision else { return }
    auditedRevision = workspace.revision
    Task { [weak self] in
      let failing = await Self.pagesThatDoNotRoundTrip(workspace)
      let total = workspace.pages.count
      Self.auditLog.log(
        "Round trip at revision \(workspace.revision): \(failing.count) of \(total) pages fail \(failing.joined(separator: ", "), privacy: .public)"
      )
      guard let self, self.auditedRevision == workspace.revision else { return }
      self.roundTrip = failing.isEmpty ? nil : RoundTrip(failing: failing.count, total: total)
    }
  }

  @concurrent
  private nonisolated static func pagesThatDoNotRoundTrip(_ workspace: Workspace) async -> [String] {
    Audit.pagesThatDoNotRoundTrip(workspace)
  }
}

// MARK: - Writing

/// A call about a page's words, handed to the engine in the order the screen made it.
private enum WritingCall {
  case keep(pageId: String, document: String, singleDeleteIds: [String], startedFrom: String)
  case rebase(pageId: String, baseDocument: String, document: String, singleDeleteIds: [String])
  case discard(pageId: String)
  /// Nothing for the engine: answered once every call made before it has been.
  case flush

  var pageId: String? {
    switch self {
    case .keep(let pageId, _, _, _), .rebase(let pageId, _, _, _), .discard(let pageId): pageId
    case .flush: nil
    }
  }

  func isFor(_ pageId: String) -> Bool {
    self.pageId?.utf8.elementsEqual(pageId.utf8) ?? false
  }
}

private struct QueuedCall {
  var call: WritingCall
  /// Each is told whether the engine did what was asked, then finished; finished with no answer when the call is
  /// dropped.
  var answers: [AsyncStream<Bool>.Continuation]
}

/// The open page's words live with the screen (`native-phase-1.md` §10.5); the model hands them to the engine. Every
/// call about a page's words (keep, rebase, discard, and the point a save now waits for) goes through one queue that a single task empties one
/// call at a time, so the engine receives them in the order made: one task per call could reach the actor in another
/// order, and a rebase landing after a later keystroke's keep would overwrite that keystroke in the store.
extension AppModel {
  private static let writingLog = Logger(subsystem: "app.daythread.Daythread", category: "writing")

  /// Hands the engine the open page's document after a change. Never awaited by the caller. While it waits behind
  /// the page's earlier calls, a newer document for the same page takes its place: only the newest words need to
  /// reach the engine. `startedFrom` is the page his words were typed onto, which the engine takes as the base of a
  /// draft it does not have yet; of several documents that went as one, the first one's.
  public func wrote(pageId: String, document: String, singleDeleteIds: [String], startedFrom: String) {
    if let last = queuedCalls.indices.last, case .keep(let waiting, _, _, let firstStart) = queuedCalls[last].call,
      waiting.utf8.elementsEqual(pageId.utf8)
    {
      queuedCalls[last].call = .keep(
        pageId: pageId, document: document, singleDeleteIds: singleDeleteIds, startedFrom: firstStart)
      return
    }
    queuedCalls.append(
      QueuedCall(
        call: .keep(pageId: pageId, document: document, singleDeleteIds: singleDeleteIds, startedFrom: startedFrom),
        answers: []))
    sendCalls()
  }

  /// Sends what is waiting now (leaving the day, leaving the foreground), once every change handed over before it is
  /// stored. The task ends when the engine's pass has. The pass is not a call in the queue: it waits for the network,
  /// and what he types meanwhile is stored at once, not after it.
  @discardableResult
  public func saveNow() -> Task<Void, Never> {
    let stored = enqueue(.flush)
    let engine = engine
    return Task {
      _ = await Self.answer(stored)
      await engine.saveNow()
    }
  }

  public func discardDraft(pageId: String) async {
    _ = await Self.answer(enqueue(.discard(pageId: pageId)))
  }

  /// The stored draft's words as plain text, one line per row, for "Copy draft"; nil when the page has none. Read
  /// once every change handed over before has been stored.
  public func draftText(of pageId: String) async -> String? {
    _ = await Self.answer(enqueue(.flush))
    guard let draft = await engine.draft(of: pageId) else { return nil }
    let page = state.workspace?.page(pageId)
    // As the engine draws a draft: only a day page reads its date into a `@date` chip.
    return DraftMerging.plainText(of: draft.document, pageDate: page?.type == "daily" ? page?.date : nil)
  }

  /// The pair the open page's draft is merged with, read in one turn of the engine (`SyncEngine.merging`).
  func merging(_ pageId: String) async -> (baseDocument: String, theirs: String)? {
    await engine.merging(pageId)
  }

  /// Hands the engine the merged page as the draft on the server's page (`SyncEngine.rebaseDraft`), behind the calls
  /// made before it, with the rows he removed one at a time that the list still names. The task answers whether the
  /// engine took it.
  func rebase(pageId: String, baseDocument: String, document: String, singleDeleteIds: [String]) -> Task<Bool, Never> {
    let answer = enqueue(
      .rebase(pageId: pageId, baseDocument: baseDocument, document: document, singleDeleteIds: singleDeleteIds))
    return Task { await Self.answer(answer) }
  }

  /// Whether the engine may not have what the screen wrote on the page yet: a call for it waits or is being
  /// answered, or the engine did not store the last one. While it may not, the page the engine publishes can be an
  /// older version of what is on screen; once it has, the published page is the truth, and a page that differs from
  /// the screen's was changed from outside. That a state the engine publishes inside a call reaches the model before
  /// the call's answer does is how the main executor delivers them (first in, first out: the stream's element is
  /// enqueued before the call's return), not a promise of any API; `answeredWrites` makes the screen look again once
  /// the answer is in, should an update pass fall between the two.
  func isWriting(_ pageId: String) -> Bool {
    callInFlight?.isFor(pageId) == true || queuedCalls.contains { $0.call.isFor(pageId) } || unstored.contains(pageId)
  }

  /// A day screen edits the page: its draft, when behind, is the screen's to merge.
  func opened(_ pageId: String) {
    openPages[pageId, default: 0] += 1
  }

  func closed(_ pageId: String) {
    guard let count = openPages[pageId] else { return }
    openPages[pageId] = count > 1 ? count - 1 : nil
  }

  private func enqueue(_ call: WritingCall) -> AsyncStream<Bool> {
    let (answer, continuation) = AsyncStream.makeStream(of: Bool.self)
    queuedCalls.append(QueuedCall(call: call, answers: [continuation]))
    sendCalls()
    return answer
  }

  /// False when the call was dropped.
  private static func answer(_ stream: AsyncStream<Bool>) async -> Bool {
    for await answer in stream { return answer }
    return false
  }

  private func sendCalls() {
    guard sendingCalls == nil else { return }
    sendingCalls = Task { [weak self] in
      while let call = self?.nextCall() {
        let answer = await self?.perform(call.call) ?? false
        self?.answered(call, answer)
      }
    }
  }

  private func nextCall() -> QueuedCall? {
    guard !queuedCalls.isEmpty else {
      sendingCalls = nil
      return nil
    }
    let call = queuedCalls.removeFirst()
    callInFlight = call.call
    return call
  }

  private func answered(_ call: QueuedCall, _ answer: Bool) {
    callInFlight = nil
    if let pageId = call.call.pageId, !isWriting(pageId) { answeredWrites += 1 }
    for continuation in call.answers {
      continuation.yield(answer)
      continuation.finish()
    }
  }

  /// The calls not yet handed over go unanswered: they were made under the account that is gone. The one being
  /// answered is the engine's to settle; it refuses a call once the account changed.
  private func dropQueuedCalls() {
    let dropped = queuedCalls
    guard !dropped.isEmpty else { return }
    queuedCalls = []
    for call in dropped { for continuation in call.answers { continuation.finish() } }
    // The pages they were for may have nothing waiting now.
    answeredWrites += 1
  }

  private func perform(_ call: WritingCall) async -> Bool {
    let engine = engine
    switch call {
    case .keep(let pageId, let document, let singleDeleteIds, let startedFrom):
      do {
        try await engine.keepDraft(
          pageId: pageId, document: document, singleDeleteIds: singleDeleteIds, startedFrom: startedFrom)
        unstored.remove(pageId)
        return true
      } catch {
        // The screen keeps his words, and his next change hands them over again. The error's type only.
        unstored.insert(pageId)
        if error as? SyncError != .notReady {
          Self.writingLog.error(
            "A page's words were not stored: \(String(describing: type(of: error)), privacy: .public)")
        }
        return false
      }
    case .rebase(let pageId, let baseDocument, let document, let singleDeleteIds):
      do {
        let taken = try await engine.rebaseDraft(
          pageId: pageId, baseDocument: baseDocument, document: document, singleDeleteIds: singleDeleteIds)
        if taken { unstored.remove(pageId) }
        return taken
      } catch {
        if error as? SyncError != .notReady {
          Self.writingLog.error(
            "A merged page was not stored: \(String(describing: type(of: error)), privacy: .public)")
        }
        return false
      }
    case .discard(let pageId):
      await engine.discardDraft(pageId: pageId)
      unstored.remove(pageId)
      return true
    case .flush:
      return true
    }
  }

  /// A draft of a page no screen edits that is behind the server's page is merged from the stored draft and handed
  /// back as the draft: once per behind state (the copy's revision), never in a loop. Not while calls for the page
  /// wait: what they hold is newer than the stored draft, and the state they publish brings the merge back.
  private func mergeDraftsNotOpen() {
    let behind = state.drafts.filter { $0.state == .behind }.map(\.id)
    mergedAt = mergedAt.filter { behind.contains($0.key) }
    guard let revision = state.workspace?.revision else { return }
    for pageId in behind where openPages[pageId] == nil && mergedAt[pageId] != revision && !isWriting(pageId) {
      mergedAt[pageId] = revision
      let engine = engine
      Task { [weak self] in
        guard let pair = await engine.merging(pageId), let draft = await engine.draft(of: pageId), let self else {
          return
        }
        guard self.openPages[pageId] == nil, !self.isWriting(pageId) else {
          self.mergedAt[pageId] = nil
          return
        }
        let merged = DraftMerging.merged(draft: draft, mine: draft.document, theirs: pair.theirs)
        // The stored draft's rows, but for any the merged page holds again.
        _ = self.enqueue(
          .rebase(
            pageId: pageId, baseDocument: pair.theirs, document: merged.document,
            singleDeleteIds: DraftMerging.rowsStillRemoved(draft.singleDeleteIds, from: merged.document)))
      }
    }
  }
}
