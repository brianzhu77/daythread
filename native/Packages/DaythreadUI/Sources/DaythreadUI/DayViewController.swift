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

    /// The page being edited, and the page his words on it were typed onto: the document the list was last given
    /// from outside (by `edit`, a change from outside, or a merge), never one of its own changes coming back.
    private struct OpenPage {
      let id: String
      /// The account whose page the list was handed: his words on it are that account's, and are written, merged and
      /// stored under it only. Nil when no copy was shown, so nothing he types is written.
      let owner: String?
      var startedFrom: String
      /// The rows he removed one at a time that the list names: as it last reported them, carried over each page it
      /// has been handed since as it carries them (`DraftMerging.rowsStillRemoved`), so what it would report next.
      var singleDeleteIds: [String] = []
    }

    private let document = DocumentViewController()
    private var openPage: OpenPage?
    /// The workspace the list was last handed.
    private var listWorkspace: Workspace?
    /// A merge of the open page is being made and handed over: until the engine has it, what it publishes for the
    /// page is older than the screen.
    private var merging = false
    /// The last merge put a line of his below the server's; the status line says so until he types again.
    private var saysMerged = false
    /// A merge waits for the composition to end (`onComposingChange`).
    private var mergeAfterComposition = false
    /// The documents handed to the list's `replace`, in order (tests read it).
    private(set) var replacedDocuments: [String] = []
    /// Where "Copy draft" puts the draft's words.
    var pasteboard = UIPasteboard.general
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
      if let openPage { model.closed(openPage.id) }
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
      document.onChange = { [weak self] document, singleDeleteIds in self?.wrote(document, singleDeleteIds) }
      document.onComposingChange = { [weak self] composing in
        if !composing { self?.compositionEnded() }
      }
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
      // Read so that this runs again once a page's last call is answered: a state passed over while the screen was
      // ahead is then drawn.
      _ = model.answeredWrites
      let date = date
      let status = StatusLine.text(
        state: state, keepsChanges: model.keepsChanges, pageId: model.workspace?.dayPage(date)?.id, merged: saysMerged)
      if headerView.show(DayHeading(for: date, today: model.today), status: status) { document.headerDidChange() }
      showDay()

      let stuck = !HeldMenu.draftSections(state.drafts, in: state.workspace).isEmpty
      let controls = DayControls.controls(
        for: date, today: model.today, regularWidth: traitCollection.horizontalSizeClass == .regular,
        hasHeld: !state.held.isEmpty || stuck,
        hasMore: !Self.accountRows(state: state, roundTrip: model.roundTrip).isEmpty)
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

    /// Draws the day from what the model draws: its page, edited, or an empty one under what the day says instead.
    private func showDay() {
      guard let workspace = model.workspace else { return }
      let date = date
      let content = DayContent.content(for: date, today: model.today, in: workspace)
      self.content = content
      if case .page = content, failed?.date == date { failed = nil }
      if case .page(let page) = content {
        edit(page, in: workspace)
      } else {
        // Until the engine has made today's page, an empty one stands in for it. Shown first: what he was composing
        // on the page before is reported for that page.
        if let page = Self.emptyPage(on: date) { document.show(page: page, in: workspace) }
        closePage()
      }

      emptyState = emptyState(for: content, on: date)
      if let emptyState { emptyView.configuration = emptyState }
      list?.backgroundView = emptyState == nil ? nil : emptyBackground
      if drawnDate != date {
        if drawnDate != nil, let list {
          list.setContentOffset(CGPoint(x: 0, y: -list.adjustedContentInset.top), animated: false)
          // He left the day: what he wrote there goes now, not after the wait.
          model.saveNow()
        }
        drawnDate = date
      }
    }

    // MARK: Writing

    /// The day's page in the list, edited. While the screen is ahead of the engine (what it wrote is not all stored,
    /// or a merge is being handed over) its words are the truth, and only what else the list draws (to-dos' circles,
    /// page titles) follows the workspace. Once the engine has it all, a page that differs from the screen's was
    /// changed from outside (a save's answer, a load with no draft, a discard), and the list takes it.
    ///
    /// The same page of another account (the engine moved to that account's copy on its own) is another page, whether
    /// or not the screen is ahead: the words on screen are the first account's.
    private func edit(_ page: Page, in workspace: Workspace) {
      let owner = model.state.owner
      guard let open = openPage, open.id.utf8.elementsEqual(page.id.utf8), open.owner == owner,
        let mine = document.document
      else {
        let previous = openPage?.id
        // Another page: what he was composing on the one before is reported for that one, so `openPage` moves after.
        document.edit(page: page, in: workspace, afresh: openPage != nil)
        if let previous { model.closed(previous) }
        model.opened(page.id)
        openPage = OpenPage(id: page.id, owner: owner, startedFrom: page.document)
        listWorkspace = workspace
        saysMerged = false
        mergeIfBehind()
        return
      }
      let ahead = merging || model.isWriting(page.id)
      let draft = model.state.drafts.first { $0.id.utf8.elementsEqual(page.id.utf8) }
      // With no draft, the page is the server's, and what he types next is typed onto it: after a save landed it is
      // what was saved, even when that is what the screen already shows.
      if !ahead, draft == nil { openPage?.startedFrom = page.document }
      // A draft behind the server's page is the stored one, older than the screen: it is merged, never taken.
      if !ahead, draft?.state != .behind, !page.document.utf8.elementsEqual(mine.utf8) {
        replaceList(with: page.document, in: workspace)
        if draft != nil { openPage?.startedFrom = page.document }
        listWorkspace = workspace
      } else {
        // His words stay; the list is handed the new workspace only when it would draw a row of them differently.
        let drawn = workspace.drawing(draft: mine, of: page.id)
        if ListReading(of: mine, in: drawn) != listWorkspace.map({ ListReading(of: mine, in: $0) }) {
          replaceList(with: mine, in: drawn)
          listWorkspace = drawn
        }
      }
      mergeIfBehind()
    }

    /// Every page replace hands the list, so tests can tell a replace that happened from one that did not.
    private func replaceList(with page: String, in workspace: Workspace) {
      replacedDocuments.append(page)
      document.replace(document: page, in: workspace)
      if let ids = openPage?.singleDeleteIds, !ids.isEmpty {
        openPage?.singleDeleteIds = DraftMerging.rowsStillRemoved(ids, from: page)
      }
    }

    private func closePage() {
      guard let openPage else { return }
      model.closed(openPage.id)
      self.openPage = nil
      listWorkspace = nil
      saysMerged = false
      mergeAfterComposition = false
    }

    /// The list's report of a change he made. Not a place to read `document.document`: the list hands it over.
    private func wrote(_ document: String, _ singleDeleteIds: [String]) {
      guard let openPage else { return }
      self.openPage?.singleDeleteIds = singleDeleteIds
      if let owner = openPage.owner {
        model.wrote(
          pageId: openPage.id, document: document, singleDeleteIds: singleDeleteIds,
          startedFrom: openPage.startedFrom, owner: owner)
      }
      if saysMerged {
        saysMerged = false
        setNeedsUpdateProperties()
      }
    }

    /// When the engine says the open page's draft is behind the server's page, the page as it is on screen is merged
    /// with the server's and replaces it, without asking (`native-phase-1.md` §10.6), and the result is handed to the
    /// engine as the draft on the server's page. Never while he composes: the merge waits for the composition to
    /// end. After a merge the engine refused (the page moved again meanwhile, or the draft went), the state decides:
    /// behind again, and the page is merged again (merging twice is safe, the merge settles); or the page is the
    /// server's, and the list takes it.
    private func mergeIfBehind() {
      guard let open = openPage, !merging, let owner = open.owner, model.state.owner == owner,
        model.state.drafts.contains(where: { $0.id.utf8.elementsEqual(open.id.utf8) && $0.state == .behind })
      else { return }
      guard !document.isComposing else {
        mergeAfterComposition = true
        return
      }
      merging = true
      let pageId = open.id
      // The merge is of the words he typed under this account: the engine takes it under this account only.
      Task { [weak self, model] in
        let pair = await model.merging(pageId)
        guard let self else { return }
        // From here to the hand-over nothing suspends: the words merged are the words on screen, and no keystroke
        // can come between.
        guard let pair, self.openPage?.id.utf8.elementsEqual(pageId.utf8) == true, self.openPage?.owner == owner,
          self.model.state.owner == owner, !self.document.isComposing, let mine = self.document.document,
          let workspace = self.model.workspace
        else {
          // Not behind any more (the state saying so is on its way), or another page, or another account's copy (the
          // pair may be that account's, the words on screen are not); or he began composing. A state
          // passed over as ahead meanwhile is drawn now, and a behind draft of the day now open is merged.
          self.merging = false
          if self.document.isComposing { self.mergeAfterComposition = true }
          self.setNeedsUpdateProperties()
          return
        }
        let merged = DraftMerging.merged(base: pair.baseDocument, mine: mine, theirs: pair.theirs)
        let drawn = workspace.drawing(draft: merged.document, of: pageId)
        self.replaceList(with: merged.document, in: drawn)
        self.listWorkspace = drawn
        self.openPage?.startedFrom = merged.document
        if merged.bothChanged {
          self.saysMerged = true
          self.setNeedsUpdateProperties()
        }
        _ = await self.model.rebase(
          pageId: pageId, baseDocument: pair.theirs, document: merged.document,
          singleDeleteIds: self.openPage?.singleDeleteIds ?? [], owner: owner
        ).value
        self.merging = false
        // Refused, the state says behind again (and this merges again) or says the page is the server's.
        self.setNeedsUpdateProperties()
      }
    }

    /// The list says when a composition ends, also one that ends with nothing typed (which reports no change of its
    /// words) and one ended by losing the keyboard; what he committed has been reported by then. A merge that waited
    /// for it is made now.
    private func compositionEnded() {
      guard mergeAfterComposition else { return }
      mergeAfterComposition = false
      mergeIfBehind()
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
    func accountMenu() -> [UIMenuElement] {
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

    /// The "Not saved" menu: first each draft the engine keeps and does not send, then each held change.
    func heldMenu() -> [UIMenuElement] {
      let state = model.state
      var elements: [UIMenuElement] = HeldMenu.draftSections(state.drafts, in: state.workspace).map { section in
        UIMenu(
          title: section.title, options: .displayInline,
          children: [
            UIAction(title: "Copy draft") { [weak self] _ in self?.copyDraft(of: section.pageId) },
            UIAction(title: "Discard draft", attributes: .destructive) { [model] _ in
              Task { await model.discardDraft(pageId: section.pageId) }
            },
          ])
      }
      elements += HeldMenu.sections(state.held).map { section in
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

    /// The draft's words as plain text, so he can put them somewhere the app can save them.
    private func copyDraft(of pageId: String) {
      Task { [weak self, model] in
        guard let text = await model.draftText(of: pageId) else { return }
        self?.pasteboard.string = text
      }
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
