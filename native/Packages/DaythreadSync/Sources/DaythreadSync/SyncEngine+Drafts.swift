import DaythreadCore
import Foundation

/// Drafts: a page's words kept the moment they are given, drawn over the copy, and saved on their own.
///
/// - **Stored first.** `keepDraft` writes the draft before it returns and publishes a state that draws it; nothing
///   about it waits for the network.
/// - **One save per page on its way.** What is sent is recorded in the draft (`sent`) in the store section that
///   takes it out, before the request leaves. Until it is answered, every try sends that document under that
///   operation id, however much he typed since, so a save that landed with its answer lost is recognised by the
///   server rather than applied twice. His newer words wait for the answer.
/// - **When.** 450 ms after his last change to the page, through the injected `sleep`; at once on `saveNow`; and in
///   any pass, after the outbox entries, for a draft with no wait running (a relaunch, a retry, the network back).
extension SyncEngine {
  /// The wait after his last change before the page is saved, as on the web.
  static let draftWait: Duration = .milliseconds(450)

  /// Stores the draft at once and publishes a state that draws it; the save goes 450 ms after the last call.
  /// The first call for a page records the page as the copy has it then as the draft's base.
  ///
  /// A document equal to that base removes the draft and sends nothing, unless a save is on its way: then the draft
  /// stays until its answer. Throws `SyncError.notReady` when no workspace is shown, the copy has no such page, or a
  /// sign-out has begun, and what the store threw when it refuses the draft; either way nothing was kept.
  public func keepDraft(pageId: String, document: String, singleDeleteIds: [String]) async throws {
    await acquire()
    defer { release() }
    guard copyShown, phase != .signedOut, !leaving, let copy, let page = copy.workspace.page(pageId) else {
      throw SyncError.notReady
    }
    let kept = accountDraft(page.id)
    let baseDocument = kept?.baseDocument ?? page.document
    setAside.remove(page.id)
    if kept?.sent == nil, document.utf8.elementsEqual(baseDocument.utf8) {
      stopDraftWait(page.id)
      guard kept != nil else { return }
      try await store.removeDraft(pageId: page.id, owner: copy.owner)
      forgetDraft(pageId: page.id, owner: copy.owner)
      publish()
      return
    }
    try await keep(
      PageDraft(
        pageId: page.id, owner: copy.owner, base: kept?.base ?? ContentKey.of(baseDocument),
        baseDocument: baseDocument, document: document, singleDeleteIds: singleDeleteIds, sent: kept?.sent,
        changedAt: now()))
    publish()
    waitThenSave(page.id)
  }

  /// Sends what is waiting now (leaving the day, leaving the foreground): the waits after his changes are cut short,
  /// and drafts set aside go again. Returns when that pass has ended.
  public func saveNow() async {
    await acquire()
    let ready = copyShown && phase != .signedOut && !leaving
    if ready {
      for wait in draftWaits.values { wait.task.cancel() }
      draftWaits = [:]
      setAside = []
    }
    release()
    guard ready else { return }
    await requestPass(load: false)
  }

  // MARK: What is drawn and said

  /// The drafts of the copy's owner, while the copy is shown: the only ones drawn or sent.
  var accountDrafts: [PageDraft] {
    guard copyShown, let owner = copy?.owner else { return [] }
    return drafts.filter { $0.owner == owner }
  }

  private func accountDraft(_ pageId: String) -> PageDraft? {
    // Ids compare by code units, as they do in the domain.
    accountDrafts.first { $0.pageId.utf8.elementsEqual(pageId.utf8) }
  }

  /// `workspace` with each of the account's drafts drawn on it.
  func drawingDrafts(over workspace: Workspace) -> Workspace {
    accountDrafts.reduce(workspace) { $0.drawing(draft: $1.document, of: $1.pageId) }
  }

