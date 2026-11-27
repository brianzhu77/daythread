import DaythreadCore
import Synchronization

/// What the app's screens draw from: they show `workspace` and nothing else.
public struct SyncState: Sendable, Equatable {
  public enum Phase: Sendable, Equatable { case starting, signedOut, ready }

  public var phase: Phase
  /// The server's copy with every pending outbox entry replayed over it, in the order made. Held entries are not.
  /// Nil when there is none to show (signed out, or a copy that belongs to another account than the session's).
  public var workspace: Workspace?
  /// The last try to reach the server failed for lack of network.
  public var offline: Bool
  /// Outbox entries the server held or refused, waiting for him to keep or discard them, by `seq`.
  public var held: [HeldChange]
  /// His pending entries the engine will send: not those waiting behind a held one, and not the engine's own request
  /// for today's page, which it sends but he did not make.
  public var pending: Int
  /// Pending entries not sent while an earlier entry for the same to-do is held.
  public var waiting: Int
  /// Why the last pass ended early, when the reason was neither lack of network (`offline`) nor a session the server
  /// no longer knows; nil again once the server answers.
  public var failure: SyncFailure?
  /// A session is stored on the device: there is someone to sign out.
  public var signedIn: Bool
  /// The highest ticket `enqueue` has given in this engine's lifetime; 0 before the first.
  public var enqueued: Int
  /// The account's email, once the server has told it on this launch.
  public var address: String?
  /// The signed-in account's pages with words not yet saved, oldest change first. Another account's are never here.
  public var drafts: [DraftStatus]
  /// The account whose copy is shown, which `workspace` and `drafts` are of; nil when no copy is shown. A call about
  /// a page's words names it (`expectedOwner`), so the engine never makes it on another account's copy.
  public var owner: String?
  /// The calls about a page's words the engine had made when it published this state (`SyncEngine.draftsWritten`);
  /// 0 before the first.
  public var draftsWritten: Int

  public init(
    phase: Phase = .starting, workspace: Workspace? = nil, offline: Bool = false, held: [HeldChange] = [],
    pending: Int = 0, waiting: Int = 0, failure: SyncFailure? = nil, signedIn: Bool = false, enqueued: Int = 0,
    address: String? = nil, drafts: [DraftStatus] = [], owner: String? = nil, draftsWritten: Int = 0
  ) {
    self.phase = phase
    self.workspace = workspace
    self.offline = offline
    self.held = held
    self.pending = pending
    self.waiting = waiting
    self.failure = failure
    self.signedIn = signedIn
    self.enqueued = enqueued
    self.address = address
    self.drafts = drafts
    self.owner = owner
    self.draftsWritten = draftsWritten
  }

  static let initial = SyncState()
}

/// Where a page's unsaved words stand.
public struct DraftStatus: Sendable, Equatable, Identifiable {
  public enum State: Sendable, Equatable {
    /// Kept, and not on its way: within the wait after his last change.
    case waiting
    /// A save is on its way to the server.
    case sending
    /// The last try to reach the server failed for lack of network; it goes again when the network is back.
    case offline
    /// The last try failed for another reason; it goes again on the schedule.
    case retrying
    /// The server's page changed since the draft started from it: not sent until the screen has merged it onto that
    /// page (`SyncEngine.rebaseDraft`).
    case behind
    /// Kept and not sent until he acts (types again, discards it, or the page comes back): the page is gone or in
    /// Trash, or the server would not take the document. The reason, in the app's words or the server's.
    case stuck(String)
  }

  /// The page.
  public let id: String
  public let state: State

  public init(id: String, state: State) {
    self.id = id
    self.state = state
  }
}

/// A change the server would not apply, kept until he keeps or discards it.
public struct HeldChange: Sendable, Equatable, Identifiable {
  public enum Reason: Sendable, Equatable {
    case conflict, changedSince, maybeApplied, gone, refused

