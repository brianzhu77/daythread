#if canImport(UIKit)
  import DaythreadSync
  import SwiftUI
  import UIKit

  /// The window's root: nothing while the app starts with no copy to show, sign-in when signed out, Today otherwise.
  /// Its child changes, with a cross-dissolve, only when that choice does; an ordinary state change never rebuilds it.
  @MainActor
  public final class RootViewController: UIViewController {
    enum Screen: Equatable {
      case nothing, signIn, today

      init(_ state: SyncState?) {
        switch state?.phase {
        case .signedOut?: self = .signIn
        case .ready?: self = .today
        case .starting?: self = state?.workspace == nil ? .nothing : .today
        case nil: self = .nothing
        }
      }
    }

    private let model: AppModel
    private var screen: Screen?
    private var shown: UIViewController?

    public init(model: AppModel) {
      self.model = model
      super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .systemBackground
    }

    /// UIKit calls this again whenever `model.state` changes, since it is read here.
    public override func updateProperties() {
      super.updateProperties()
      let next = Screen(model.state)
      guard next != screen else { return }
      let animated = screen != nil
      screen = next
      show(controller(for: next), animated: animated)
    }

    private func controller(for screen: Screen) -> UIViewController? {
      switch screen {
      case .nothing:
        return nil
      case .signIn:
        return UIHostingController(rootView: SignInView(model: model))
      case .today:
        let navigation = UINavigationController(rootViewController: TodayViewController(model: model))
        navigation.navigationBar.prefersLargeTitles = true
        return navigation
      }
    }

    private func show(_ next: UIViewController?, animated: Bool) {
      let previous = shown
      shown = next
      previous?.willMove(toParent: nil)
      if let next {
        addChild(next)
        next.view.frame = view.bounds
        next.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      }
      let swap = {
        previous?.view.removeFromSuperview()
        if let next { self.view.addSubview(next.view) }
      }
      let finish = {
        previous?.removeFromParent()
        next?.didMove(toParent: self)
      }
      if animated {
        UIView.transition(with: view, duration: 0.3, options: .transitionCrossDissolve, animations: swap) { _ in
          finish()
        }
      } else {
        swap()
        finish()
      }
    }
  }
#endif