  /// The pending ticks of `entries` for a to-do that exists only in a draft: they wait for that draft's save, which
  /// makes the to-do on the server.
  func waitingForDrafts(_ entries: [OutboxEntry]) -> Set<Int> {
    guard let copy, !accountDrafts.isEmpty else { return [] }
    let typed = drawingDrafts(over: copy.workspace)
    return Set(
      entries.filter { entry in
        guard entry.state == .pending, let taskId = Command.taskId(of: entry.action) else { return false }
        return copy.workspace.task(taskId) == nil && typed.task(taskId) != nil
      }.map(\.seq))
  }

  /// Whether a pass sends `draft` now: a save on its way is sent again as it was; newer words go once the wait
  /// after his last change has ended.
  func isDue(_ draft: PageDraft) -> Bool {
    guard !setAside.contains(draft.pageId), !savesInFlight.contains(draft.pageId) else { return false }
    return draft.sent != nil || draftWaits[draft.pageId] == nil
  }

  func draftStatuses(retrying: Bool) -> [DraftStatus] {
    accountDrafts.map { draft in
      let state: DraftStatus.State =
        if savesInFlight.contains(draft.pageId) {
          .sending
        } else if setAside.contains(draft.pageId) {
          .waiting
        } else if offline {
          .offline
        } else if retrying {
          .retrying
        } else {
          .waiting
        }
      return DraftStatus(id: draft.pageId, state: state)
    }
  }

  /// Reads the drafts the store holds, when the engine has no account's drafts in step yet (at launch, at sign-in).
  /// Runs inside a store section. Drafts that cannot be read keep what was last read.
  func readDrafts() async {
    guard let all = try? await store.drafts() else { return }
    drafts = all
  }

  /// Stores `draft` and holds what was written, not what a read after it would give: a read that fails must not
  /// leave memory without a `sent` the store has. Runs inside a store section.
  private func keep(_ draft: PageDraft) async throws {
    try await store.put(draft)
    drafts.removeAll { $0.owner == draft.owner && $0.pageId.utf8.elementsEqual(draft.pageId.utf8) }
    drafts.append(draft)
    drafts.sort(by: PageDraft.inStoreOrder)
  }

  private func forgetDraft(pageId: String, owner: String) {
    drafts.removeAll { $0.owner == owner && $0.pageId.utf8.elementsEqual(pageId.utf8) }
  }

  // MARK: The wait after a change

  private func waitThenSave(_ pageId: String) {
    stopDraftWait(pageId)
    draftWaitNumber += 1
    let number = draftWaitNumber
    let sleep = sleep
    let task = Task { [weak self] in
      // A wait cancelled before it began is never started: see `SyncEngine.sleep`.
      guard !Task.isCancelled else { return }
      do { try await sleep(Self.draftWait) } catch { return }
      guard !Task.isCancelled, let engine = self else { return }
      await engine.draftWaitEnded(pageId, number)
    }
    draftWaits[pageId] = DraftWait(number: number, task: task)
  }

  private func draftWaitEnded(_ pageId: String, _ number: Int) {
    guard draftWaits[pageId]?.number == number else { return }
    draftWaits[pageId] = nil
    askForPass(load: false)
  }

  private func stopDraftWait(_ pageId: String) {
    draftWaits.removeValue(forKey: pageId)?.task.cancel()
  }

  /// Drops every wait and mark of the account that was shown, when the account changes or a sign-out begins. The
  /// drafts themselves stay in the store.
  func forgetDraftWork() {
    for wait in draftWaits.values { wait.task.cancel() }
    draftWaits = [:]
    savesInFlight = []
    setAside = []
  }

  // MARK: Saving

  /// A save taken out for sending: the request, and what it was made under.
  private struct DraftSave: Sendable {
    let pageId: String
    let owner: String
    let operationId: String
    let document: String
    let expectedRevision: Int
    let action: JSONValue
  }

  private enum AfterSave {
    case next
    /// The changes start from another revision than the copy's: load whole, then settle the draft against it.
    /// `revision` is the one the save made, as its receipt says.
    case loadWholeThenSettle(revision: Int?)
    /// The answer is another account's: nothing more of this owner's is saved; the new owner's workspace is loaded.
    case loadWholeAndStop
  }

