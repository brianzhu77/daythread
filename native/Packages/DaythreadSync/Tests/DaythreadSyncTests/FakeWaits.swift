import Foundation

@testable import DaythreadSync

/// The engine's waits, owned by the test: each is written down and returns only when the test ends it, or throws when
/// the engine cancels it. Nothing here waits for real time.
actor Waits {
  /// Every wait asked for, in order.
  private(set) var asked: [Duration] = []
  /// Waits the engine cancelled before the test ended them.
  private(set) var cancelled = 0
  private var sleeping: [Int: CheckedContinuation<Void, any Error>] = [:]

  func sleep(_ duration: Duration) async throws {
    asked.append(duration)
    let id = asked.count
    try await withTaskCancellationHandler {
      try await wait(id)
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }

  private func wait(_ id: Int) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
      if Task.isCancelled {
        cancelled += 1
        continuation.resume(throwing: CancellationError())
      } else {
        sleeping[id] = continuation
      }
    }
  }

  /// Ends every wait in progress, as if its time had come.
  func elapse() {
    let ended = sleeping
    sleeping = [:]
    for continuation in ended.values { continuation.resume() }
  }

  var inProgress: Int { sleeping.count }

  private func cancel(_ id: Int) {
    guard let continuation = sleeping.removeValue(forKey: id) else { return }
    cancelled += 1
    continuation.resume(throwing: CancellationError())
  }
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
