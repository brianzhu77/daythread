#if canImport(UIKit)
  import DaythreadCore
  import DaythreadEditor
  import DaythreadSync
  import Observation
  import SwiftUI
  import UIKit

  /// One day: its header (the page's first row), its page or what a day without one says, the quiet controls to reach
  /// other days, the changes not saved, and the More menu. Changing the day replaces the page in place; nothing is
  /// pushed.
  /// Where the action out on the day screen came from (§12.4): what is dimmed, and what its notice's Undo dims again.
  enum ActionOrigin: Equatable {
    /// The row's id.
    case row(String)
    case strip(taskId: String)
  }

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
    /// The strip above the page: what it shows, its fold, and what it was asked.
    let factsModel = DayFactsModel()
    /// The strip, in the header under the title. Its height is its own, reported as its preferred content size.
    private lazy var factsHost = DayFactsHostingController(rootView: DayFactsView(model: factsModel))
    /// The strip's view, in the header.
    var factsView: UIView { factsHost.view }
    /// How many times the facts were worked out (tests read it).
    private(set) var factsReads = 0
    private let heldButton = UIBarButtonItem(image: UIImage(systemName: "exclamationmark.triangle"))
    private let moreButton = UIBarButtonItem(image: UIImage(systemName: "ellipsis"))
    private lazy var previousButton = symbolButton("chevron.left", label: "Previous day") { $0.step(by: -1) }
    private lazy var nextButton = symbolButton("chevron.right", label: "Next day") { $0.step(by: 1) }
    private lazy var todayButton = UIBarButtonItem(
      primaryAction: UIAction(title: "Today") { [weak self] _ in self?.open(nil) })
    private lazy var tickFeedback = UIImpactFeedbackGenerator(style: .light, view: view)

    /// The day shown.
    var date: LocalDate { shownDate ?? model.today }

    /// What an action's notice is of: where it was made (a row, or the strip), the page it did not overtake (nil: it
    /// had none to wait for), the day and account it was made under, and the operation an Undo would undo.
    private struct Acted {
      let origin: ActionOrigin
      let pageId: String?
      let date: LocalDate
      let owner: String
      let operationId: String
    }

    /// The notice, over the page (on a phone under the status bar, at regular width under the navigation bar); it says
    /// what the last row action did.
    let notice: NoticeView
    /// The notice showing is of this action; nil when it offers no Undo.
    private var noticeOf: Acted?
    /// The action or Undo out on the screen, and where it came from: no other runs until it is answered (§12.4, one
    /// at a time for the whole screen). Setting it dims its row (of the page, or of the strip), disables the strip and
    /// holds every row's actions on whatever day is shown; leaving the day takes the dimming away while it stays out.
    private var actionOut: ActionOrigin? {
      didSet {
        guard actionOut != oldValue else { return }
        if case .row(let rowID) = actionOut { document.actingRow = rowID } else { document.actingRow = nil }
        document.pausesRowActions = actionOut != nil
        if case .strip(let taskId) = actionOut { factsModel.acting = taskId } else { factsModel.acting = nil }
        updateStripEnabled()
      }
    }
    /// The indexes the last `ListReading`s were read with, newest first, and the workspaces they are of: the list's
    /// workspace and a state's are read again at the next state, at no cost.
    private var readingIndexes: [(workspace: Workspace, index: TodoIndex)] = []
    /// The workspaces `readingIndexes` holds, newest first (tests read it).
    var indexedWorkspaces: [Workspace] { readingIndexes.map(\.workspace) }

    /// `noticeSleep`: how the notice waits out its time (tests hold it).
    init(model: AppModel, noticeSleep: @escaping @Sendable (Duration) async throws -> Void = SyncEngine.sleep) {
      self.model = model
      notice = NoticeView(sleep: noticeSleep)
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
      document.onRowAction = { [weak self] request in self?.rowRequested(request) }
      notice.onUndo = { [weak self] operationId in self?.undo(operationId) }
      document.onChange = { [weak self] document, singleDeleteIds in self?.wrote(document, singleDeleteIds) }
      document.onComposingChange = { [weak self] composing in
        if !composing { self?.compositionEnded() }
      }
      document.headerView = headerView
      headerView.onResize = { [weak self] in self?.emptyBackground.setNeedsLayout() }
      factsHost.sizingOptions = [.intrinsicContentSize, .preferredContentSize]
      factsHost.safeAreaRegions = []
      factsHost.view.backgroundColor = .clear
      factsHost.onPreferredContentSizeChange = { [weak self] in self?.stripHeightChanged() }
      // Its view lies in the list's header: UIKit requires the controller whose view holds it to be its parent.
      document.addChild(factsHost)
      headerView.hold(facts: factsHost.view)
      factsHost.didMove(toParent: document)
      factsModel.onBringBack = { [weak self] taskId in self?.stripRequested(taskId, on: nil) }
      factsModel.onAnotherDay = { [weak self] taskId, date in self?.stripRequested(taskId, on: date) }
      factsModel.onPickDate = { [weak self] taskId in self?.presentStripDatePicker(for: taskId) }
      factsModel.onEvents = { [weak self] in
        guard let self, let heading = factsModel.facts.eventsHeadingId else { return }
        // The caret stays where it is: with the keyboard up he sees the heading, and his line where the scroll put it.
        document.scroll(toRow: heading, animated: true)
      }
      registerForTraitChanges([UITraitHorizontalSizeClass.self]) { (self: Self, _) in self.setNeedsUpdateProperties() }

      addChild(document)
      document.view.frame = view.bounds
      document.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      view.addSubview(document.view)
      document.didMove(toParent: self)
      // Over the page, pinned to the screen's edges: the notice places itself under the safe area's top, and only
      // its surface takes touches.
      notice.frame = view.bounds
      notice.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      view.addSubview(notice)
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

    /// On a phone the notice sits under the status bar, over the navigation bar's band (`NoticeView`), so it is held
    /// by the navigation controller's view, above its bar; its place under the bar at regular width is still this
    /// page's safe area.
    override func viewIsAppearing(_ animated: Bool) {
      super.viewIsAppearing(animated)
      let host = navigationController?.view ?? view!
      if notice.superview !== host {
        notice.removeFromSuperview()
        notice.frame = host.bounds
        host.addSubview(notice)
        notice.barGuide = host === view ? nil : view.safeAreaLayoutGuide
      } else {
        host.bringSubviewToFront(notice)
      }
      // A change of the strip's height that came while the screen was away is laid out now.
      if headerLayoutPending { stripHeightChanged() }
    }

    /// The header's deferred layout is not run for a screen that is gone; it waits until the screen appears again.
    override func viewDidDisappear(_ animated: Bool) {
      super.viewDidDisappear(animated)
      NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(layOutHeader), object: nil)
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
      // Before the page is drawn, so its rows' marks read this today; a new today redraws them at midnight.
      if document.today != model.today { document.today = model.today }
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
      guard let workspace = model.workspace else {
        // No copy is shown (signed out, or another account's): nothing of the last account's is said above the page.
        showFacts(.none)
        updateStripEnabled()
        return
      }
      let date = date
      let content = DayContent.content(for: date, today: model.today, in: workspace)
      self.content = content
      if case .page = content, failed?.date == date { failed = nil }
      let drawnWith: Workspace
      if case .page(let page) = content {
        drawnWith = edit(page, in: workspace)
      } else {
        // Until the engine has made today's page, an empty one stands in for it. Shown first: what he was composing
        // on the page before is reported for that page.
        if let page = Self.emptyPage(on: date) { document.show(page: page, in: workspace) }
        closePage()
        drawnWith = workspace
      }
      updateFacts(from: drawnWith, on: date)
      updateStripEnabled()

      emptyState = emptyState(for: content, on: date)
      if let emptyState { emptyView.configuration = emptyState }
      list?.backgroundView = emptyState == nil ? nil : emptyBackground
      if drawnDate != date {
        if drawnDate != nil, let list {
          list.setContentOffset(CGPoint(x: 0, y: -list.adjustedContentInset.top), animated: false)
          // He left the day: what he wrote there goes now, not after the wait.
          model.saveNow()
          // What a row action of that day says, and its dimmed row, stay with that day; an action still out is
          // answered, and said nowhere, and holds this day's rows' actions until then.
          notice.dismiss()
          noticeOf = nil
          document.actingRow = nil
          factsModel.acting = nil
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
    ///
    /// Returns the workspace the page is drawn against: `workspace` when the list takes the page, else `workspace` with
    /// his words drawn in.
    @discardableResult
    private func edit(_ page: Page, in workspace: Workspace) -> Workspace {
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
        return workspace
      }
      let ahead = merging || model.isWriting(page.id)
      let draft = model.state.drafts.first { $0.id.utf8.elementsEqual(page.id.utf8) }
      // With no draft, the page is the server's, and what he types next is typed onto it: after a save landed it is
      // what was saved, even when that is what the screen already shows.
      if !ahead, draft == nil { openPage?.startedFrom = page.document }
      // A draft behind the server's page is the stored one, older than the screen: it is merged, never taken.
      let drawnWith: Workspace
      if !ahead, draft?.state != .behind, !page.document.utf8.elementsEqual(mine.utf8) {
        replaceList(with: page.document, in: workspace)
        if draft != nil { openPage?.startedFrom = page.document }
        listWorkspace = workspace
        drawnWith = workspace
      } else {
        // His words stay; the list is handed the new workspace only when it would draw a row of them differently.
        let drawn = workspace.drawing(draft: mine, of: page.id)
        if reading(mine, on: page.date, in: drawn) != listWorkspace.map({ reading(mine, on: page.date, in: $0) }) {
          replaceList(with: mine, in: drawn)
          listWorkspace = drawn
        }
        drawnWith = drawn
      }
      mergeIfBehind()
      return drawnWith
    }

    // MARK: The strip above the page

    /// Works the day's facts out from `workspace`, the one the page is drawn against, with the index of that same
    /// value (`DayFacts.of` does not check that they agree). While his words stay on the page, the list's reading has
    /// already built that index; when the list takes the page, or on a day without one, `todoIndex(of:)` builds it
    /// here (and keeps it for the next state). Only `showDay` calls this, when a state or the day is drawn: a
    /// keystroke draws neither.
    private func updateFacts(from workspace: Workspace, on date: LocalDate) {
      factsReads += 1
      showFacts(DayFacts.of(day: date, in: workspace, index: todoIndex(of: workspace), today: model.today))
    }

    /// The strip's controls work while no action is out and today's page is not being made (§12.4).
    private func updateStripEnabled() {
      let enabled = actionOut == nil && content != .askingForToday
      if factsModel.enabled != enabled { factsModel.enabled = enabled }
    }

    /// Hands `facts` to the strip when they differ from those it shows; the strip takes no room when they are empty.
    private func showFacts(_ facts: DayFacts) {
      factsModel.show(facts)
      let hidden = facts.isEmpty
      guard factsView.isHidden != hidden else { return }
      factsView.isHidden = hidden
      stripHeightChanged()
    }

    /// The list lays its header out again on the run loop's next turn, once for all the strip's changes until then:
    /// never inside its own layout pass or a snapshot's apply.
    private func stripHeightChanged() {
      headerLayoutPending = true
      NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(layOutHeader), object: nil)
      perform(#selector(layOutHeader), with: nil, afterDelay: 0, inModes: [.common])
    }

    /// A header layout was asked for and has not run.
    private var headerLayoutPending = false

    @objc private func layOutHeader() {
      headerLayoutPending = false
      document.headerDidChange()
      emptyBackground.setNeedsLayout()
    }

    /// What the list reads of `workspace` for `document`, at the model's today. The index is built again only for
    /// another workspace than the one read last.
    private func reading(_ document: String, on pageDate: LocalDate?, in workspace: Workspace) -> ListReading {
      ListReading(of: document, pageDate: pageDate, in: workspace, index: todoIndex(of: workspace), today: model.today)
    }

    /// The index of `workspace`, built again only for another workspace than the last two read.
    private func todoIndex(of workspace: Workspace) -> TodoIndex {
      if let cached = readingIndexes.first(where: { $0.workspace == workspace }) { return cached.index }
      let index = TodoIndex(workspace)
      // Two: a state's drawn workspace is compared with the one the list holds, and each is read again next time.
      readingIndexes = Array(([(workspace, index)] + readingIndexes).prefix(2))
      return index
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

    // MARK: A row's actions

    /// The list's report of a row's action (`native-phase-1.md` §11.3, §11.4). Nothing while another is out.
    private func rowRequested(_ request: RowRequest) {
      // Nor while a sheet, the calendar or an alert is up: another could not be presented over it.
      guard actionOut == nil, presentedViewController == nil else { return }
      switch request.kind {
      case .more: presentMore(request)
      case .action(.pickDate): presentDatePicker(for: request)
      case .action(let action): run(action, on: request)
      }
    }

    /// The rest of the row's actions, in the web's order, as the system's action sheet: a popover from the row on a
    /// wide screen.
    private func presentMore(_ request: RowRequest) {
      let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
      for item in request.menu.more {
        sheet.addAction(
          UIAlertAction(title: item.title, style: item.destructive ? .destructive : .default) { [weak self] _ in
            // The sheet keeps the items it was made with; the row may have changed while it was open.
            guard let self, self.rowStillOffers(item.action, for: request) else { return }
            if item.action == .pickDate {
              self.presentDatePicker(for: request)
            } else {
              self.run(item.action, on: request)
            }
          })
      }
      sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
      anchor(sheet.popoverPresentationController, to: request.rowID)
      present(sheet, animated: true)
    }

    /// `Pick date…`: the system's calendar, nothing selected, no day before today; a day picked closes it and moves
    /// the to-do there. A popover from the row on a wide screen, a sheet on the phone.
    private func presentDatePicker(for request: RowRequest) {
      let workspace = model.workspace
      let picker = DayPickerViewController(
        selected: nil, notBefore: model.today, written: workspace?.writtenDays() ?? [],
        weekStartsOnMonday: workspace?.weekStartsOnMonday ?? false,
        timezone: workspace?.timezone ?? TimeZone.current.identifier
      ) { [weak self] day in
        guard let self else { return }
        self.dismiss(animated: true)
        // The calendar can stay open for as long as he likes: the row, its to-do and today are read again.
        guard self.rowStillOffers(.pickDate, for: request), !(day < self.model.today) else { return }
        self.run(.move(day), on: request)
      }
      picker.modalPresentationStyle = .popover
      if let popover = picker.popoverPresentationController {
        anchor(popover, to: request.rowID)
        let sheet = popover.adaptiveSheetPresentationController
        sheet.detents = [.medium(), .large()]
        sheet.selectedDetentIdentifier = DayPickerViewController.firstDetent(
          for: traitCollection.preferredContentSizeCategory)
      }
      present(picker, animated: true)
    }

    /// Whether the row of `request` is still on the page with the same to-do, and its menu, read now from the
    /// workspace as the list draws it, still offers `action`: as the list checks a request from a menu left open.
    private func rowStillOffers(_ action: RowAction, for request: RowRequest) -> Bool {
      guard let mine = document.document, let open = openPage, case .page(let page)? = content,
        let block = Self.block(request.rowID, in: mine),
        block.props["taskId"]?.stringValue?.utf8.elementsEqual(request.taskId.utf8) == true,
        let workspace = model.workspace
      else { return false }
      let drawn = workspace.drawing(draft: mine, of: open.id)
      let facts = RowFacts.of(
        row: block, pageDate: page.date, in: drawn, index: todoIndex(of: drawn), today: model.today)
      return facts?.menu?.groups.contains { $0.items.contains { $0.action == action } } ?? false
    }

    private func anchor(_ popover: UIPopoverPresentationController?, to rowID: String) {
      guard let popover, let list else { return }
      popover.sourceView = list
      popover.sourceRect = document.sourceRect(ofRow: rowID) ?? CGRect(x: list.bounds.midX, y: list.bounds.midY, width: 0, height: 0)
    }

    /// §11.4: what he composes is committed, the row is dimmed while the command is out, and the notice says what
    /// happened; `Undo` only while the server would take it.
    private func run(_ action: RowAction, on request: RowRequest) {
      guard actionOut == nil, let open = openPage, let owner = open.owner,
        case .page(let page)? = content, let pageDate = page.date
      else { return }
      document.commitComposition()
      let origin = ActionOrigin.row(request.rowID)
      actionOut = origin
      // The command about to go takes the server's slot: an Undo of the action before would be refused.
      notice.withdrawUndo()
      noticeOf = nil
      Task { [weak self, model] in
        let acted = await model.act(
          action, taskId: request.taskId, pageId: open.id, pageDate: pageDate, owner: owner)
        guard let self else { return }
        self.actionOut = nil
        // Said only on the page it was made on, under the account it was made under: he may have gone to another
        // day meanwhile, or the copy shown may be another account's.
        guard self.openPage?.id == open.id, self.openPage?.owner == owner, model.state.owner == owner else { return }
        self.say(acted, of: origin, pageId: open.id, date: pageDate, owner: owner)
      }
    }

    /// The notice of an action's answer, on the screen it was made on; `Undo` only while the server would take it.
    private func say(_ acted: RowActed, of origin: ActionOrigin, pageId: String?, date: LocalDate, owner: String) {
      switch acted {
      case .done(let text, let operationId):
        let offers = model.offersUndo(operationId)
        notice.show(Notice(text: text, kind: .done, undoing: offers ? operationId : nil))
        if offers {
          noticeOf = Acted(origin: origin, pageId: pageId, date: date, owner: owner, operationId: operationId)
          followUndo(operationId)
        }
      case .notDone:
        notice.show(Notice(text: RowNotice.notDone, kind: .failed, undoing: nil))
      }
    }

    /// While the notice offers `Undo` for `operationId`, every change that may end it is looked at; once the model no
    /// longer offers it, it leaves the notice for good.
    private func followUndo(_ operationId: String) {
      guard noticeOf?.operationId == operationId, notice.shown?.undoing == operationId else { return }
      let offers = withObservationTracking {
        model.offersUndo(operationId)
      } onChange: { [weak self] in
        // Called before the change is made: it is read again on the main actor's next turn.
        Task { @MainActor in self?.followUndo(operationId) }
      }
      if !offers {
        noticeOf = nil
        notice.withdrawUndo()
      }
    }

    /// `Undo` runs like an action: its row is dimmed while it is out, when it is still on the page.
    private func undo(_ operationId: String) {
      guard actionOut == nil, let acted = noticeOf, acted.operationId == operationId else { return }
      noticeOf = nil
      // What he composes is committed first: his words would take the server's slot before the Undo reached it, so
      // once they are reported the Undo is not offered and nothing is sent.
      document.commitComposition()
      // The button can be tapped in the turn after it stopped being offered, before the observation withdraws it.
      guard model.offersUndo(operationId) else {
        notice.withdrawUndo()
        return
      }
      actionOut = acted.origin
      // It dims again only what is there to dim: the row on the page, the to-do in the strip's list.
      switch acted.origin {
      case .row(let rowID):
        if document.document.flatMap({ Self.block(rowID, in: $0) }) == nil { document.actingRow = nil }
      case .strip(let taskId):
        if !factsModel.facts.lists(taskId) { factsModel.acting = nil }
      }
      Task { [weak self, model] in
        let said = await model.undo(operationId, pageId: acted.pageId, owner: acted.owner)
        guard let self else { return }
        self.actionOut = nil
        guard self.stillShows(acted), model.state.owner == acted.owner else { return }
        self.notice.show(said)
      }
    }

    /// Whether the screen still shows where `acted` was made: the row's page, or the strip's today.
    private func stillShows(_ acted: Acted) -> Bool {
      switch acted.origin {
      case .row: openPage?.id == acted.pageId
      case .strip: date == acted.date && date == model.today
      }
    }

    // MARK: The strip's actions

    /// `Bring back` (`day` nil: today) or a day of `Another day`. Nothing while something is presented: another could
    /// not be presented over it.
    private func stripRequested(_ taskId: String, on day: LocalDate?) {
      guard presentedViewController == nil else { return }
      plan(taskId, on: day ?? model.today)
    }

    /// `Pick date…` of a `Not today` row: the calendar a row's `Pick date…` opens (nothing selected, no day before
    /// today, today selectable), from the row's menu button; a sheet on the phone.
    private func presentStripDatePicker(for taskId: String) {
      guard actionOut == nil, presentedViewController == nil, date == model.today, isListedAside(taskId) else { return }
      let workspace = model.workspace
      let picker = DayPickerViewController(
        selected: nil, notBefore: model.today, written: workspace?.writtenDays() ?? [],
        weekStartsOnMonday: workspace?.weekStartsOnMonday ?? false,
        timezone: workspace?.timezone ?? TimeZone.current.identifier
      ) { [weak self] day in
        guard let self else { return }
        self.dismiss(animated: true)
        // The calendar can stay open for as long as he likes: `plan` reads the list and today again.
        self.plan(taskId, on: day)
      }
      picker.modalPresentationStyle = .popover
      if let popover = picker.popoverPresentationController {
        popover.sourceView = factsView
        popover.sourceRect =
          factsModel.menuFrames[taskId]
          ?? CGRect(x: factsView.bounds.midX, y: factsView.bounds.midY, width: 0, height: 0)
        let sheet = popover.adaptiveSheetPresentationController
        sheet.detents = [.medium(), .large()]
        sheet.selectedDetentIdentifier = DayPickerViewController.firstDetent(
          for: traitCollection.preferredContentSizeCategory)
      }
      present(picker, animated: true)
    }

    /// Whether `taskId` is a row of `Not today` as the facts are worked out now, from what the screen draws (as
    /// `showDay` works them out): a menu or a calendar opened earlier may hold a to-do brought back, ticked or deleted
    /// since.
    private func isListedAside(_ taskId: String) -> Bool {
      guard let workspace = model.workspace else { return false }
      let today = model.today
      var drawn = workspace
      if case .page(let page) = DayContent.content(for: today, today: today, in: workspace), let open = openPage,
        open.id.utf8.elementsEqual(page.id.utf8), open.owner == model.state.owner, let mine = document.document
      {
        drawn = workspace.drawing(draft: mine, of: page.id)
      }
      return DayFacts.of(day: today, in: drawn, index: todoIndex(of: drawn), today: today).lists(taskId)
    }

    /// §12.4: plans `taskId` on `day` from the strip, on today's screen only, sent and waited for as a row's action
    /// is; nothing when the to-do has left the list or `day` is before today, both as they are now.
    private func plan(_ taskId: String, on day: LocalDate) {
      let today = model.today
      guard actionOut == nil, date == today, !(day < today), let owner = model.state.owner,
        let workspace = model.workspace, isListedAside(taskId)
      else { return }
      // In Trash there is no page to wait for; while it is being made, nothing is sent.
      let pageId: String?
      switch DayContent.content(for: today, today: today, in: workspace) {
      case .page(let page): pageId = page.id
      case .askingForToday: return
      case .inTrash, .noPage, .notYet: pageId = nil
      }
      document.commitComposition()
      let origin = ActionOrigin.strip(taskId: taskId)
      actionOut = origin
      // The command about to go takes the server's slot: an Undo of the action before would be refused.
      notice.withdrawUndo()
      noticeOf = nil
      Task { [weak self, model] in
        let acted = await model.plan(
          taskId, on: day, notOvertaking: pageId, owner: owner, notice: DayFacts.planNotice(date: day, today: today))
        guard let self else { return }
        self.actionOut = nil
        // Said only while the screen shows the today it was made on, under the account it was made under.
        guard self.date == today, model.today == today, model.state.owner == owner else { return }
        self.say(acted, of: origin, pageId: pageId, date: today, owner: owner)
      }
    }

    /// The block `id` of `document`, at any depth.
    private static func block(_ id: String, in document: String) -> Block? {
      var stack = Document.blocks(document)
      while let block = stack.popLast() {
        if block.id.utf8.elementsEqual(id.utf8) { return block }
        stack.append(contentsOf: block.children)
      }
      return nil
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
        if case .applied = performed {} else { self.failed = attempt }
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

  extension DayFacts {
    /// Whether `taskId` is a row of `Not today`.
    fileprivate func lists(_ taskId: String) -> Bool {
      notToday?.rows.contains { $0.taskId.utf8.elementsEqual(taskId.utf8) } ?? false
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
