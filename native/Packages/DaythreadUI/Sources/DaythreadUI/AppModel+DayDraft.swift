import DaythreadCore
import DaythreadSync
import Foundation

/// §13.3: the app's ask for the day's draft, the web's rules (`use-day-draft.ts`) with the app's today. The model owns
/// it, so "once for a page in a run" outlives a screen rebuilt; the screen says what it draws and whether the server's
/// Undo slot is held. The page never waits on it: the ask is outside the engine's passes, and `set-draft` is a command
/// of its own with no page to wait for.
extension AppModel {
  /// The day screen drew today's live `page` (it calls this for every state it draws there). Asks when the app is
  /// online and signed in, the page's draft does not stand, and this run has not asked for the page.
  public func todayDrawn(_ page: Page) {
    guard draftAsks[page.id] == nil, asksByItself(for: page) else { return }
    askForDraft(of: page)
  }

  /// He came back to today's page: the app came to the foreground with today shown, or today was shown again after
  /// another day. Asks again when the last ask for the page failed or was lost, while fewer than
  /// `DraftAsk.asksByItself` asks for it have failed, and its draft still does not stand.
  public func cameBackToToday(_ page: Page) {
    guard let ask = draftAsks[page.id], ask.failures < DraftAsk.asksByItself, failedOrLost(ask),
      asksByItself(for: page)
    else { return }
    askForDraft(of: page)
  }

  /// `Retry`: asks, unless an ask for the page is in flight.
  public func retryDraft(_ page: Page) {
    guard page.date != nil, !(draftAsks[page.id]?.inFlight(at: now()) ?? false) else { return }
    askForDraft(of: page)
  }

  /// This run's ask for the day page; nil before the first. Observable; a lost ask is published as such at 60 s.
  public func draftAsk(of pageId: String) -> DraftAsk? {
    draftAsks[pageId]
  }

  /// The account changed or nobody is signed in: the new account's pages, whose ids are the same, are asked for
  /// afresh, and no ask of the one before writes its outcome.
  func forgetDraftAsks() {
    latestDraftAsks = [:]
    if !draftAsks.isEmpty { draftAsks = [:] }
  }

  /// Every rule of an ask the model makes by itself but the count: online, signed in, the page today's live day page,
  /// and its draft not standing.
  private func asksByItself(for page: Page) -> Bool {
    guard asksForDayDrafts, state.phase == .ready, state.owner != nil, !state.offline, page.type == "daily",
      page.date == today, let workspace = state.workspace
    else { return false }
    return !Self.draftStands(for: page.id, in: workspace)
  }

  /// `TodoIndex.draftStands(for:)` for the one page, read without building an index for the whole workspace: this
  /// runs on every state today is drawn with while no ask was made (a draft that stands is never asked for).
  /// The draft is the first draft page of its id not in Trash, as `draftOf` takes it.
  private static func draftStands(for dayPageId: String, in workspace: Workspace) -> Bool {
    let id = "draft:\(dayPageId)"
    guard
      let page = workspace.pages.first(where: {
        $0.isDraft && ($0.trashedAt?.isEmpty ?? true) && $0.id.utf8.elementsEqual(id.utf8)
      }),
      let draft = DayDraft(document: page.document)
    else { return false }
    return !draft.stale
  }

  /// Failed, or asked `DraftAsk.lostAfter` ago with no answer (the app may have been away while the wait ran).
  private func failedOrLost(_ ask: DraftAsk) -> Bool {
    switch ask {
    case .failed: true
    case .asking: !ask.inFlight(at: now())
    case .done: false
    }
  }

  private func askForDraft(of page: Page) {
    guard let date = page.date else { return }
    let pageId = page.id
    let failures = draftAsks[pageId]?.failures ?? 0
    draftAsksMade += 1
    let number = draftAsksMade
    latestDraftAsks[pageId] = number
    draftAsks[pageId] = .asking(since: now(), failures: failures)
    let failed = DraftAsk.failed(failures: failures + 1)

    let sleep = draftSleep
    let lost = Task { [weak self] in
      do { try await sleep(.seconds(DraftAsk.lostAfter)) } catch { return }
      // Retry shows at once: he may be looking at the page. A reply after this still sends its draft; it no longer
      // writes the page's ask.
      guard let self, self.latestDraftAsks[pageId] == number else { return }
      self.draftAsks[pageId] = failed
      self.latestDraftAsks[pageId] = nil
    }
    let engine = engine
    Task { [weak self] in
      let answer = await engine.dayDraft(for: date)
      let outcome = await self?.outcome(of: answer, failures: failures) ?? failed
      lost.cancel()
      guard let self, self.latestDraftAsks[pageId] == number else { return }
      self.draftAsks[pageId] = outcome
    }
  }

  /// What the answer comes to; `set-draft` sent first when it holds one.
  private func outcome(of answer: DayDraftAnswer, failures: Int) async -> DraftAsk {
    let failed = DraftAsk.failed(failures: failures + 1)
    // Not found (the page went to Trash), offline, a timeout, a failure, or signed out: nothing stored.
    guard case .reply(let reply) = answer else { return failed }
    // Made from another account's workspace: its words never go into this one, and the ask is over, as on the web.
    guard reply.owner == state.owner else { return .done }
    // Today's older draft could not be made again: it stays, and this counts as a failed ask.
    if reply.remakeFailed { return failed }
    // The server's draft already stands: loaded, so that a draft another device made shows now.
    guard let text = reply.setDraft else {
      await refresh()
      return .done
    }
    guard let action = try? JSON.parse(text) else { return failed }
    // A failure is tried once more (another device's change, the network dropping); a refusal is final, as the same
    // command would be refused again.
    for _ in 0..<2 {
      // `set-draft` takes the server's one Undo: it waits while he is offered one it would take away.
      await undoSlotLetGo()
      guard state.owner == reply.owner else { return .done }
      switch await engine.perform(action: action, notOvertaking: nil) {
      case .applied(let answer):
        // Done once the draft is drawn, so the line does not show nothing in between.
        _ = await stateHolding(answer.published, madeUnder: reply.owner)
        return .done
      case .refused(let reason) where reason.contains(Self.alreadyDrafted):
        // Another device's draft won.
        return .done
      case .refused:
        return failed
      case .offline, .signedOut, .notSent:
        continue
      }
    }
    return failed
  }

  /// The server's refusal when the day's draft was stored meanwhile (`workspace.ts`), matched as the web matches it.
  private static let alreadyDrafted = "already has its draft"

  private func undoSlotLetGo() async {
    while holdsUndoSlot {
      await withCheckedContinuation { undoSlotWaits.append($0) }
    }
  }
}
