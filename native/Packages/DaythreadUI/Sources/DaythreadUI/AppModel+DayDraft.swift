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
    guard let ask = draftAsks[page.id], ask.failures < DraftAsk.asksByItself, failedOrLost(page.id),
      asksByItself(for: page)
    else { return }
    askForDraft(of: page)
  }

  /// `Retry`: asks, unless an ask for the page is in flight.
  public func retryDraft(_ page: Page) {
    guard page.date != nil, !(draftAsk(of: page.id)?.inFlight(at: now()) ?? false) else { return }
    askForDraft(of: page)
  }

  /// This run's ask for the day page; nil before the first. Observable; a lost ask is published as such at 60 s.
  /// An ask whose answer is in hand (its `set-draft` waiting for the Undo slot, or being sent) reads as asked now: in
  /// flight however long it waits, never lost, and not asked for again.
  public func draftAsk(of pageId: String) -> DraftAsk? {
    guard let ask = draftAsks[pageId] else { return nil }
    if case .asking(_, let failures) = ask, let number = latestDraftAsks[pageId], answeredDraftAsks.contains(number) {
      return .asking(since: now(), failures: failures)
    }
    return ask
  }

  /// The `set-draft`s waiting for the Undo slot to be let go (tests read it).
  var sendsWaitingForUndoSlot: Int { undoSlotWaits.count }

  /// The account changed or nobody is signed in: the new account's pages, whose ids are the same, are asked for
  /// afresh, and no ask of the one before writes its outcome or sends its draft.
  func forgetDraftAsks() {
    draftAskRun += 1
    latestDraftAsks = [:]
    if !answeredDraftAsks.isEmpty { answeredDraftAsks = [] }
    if !draftAsks.isEmpty { draftAsks = [:] }
  }

  /// Every rule of an ask the model makes by itself but the count: online, signed in, the page today's live day page,
  /// and its draft not standing.
  private func asksByItself(for page: Page) -> Bool {
    guard asksForDayDrafts, state.phase == .ready, state.owner != nil, !state.offline, page.type == "daily",
      page.date == today, let workspace = state.workspace
    else { return false }
    // One page's draft, read without an index of the whole workspace: this runs on every state today is drawn with
    // while no ask was made (a draft that stands is never asked for).
    let stands = workspace.dayDraft(of: page.id).map { !$0.stale } ?? false
    return !stands
  }

  /// Failed, or asked `DraftAsk.lostAfter` ago with no answer (the app may have been away while the wait ran). An
  /// ask whose answer is in hand is neither.
  private func failedOrLost(_ pageId: String) -> Bool {
    switch draftAsk(of: pageId) {
    case .failed?: true
    case let ask? where !ask.inFlight(at: now()): ask != .done
    case .asking?, .done?, nil: false
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
      // writes the page's ask. Cancelling does not stop a wait that had already run out: an answer that came in
      // between cancelled this task, and the ask is not lost.
      guard !Task.isCancelled, let self, self.latestDraftAsks[pageId] == number else { return }
      self.draftAsks[pageId] = failed
      self.latestDraftAsks[pageId] = nil
    }
    let engine = engine
    let run = draftAskRun
    Task { [weak self] in
      let answer = await engine.dayDraft(for: date)
      // The answer is in hand: what is left (the wait for the Undo slot, the send) is not an ask with no answer.
      lost.cancel()
      guard let self else { return }
      if self.latestDraftAsks[pageId] == number { self.answeredDraftAsks.insert(number) }
      let outcome = await self.outcome(of: answer, failures: failures, run: run)
      self.answeredDraftAsks.remove(number)
      guard self.latestDraftAsks[pageId] == number else { return }
      self.draftAsks[pageId] = outcome
    }
  }

  /// What the answer comes to; `set-draft` sent first when it holds one. `run`: the run of asks it was made in, which
  /// an account change, a sign-in or a sign-out ends.
  private func outcome(of answer: DayDraftAnswer, failures: Int, run: Int) async -> DraftAsk {
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
      // An ask of a run forgotten sends nothing, even signed in again as the same account.
      guard draftAskRun == run, state.owner == reply.owner else { return .done }
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
