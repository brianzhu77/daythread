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
}