    /// The server's own reasons by name; a refusal's message by the web's patterns (`sendOutbox` in
    /// `src/components/use-day.tsx`); anything else, a 400's `bad-request` included, is `refused`.
    init(stored reason: String?) {
      switch reason {
      case "conflict": self = .conflict
      case "changed-since": self = .changedSince
      case "maybe-applied": self = .maybeApplied
      default:
        let message = reason?.lowercased() ?? ""
        if ["not found", "gone", "no longer"].contains(where: { message.contains($0) }) {
          self = .gone
        } else if ["changed elsewhere", "saved elsewhere"].contains(where: { message.contains($0) }) {
          self = .conflict
        } else {
          self = .refused
        }
      }
    }
  }

  /// The entry's `seq`.
  public let id: Int
  public let label: String
  public let reason: Reason

  /// Sending it again on the latest revision can succeed only when the server held it, not when it refused it.
  public var canKeep: Bool {
    switch reason {
    case .conflict, .changedSince, .maybeApplied: true
    case .gone, .refused: false
    }
  }

  public init(id: Int, label: String, reason: Reason) {
    self.id = id
    self.label = label
    self.reason = reason
  }

  init(_ entry: OutboxEntry) {
    self.init(id: entry.seq, label: entry.label, reason: Reason(stored: entry.reason))
  }
}

/// What `SyncEngine.perform` did with a command it sent and waited for.
public enum Performed: Sendable, Equatable {
  /// The server applied it; its changes are in the published workspace, unless the whole load needed to bring them
  /// in failed, in which case the copy catches up at the next load.
  case applied
  /// The server could not be reached, or did not answer.
  case offline
  /// No session, or the account changed before it was answered.
  case signedOut
  /// The server would not apply it; its reason.
  case refused(String)
}

/// Why a pass ended early, as far as the screens tell it apart.
public enum SyncFailure: Sendable, Equatable {
  /// The request failed below HTTP, other than for lack of network.
  case unreachable
  /// The server answered with an error, asked to wait, or refused the request.
  case server
  /// The server answered with something this client cannot read.
  case unreadable

  /// Nil for lack of network and for a session the server no longer knows: the state says those its own way.
  init?(_ error: any Error) {
    switch error as? TransportError {
    case .offline?, .signedOut?: return nil
    case .server?, .wait?, .refused?: self = .server
    case .unreadable?: self = .unreadable
    case nil: self = .unreachable
    }
  }
}

/// Hands each reader its own stream: the current state at once, then every change. A reader that stops is forgotten.
final class StateBroadcast: Sendable {
  private struct Readers: ~Copyable {
    var current: SyncState
    var streams: [Int: AsyncStream<SyncState>.Continuation] = [:]
    var nextId = 0
  }

  private let readers: Mutex<Readers>

  init(_ initial: SyncState) {
    readers = Mutex(Readers(current: initial))
  }

  deinit {
    let streams = readers.withLock { readers in readers.streams.values }
    for stream in streams { stream.finish() }
  }

  var count: Int { readers.withLock { $0.streams.count } }

  func stream() -> AsyncStream<SyncState> {
    let (stream, continuation) = AsyncStream.makeStream(of: SyncState.self)
    // The first value is yielded under the lock, so a `publish` racing with this read is seen after it, never before.
    let id = readers.withLock { readers in
      let id = readers.nextId
      readers.nextId += 1
      readers.streams[id] = continuation
      continuation.yield(readers.current)
      return id
    }
    continuation.onTermination = { [weak self] _ in
      _ = self?.readers.withLock { $0.streams.removeValue(forKey: id) }
    }
    return stream
  }

  /// Called only from the engine's actor, so publishes never overlap and readers see them in order.
  func publish(_ state: SyncState) {
    let streams = readers.withLock { readers -> [AsyncStream<SyncState>.Continuation] in
      guard readers.current != state else { return [] }
      readers.current = state
      return Array(readers.streams.values)
    }
    for stream in streams { stream.yield(state) }
  }
}

public enum SyncError: Error, Equatable, Sendable {
  /// No workspace is shown, so there is nothing a change could be made to (before the first load, or signed out).
  case notReady
}
