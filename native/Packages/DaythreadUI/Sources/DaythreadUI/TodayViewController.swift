#if canImport(UIKit)
  import DaythreadCore
  import DaythreadEditor
  import DaythreadSync
  import UIKit

  /// The account's today: its title, its page, and the account menu.
  @MainActor
  final class TodayViewController: UIViewController {
    static let offlineLine = "Offline · showing what was last loaded"

    private let model: AppModel
    private let document = DocumentViewController()
    private let refreshControl = UIRefreshControl()
    private let accountButton = UIBarButtonItem(image: UIImage(systemName: "person.crop.circle"))

    init(model: AppModel) {
      self.model = model
      super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .systemBackground
      navigationItem.largeTitleDisplayMode = .always
      accountButton.accessibilityLabel = "Account"
      navigationItem.rightBarButtonItem = accountButton

      addChild(document)
      document.view.frame = view.bounds
      document.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      view.addSubview(document.view)
      document.didMove(toParent: self)
      if let list = document.view as? UIScrollView {
        list.refreshControl = refreshControl
        setContentScrollView(list)
      }
      refreshControl.addTarget(self, action: #selector(pulled), for: .valueChanged)

      let center = NotificationCenter.default
      center.addObserver(
        self, selector: #selector(dayMayHaveChanged), name: UIApplication.significantTimeChangeNotification, object: nil)
      center.addObserver(self, selector: #selector(sceneBecameActive), name: UIScene.didActivateNotification, object: nil)
    }

    /// UIKit calls this again whenever what it reads from `model` changes.
    override func updateProperties() {
      super.updateProperties()
      let state = model.state
      let workspace = state?.workspace
      let today = LocalDate.today(in: workspace?.timezone ?? TimeZone.current.identifier, at: Date())
      title = DayTitle.text(for: today)
      navigationItem.prompt = state?.offline == true ? Self.offlineLine : nil
      if let workspace {
        // Until the engine has made today's page, an empty one stands in for it.
        if let page = workspace.dayPage(today) ?? Self.emptyPage(on: today) {
          document.show(page: page, in: workspace)
        }
      }
      accountButton.menu = accountMenu()
    }

    private func accountMenu() -> UIMenu {
      var rows: [UIMenuElement] = []
      if let roundTrip = model.roundTrip {
        rows.append(
          UIAction(title: "Round trip · \(roundTrip.failing) of \(roundTrip.total) pages fail", attributes: .disabled) {
            _ in
          })
      }
      if let address = model.address {
        rows.append(UIAction(title: address, attributes: .disabled) { _ in })
      }
      rows.append(
        UIAction(title: "Sign out", image: nil, attributes: .destructive) { [model] _ in
          Task { await model.signOut() }
        })
      return UIMenu(children: rows)
    }

    private static func emptyPage(on date: LocalDate) -> Page? {
      Page(
        .object([
          "id": .string("day:\(date.value)"), "type": .string("day"), "date": .string(date.value),
          "title": .string(""), "document": .string("[]"),
        ]))
    }

    // MARK: Refreshing

    @objc private func pulled() {
      Task {
        await model.refresh()
        refreshControl.endRefreshing()
      }
    }

    @objc private func dayMayHaveChanged() {
      setNeedsUpdateProperties()
      Task { await model.refresh() }
    }

    @objc private func sceneBecameActive(_ notification: Notification) {
      guard let scene = notification.object as? UIScene, scene === view.window?.windowScene else { return }
      Task { await model.refresh() }
    }
  }
#endif
