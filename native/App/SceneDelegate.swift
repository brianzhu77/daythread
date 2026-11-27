import DaythreadUI
import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene, let app = UIApplication.shared.delegate as? AppDelegate else {
      return
    }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = RootViewController(model: app.model)
    window.makeKeyAndVisible()
    self.window = window
  }

  /// What he wrote goes now, not after the wait: the app may not run again until it is opened again.
  func sceneDidEnterBackground(_ scene: UIScene) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = SavingInBackground(model: app.model, time: UIApplication.shared)
  }
}

/// The time the system gives an app to finish what it was doing after it leaves the foreground.
@MainActor
protocol BackgroundTime {
  /// `expired` is called when the system says time is up; the task must be ended then.
  func begin(expired: @escaping @MainActor @Sendable () -> Void) -> UIBackgroundTaskIdentifier
  func end(_ task: UIBackgroundTaskIdentifier)
}

extension UIApplication: BackgroundTime {
  func begin(expired: @escaping @MainActor @Sendable () -> Void) -> UIBackgroundTaskIdentifier {
    beginBackgroundTask(withName: "Save what was written") { expired() }
  }

  func end(_ task: UIBackgroundTaskIdentifier) {
    endBackgroundTask(task)
  }
}

/// Asks the engine to save now and holds a background task until it has, or until the system says time is up; the
/// task is ended exactly once on either path. It lives as long as the save does.
@MainActor
final class SavingInBackground {
  private let time: any BackgroundTime
  private var task = UIBackgroundTaskIdentifier.invalid

  init(model: AppModel, time: any BackgroundTime) {
    self.time = time
    task = time.begin { [weak self] in self?.end() }
    let saving = model.saveNow()
    Task {
      await saving.value
      self.end()
    }
  }

  private func end() {
    guard task != .invalid else { return }
    time.end(task)
    task = .invalid
  }
}
