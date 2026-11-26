import DaythreadCore
import DaythreadSync
import Foundation
import Testing
import UIKit

@testable import DaythreadUI

/// A window `width` points wide and a phone's height, in the test host's scene, for a screen that must be laid out
/// and presented as on a device.
@MainActor
func testWindow(width: CGFloat, height: CGFloat = 874) throws -> UIWindow {
  let scene = try #require(
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first, "the test host has a scene")
  let window = UIWindow(windowScene: scene)
  window.frame = CGRect(x: 0, y: 0, width: width, height: height)
  return window
}

/// Noon UTC on Wednesday, Nov 25 2026.
let noon = Date(timeIntervalSince1970: 1_795_608_000)

let one = Session(token: "token-one", owner: "one", expiresAt: noon.addingTimeInterval(86_400 * 30))

/// The time `now` gives; the test moves it.
@MainActor
final class Clock {
  var date = noon
}

/// A model signed in as `one` over `copy`, its engine past its first pass. The engine's own clock stays at the
/// start, so it asks for no day page the copy lacks after the test moves the model's.
@MainActor
struct Harness {
  let server: TestServer
  let store: TestStore
  let engine: SyncEngine
  let model: AppModel

  init(copy: Workspace, clock: Clock = Clock()) async throws {
    server = TestServer([
      .account(Account(owner: "one", email: "one@example.com", signIn: true)),
      .workspace(.unchanged(revision: copy.revision, owner: "one")),
    ])
    store = TestStore()
    try await store.replace(with: copy, owner: "one")
    let tokens = MemoryTokenStore()
    try tokens.write(one)
    let start = clock.date
    engine = SyncEngine(transport: server, tokens: tokens, store: store, now: { start })
    model = AppModel(engine: engine, now: { clock.date })
    model.start()
    try await until { [model] in model.state.phase == .ready && model.state.workspace != nil }
    await engine.settled()
  }

  func status(_ taskId: String) -> TodoTask.Status? {
    model.workspace?.task(taskId)?.status
  }
}

/// Waits, a few milliseconds at a time, for `condition`; records an issue after two seconds.
@MainActor
func until(_ condition: () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async throws {
  for _ in 0..<400 {
    if condition() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Timed out waiting", sourceLocation: sourceLocation)
}
