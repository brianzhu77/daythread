import Foundation

/// The app's ask for a day page's draft in this run (`Ask`, `use-day-draft.ts:79-89`).
public enum DraftAsk: Hashable, Sendable {
  case asking(since: Date, failures: Int)
  case done
  case failed(failures: Int)

  /// `LOST_MS`: 60 seconds with no answer and the ask is lost.
  public static let lostAfter: TimeInterval = 60
  /// `AUTO_ASKS`: the asks the page makes by itself before only `Retry` asks.
  public static let asksByItself = 2

  /// `inFlight`: asking, and asked less than `lostAfter` ago.
  public func inFlight(at now: Date) -> Bool {
    guard case .asking(let since, _) = self else { return false }
    return now.timeIntervalSince(since) < Self.lostAfter
  }

  /// `failuresOf`: an ask in flight counts as one more.
  public var failures: Int {
    switch self {
    case .asking(_, let failures): failures + 1
    case .done: 0
    case .failed(let failures): failures
    }
  }
}

/// The line's state (`DayDraftState`, `draft-words.ts:7`).
public enum DraftLineState: Hashable, Sendable { case none, preparing, ready, failed, offline }

/// The draft's line under the title (`draftLineWords`, `draft-words.ts:59-66`).
public enum DraftLine: Hashable, Sendable {
  case preparing
  /// `Suggestions ready` · `Show` (1d.2b; nothing in 1d.2a passes `held: true`).
  case held
  case segments(count: String?, failed: Bool, offline: Bool)

  // `draftWords` (`draft-words.ts:16-28`).
  public static let preparingText = "Preparing\u{2026}"
  public static let readyText = "Suggestions ready"
  public static let show = "Show"
  public static let applyAll = "Apply all"
  public static let dismiss = "Dismiss"
  public static let failedText = "Couldn\u{2019}t draft"
  public static let retry = "Retry"
  public static let offlineText = "Offline"

  /// `1 suggestion`, `3 suggestions`.
  public static func count(_ n: Int) -> String { n == 1 ? "1 suggestion" : "\(n) suggestions" }

  /// `draftLineState` (`draft-words.ts:46-50`): `ask` nil when this run has not asked for the page.
  public static func state(view: DraftView?, ask: DraftAsk?, offline: Bool, at now: Date) -> DraftLineState {
    if offline && view == nil { return .offline }
    if let ask, ask.inFlight(at: now), view?.suggestions.isEmpty ?? true { return .preparing }
    guard let view else {
      // A failed or lost ask shows Retry at once (he may be looking at the page); `done` or no ask shows nothing.
      return switch ask {
      case nil, .done?: DraftLineState.none
      case .asking?, .failed?: .failed
      }
    }
    return view.status == .failed ? .failed : .ready
  }

  /// Nil: no line. `shown` is the suggestions shown.
  public static func of(_ state: DraftLineState, shown: Int, held: Bool) -> DraftLine? {
    switch state {
    case .none: return nil
    case .preparing: return .preparing
    default: break
    }
    if held { return .held }
    let count = shown > 0 ? Self.count(shown) : nil
    let failed = state == .failed, offline = state == .offline
    return count != nil || failed || offline ? .segments(count: count, failed: failed, offline: offline) : nil
  }

  /// The line's words for VoiceOver: `3 suggestions`, `Couldn’t draft`, `3 suggestions, Couldn’t draft`, `Preparing…`.
  public var spoken: String {
    switch self {
    case .preparing: Self.preparingText
    case .held: Self.readyText
    case .segments(let count, let failed, let offline):
      [count, failed ? Self.failedText : nil, offline ? Self.offlineText : nil].compactMap { $0 }
        .joined(separator: ", ")
    }
  }
}
