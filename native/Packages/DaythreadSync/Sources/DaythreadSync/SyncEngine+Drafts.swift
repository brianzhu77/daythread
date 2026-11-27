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
/// - **When.** 450 ms after his last change to the page, through the injected `sleep`; at once on `saveNow` and
///   `rebaseDraft`; and in any pass, after the outbox entries, for a draft with no wait running (a relaunch, a retry,
///   the network back).
/// - **Behind the server's page.** A draft with no save on its way whose page in the copy has another content key
///   than the draft's `base` is behind: the server's page changed since the draft started from it. It is never sent
///   so; the screen merges it (`PageMerge`, with the draft's `baseDocument`, its `document` and the copy's page) and
///   hands the result back with `rebaseDraft`. A draft with a save on its way is never behind: that save goes again
///   as recorded until it is answered, whatever a load brought.
/// - **Stuck.** A draft whose page is gone from the copy or is in Trash, or whose document the server refused, is
///   kept and not sent until he acts. Behind, gone and in Trash are read from the store's copy and drafts, so they
///   hold after a relaunch; a refused document is remembered for the launch only.
extension SyncEngine {
  /// The wait after his last change before the page is saved, as on the web.
  static let draftWait: Duration = .milliseconds(450)

  /// Why a draft is held, in his words.
  static let pageInTrash = "This page is in Trash"
  static let pageGone = "This page is gone"

  /// Stores the draft at once and publishes a state that draws it; the save goes 450 ms after the last call.
  /// `startedFrom` is the page the screen typed onto. The first call for a page records it as the draft's base, never
  /// the copy's page now: a load may have changed that page between his keystroke and this call, and his document
  /// would then replace another device's lines. When the copy's page is not `startedFrom`, the draft is behind and
  /// waits for the screen's merge. Once a draft exists, its base stands and `startedFrom` is only kept among the
  /// draft's origins (see `firstBase`). A draft the server refused is sent again with these words.
  ///
  /// One exception for the first call: a `startedFrom` with the content key of the page that the page's last landed
  /// save was made on, when that save removed its draft. The keystroke was made before the answer reached the screen,
  /// and his words derive from what the screen last sent, so the draft starts from what that save sent. Saved
  /// unchanged, that is the copy's page and the draft is free; changed by the server, the draft is behind what was
  /// sent, and the screen's merge is a real three-way one.
  ///
  /// A document equal to the draft's base removes the draft and sends nothing, unless a save is on its way: then the
  /// draft stays until its answer. Throws `SyncError.notReady` when no workspace is shown, the copy shown is not
  /// `expectedOwner`'s (the account whose state the screen typed under), the copy has no such page, or a sign-out has
  /// begun, and what the store threw when it refuses the draft; either way nothing was kept.
  public func keepDraft(
    pageId: String, document: String, singleDeleteIds: [String], startedFrom: String, expectedOwner: String
  ) async throws {
    await acquire()
    defer { release() }
    guard isShown(expectedOwner), phase != .signedOut, !leaving, let copy, let page = copy.workspace.page(pageId)
    else {
      throw SyncError.notReady
    }
    let kept = accountDraft(page.id)
    let baseDocument = kept?.baseDocument ?? firstBase(of: page.id, owner: copy.owner, startedFrom: startedFrom)
    if kept?.sent == nil, document.utf8.elementsEqual(baseDocument.utf8) {
      stopDraftWait(page.id)
      guard kept != nil else { return }
      try await store.removeDraft(pageId: page.id, owner: copy.owner)
      forgetDraft(pageId: page.id, owner: copy.owner)
      refusedDrafts[page.id] = nil
      publishDrafts()
      return
    }
    try await keep(
      PageDraft(
        pageId: page.id, owner: copy.owner, base: kept?.base ?? ContentKey.of(baseDocument),
        baseDocument: baseDocument, document: document, singleDeleteIds: singleDeleteIds, sent: kept?.sent,
        changedAt: now()))
    recordOrigin(startedFrom, of: page.id, owner: copy.owner)
    refusedDrafts[page.id] = nil
    publishDrafts()
    waitThenSave(page.id)
  }

