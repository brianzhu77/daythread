import DaythreadCore
import Synchronization

/// What the app's screens draw from: they show `workspace` and nothing else.
public struct SyncState: Sendable, Equatable {
  public enum Phase: Sendable, Equatable { case starting, signedOut, ready }

  public var phase: Phase
  /// The copy kept on the device, as the server last sent it; nil when there is none to show (signed out, or a copy
  /// that belongs to another account than the session's).
  public var workspace: Workspace?
  /// The last try to reach the server failed for lack of network.
  public var offline: Bool
  /// Outbox entries the server held or refused, waiting for him.
  public var held: Int

  static let initial = SyncState(phase: .starting, workspace: nil, offline: false, held: 0)
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
