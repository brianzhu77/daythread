#if canImport(UIKit)
  import DaythreadCore
  import DaythreadEditor
  import DaythreadSync
  import UIKit

  /// The account's today: its title, its page, and the account menu.
  @MainActor
  final class TodayViewController: UIViewController {
    static let offlineLine = "Offline · showing what was last loaded"
    static let failedLine = "Couldn't update · showing what was last loaded"

    /// What the prompt says over the copy: offline first, then a pass that failed otherwise.
    static func prompt(for state: SyncState) -> String? {
      if state.offline { return offlineLine }
      if state.failure != nil { return failedLine }
      return nil
    }

    enum AccountRow: Equatable {
      case roundTrip(failing: Int, total: Int)
      case address(String)
      case signOut
    }

    /// The account menu's rows; "Sign out" only while a session is stored. No rows, no account button.
    static func accountRows(state: SyncState, address: String?, roundTrip: AppModel.RoundTrip?) -> [AccountRow] {
      var rows: [AccountRow] = []
      if let roundTrip { rows.append(.roundTrip(failing: roundTrip.failing, total: roundTrip.total)) }
      if let address { rows.append(.address(address)) }
      if state.signedIn { rows.append(.signOut) }
      return rows
    }

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

      NotificationCenter.default.addObserver(
        self, selector: #selector(dayMayHaveChanged), name: UIApplication.significantTimeChangeNotification, object: nil)
    }

    /// UIKit calls this again whenever what it reads from `model` changes.
    override func updateProperties() {
      super.updateProperties()
      let state = model.state
      let workspace = state.workspace
      let today = LocalDate.today(in: workspace?.timezone ?? TimeZone.current.identifier, at: Date())
      title = DayTitle.text(for: today)
      navigationItem.prompt = Self.prompt(for: state)
      if let workspace {
        // Until the engine has made today's page, an empty one stands in for it.
        if let page = workspace.dayPage(today) ?? Self.emptyPage(on: today) {
          document.show(page: page, in: workspace)
        }
      }
      let rows = Self.accountRows(state: state, address: model.address, roundTrip: model.roundTrip)
      accountButton.menu = UIMenu(children: rows.map(menuElement))
      navigationItem.rightBarButtonItem = rows.isEmpty ? nil : accountButton
    }

    private func menuElement(_ row: AccountRow) -> UIMenuElement {
      switch row {
      case .roundTrip(let failing, let total):
        UIAction(title: "Round trip · \(failing) of \(total) pages fail", attributes: .disabled) { _ in }
      case .address(let address):
        UIAction(title: address, attributes: .disabled) { _ in }
      case .signOut:
        UIAction(title: "Sign out", attributes: .destructive) { [model] _ in
          Task { await model.signOut() }
        }
      }
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
  }
#endif