  /// Adds the page the screen typed onto to the draft's origins, on every keep: the screen can open a page whose draft
  /// this engine did not create (after a relaunch, after he left the day and came back, after a merge it refused) and
  /// type onto the draft as drawn. The text is compared first, so a keystroke on the same page costs no hash. Runs
  /// inside a store section.
  private func recordOrigin(_ startedFrom: String, of pageId: String, owner: String) {
    var origin = draftOrigins[pageId].flatMap { $0.owner == owner ? $0 : nil } ?? DraftOrigin(owner: owner, keys: [])
    if let last = origin.lastText, last.utf8.elementsEqual(startedFrom.utf8) { return }
    origin.keys.append(ContentKey.of(startedFrom))
    origin.lastText = startedFrom
    draftOrigins[pageId] = origin
  }

  /// Where a page's first draft starts: `startedFrom`, or what the page's last landed save sent when `startedFrom` is
  /// the page that save was made on, or a page the screen typed that save's draft onto (see `keepDraft`): the screen
  /// moves its `startedFrom` on only while the page has no draft, so a draft that lived through several saves still
  /// carries the page it was created on. A `startedFrom` that is the page as the save left it was typed after the
  /// answer reached the screen: nothing to translate, even when it is also one of those pages (a server that wrote
  /// the page back to an earlier version). Runs inside a store section.
  private func firstBase(of pageId: String, owner: String, startedFrom: String) -> String {
    guard let landed = landedSaves[pageId], landed.owner == owner else { return startedFrom }
    if ContentKey.storedDocument(startedFrom).utf8.elementsEqual(landed.pageAfter.utf8) { return startedFrom }
    guard
      Self.document(startedFrom, hasKey: landed.base, keyOf: landed.baseDocument)
        || landed.origins.contains(ContentKey.of(startedFrom))
    else { return startedFrom }
    return landed.sentDocument
  }

  /// Forgets each landed save whose page the copy no longer has as that save left it (a load or another change
  /// brought other words): a keystroke typed on the page now is typed on what the copy shows, not on what was sent
  /// long ago. Runs inside a store section, after every change of the copy.
  func forgetOverwrittenSaves() {
    guard !landedSaves.isEmpty else { return }
    landedSaves = landedSaves.filter { pageId, landed in
      copy?.workspace.page(pageId).map { ContentKey.storedDocument($0.document).utf8.elementsEqual(landed.pageAfter.utf8) }
        ?? false
    }
  }

  /// After the screen merged: the draft now starts from `baseDocument` (the server's page it was merged with),
  /// holds `document`, names the rows of `singleDeleteIds` that `document` does not hold, and is saved at once. The
  /// server settles a row he removed as removed one at a time only when the save that removes it names it, so the
  /// rows he removed before the merge are named still; a row the merge kept never is. Refused when the copy's page is
  /// no longer that one.
  ///
  /// Answers false, changing nothing, when the page has no draft (it was saved or discarded while the screen
  /// merged: what it merged must not bring back words just thrown away), when the copy's page is not `baseDocument`
  /// in its stored form (the page moved again while the screen merged), or when a save of the draft is on its way. A
  /// `document` equal to `baseDocument` removes the draft. Answers false too when no copy is shown or the copy shown is
  /// not `expectedOwner`'s: the merge was made of another account's words. Otherwise throws as `keepDraft` does.
  @discardableResult
  public func rebaseDraft(
    pageId: String, baseDocument: String, document: String, singleDeleteIds: [String], expectedOwner: String
  ) async throws -> Bool {
    await acquire()
    defer { release() }
    guard isShown(expectedOwner) else { return false }
    guard copyShown, phase != .signedOut, !leaving, let copy, let page = copy.workspace.page(pageId) else {
      throw SyncError.notReady
    }
    guard let kept = accountDraft(page.id), kept.sent == nil,
      ContentKey.storedDocument(page.document).utf8.elementsEqual(ContentKey.storedDocument(baseDocument).utf8)
    else { return false }
    if document.utf8.elementsEqual(baseDocument.utf8) {
      try await store.removeDraft(pageId: page.id, owner: copy.owner)
      forgetDraft(pageId: page.id, owner: copy.owner)
    } else {
      var named = EditablePage(document: document, pageDate: nil)
      named.carryRemovedRows(singleDeleteIds)
      try await keep(
        PageDraft(
          pageId: page.id, owner: copy.owner, base: ContentKey.of(baseDocument), baseDocument: baseDocument,
          document: document, singleDeleteIds: named.singleDeleteIds, sent: nil, changedAt: now()))
      // The screen goes on typing onto the merged page.
      var origin = draftOrigins[page.id].flatMap { $0.owner == copy.owner ? $0 : nil }
        ?? DraftOrigin(owner: copy.owner, keys: [])
      origin.keys.append(ContentKey.of(document))
      origin.lastText = document
      draftOrigins[page.id] = origin
    }
    stopDraftWait(page.id)
    refusedDrafts[page.id] = nil
    publishDrafts()
    askForPass(load: false)
    return true
  }

