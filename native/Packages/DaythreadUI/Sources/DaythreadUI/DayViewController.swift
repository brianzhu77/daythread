#if canImport(UIKit)
  import DaythreadCore
  import DaythreadEditor
  import DaythreadSync
  import UIKit

  /// One day: its header (the page's first row), its page or what a day without one says, the quiet controls to reach
  /// other days, the changes not saved, and the More menu. Changing the day replaces the page in place; nothing is
  /// pushed.
  @MainActor
  final class DayViewController: UIViewController {
    enum AccountRow: Equatable {
      case roundTrip(failing: Int, total: Int)
      case address(String)
      case signOut
    }

    /// The More menu's rows, the account's: the address the engine last published, and "Sign out" only while a session
    /// is stored (from a hidden copy the engine's count of unsent changes means nothing). No rows, no More button.
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

    /// What a button of a day without a page asks the server for.
    enum DayAction: Equatable {
      /// "Add page" on a past day, or "Add a new page" beside a page in Trash.
      case add
      /// "Create page" on a future day.
      case create
      case restore(trashId: String)

      /// The empty state's second line after the server could not be reached or would not do it, naming what the
      /// button tried.
      var failureLine: String {
        switch self {
        case .add: "Couldn't add a page · try again"
        case .create: "Couldn't create a page · try again"
        case .restore: "Couldn't restore · try again"
        }
      }
    }

    private struct Attempt: Equatable {
      let date: LocalDate
      let action: DayAction
    }

    private let model: AppModel
    /// The day shown; nil follows `model.today`, so the screen moves at the account's midnight.
    private(set) var shownDate: LocalDate?
    /// What was drawn last.
    private(set) var content: DayContent?
    /// What the day says in place of a page; nil while it shows one.
    private(set) var emptyState: UIContentUnavailableConfiguration?
    /// The one empty-state action that may run at a time; its button shows the system's activity indicator.
    private var running: Attempt?
    private var failed: Attempt?
    private var drawnDate: LocalDate?
    /// Fires at the account's next midnight.
    private(set) var dayTimer: Timer?
    private var scheduledChange: Date?

    private let document = DocumentViewController()
    private let refreshControl = UIRefreshControl()
    let emptyView = UIContentUnavailableView(configuration: UIContentUnavailableConfiguration.empty())
    /// The list's background on a day without a page: the empty state, in the space under the header.
    private lazy var emptyBackground = UnderHeaderView(content: emptyView) { [weak self] in
      self?.spaceUnderHeader ?? .zero
    }
    private(set) lazy var headerView = DayHeaderView { [weak self] in self?.pickDay() }
    private let heldButton = UIBarButtonItem(image: UIImage(systemName: "exclamationmark.triangle"))
    private let moreButton = UIBarButtonItem(image: UIImage(systemName: "ellipsis"))
    private lazy var previousButton = symbolButton("chevron.left", label: "Previous day") { $0.step(by: -1) }
    private lazy var nextButton = symbolButton("chevron.right", label: "Next day") { $0.step(by: 1) }
    private lazy var todayButton = UIBarButtonItem(
      primaryAction: UIAction(title: "Today") { [weak self] _ in self?.open(nil) })
    private lazy var tickFeedback = UIImpactFeedbackGenerator(style: .light, view: view)

    /// The day shown.
    var date: LocalDate { shownDate ?? model.today }

    init(model: AppModel) {
      self.model = model
      super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    isolated deinit {
      dayTimer?.invalidate()
    }

    override func viewDidLoad() {
      super.viewDidLoad()
      view.backgroundColor = .systemBackground
      // The day's title is the page's first row; the bar holds only the quiet controls.
      navigationItem.largeTitleDisplayMode = .never
      moreButton.accessibilityLabel = "More"
      // Both menus are built when opened, from the state of that moment.
      moreButton.menu = UIMenu(children: [
        UIDeferredMenuElement.uncached { [weak self] completion in completion(self?.accountMenu() ?? []) }
      ])
      heldButton.accessibilityLabel = "Not saved"
      heldButton.menu = UIMenu(children: [
        UIDeferredMenuElement.uncached { [weak self] completion in completion(self?.heldMenu() ?? []) }
      ])
      // Ghost buttons, as the web's phone app has them: no glass capsule, the secondary colour. Not saved keeps the
      // system's red.
      for item in [todayButton, previousButton, nextButton, moreButton, heldButton] {
        item.hidesSharedBackground = true
        item.tintColor = .secondaryLabel
      }
      heldButton.tintColor = .systemRed
      document.onTick = { [weak self] taskId in self?.tick(taskId) }
      document.headerView = headerView
      headerView.onResize = { [weak self] in self?.emptyBackground.setNeedsLayout() }
      registerForTraitChanges([UITraitHorizontalSizeClass.self]) { (self: Self, _) in self.setNeedsUpdateProperties() }

      addChild(document)
      document.view.frame = view.bounds
      document.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      view.addSubview(document.view)
      document.didMove(toParent: self)
      // The list stays on a day without a page, holding the empty state as its background, so pull to refresh works
      // on every day.
      list?.refreshControl = refreshControl
      if let list { setContentScrollView(list) }
      refreshControl.addTarget(self, action: #selector(pulled), for: .valueChanged)

      NotificationCenter.default.addObserver(
        self, selector: #selector(dayMayHaveChanged), name: UIApplication.significantTimeChangeNotification, object: nil)
      // A timer counts no time while the device sleeps, so after a sleep it would fire late. The root view controller
      // checks the day and refreshes on activation; here only the timer is set again.
      NotificationCenter.default.addObserver(
        self, selector: #selector(rearmDayTimer), name: UIScene.didActivateNotification, object: nil)
    }

    /// UIKit calls this again whenever what it reads from `model` changes; a change of day or of an empty state's
    /// action asks for it.
    override func updateProperties() {
      super.updateProperties()
      // A day opened before it was today is today now: from here on the screen follows today.
      if shownDate == model.today { shownDate = nil }
      let state = model.state
      let date = date
      let status = StatusLine.text(state: state, keepsChanges: model.keepsChanges)
      if headerView.show(DayHeading(for: date, today: model.today), status: status) { document.headerDidChange() }
      showDay()

      let controls = DayControls.controls(
        for: date, today: model.today, regularWidth: traitCollection.horizontalSizeClass == .regular,
        hasHeld: !state.held.isEmpty, hasMore: !Self.accountRows(state: state, roundTrip: model.roundTrip).isEmpty)
      previousButton.isEnabled = date.adding(days: -1) != nil
      nextButton.isEnabled = controls.canGoNext
      // Set only when they change, so a state change that moves nothing does not lay the bar out again. The bar
      // takes its trailing items from the trailing edge.
      let navigationBar = Array(buttons(controls.navigationBar).reversed())
      if navigationItem.rightBarButtonItems ?? [] != navigationBar { navigationItem.rightBarButtonItems = navigationBar }
      scheduleDayChange()
    }

    var list: UICollectionView? { document.view as? UICollectionView }

    /// The space left for the empty state in the list's background: under the header with the list at rest, and over
    /// the tab bar.
    private var spaceUnderHeader: UIEdgeInsets {
      guard let list else { return .zero }
      let header =
        headerView.superview != nil
        ? headerView.convert(headerView.bounds, to: list)
        : list.layoutAttributesForSupplementaryElement(
          ofKind: UICollectionView.elementKindSectionHeader, at: IndexPath(item: 0, section: 0))?.frame ?? .zero
      return UIEdgeInsets(
        top: header.maxY + list.adjustedContentInset.top, left: 0, bottom: list.adjustedContentInset.bottom, right: 0)
    }

    /// The Today tab tapped again while today is shown: the page's top, as the system's tabs do.
    func scrollToTop() {
      guard let list else { return }
      list.setContentOffset(CGPoint(x: 0, y: -list.adjustedContentInset.top), animated: true)
    }

    /// Draws the day from what the model draws: its page, or an empty one under what the day says instead.
    private func showDay() {
      guard let workspace = model.workspace else { return }
      let date = date
      let content = DayContent.content(for: date, today: model.today, in: workspace)
      self.content = content
      if case .page = content, failed?.date == date { failed = nil }
      // Until the engine has made today's page, an empty one stands in for it.
      let page: Page? =
        if case .page(let page) = content { page } else { Self.emptyPage(on: date) }
      if let page { document.show(page: page, in: workspace) }

      emptyState = emptyState(for: content, on: date)
      if let emptyState { emptyView.configuration = emptyState }
      list?.backgroundView = emptyState == nil ? nil : emptyBackground
      if drawnDate != date {
        if drawnDate != nil, let list {
          list.setContentOffset(CGPoint(x: 0, y: -list.adjustedContentInset.top), animated: false)
        }
        drawnDate = date
      }
    }

    /// Draws the tap before returning, so the circle changes in the frame it is tapped.
    private func tick(_ taskId: String) {
      guard model.tick(taskId: taskId) else { return }
      tickFeedback.impactOccurred()
      showDay()
    }

    // MARK: Other days

    private func buttons(_ items: [DayControls.Item]) -> [UIBarButtonItem] {
      items.map { item in
        switch item {
        case .today: todayButton
        case .previousDay: previousButton
        case .nextDay: nextButton
        case .held: heldButton
        case .more: moreButton
        }
      }
    }

    private func symbolButton(_ symbol: String, label: String, action: @escaping (DayViewController) -> Void)
      -> UIBarButtonItem
    {
      let item = UIBarButtonItem(
        primaryAction: UIAction(image: UIImage(systemName: symbol)) { [weak self] _ in
          if let self { action(self) }
        })
      item.accessibilityLabel = label
      return item
    }

    private func step(by days: Int) {
      guard let day = date.adding(days: days) else { return }
      open(day)
    }

    /// Shows `day`; today, or nil, follows today from then on.
    func open(_ day: LocalDate?) {
      shownDate = day == model.today ? nil : day
      // A failure belongs to the visit it happened in.
      failed = nil
      setNeedsUpdateProperties()
    }

    private func pickDay() {
      let workspace = model.workspace
      let picker = DayPickerViewController(
        selected: date, written: workspace?.writtenDays() ?? [],
        weekStartsOnMonday: workspace?.weekStartsOnMonday ?? false,
        timezone: workspace?.timezone ?? TimeZone.current.identifier
      ) { [weak self] day in
        self?.dismiss(animated: true)
        self?.open(day)
      }
      picker.modalPresentationStyle = .popover
      if let popover = picker.popoverPresentationController {
        popover.sourceItem = headerView.titleButton
        // On the phone the popover becomes a sheet; the calendar needs about half the screen, not all of it.
        let sheet = popover.adaptiveSheetPresentationController
        sheet.detents = [.medium(), .large()]
        sheet.selectedDetentIdentifier = DayPickerViewController.firstDetent(
          for: traitCollection.preferredContentSizeCategory)
      }
      present(picker, animated: true)
    }

    // MARK: A day without a page

    private func emptyState(for content: DayContent, on date: LocalDate) -> UIContentUnavailableConfiguration? {
      let day = DayTitle.text(for: date)
      let text: String
      let buttons: [(title: String, action: DayAction)]
      switch content {
      case .page, .askingForToday:
        return nil
      case .noPage:
        text = "No page for \(day)"
        buttons = [("Add page", .add)]
      case .notYet:
        text = "\(day) hasn't happened yet"
        buttons = [("Create page", .create)]
      case .inTrash(let page):
        text = date == model.today ? "Today's page is in Trash." : "The page for \(day) is in Trash."
        // `restore-batch` names the trash entry; a page without one can only be added again.
        let restore = page.trashId.map { [(title: "Restore", action: DayAction.restore(trashId: $0))] } ?? []
        buttons = restore + [("Add a new page", .add)]
      }

      var configuration = UIContentUnavailableConfiguration.empty()
      configuration.text = text
      if let failed, failed.date == date { configuration.secondaryText = failed.action.failureLine }
      let enabled = running == nil
      if let first = buttons.first {
        configuration.button.title = first.title
        configuration.button.showsActivityIndicator = running == Attempt(date: date, action: first.action)
        configuration.buttonProperties.primaryAction = UIAction { [weak self] _ in self?.act(first.action, on: date) }
        configuration.buttonProperties.isEnabled = enabled
      }
      if buttons.count > 1 {
        let second = buttons[1]
        configuration.secondaryButton.title = second.title
        configuration.secondaryButton.showsActivityIndicator = running == Attempt(date: date, action: second.action)
        configuration.secondaryButtonProperties.primaryAction = UIAction { [weak self] _ in
          self?.act(second.action, on: date)
        }
        configuration.secondaryButtonProperties.isEnabled = enabled
      }
      return configuration
    }

    /// Asks the server and waits for it; nothing is stored, so a failure is said and the button works again.
    private func act(_ action: DayAction, on date: LocalDate) {
      guard running == nil else { return }
      let attempt = Attempt(date: date, action: action)
      running = attempt
      failed = nil
      setNeedsUpdateProperties()
      let command =
        switch action {
        case .add, .create: Command.ensureDay(date)
        case .restore(let trashId): Command.restoreBatch(trashId: trashId)
        }
      Task { [weak self, model] in
        let performed = await model.perform(command)
        guard let self else { return }
        self.running = nil
        if performed != .applied { self.failed = attempt }
        self.setNeedsUpdateProperties()
      }
    }

    // MARK: Menus

    /// The More menu: the account's rows.
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

    /// Today moves at the account's midnight. A timer is set for it each time the day or the zone changes.
    private func scheduleDayChange() {
      let change = model.nextDayChange
      guard change.at != scheduledChange else { return }
      scheduledChange = change.at
      dayTimer?.invalidate()
      // At least a second, so a timer that finds the day unchanged cannot fire again at once.
      let timer = Timer(timeInterval: max(change.in, 1), repeats: false) { [weak self] _ in
        MainActor.assumeIsolated { self?.dayMayHaveChanged() }
      }
      RunLoop.main.add(timer, forMode: .common)
      dayTimer = timer
    }

    @objc private func rearmDayTimer() {
      scheduledChange = nil
      setNeedsUpdateProperties()
    }

    @objc private func dayMayHaveChanged() {
      model.checkToday()
      // Set the timer again even when the day has not moved: a change of the system's clock moves where it falls.
      scheduledChange = nil
      setNeedsUpdateProperties()
      Task { await model.refresh() }
    }
  }

  /// Lays `content` out in the space under the header at rest, so a day's empty state is centred below its header.
  /// It is the list's background view, which does not scroll.
  @MainActor
  final class UnderHeaderView: UIView {
    private let content: UIView
    private let insets: () -> UIEdgeInsets

    init(content: UIView, insets: @escaping () -> UIEdgeInsets) {
      self.content = content
      self.insets = insets
      super.init(frame: .zero)
      addSubview(content)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
      super.layoutSubviews()
      let insets = insets()
      let top = min(max(insets.top, 0), bounds.height)
      let height = max(bounds.height - top - max(insets.bottom, 0), 0)
      content.frame = CGRect(x: 0, y: top, width: bounds.width, height: height)
    }
  }
#endif