  /// Saves the account's due drafts one at a time, oldest change first, until none is due. Returns whether a save
  /// landed, so the ticks waiting for one go.
  func saveDrafts(_ pass: Pass) async throws -> Bool {
    var landed = false
    while let save = try await nextSave(pass) {
      let outcome: SaveOutcome
      do {
        outcome = try await transport.save(
          token: pass.session?.token, operationId: save.operationId, expectedRevision: save.expectedRevision,
          expectedOwner: save.owner, action: save.action)
      } catch TransportError.refused(let status, let reason) {
        // The server will never take this body: trying it again would only be refused again.
        try await putAside(save, because: "\(status) \(reason ?? "")", pass)
        continue
      } catch {
        // Kept as sent; the pass's failure plans the next try.
        savesInFlight.remove(save.pageId)
        throw error
      }
      switch try await settle(outcome, of: save, pass) {
      case .next:
        if case .applied = outcome { landed = true }
      case .loadWholeThenSettle(let revision):
        try await loadWorkspace(pass, have: nil)
        try await enter(pass)
        defer { release() }
        // After a load under another owner the draft is not this copy's to settle.
        guard copy?.owner == save.owner else { return landed }
        try await learn(revision, savedOn: save.expectedRevision)
        try await settleDraft(save)
        await readOutbox()
        publish()
        landed = true
      case .loadWholeAndStop:
        try await loadWorkspace(pass, have: nil)
        return landed
      }
    }
    return landed
  }

  /// The first due draft, marked as sending. A save already on its way goes again as its action was first written;
  /// otherwise the action is made now and recorded with a new operation id before anything leaves.
  private func nextSave(_ pass: Pass) async throws -> DraftSave? {
    try await enter(pass)
    defer { release() }
    while let copy, var draft = accountDrafts.first(where: isDue) {
      let sent: PageDraft.Sent
      let action: JSONValue
      if let recorded = draft.sent {
        guard let parsed = try? JSON.parse(recorded.action) else {
          // Not the same request any more, so not sent as one: kept for him, as a refusal is.
          SyncLog.logger.error("A recorded save could not be read; kept, not sent")
          setAside.insert(draft.pageId)
          draft.sent = nil
          try await keep(draft)
          continue
        }
        (sent, action) = (recorded, parsed)
      } else {
        let at = now()
        action = Command.saveEditor(
          pageId: draft.pageId, expectedContent: draft.base, document: draft.document,
          singleDeleteIds: draft.singleDeleteIds, today: LocalDate.today(in: copy.workspace.timezone, at: at), at: at)
        // The document and the action recorded are one value: what the answer is compared with is what was sent.
        sent = PageDraft.Sent(
          operationId: UUID().uuidString.lowercased(), document: draft.document, action: JSON.write(action))
        draft.sent = sent
        try await keep(draft)
      }
      savesInFlight.insert(draft.pageId)
      publish()
      return DraftSave(
        pageId: draft.pageId, owner: copy.owner, operationId: sent.operationId, document: sent.document,
        expectedRevision: copy.workspace.revision, action: action)
    }
    return nil
  }

  private func settle(_ outcome: SaveOutcome, of save: DraftSave, _ pass: Pass) async throws -> AfterSave {
    try await enter(pass)
    defer { release() }
    savesInFlight.remove(save.pageId)
    offline = false
    failure = nil
    guard let copy else {
      publish()
      return .loadWholeAndStop
    }
    switch outcome {
    case .applied(let receipt, let changes, let owner):
      // A reply under another owner than the copy's is never applied to it.
      guard owner == copy.owner else {
        try await putAside(save)
        publish()
        return .loadWholeAndStop
      }
      guard let updated = copy.workspace.applying(changes) else {
        publish()
        return .loadWholeThenSettle(revision: Self.revision(of: receipt))
      }
      SyncLog.logger.info("Save of a page: applied")
      // Two transactions: a death between them leaves the draft as sent, and its replay is answered with the
      // receipt the server kept.
      try await store.write(updated, changed: changes)
      self.copy = (updated, copy.owner)
      // Not `changes.revision`: a replay's changes end at the workspace as it is now, others' writes included.
      try await learn(Self.revision(of: receipt), savedOn: save.expectedRevision)
      try await settleDraft(save)
    case .refused:
      // The message is the server's words about his page; the log says only that it was refused.
      SyncLog.logger.notice("Save of a page: refused, kept")
      try await putAside(save)
    case .ownerMismatch:
      SyncLog.logger.notice("Save of a page: owner-mismatch, kept")
      try await putAside(save)
      publish()
      return .loadWholeAndStop
    }
    await readOutbox()
    publish()
    return .next
  }