  /// Removes the account's draft of the page: the page is drawn as the server has it. A save already on its way is
  /// still answered into the copy. The pending ticks on a to-do that only this draft had go with it: sent, they
  /// would only be held as gone. Not those on a to-do its recorded save makes (that save may land, or have landed,
  /// and the tick goes after its answer or is held as gone where he sees it), nor on one another page's draft makes.
  /// Does nothing when no copy is shown or the copy shown is not `expectedOwner`'s.
  public func discardDraft(pageId: String, expectedOwner: String) async {
    await acquire()
    defer { release() }
    guard isShown(expectedOwner), phase != .signedOut, !leaving, let copy else { return }
    // A keystroke made before he discarded is not typed onto what an earlier save sent.
    landedSaves[pageId] = nil
    guard let kept = accountDraft(pageId) else { return }
    let stillMade = Set(
      (Self.todosMade(by: kept)
        + accountDrafts.filter { !$0.pageId.utf8.elementsEqual(kept.pageId.utf8) }
        .flatMap { Self.todoIds(in: Document.blocks($0.document)) }).map { Array($0.utf8) })
    let onlyHere = Set(
      Self.todoIds(in: Document.blocks(kept.document)).filter { copy.workspace.task($0) == nil }.map { Array($0.utf8) }
    ).subtracting(stillMade)
    do {
      try await store.removeDraft(pageId: kept.pageId, owner: copy.owner)
      for entry in outbox where entry.state == .pending {
        guard let taskId = Command.taskId(of: entry.action), onlyHere.contains(Array(taskId.utf8)) else { continue }
        try await store.remove(seq: entry.seq)
      }
    } catch {
      SyncLog.logger.error("A draft could not be discarded: \(SyncLog.describe(error), privacy: .public)")
      await readOutbox()
      await readDrafts()
      publishDrafts()
      return
    }
    await readOutbox()
    forgetDraft(pageId: kept.pageId, owner: copy.owner)
    stopDraftWait(kept.pageId)
    refusedDrafts[kept.pageId] = nil
    publishDrafts()
  }

  /// Publishes what a call about a page's words did, numbered (`SyncState.draftsWritten`). Runs inside a store section.
  private func publishDrafts() {
    draftsWritten += 1
    publish()
  }

  /// The signed-in account's draft of the page, while its copy is shown; nil when it has none.
  public func draft(of pageId: String) async -> PageDraft? {
    accountDraft(pageId)
  }

  /// The pair the screen merges with, read in one turn: the document the draft started from and the server's
  /// page now. Nil unless the signed-in account's draft for the page is behind.
  public func merging(_ pageId: String) async -> (baseDocument: String, theirs: String)? {
    // Nothing here awaits, so both halves are from one moment of the actor.
    guard let draft = accountDraft(pageId), standing(of: draft) == .behind,
      let page = copy?.workspace.page(draft.pageId)
    else { return nil }
    return (draft.baseDocument, page.document)
  }

  /// Sends what is waiting now (leaving the day, leaving the foreground): the waits after his changes are cut short.
  /// Returns when that pass has ended.
  public func saveNow() async {
    await acquire()
    let ready = copyShown && phase != .signedOut && !leaving
    if ready { cutDraftWaitsShort() }
    release()
    guard ready else { return }
    await requestPass(load: false)
  }

  /// Ends every wait after a change, so the next pass sends what they held. Runs inside a store section.
  func cutDraftWaitsShort() {
    for wait in draftWaits.values { wait.task.cancel() }
    draftWaits = [:]
  }

  // MARK: What is drawn and said

  /// The owner of the copy, while it is shown.
  var shownOwner: String? { copyShown ? copy?.owner : nil }

  /// Whether the copy shown is `owner`'s: a call made under another account's state, or under none, is not made on it.
  /// Read inside the store section the call acts in, so the copy cannot change owner between the check and the act.
  private func isShown(_ owner: String) -> Bool {
    shownOwner.map { $0.utf8.elementsEqual(owner.utf8) } ?? false
  }

