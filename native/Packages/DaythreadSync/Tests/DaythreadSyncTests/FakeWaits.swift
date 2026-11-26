import Foundation

@testable import DaythreadSync

/// The engine's waits, owned by the test: each is written down and returns only when the test ends it, or throws when
/// the engine cancels it. Nothing here waits for real time.
actor Waits {
  /// Every wait asked for, in order.
  private(set) var asked: [Duration] = []
  /// Waits the engine cancelled before the test ended them.
  private(set) var cancelled = 0
  private var sleeping: [Int: AsyncStream<Void>.Continuation] = [:]

  /// Waits on a stream the test ends. A stream's iteration also ends when the task is cancelled, so this needs no
  /// cancellation handler of its own: the one it had (`withTaskCancellationHandler` around a continuation) made the
  /// test process abort when built by Xcode 26.6 ("freed pointer was not the last allocation", in the task that had
  /// been waiting), on the hosted runner only.
  func sleep(_ duration: Duration) async throws {
    asked.append(duration)
    let id = asked.count
    let (ended, end) = AsyncStream.makeStream(of: Void.self)
    sleeping[id] = end
    for await _ in ended { break }
    // Still written down: the test did not end it, so the engine cancelled it.
    if sleeping.removeValue(forKey: id) != nil {
      cancelled += 1
      throw CancellationError()
    }
  }

  /// Ends every wait in progress, as if its time had come.
  func elapse() {
    let ended = sleeping
    sleeping = [:]
    for end in ended.values {
      end.yield()
      end.finish()
    }
  }

  var inProgress: Int { sleeping.count }
}

/// A network the test says has come back.
struct FiredReachability: Reachability {
  let becameReachable: AsyncStream<Void>
  private let continuation: AsyncStream<Void>.Continuation

  init() {
    (becameReachable, continuation) = AsyncStream.makeStream(of: Void.self)
  }

  func fire() { continuation.yield() }
}
