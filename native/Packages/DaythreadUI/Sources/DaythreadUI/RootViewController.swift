#if canImport(UIKit)
  import DaythreadSync
  import SwiftUI
  import UIKit

  /// The window's root: nothing while the app starts with no copy to show, "Couldn't load" when there is none to show
  /// after a pass failed, sign-in when signed out, Today otherwise. Its child changes, with a cross-dissolve, only when
  /// that choice does; an ordinary state change never rebuilds it. It refreshes whenever its scene becomes active,
  /// whatever it shows.
  @MainActor
  public final class RootViewController: UIViewController {
    enum Screen: Equatable {
      case nothing, couldNotLoad, signIn, today

      init(_ state: SyncState) {
        let failed = state.failure != nil || state.offline
        switch state.phase {
        case .signedOut: self = .signIn
        case _ where state.workspace == nil && failed: self = .couldNotLoad
        case .ready: self = .today
        case .starting: self = state.workspace == nil ? .nothing : .today
        }
      }
    }

    private let model: AppModel
    private var screen: Screen?
    private var shown: UIViewController?
    /// A retry from "Couldn't load" is running; its button waits.
    private var retrying = false

    public init(model: AppModel) {
      self.model = model
      super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .systemBackground
      NotificationCenter.default.addObserver(
        self, selector: #selector(sceneBecameActive), name: UIScene.didActivateNotification, object: nil)
    }

    /// UIKit calls this again whenever `model.state` changes, since it is read here.
    public override func updateProperties() {
      super.updateProperties()
      let next = Screen(model.state)
      guard next != screen else { return }
      let animated = screen != nil
      screen = next
      show(controller(for: next), animated: animated)
      setNeedsUpdateContentUnavailableConfiguration()
    }

    public override func updateContentUnavailableConfiguration(using state: UIContentUnavailableConfigurationState) {
      guard screen == .couldNotLoad else {
        contentUnavailableConfiguration = nil
        return
      }
      var configuration = UIContentUnavailableConfiguration.empty()
      configuration.text = "Couldn't load"
      configuration.button.title = "Retry"
      configuration.buttonProperties.isEnabled = !retrying
      configuration.buttonProperties.primaryAction = UIAction { [weak self] _ in self?.retry() }
      contentUnavailableConfiguration = configuration
    }

    private func retry() {
      guard !retrying else { return }
      retrying = true
      setNeedsUpdateContentUnavailableConfiguration()
      Task {
        await model.refresh()
        retrying = false
        setNeedsUpdateContentUnavailableConfiguration()
      }
    }

    @objc private func sceneBecameActive(_ notification: Notification) {
      guard let scene = notification.object as? UIScene, scene === view.window?.windowScene else { return }
      Task { await model.refresh() }
    }

    private func controller(for screen: Screen) -> UIViewController? {
      switch screen {
      case .nothing, .couldNotLoad:
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