  /// The drafts of the copy's owner, while the copy is shown: the only ones drawn or sent.
  var accountDrafts: [PageDraft] {
    guard let owner = shownOwner else { return [] }
    return drafts.filter { $0.owner == owner }
  }

  private func accountDraft(_ pageId: String) -> PageDraft? {
    // Ids compare by code units, as they do in the domain.
    accountDrafts.first { $0.pageId.utf8.elementsEqual(pageId.utf8) }
  }

  /// Whether a draft may be sent, as far as the copy and the server's refusals say.
  enum Standing: Equatable {
    case free
    /// The copy's page changed since the draft started from it: the screen merges before it is sent.
    case behind
    /// Kept, and not sent until he acts; why, in his words or the server's.
    case stuck(String)
  }

  func standing(of draft: PageDraft) -> Standing {
    guard let page = copy?.workspace.page(draft.pageId) else { return .stuck(Self.pageGone) }
    // A page in Trash is out of his sight: the server would take the save, into a page he cannot see.
    if page.trashedAt != nil { return .stuck(Self.pageInTrash) }
    if let reason = refusedDrafts[draft.pageId] { return .stuck(reason) }
    if draft.sent == nil, !Self.document(page.document, hasKey: draft.base, keyOf: draft.baseDocument) {
      return .behind
    }
    return .free
  }

  /// Whether `document` has the content key `key`, which is `keyed`'s; the same text needs no hash.
  private static func document(_ document: String, hasKey key: String, keyOf keyed: String) -> Bool {
    document.utf8.elementsEqual(keyed.utf8) || ContentKey.of(document) == key
  }

  /// `workspace` with each of the account's drafts drawn on it.
  func drawingDrafts(over workspace: Workspace) -> Workspace {
    accountDrafts.reduce(workspace) { $0.drawing(draft: $1.document, of: $1.pageId) }
  }

  /// The pending ticks of `entries` that wait for a draft's save: on a to-do that exists only in a draft, which that
  /// draft's save makes on the server; and on a to-do that a save on its way made, until it is answered, even when a
  /// load has meanwhile brought the to-do into the copy. Sent before that answer, the tick would carry none of the
  /// save's revision as its own, and the server would hold it for a change that is his.
  func waitingForDrafts(_ entries: [OutboxEntry]) -> Set<Int> {
    guard let copy, !accountDrafts.isEmpty else { return [] }
    let typed = drawingDrafts(over: copy.workspace)
    let madeBySaves = Set(accountDrafts.flatMap { Self.todosMade(by: $0) }.map { Array($0.utf8) })
    return Set(
      entries.filter { entry in
        guard entry.state == .pending, let taskId = Command.taskId(of: entry.action) else { return false }
        return (copy.workspace.task(taskId) == nil && typed.task(taskId) != nil)
          || madeBySaves.contains(Array(taskId.utf8))
      }.map(\.seq))
  }

  /// The to-dos the save on its way of `draft` makes: those of its rows that the page it started from did not have.
  private static func todosMade(by draft: PageDraft) -> [String] {
    guard let sent = draft.sent else { return [] }
    let before = Set(todoIds(in: Document.blocks(draft.baseDocument)).map { Array($0.utf8) })
    return todoIds(in: Document.blocks(sent.document)).filter { !before.contains(Array($0.utf8)) }
  }

  /// The `taskId` of every to-do row, nested ones included.
  private static func todoIds(in blocks: [Block]) -> [String] {
    blocks.flatMap { block -> [String] in
      let own = block.type == "task" ? block.props["taskId"]?.stringValue.map { [$0] } ?? [] : []
      return own + todoIds(in: block.children)
    }
  }

  /// Whether a pass sends `draft` now: a save on its way is sent again as it was; newer words go once the wait
  /// after his last change has ended. Never a draft behind the server's page or stuck.
  func isDue(_ draft: PageDraft) -> Bool {
    guard standing(of: draft) == .free, !savesInFlight.contains(draft.pageId) else { return false }
    return draft.sent != nil || draftWaits[draft.pageId] == nil
  }

