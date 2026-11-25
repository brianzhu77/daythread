#if canImport(UIKit)
  import UIKit

  /// The window's root. Shows nothing yet.
  @MainActor
  public final class RootViewController: UIViewController {
    public override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .systemBackground
    }
  }
#endif