  /// The draft after its save's answer is in the copy: removed when he typed nothing since; otherwise it starts from
  /// the server's page, and goes as the next save when that page is what was sent. When the server changed what it
  /// was sent, the draft starts from what was sent and is set aside for the screen to merge. Runs inside a store
  /// section.
  private func settleDraft(_ save: DraftSave) async throws {
    guard var draft = draft(of: save), let sent = draft.sent, sent.operationId == save.operationId
    else { return }
    if draft.document.utf8.elementsEqual(sent.document.utf8) {
      try await store.removeDraft(pageId: draft.pageId, owner: draft.owner)
      forgetDraft(pageId: draft.pageId, owner: draft.owner)
    } else {
      let page = copy?.workspace.page(draft.pageId)?.document
      if let page, ContentKey.storedDocument(page).utf8.elementsEqual(ContentKey.storedDocument(sent.document).utf8) {
        draft.baseDocument = page
      } else {
        draft.baseDocument = sent.document
        setAside.insert(draft.pageId)
      }
      draft.base = ContentKey.of(draft.baseDocument)
      draft.sent = nil
      try await keep(draft)
    }
  }

  private func draft(of save: DraftSave) -> PageDraft? {
    drafts.first { $0.owner == save.owner && $0.pageId.utf8.elementsEqual(save.pageId.utf8) }
  }

  /// Clears the draft's `sent` and leaves it waiting, not sent again until he types or `saveNow`.
  private func putAside(_ save: DraftSave, because reason: String, _ pass: Pass) async throws {
    try await enter(pass)
    defer { release() }
    savesInFlight.remove(save.pageId)
    offline = false
    failure = nil
    SyncLog.logger.notice("Save of a page: \(reason, privacy: .public), kept")
    try await putAside(save)
    publish()
  }

  /// Runs inside a store section.
  private func putAside(_ save: DraftSave) async throws {
    setAside.insert(save.pageId)
    guard var draft = draft(of: save), draft.sent?.operationId == save.operationId
    else { return }
    draft.sent = nil
    try await keep(draft)
  }

  /// The revision a save made, as its receipt says; nil when it does not say.
  private static func revision(of receipt: JSONValue) -> Int? {
    receipt.objectValue?["revision"]?.intValue
  }

  /// The save that made `revision` is his own change, sent on `savedOn`. A pending entry learns it only when every
  /// revision after its base up to `savedOn` is already its own (the server's rule for `ownRevisions`): then nothing
  /// another device wrote lies between the entry and the save, and the save is all that changed its rows. An entry
  /// built further back keeps seeing what came between. Runs inside a store section.
  private func learn(_ revision: Int?, savedOn: Int) async throws {
    guard let revision, let owner = copy?.owner else { return }
    for var entry in try await store.entries()
    where entry.owner == owner && entry.state == .pending && entry.baseRevision < revision
      && !entry.ownRevisions.contains(revision)
    {
      let between = entry.baseRevision < savedOn ? Array(entry.baseRevision + 1...savedOn) : []
      guard between.allSatisfy(entry.ownRevisions.contains) else { continue }
      entry.ownRevisions.append(revision)
      try await store.update(entry)
    }
  }
}

/// The wait in progress after his last change to a page; `number` tells a wait that ended after it was replaced.
struct DraftWait: Sendable {
  let number: Int
  let task: Task<Void, Never>
}