  func draftStatuses(retrying: Bool) -> [DraftStatus] {
    accountDrafts.map { draft in
      let state: DraftStatus.State =
        if savesInFlight.contains(draft.pageId) {
          .sending
        } else {
          switch standing(of: draft) {
          case .stuck(let reason): .stuck(reason)
          case .behind: .behind
          case .free: offline ? .offline : retrying ? .retrying : .waiting
          }
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
    if draftOrigins[pageId]?.owner == owner { draftOrigins[pageId] = nil }
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
    cutDraftWaitsShort()
    savesInFlight = []
    refusedDrafts = [:]
    landedSaves = [:]
    draftOrigins = [:]
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
    /// "Saved elsewhere": the workspace moved on since the copy was loaded. The save is kept as sent.
    case savedElsewhere
    /// "Page changed elsewhere": the page moved on since the draft started from it.
    case pageChanged
    /// "This change was already applied": the save went in long ago and its receipt has expired.
    case appliedLongAgo
  }

  /// What the saves of a pass came to.
  struct SavesDone {
    /// A save landed, so the ticks waiting for one may go.
    var landed = false
    /// A save the server turned away for now is left for the retry schedule.
    var leftForRetry = false
  }

  /// Saves the account's due drafts one at a time, oldest change first, until none is due.
  ///
  /// When the server says the workspace or the page moved on, the workspace is loaded once in the pass, never
  /// more: after "Saved elsewhere" with the page as it was, the same save goes once more on the new revision (a
  /// refused operation left no receipt, so its id is free); with the page changed, the draft is behind. A second
  /// such answer in the pass, or "Page changed elsewhere" over a page that has the draft's key after all, leaves
  /// the save for the retry schedule. An expired receipt ("This change was already applied") says that exact save
  /// landed long ago: after the same one load, the draft is settled as for an answer. `loaded`: the pass already
  /// loaded after the server held an outbox entry, so the copy is as new as this pass will make it.
  func saveDrafts(_ pass: Pass, loaded: Bool) async throws -> SavesDone {
    var done = SavesDone()
    var loaded = loaded
    var later: Set<String> = []
    var sentAgain: Set<String> = []
    while let save = try await nextSave(pass, leaving: later) {
      let outcome: SaveOutcome
      do {
        outcome = try await transport.save(
          token: pass.session?.token, operationId: save.operationId, expectedRevision: save.expectedRevision,
          expectedOwner: save.owner, action: save.action)
      } catch TransportError.refused(let status, let reason) {
        // The server will never take this body: trying it again would only be refused again. Worded as a
        // command's refusal is.
        try await hold(save, because: status == 400 ? "bad-request" : reason ?? "refused", status: status, pass)
        continue
      } catch {
        // Kept as sent; the pass's failure plans the next try.
        savesInFlight.remove(save.pageId)
        throw error
      }
      switch try await settle(outcome, of: save, pass) {
      case .next:
        if case .applied = outcome { done.landed = true }
      case .loadWholeThenSettle(let revision):
        try await loadWorkspace(pass, have: nil)
        loaded = true
        try await enter(pass)
        defer { release() }
        // After a load under another owner the draft is not this copy's to settle.
        guard copy?.owner == save.owner else { return done }
        try await learn(revision)
        try await settleDraft(save)
        await readOutbox()
        publish()
        done.landed = true
      case .loadWholeAndStop:
        try await loadWorkspace(pass, have: nil)
        return done
      case .savedElsewhere:
        guard !loaded, !sentAgain.contains(save.pageId) else {
          later.insert(save.pageId)
          done.leftForRetry = true
          continue
        }
        try await loadWorkspace(pass, have: copy?.workspace.revision)
        loaded = true
        try await enter(pass)
        defer { release() }
        guard copy?.owner == save.owner else { return done }
        if pageHasBase(of: save) {
          // Still due, as sent: the next turn of the loop takes it out again on the copy's new revision.
          sentAgain.insert(save.pageId)
        } else {
          try await clearSent(save)
        }
        publish()
      case .pageChanged:
        if !loaded {
          try await loadWorkspace(pass, have: copy?.workspace.revision)
          loaded = true
        }
        try await enter(pass)
        defer { release() }
        guard copy?.owner == save.owner else { return done }
        try await clearSent(save)
        if pageHasBase(of: save) {
          // The load shows the page it was built on after all: not behind, so tried again later, not in this pass.
          later.insert(save.pageId)
          done.leftForRetry = true
        }
        publish()
      case .appliedLongAgo:
        if !loaded {
          try await loadWorkspace(pass, have: copy?.workspace.revision)
          loaded = true
        }
        try await enter(pass)
        defer { release() }
        guard copy?.owner == save.owner else { return done }
        // The exact action landed: settled as an answer is, against the page the load brought.
        try await settleDraft(save, removingOnlyOntoWhatWasSent: true)
        await readOutbox()
        publish()
        done.landed = true
      }
    }
    return done
  }

  /// The first due draft not left for later, marked as sending. A save already on its way goes again as its action
  /// was first written; otherwise the action is made now and recorded with a new operation id before anything
  /// leaves.
  private func nextSave(_ pass: Pass, leaving later: Set<String>) async throws -> DraftSave? {
    try await enter(pass)
    defer { release() }
    while let copy, var draft = accountDrafts.first(where: { isDue($0) && !later.contains($0.pageId) }) {
      let sent: PageDraft.Sent
      let action: JSONValue
      if let recorded = draft.sent {
        guard let parsed = try? JSON.parse(recorded.action) else {
          // Not the same request any more, so not sent as one: read as never sent, as the store reads a damaged
          // record. That cannot apply anything twice: the next save carries the old `expectedContent`, refused if
          // the first landed.
          SyncLog.logger.error("A recorded save could not be read; read as not sent")
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
        try await clearSent(save)
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
      forgetOverwrittenSaves()
      // Not `changes.revision`: a replay's changes end at the workspace as it is now, others' writes included.
      try await learn(Self.revision(of: receipt))
      try await settleDraft(save)
    case .refused(let message):
      // The message is the server's words about his page; the log says only which refusal it was.
      if message.hasPrefix(Self.savedElsewhere) {
        SyncLog.logger.notice("Save of a page: saved elsewhere, loading")
        publish()
        return .savedElsewhere
      }
      // An expired receipt says the save went in long ago, not that the document is wrong.
      if message.hasPrefix(Self.alreadyApplied) {
        SyncLog.logger.notice("Save of a page: already applied, loading")
        publish()
        return .appliedLongAgo
      }
      if message.hasPrefix(Self.pageChangedElsewhere) {
        SyncLog.logger.notice("Save of a page: page changed elsewhere, loading")
        publish()
        return .pageChanged
      }
      SyncLog.logger.notice("Save of a page: refused, kept")
      if recordsAsSent(save) { refusedDrafts[save.pageId] = message }
      try await clearSent(save)
    case .ownerMismatch:
      SyncLog.logger.notice("Save of a page: owner-mismatch, kept")
      try await clearSent(save)
      publish()
      return .loadWholeAndStop
    }
    await readOutbox()
    publish()
    return .next
  }

  /// The beginnings of the server's messages (`workspace.ts`) that say the copy is behind, not that the document is
  /// wrong.
  private static let savedElsewhere = "Saved elsewhere"
  private static let pageChangedElsewhere = "Page changed elsewhere"
  private static let alreadyApplied = "This change was already applied"

  /// Whether the copy's page still has the content key the save's draft started from. Runs inside a store section.
  private func pageHasBase(of save: DraftSave) -> Bool {
    guard let draft = recordedDraft(of: save), let page = copy?.workspace.page(save.pageId) else { return false }
    return Self.document(page.document, hasKey: draft.base, keyOf: draft.baseDocument)
  }

  /// The draft after its save's answer is in the copy: removed when he typed nothing since; otherwise it starts from
  /// the server's page when that page is what was sent, and goes as the next save. When the server changed what it
  /// was sent, the draft starts from what was sent, which leaves it behind the server's page for the screen to
  /// merge. `removingOnlyOntoWhatWasSent`: the answer says only that the save went in, not that the page is what it
  /// left (an expired receipt), so a draft with nothing typed since is removed only over a page that is what was
  /// sent. Runs inside a store section.
  private func settleDraft(_ save: DraftSave, removingOnlyOntoWhatWasSent: Bool = false) async throws {
    guard var draft = recordedDraft(of: save), let sent = draft.sent, sent.operationId == save.operationId
    else { return }
    let page = copy?.workspace.page(draft.pageId)?.document
    let pageIsSent =
      page.map { ContentKey.storedDocument($0).utf8.elementsEqual(ContentKey.storedDocument(sent.document).utf8) }
      ?? false
    if draft.document.utf8.elementsEqual(sent.document.utf8), !removingOnlyOntoWhatWasSent || pageIsSent {
      let origins = draftOrigins[draft.pageId].flatMap { $0.owner == draft.owner ? $0.keys : nil } ?? []
      try await store.removeDraft(pageId: draft.pageId, owner: draft.owner)
      forgetDraft(pageId: draft.pageId, owner: draft.owner)
      landedSaves[draft.pageId] = copy?.workspace.page(draft.pageId).map { page in
        LandedSave(
          owner: draft.owner, base: draft.base, baseDocument: draft.baseDocument, origins: origins,
          sentDocument: sent.document, pageAfter: ContentKey.storedDocument(page.document))
      }
    } else {
      // His newer words go on from this draft: no keystroke starts from an older landed save's page any more.
      landedSaves[draft.pageId] = nil
      if let page, pageIsSent {
        draft.baseDocument = page
      } else {
        draft.baseDocument = sent.document
      }
      draft.base = ContentKey.of(draft.baseDocument)
      draft.sent = nil
      try await keep(draft)
    }
  }

  private func recordedDraft(of save: DraftSave) -> PageDraft? {
    drafts.first { $0.owner == save.owner && $0.pageId.utf8.elementsEqual(save.pageId.utf8) }
  }

  /// Whether the page's draft still has `save` as the one on its way. A refusal belongs to the save refused: once
  /// that draft was discarded, a new draft of the page never sent those words. Runs inside a store section.
  private func recordsAsSent(_ save: DraftSave) -> Bool {
    recordedDraft(of: save)?.sent?.operationId == save.operationId
  }

  /// Holds the draft for him after the server refused the request itself: kept, and not sent until he acts.
  private func hold(_ save: DraftSave, because reason: String, status: Int, _ pass: Pass) async throws {
    try await enter(pass)
    defer { release() }
    savesInFlight.remove(save.pageId)
    offline = false
    failure = nil
    SyncLog.logger.notice("Save of a page: refused with \(status, privacy: .public), kept")
    if recordsAsSent(save) { refusedDrafts[save.pageId] = reason }
    try await clearSent(save)
    publish()
  }

  /// Forgets what was sent: the server refused it, so it left no receipt and the next save is made anew. Runs
  /// inside a store section.
  private func clearSent(_ save: DraftSave) async throws {
    guard var draft = recordedDraft(of: save), draft.sent?.operationId == save.operationId
    else { return }
    draft.sent = nil
    try await keep(draft)
  }

  /// The revision a save made, as its receipt says; nil when it does not say.
  private static func revision(of receipt: JSONValue) -> Int? {
    receipt.objectValue?["revision"]?.intValue
  }

  /// The save that made `revision` is his own change. The server applies a save only on the revision it holds and
  /// names the next one in the receipt, so the save was made on `revision - 1`, whatever revision a resend carried.
  /// A pending entry learns it only when every revision after its base up to that one is already its own (the
  /// server's rule for `ownRevisions`): then nothing another device wrote lies between the entry and the save. An
  /// entry built further back keeps seeing what came between. Runs inside a store section.
  private func learn(_ revision: Int?) async throws {
    guard let revision, let owner = copy?.owner else { return }
    let savedOn = revision - 1
    for var entry in try await store.entries()
    where entry.owner == owner && entry.state == .pending && entry.baseRevision < revision
      && !entry.ownRevisions.contains(revision)
    {
      // As `outbox-replay.ts` checks it: a gap longer than its own revisions cannot be covered by them.
      let gap = max(0, savedOn - entry.baseRevision)
      guard gap <= entry.ownRevisions.count else { continue }
      let own = Set(entry.ownRevisions)
      guard gap == 0 || (entry.baseRevision + 1...savedOn).allSatisfy(own.contains) else { continue }
      entry.ownRevisions.append(revision)
      try await store.update(entry)
    }
  }
}

/// A save that landed and removed its draft: the page it was made on, the pages the screen typed its draft onto,
/// what it sent, and the page as the save left it in the copy.
struct LandedSave: Sendable {
  let owner: String
  /// The content key of `baseDocument`.
  let base: String
  let baseDocument: String
  /// Content keys (`DraftOrigin`).
  let origins: [String]
  let sentDocument: String
  /// In its stored form (`ContentKey.storedDocument`).
  let pageAfter: String
}

/// The content keys of the pages the screen typed a draft's words onto, and whose draft it is.
struct DraftOrigin: Sendable {
  let owner: String
  var keys: [String]
  /// The page last added, as text, so the same page given again is told without a hash.
  var lastText: String?
}

/// The wait in progress after his last change to a page; `number` tells a wait that ended after it was replaced.
struct DraftWait: Sendable {
  let number: Int
  let task: Task<Void, Never>
}
