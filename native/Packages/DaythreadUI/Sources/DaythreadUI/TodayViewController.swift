#if canImport(UIKit)
  import DaythreadCore
  import DaythreadEditor
  import DaythreadSync
  import UIKit

  /// The account's today: its title, its page, the changes not saved, and the account menu.
  @MainActor
  final class TodayViewController: UIViewController {
    enum AccountRow: Equatable {
      case roundTrip(failing: Int, total: Int)
      case address(String)
      case signOut
    }

    /// The account menu's rows; the address the engine last published, and "Sign out" only while a session is stored
    /// (from a hidden copy the engine's count of unsent changes means nothing). No rows, no account button.
    static func accountRows(state: SyncState, roundTrip: AppModel.RoundTrip?) -> [AccountRow] {
      var rows: [AccountRow] = []
      if let roundTrip { rows.append(.roundTrip(failing: roundTrip.failing, total: roundTrip.total)) }
      if let address = state.address { rows.append(.address(address)) }
      if state.signedIn { rows.append(.signOut) }
      return rows
    }

    /// The sign-out alert's title.
    static func unsentTitle(_ count: Int) -> String {
      count == 1 ? "1 change not sent" : "\(count) changes not sent"
    }

    private let model: AppModel
    private let document = DocumentViewController()
    private let refreshControl = UIRefreshControl()
    private let accountButton = UIBarButtonItem(image: UIImage(systemName: "person.crop.circle"))
    private let heldButton = UIBarButtonItem(image: UIImage(systemName: "exclamationmark.triangle"))
    private lazy var tickFeedback = UIImpactFeedbackGenerator(style: .light, view: view)

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
      // Both menus are built when opened, from the state of that moment.
      accountButton.menu = UIMenu(children: [
        UIDeferredMenuElement.uncached { [weak self] completion in completion(self?.accountMenu() ?? []) }
      ])
      heldButton.tintColor = .systemRed
      heldButton.accessibilityLabel = "Not saved"
      heldButton.menu = UIMenu(children: [
        UIDeferredMenuElement.uncached { [weak self] completion in completion(self?.heldMenu() ?? []) }
      ])
      document.onTick = { [weak self] taskId in self?.tick(taskId) }

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
      title = DayTitle.text(for: model.today)
      navigationItem.prompt = StatusLine.text(state: state, keepsChanges: model.keepsChanges)
      showPage()
      let rows = Self.accountRows(state: state, roundTrip: model.roundTrip)
      navigationItem.rightBarButtonItems =
        (rows.isEmpty ? [] : [accountButton]) + (state.held.isEmpty ? [] : [heldButton])
    }

    /// Draws today's page from what the model draws.
    private func showPage() {
      guard let workspace = model.workspace else { return }
      let today = model.today
      // Until the engine has made today's page, an empty one stands in for it.
      if let page = workspace.dayPage(today) ?? Self.emptyPage(on: today) {
        document.show(page: page, in: workspace)
      }
    }

    /// Draws the tap before returning, so the circle changes in the frame it is tapped.
    private func tick(_ taskId: String) {
      guard model.tick(taskId: taskId) else { return }
      tickFeedback.impactOccurred()
      showPage()
    }

    // MARK: Menus

    private func accountMenu() -> [UIMenuElement] {
      Self.accountRows(state: model.state, roundTrip: model.roundTrip).map { row in
        switch row {
        case .roundTrip(let failing, let total):
          UIAction(title: "Round trip · \(failing) of \(total) pages fail", attributes: .disabled) { _ in }
        case .address(let address):
          UIAction(title: address, attributes: .disabled) { _ in }
        case .signOut:
          UIAction(title: "Sign out", attributes: .destructive) { [weak self] _ in self?.signOut() }
        }
      }
    }

    private func heldMenu() -> [UIMenuElement] {
      let state = model.state
      var elements: [UIMenuElement] = HeldMenu.sections(state.held).map { section in
        var actions: [UIMenuElement] = []
        if section.canKeep {
          actions.append(UIAction(title: "Keep mine") { [model] _ in Task { await model.keep(section.id) } })
        }
        actions.append(
          UIAction(title: "Discard", attributes: .destructive) { [model] _ in Task { await model.discard(section.id) } })
        return UIMenu(title: section.title, options: .displayInline, children: actions)
      }
      if let line = HeldMenu.waitingLine(state.waiting) {
        elements.append(UIAction(title: line, attributes: .disabled) { _ in })
      }
      return elements
    }

    // MARK: Signing out

    /// Tries to send what is waiting first; when changes are still not sent, asks before erasing them.
    private func signOut() {
      Task {
        guard case .unsent(let count) = await model.signOut(discardingUnsent: false) else { return }
        let alert = UIAlertController(title: Self.unsentTitle(count), message: nil, preferredStyle: .alert)
        alert.addAction(
          UIAlertAction(title: "Sign out and discard", style: .destructive) { [model] _ in
            Task { _ = await model.signOut(discardingUnsent: true) }
          })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        present(alert, animated: true)
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
