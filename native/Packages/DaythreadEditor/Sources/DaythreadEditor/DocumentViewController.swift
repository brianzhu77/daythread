#if canImport(UIKit)
  import DaythreadCore
  import UIKit

  /// A page drawn from its document: one list row per block. A page that is only shown (`show`) edits nothing; a
  /// to-do's circle reports a tick (`onTick`). A page being edited (`edit`) is held here as an `EditablePage`, the
  /// truth while it is open: a line's words are typed into one row at a time, each change goes through the page, and
  /// `onChange` reports it.
  @MainActor
  public final class DocumentViewController: UIViewController {
    /// How far each level of nesting moves a row in.
    static let indentationWidth: CGFloat = 20

    private enum Section { case main }

    /// Which cell registration draws a row. The one place a row kind is mapped to a cell, so the cell
    /// provider and the choice between reconfiguring and reloading cannot disagree.
    private enum CellKind {
      case text, todo, separator, placeholder

      init(_ kind: BlockRow.Kind) {
        switch kind {
        case .text: self = .text
        case .todo: self = .todo
        case .separator: self = .separator
        case .placeholder: self = .placeholder
        }
      }
    }

    /// Called when a to-do's circle is tapped, with the to-do's id. The caller draws the result by calling `show`
    /// (or, for a page being edited, `replace`) before it returns, and the circle is then drawn in the same turn of
    /// the run loop. A tick does not take the caret from the line being typed.
    public var onTick: ((_ taskId: String) -> Void)?

    /// The one callback for a row's actions: a swipe action, `More`, an item of the circle's menu, ⌘/'s menu (the
    /// same), a VoiceOver custom action, the `Plan for today` button. The list presents nothing itself.
    public var onRowAction: ((RowRequest) -> Void)?

    /// The row an action is out for: drawn dimmed (its words and marks in `.tertiaryLabel`), and every row's actions
    /// report nothing until it is nil again. Typing and ticking go on.
    public var actingRow: String? {
      didSet {
        guard actingRow != oldValue else { return }
        let ids = [oldValue, actingRow].compactMap { $0 }.filter { rowsByID[$0] != nil }
        // A row being composed in is never reconfigured from outside: its cell takes the look in place, and its words
        // are drawn in it once the composition ends (`applyWords` leaves marked text alone).
        for id in ids where id == composingRow { (cell(for: id) as? TodoBlockCell)?.setDimmed(id == actingRow) }
        // The others are reconfigured, which keeps each cell (and its caret and keyboard), and reaches a cell the list
        // made ahead of time off screen, which `cellForItem` does not return.
        let reconfigured = ids.filter { $0 != composingRow }
        guard !reconfigured.isEmpty else { return }
        var snapshot = dataSource.snapshot()
        snapshot.reconfigureItems(reconfigured.filter { snapshot.indexOfItem($0) != nil })
        dataSource.apply(snapshot, animatingDifferences: false)
      }
    }

    /// The row's frame in the list's coordinates, for a popover; nil when it is not drawn.
    public func sourceRect(ofRow rowID: String) -> CGRect? {
      cell(for: rowID)?.frame
    }

    /// Called on the main actor after each change he makes, with the page's document and the rows he removed one at a
    /// time. Never for `edit` or `replace`.
    public var onChange: ((_ document: String, _ singleDeleteIds: [String]) -> Void)?

    /// The page as it is on screen now; nil while a page is only shown.
    public var document: String? { editedPage?.document }

    /// Called on the main actor when `isComposing` changes, after the committed words (if any) were reported through
    /// `onChange`. A composition cancelled with nothing typed, or ended by its line losing the keyboard, ends too.
    public var onComposingChange: ((Bool) -> Void)?

    /// True while some line holds marked text.
    public var isComposing: Bool { composingRow != nil }

    /// The page being edited. Nil while a page is only shown.
    private var editedPage: EditablePage?
    /// What the rows are drawn with: the page's day, and the workspace its to-dos and page titles come from.
    private var pageDate: LocalDate?
    private var workspace: Workspace?
    /// The page drawn by `show`, so a new today can draw it again; nil while a page is edited.
    private var shownPage: Page?
    /// The index the rows' facts were last read with, and the workspace it is of: a draw in the same workspace (a key
    /// that restructures the page, a composition that ends) reads no page again.
    private var factsIndex: (workspace: Workspace, index: TodoIndex)?

    /// The app's today, for the rows' facts; a change redraws the rows whose facts change. Nil: no facts.
    public var today: LocalDate? {
      didSet {
        guard today != oldValue, shownPageID != nil else { return }
        drawAgainForToday()
      }
    }
    private var rowsByID: [String: BlockRow] = [:]
    private var orderedIDs: [String] = []
    private var drawn: [String: AttributedString] = [:]
    /// The rows whose words can be typed into.
    private var editableIDs: Set<String> = []
    /// The id of the page drawn last; nil before the first.
    private var shownPageID: String?
    /// The row whose text view holds marked text. What is being composed is not the document yet.
    private var composingRow: String?
    /// Today changed while he composed: the row composed in still shows the facts it had (`drawStaleFacts`).
    private var composingRowFactsAreStale = false
    /// The last change from outside that arrived while he composed, with the page as it was when the first did. The
    /// rest of it is on screen already; the composing row's part waits for the composition to end.
    private var heldReplace: (base: String, document: String, workspace: Workspace)?
    /// Whether each snapshot applied was animated, in order; a call that changes nothing applies none.
    private(set) var appliedAnimated: [Bool] = []
    var appliedSnapshots: Int { appliedAnimated.count }
    /// The rows the last snapshot redrew, reconfigured or reloaded, in page order.
    private(set) var redrawnRows: [String] = []
    /// Space kept between the caret and the edge of what the list shows when the list scrolls to it.
    private static let caretMargin: CGFloat = 8
    /// A view held at the top of the keyboard layout guide, so the list is laid out again when the keyboard moves.
    private let keyboardEdge = UIView()
    private lazy var lineInput = LineInput(self)
    private lazy var tapsUnderLines = TapsUnderLines(self)
    /// How a composition's words and the changes held meanwhile are put together: base, his page, the latest outside
    /// page. Tests replace it to stand in for a merge the app does not make.
    var mergeAfterComposing: (_ base: String, _ mine: String, _ theirs: String) -> String = {
      PageMerge.merge(base: $0, mine: $1, theirs: $2).document
    }
    /// Set while `finishEditing` commits: the page is about to be left, so nothing of it is drawn or given the keyboard.
    private var leavingPage = false
    /// What a commit during a line's resign left to draw, once the line no longer has the keyboard; and, should the
    /// resign be refused, where the caret follows his words.
    private struct AfterResign {
      var workspace: Workspace
      /// The row he composed in.
      let row: String
      /// After what he committed, in the row that holds it; nil when he committed nothing or no row holds it.
      let caret: EditablePage.Caret?
    }

    private var redrawAfterResign: AfterResign?
    /// While set, a change is not reported but noted (`holdingReports`).
    private var reportsHeld = false
    private var reportWasHeld = false

    /// A view the host puts above the rows, as the page's first line: it scrolls with them and is not a row, so the
    /// rows keep their indices.
    public var headerView: UIView? {
      didSet {
        guard headerView !== oldValue else { return }
        oldValue?.removeFromSuperview()
        collectionView.setCollectionViewLayout(Self.layout(using: listConfiguration), animated: false)
      }
    }

    private lazy var collectionView: UICollectionView = {
      let view = UICollectionView(frame: .zero, collectionViewLayout: Self.layout(using: listConfiguration))
      view.backgroundColor = .systemBackground
      view.allowsSelection = false
      view.alwaysBounceVertical = true
      // Dragging the page down puts the keyboard away.
      view.keyboardDismissMode = .interactive
      return view
    }()

    /// The list as the system lays it out, the rows' trailing swipe included.
    var listConfiguration: UICollectionLayoutListConfiguration {
      var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
      configuration.showsSeparators = false
      // The section's own background lies over the list's background view, where a day without a page says so; the
      // list itself is the page's background.
      configuration.backgroundColor = .clear
      configuration.headerMode = headerView != nil ? .supplementary : .none
      // The header is the page's first line, not a section title: no gap above it beyond its own margins.
      configuration.headerTopPadding = 0
      configuration.trailingSwipeActionsConfigurationProvider = { [weak self] indexPath in
        self?.trailingSwipeActions(at: indexPath)
      }
      return configuration
    }

    private static func layout(using configuration: UICollectionLayoutListConfiguration) -> UICollectionViewLayout {
      UICollectionViewCompositionalLayout { _, environment in
        let section = NSCollectionLayoutSection.list(using: configuration, layoutEnvironment: environment)
        // A plain list pins its header to the top; this one is the page's first line and scrolls away with it.
        for header in section.boundarySupplementaryItems { header.pinToVisibleBounds = false }
        return section
      }
    }

    /// Lays the header out again after its host changed what it holds or its height changed. While a line holds the
    /// keyboard, the list's offset moves by as much as that line moved, so it stays where it is on the screen (within
    /// the list's top and bottom); otherwise the rows move with the header. Never animated; never reconfigures a row.
    public func headerDidChange() {
      guard headerView != nil else { return }
      let list = collectionView
      // The list itself keeps the rows it shows when a header scrolled off above them changes height, but not when the
      // header is on screen above them: the line is read on the screen, so either way it is moved by what is left.
      let typed = focusedLine.flatMap { line in
        line.rowID.flatMap { id in cell(for: id).map { (id: id, onScreen: $0.frame.minY - list.contentOffset.y) } }
      }
      list.collectionViewLayout.invalidateLayout()
      guard let typed else { return }
      list.layoutIfNeeded()
      guard let cell = cell(for: typed.id) else { return }
      let moved = cell.frame.minY - list.contentOffset.y - typed.onScreen
      setContentOffset(clamped: list.contentOffset.y + moved, animated: false)
    }

    private lazy var dataSource = makeDataSource()

    public init() {
      super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    public override func loadView() {
      view = collectionView
    }

    public override func viewDidLoad() {
      super.viewDidLoad()
      keyboardEdge.isHidden = true
      keyboardEdge.isUserInteractionEnabled = false
      keyboardEdge.translatesAutoresizingMaskIntoConstraints = false
      collectionView.addSubview(keyboardEdge)
      NSLayoutConstraint.activate([
        keyboardEdge.topAnchor.constraint(equalTo: collectionView.keyboardLayoutGuide.topAnchor),
        keyboardEdge.leadingAnchor.constraint(equalTo: collectionView.frameLayoutGuide.leadingAnchor),
        keyboardEdge.widthAnchor.constraint(equalToConstant: 0),
        keyboardEdge.heightAnchor.constraint(equalToConstant: 0),
      ])
      let tap = UITapGestureRecognizer(target: tapsUnderLines, action: #selector(TapsUnderLines.tapped(_:)))
      tap.delegate = tapsUnderLines
      tap.cancelsTouchesInView = false
      collectionView.addGestureRecognizer(tap)
      // A larger text size grows the rows above the line being typed and pushes it down, under the keyboard. The
      // rows are measured again in the layout after the cells take the new size, so the caret is looked for then.
      registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (self: Self, _) in
        // The run loop's next turn, as a line's deferred paste (`LineTextView.replaceSoon`).
        self.perform(#selector(self.revealCaretAfterTextSizeChange), with: nil, afterDelay: 0, inModes: [.common])
      }
    }

    @objc private func revealCaretAfterTextSizeChange() {
      guard let line = focusedLine else { return }
      collectionView.layoutIfNeeded()
      revealCaret(of: line, animated: false)
    }

    public override func viewDidLayoutSubviews() {
      super.viewDidLayoutSubviews()
      followKeyboard()
    }

    /// Draws a page that is not edited. A row that is the same as before is left alone, one whose content or status
    /// changed is reconfigured in place, and the scroll position is kept. The first call, and the first for another
    /// page, do not animate.
    public func show(page: Page, in workspace: Workspace) {
      finishEditing()
      editedPage = nil
      heldReplace = nil
      shownPage = page
      let rows = BlockRows.rows(
        for: Document.blocks(page.document), in: workspace, facts: factsSource(in: workspace, pageDate: page.date))
      draw(rows, pageID: page.id, pageDate: page.date, in: workspace, editable: [])
    }

    /// What the rows' facts are read with now: nil without a today. The index is built again only for another
    /// workspace; a workspace value handed on unchanged compares by its storage, at no cost.
    private func factsSource(in workspace: Workspace, pageDate: LocalDate?) -> BlockRows.FactsSource? {
      guard let today else {
        factsIndex = nil
        return nil
      }
      let index: TodoIndex
      if let cached = factsIndex, cached.workspace == workspace {
        index = cached.index
      } else {
        index = TodoIndex(workspace)
        factsIndex = (workspace, index)
      }
      return BlockRows.FactsSource(today: today, pageDate: pageDate, index: index)
    }

    /// Today changed: the page is drawn again in the workspace it was drawn in, and only the rows whose facts changed
    /// are redrawn, in place (`draw`).
    private func drawAgainForToday() {
      guard let workspace, let pageID = shownPageID else { return }
      if editedPage != nil {
        // A line's resign is under way: its draw, once the line has let the keyboard go, reads the new today.
        guard redrawAfterResign == nil else { return }
        // The row being composed in is pinned with the facts it had: they are drawn when the composition ends.
        if isComposing { composingRowFactsAreStale = true }
        redraw(pageID: pageID, pageDate: pageDate, in: workspace)
      } else if let shownPage {
        show(page: shownPage, in: workspace)
      }
    }

    /// Shows a page for editing. `page` is the workspace's (the draft's document when it has one). The page that is
    /// being edited, given again, is a change from outside, as `replace`; unless `afresh`: then it is another page with
    /// the same id (another account's), and what he composed is committed into the one before first.
    public func edit(page: Page, in workspace: Workspace, afresh: Bool = false) {
      if !afresh, editedPage != nil, page.id == shownPageID {
        replace(document: page.document, in: workspace)
        return
      }
      finishEditing()
      editedPage = EditablePage(document: page.document, pageDate: page.date)
      shownPage = nil
      heldReplace = nil
      redraw(pageID: page.id, pageDate: page.date, in: workspace)
    }

    /// Before another page: what he composed is committed into the page it was composed in, and reported for it,
    /// nothing deferred lands in a line afterwards, and the keyboard is put away, so nothing of this page is read into
    /// the next.
    private func finishEditing() {
      guard editedPage != nil else { return }
      leavingPage = true
      for line in lines where line.markedTextRange != nil { line.unmarkText() }
      leavingPage = false
      for line in lines { line.cancelPendingReplacement() }
      // The next page is drawn by the caller; this one is not drawn again as the keyboard goes.
      redrawAfterResign = nil
      collectionView.endEditing(true)
      redrawAfterResign = nil
      // The next page is drawn afresh, with every row's facts.
      composingRowFactsAreStale = false
      // Its line was not found to commit (its cell had gone): the composition ends with nothing read.
      if composingRow != nil {
        composingRow = nil
        onComposingChange?(false)
      }
    }

    /// Commits the marked text of the line that holds it, in place: the caret and the keyboard stay, the committed
    /// words are reported through `onChange` once. Nothing when no line composes.
    ///
    /// The host calls it before it sends a change the page must not be under while words are only composed (a row
    /// action, §11.4 step 1). The commit takes the keyboard's own path (`unmarkText`), so a change held meanwhile is
    /// merged as it would be then.
    public func commitComposition() {
      guard isComposing else { return }
      for line in lines where line.markedTextRange != nil { line.unmarkText() }
      // The marked text can end without the line being told (an edit of its text outside the input system): the
      // composing row's line is read as a commit is. With no line to read, the composition ends with nothing read,
      // as in `finishEditing`. Either way the host never sends a change over a page still composing.
      if let id = composingRow, let line = lineView(for: id), line.markedTextRange == nil { read(line) }
      if composingRow != nil {
        composingRow = nil
        // The page already is the latest from outside; drawn again, the row that was pinned is drawn from it.
        if let held = heldReplace, let pageID = shownPageID {
          heldReplace = nil
          redraw(pageID: pageID, pageDate: pageDate, in: held.workspace)
        } else {
          drawStaleFactsNow()
        }
        onComposingChange?(false)
      }
    }

    /// Replaces the page from outside (a merge, a load) keeping the caret where its line still exists. When its row is
    /// not in the new page, the caret goes to the end of the nearest line above that is (or to the start of the first
    /// line), and the keyboard stays up (`draw`). While he composes, every row but the composing one is drawn from it at once; that row's part waits until the
    /// composition ends, when his composed words and this page are merged (`commitHeld`).
    public func replace(document: String, in workspace: Workspace) {
      guard let editedPage, let pageID = shownPageID else { return }
      // A line's resign is under way and its merge is drawn once the line has let the keyboard go: drawn now, this
      // page would be drawn over by that draw's older workspace. It is that draw's page and workspace instead.
      if redrawAfterResign != nil {
        self.editedPage = replacing(editedPage, with: document)
        redrawAfterResign?.workspace = workspace
        return
      }
      if isComposing {
        heldReplace = (heldReplace?.base ?? editedPage.document, document, workspace)
      }
      self.editedPage = replacing(editedPage, with: document)
      redraw(pageID: pageID, pageDate: pageDate, in: workspace)
    }

    /// The page made from `document` in place of `page`. It still names the rows he removed one at a time that it
    /// does not hold, so a redraw that is not about his words (a tick) does not take them out of the next save.
    private func replacing(_ page: EditablePage, with document: String) -> EditablePage {
      var next = EditablePage(document: document, pageDate: pageDate)
      next.carryRemovedRows(page.singleDeleteIds)
      return next
    }

    /// Draws the page being edited from its blocks. The row being composed in stays as it is on screen, where it was,
    /// whatever the page now holds for it.
    private func redraw(pageID: String, pageDate: LocalDate?, in workspace: Workspace) {
      guard let editedPage else { return }
      var rows = BlockRows.rows(
        for: editedPage.blocks, in: workspace, facts: factsSource(in: workspace, pageDate: pageDate))
      var editable = editedPage.isReadable ? Set(editedPage.textBlocks) : []
      let pinned = composingRow.flatMap { id in rowsByID[id].map { (id: id, row: $0) } }
      if let pinned {
        if let index = rows.firstIndex(where: { $0.id == pinned.id }) {
          rows[index] = pinned.row
        } else {
          // After the nearest row above it that is still there.
          let above = orderedIDs.prefix { $0 != pinned.id }.reversed().first { id in rows.contains { $0.id == id } }
          let index = above.flatMap { id in rows.firstIndex { $0.id == id } }.map { $0 + 1 } ?? 0
          rows.insert(pinned.row, at: index)
        }
        editable.insert(pinned.id)
      }
      // Every row, the one composed in included, is drawn from this page and today.
      if pinned == nil { composingRowFactsAreStale = false }
      draw(rows, pageID: pageID, pageDate: pageDate, in: workspace, editable: editable, pinned: pinned?.id)
    }

    /// `pinned`: a row that is not redrawn, however the page or the workspace draws it now.
    private func draw(
      _ rows: [BlockRow], pageID: String, pageDate: LocalDate?, in workspace: Workspace, editable: Set<String>,
      pinned: String? = nil
    ) {
      var newRows: [String: BlockRow] = [:]
      var newDrawn: [String: AttributedString] = [:]
      for row in rows {
        newRows[row.id] = row
        switch row.kind {
        case .text, .todo:
          // A line that is edited is drawn by its runs, a chip one position wide; one that is only shown as 1a drew it.
          newDrawn[row.id] =
            row.id == pinned
            ? drawn[row.id]
            : editable.contains(row.id)
              ? InlineAttributedText.make(InlineContent(row.content), pageDate: pageDate, in: workspace)
              : InlineAttributedText.make(row.content, pageDate: pageDate, in: workspace)
        case .separator, .placeholder: break
        }
      }
      let ids = rows.map(\.id)
      let changed = ids.filter {
        $0 != pinned && rowsByID[$0] != nil
          && (rowsByID[$0] != newRows[$0] || drawn[$0] != newDrawn[$0]
            || editableIDs.contains($0) != editable.contains($0))
      }
      self.pageDate = pageDate
      self.workspace = workspace
      editableIDs = editable
      if pageID == shownPageID, changed.isEmpty, ids == orderedIDs { return }

      let focus = focusedLine.flatMap { line in line.rowID.map { (id: $0, selection: line.selectedRange) } }
      // The row holding the caret is not in the new page (the server moved its to-do to another day): where the
      // caret goes instead, and that line's text view while the list still shows the rows as they were.
      let leaving = focus.flatMap { newRows[$0.id] == nil ? $0.id : nil }
      let successor = leaving.flatMap { Self.caret(afterLeaving: $0, from: orderedIDs, to: ids, editable: editable) }
      let successorLine = successor.flatMap { lineView(for: $0.row) }
      let oldRows = rowsByID
      rowsByID = newRows
      drawn = newDrawn
      orderedIDs = ids
      var snapshot = NSDiffableDataSourceSnapshot<Section, String>()
      snapshot.appendSections([.main])
      snapshot.appendItems(ids)
      // A reconfigure must get the same kind of cell back; a row that now needs another gets a fresh one.
      let (reloaded, reconfigured) = changed.reduce(into: ([String](), [String]())) { split, id in
        let sameCell = oldRows[id].map { CellKind($0.kind) } == newRows[id].map { CellKind($0.kind) }
        if sameCell { split.1.append(id) } else { split.0.append(id) }
      }
      snapshot.reconfigureItems(reconfigured)
      snapshot.reloadItems(reloaded)
      // Another page (another day) is not a diff of the one before: animated, its rows would slide in as the old
      // ones slide out. Redraws of the same page animate, so a tick's symbol transition plays.
      let animated = pageID == shownPageID
      shownPageID = pageID
      appliedAnimated.append(animated)
      redrawnRows = changed
      // A reconfigured row keeps its cell, and its text view the caret; a reloaded one has a new cell to give it to,
      // and the keyboard is held meanwhile.
      let rebuilt = focus.map { reloaded.contains($0.id) } == true
      if rebuilt, let line = focusedLine { holdKeyboard(from: line) }
      // The list resigns a first responder in a cell it takes away, and with no other the keyboard goes down: the
      // keyboard leaves the row before the row leaves the list. Straight to the caret's line when the list shows it
      // and keeps its cell, else held until that line is in the list; with no line left, given up first.
      if leaving != nil, let line = focusedLine {
        if let successor {
          let handed =
            !reloaded.contains(successor.row) && successorLine.map { $0.isEditable && $0.becomeFirstResponder() } == true
          if !handed { holdKeyboard(from: line) }
        } else {
          line.resignFirstResponder()
        }
      }
      dataSource.apply(snapshot, animatingDifferences: animated)
      if let focus, rebuilt {
        place(caretIn: focus.id, selection: focus.selection)
        releaseKeyboardHold()
      }
      if let successor {
        place(caretIn: successor.row, selection: successor.selection)
        releaseKeyboardHold()
      }
    }

    /// Where the caret goes when its row `id` leaves the page: the end of the nearest line above it in the order on
    /// screen before (as for the pinned row in `redraw`) that is still on the page and takes a caret, wherever the new
    /// page puts it; with none, the start of the new page's first line that takes one; nil when no line takes a caret.
    private static func caret(
      afterLeaving id: String, from before: [String], to after: [String], editable: Set<String>
    ) -> (row: String, selection: NSRange)? {
      let remaining = Set(after).intersection(editable)
      if let line = before.prefix(while: { $0 != id }).reversed().first(where: remaining.contains) {
        return (line, NSRange(location: Int.max, length: 0))
      }
      return after.first(where: remaining.contains).map { ($0, NSRange(location: 0, length: 0)) }
    }

    /// A text view of the screen's own, out of sight, that holds the keyboard while the row that had it is rebuilt or
    /// removed: the list resigns a first responder in a cell it takes away, and with no other the keyboard goes down
    /// and comes up again. Moving it straight from line to line keeps it up.
    private lazy var keyboardHolder: UITextView = {
      let holder = UITextView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
      holder.alpha = 0
      holder.isScrollEnabled = false
      holder.isAccessibilityElement = false
      holder.accessibilityElementsHidden = true
      collectionView.addSubview(holder)
      return holder
    }()

    private func holdKeyboard(from line: LineTextView) {
      guard line.isFirstResponder else { return }
      // Where the line is, so a list that scrolls its first responder into view has nothing to scroll to.
      keyboardHolder.frame = line.convert(line.bounds, to: collectionView)
      Self.takeKeyboard(of: line, to: keyboardHolder)
      keyboardHolder.becomeFirstResponder()
    }

    /// Everything that decides which keyboard a text view shows, from `line` to `holder`, so the keyboard does not
    /// change while it is held.
    private static func takeKeyboard(of line: UITextView, to holder: UITextView) {
      holder.autocapitalizationType = line.autocapitalizationType
      holder.autocorrectionType = line.autocorrectionType
      holder.spellCheckingType = line.spellCheckingType
      holder.smartQuotesType = line.smartQuotesType
      holder.smartDashesType = line.smartDashesType
      holder.smartInsertDeleteType = line.smartInsertDeleteType
      holder.inlinePredictionType = line.inlinePredictionType
      holder.mathExpressionCompletionType = line.mathExpressionCompletionType
      holder.writingToolsBehavior = line.writingToolsBehavior
      holder.allowedWritingToolsResultOptions = line.allowedWritingToolsResultOptions
      holder.keyboardType = line.keyboardType
      holder.keyboardAppearance = line.keyboardAppearance
      holder.returnKeyType = line.returnKeyType
      holder.enablesReturnKeyAutomatically = line.enablesReturnKeyAutomatically
      holder.isSecureTextEntry = line.isSecureTextEntry
      holder.textContentType = line.textContentType
      holder.passwordRules = line.passwordRules
      holder.inputView = line.inputView
      holder.inputAccessoryView = line.inputAccessoryView
    }

    /// The hold ends: a line has taken the keyboard, or, when none could, it goes down.
    private func releaseKeyboardHold() {
      if keyboardHolder.isFirstResponder { keyboardHolder.resignFirstResponder() }
    }

    /// The number of rows the list holds (tests and accessibility use it; nothing else does).
    var itemCount: Int { collectionView.numberOfItems(inSection: 0) }

    private func makeDataSource() -> UICollectionViewDiffableDataSource<Section, String> {
      let text = UICollectionView.CellRegistration<TextBlockCell, String> { [weak self] cell, _, id in
        guard let self, let row = self.rowsByID[id], case .text(let style) = row.kind else { return }
        cell.configure(
          style: style, depth: row.depth, text: self.drawn[id] ?? AttributedString(),
          editable: self.editableIDs.contains(id), rowID: id, delegate: self.lineInput)
      }
      let todo = UICollectionView.CellRegistration<TodoBlockCell, String> { [weak self] cell, _, id in
        guard let self, let row = self.rowsByID[id], case .todo(let taskId, let status, _, let facts) = row.kind else {
          return
        }
        cell.configure(
          status: status, facts: facts, canBeTicked: row.canBeTicked, dimmed: id == self.actingRow, depth: row.depth,
          text: self.drawn[id] ?? AttributedString(),
          editable: self.editableIDs.contains(id), rowID: id, taskId: taskId, delegate: self.lineInput,
          onTick: { [weak self] in self?.onTick?(taskId) },
          onRowAction: { [weak self] kind in self?.reportRowAction(kind, row: id, taskId: taskId) ?? false })
      }
      let separator = UICollectionView.CellRegistration<SeparatorBlockCell, String> { [weak self] cell, _, id in
        cell.configure(depth: self?.rowsByID[id]?.depth ?? 0)
      }
      let placeholder = UICollectionView.CellRegistration<PlaceholderBlockCell, String> { [weak self] cell, _, id in
        guard let self, let row = self.rowsByID[id], case .placeholder(let name) = row.kind else { return }
        cell.configure(name: name, depth: row.depth)
      }
      let dataSource = UICollectionViewDiffableDataSource<Section, String>(collectionView: collectionView) {
        [weak self] collectionView, indexPath, id in
        switch self?.rowsByID[id].map({ CellKind($0.kind) }) {
        case .text: collectionView.dequeueConfiguredReusableCell(using: text, for: indexPath, item: id)
        case .todo: collectionView.dequeueConfiguredReusableCell(using: todo, for: indexPath, item: id)
        case .placeholder: collectionView.dequeueConfiguredReusableCell(using: placeholder, for: indexPath, item: id)
        case .separator, nil: collectionView.dequeueConfiguredReusableCell(using: separator, for: indexPath, item: id)
        }
      }
      let header = UICollectionView.SupplementaryRegistration<HeaderContainer>(
        elementKind: UICollectionView.elementKindSectionHeader
      ) { [weak self] container, _, _ in
        container.hold(self?.headerView)
      }
      dataSource.supplementaryViewProvider = { collectionView, _, indexPath in
        collectionView.dequeueConfiguredReusableSupplementary(using: header, for: indexPath)
      }
      return dataSource
    }
  }

  // MARK: - Typing

  /// Hears the lines' text views for the screen, so their delegate methods are not part of its public face.
  @MainActor
  private final class LineInput: NSObject, LineTextViewDelegate {
    weak var screen: DocumentViewController?

    init(_ screen: DocumentViewController) {
      self.screen = screen
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
      guard let line = textView as? LineTextView else { return true }
      return screen?.line(line, shouldReplace: range, with: text) ?? true
    }

    func textViewDidChange(_ textView: UITextView) {
      guard let line = textView as? LineTextView else { return }
      screen?.lineTextDidChange(line)
    }

    func lineTextViewMarkedTextDidChange(_ line: LineTextView) {
      screen?.lineTextDidChange(line)
    }

    func lineTextViewDidGiveUpKeyboard(_ line: LineTextView) {
      screen?.lineDidGiveUpKeyboard(line)
    }

    func lineTextViewKeptKeyboard(_ line: LineTextView) {
      screen?.lineKeptKeyboard(line)
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
      guard let line = textView as? LineTextView else { return }
      screen?.lineSelectionDidChange(line)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      guard let line = textView as? LineTextView else { return }
      screen?.lineSelectionDidChange(line)
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      guard let line = textView as? LineTextView else { return }
      screen?.lineDidEndEditing(line)
    }

    func lineTextView(_ line: LineTextView, didPress key: EditablePage.Key) -> Bool {
      screen?.line(line, didPress: key) ?? false
    }

    func lineTextView(_ line: LineTextView, canMoveCaret direction: LineTextView.Direction) -> Bool {
      screen?.row(after: line, going: direction) != nil
    }

    func lineTextView(_ line: LineTextView, moveCaret direction: LineTextView.Direction, near point: CGPoint) {
      screen?.moveCaret(from: line, going: direction, near: point)
    }

    func lineTextViewHasRowMenu(_ line: LineTextView) -> Bool {
      screen?.hasRowMenu(line) ?? false
    }

    func lineTextViewShowRowMenu(_ line: LineTextView) {
      screen?.showRowMenu(line)
    }
  }

  /// Hears taps on the list for the screen: only one in the empty space under the last row is its.
  @MainActor
  private final class TapsUnderLines: NSObject, UIGestureRecognizerDelegate {
    weak var screen: DocumentViewController?

    init(_ screen: DocumentViewController) {
      self.screen = screen
    }

    func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
      guard let screen, let list = recognizer.view else { return false }
      return screen.takesTapUnderTheLastLine(at: recognizer.location(in: list))
    }

    @objc func tapped(_ recognizer: UITapGestureRecognizer) {
      guard let screen, let list = recognizer.view, recognizer.state == .ended else { return }
      screen.tapUnderTheLastLine(at: recognizer.location(in: list))
    }
  }

  extension DocumentViewController {
    /// A newline never enters a line: Return is a key of the page's (`line(_:didPress:)`), and the line breaks of
    /// words that come in otherwise (pasted, dropped) become spaces.
    fileprivate func line(_ line: LineTextView, shouldReplace range: NSRange, with text: String) -> Bool {
      let key: EditablePage.Key? = LineTextView.isReturn(text) ? .returnKey : (text == "\t" ? .tab : nil)
      if let key {
        if line.markedTextRange == nil { _ = self.line(line, didPress: key) }
        return false
      }
      guard LineTextView.needsCleaning(text) else { return true }
      let words = LineTextView.cleaned(text)
      if !(words.isEmpty && range.length == 0) { line.replaceSoon(range, with: words) }
      return false
    }

    /// The text view's text changed, typed, composed or committed: the words are read when they are his, and then
    /// the row's height follows the text.
    fileprivate func lineTextDidChange(_ line: LineTextView) {
      read(line)
      (line.superview as? LineBlockCell)?.lineTextDidChange()
    }

    fileprivate func lineSelectionDidChange(_ line: LineTextView) {
      setTypingAttributes(of: line)
      revealCaret(of: line)
    }

    /// A key that changes the page's structure, at the caret in `line`: the page decides what it does (`press`), the
    /// rows that changed are drawn again, the caret goes where the page put it, and the change is reported once. While
    /// text is marked no key is the page's: Return only commits (`LineTextView.insertText`), Backspace edits the marked
    /// text, Tab does nothing. True when the key was taken; Return and Tab always are, so neither is typed.
    fileprivate func line(_ line: LineTextView, didPress key: EditablePage.Key) -> Bool {
      let taken = key != .backspace
      guard line.markedTextRange == nil, line.isEditable, let id = line.rowID, editableIDs.contains(id) else {
        return taken
      }
      // Words pasted and waiting for the run loop's next turn, and words on screen the page has not read yet (an
      // autocorrection, say), are the page's before the key is; with it, they are one change.
      let hadKeyboard = line.isFirstResponder
      let pasted = holdingReports { line.applyPendingReplacement() }
      // The pasted words may have made a shortcut and drawn the rows again, the keyboard going to another line: the
      // key belonged to the line as it was, and does nothing more.
      guard line.rowID == id, editableIDs.contains(id), line.isFirstResponder || !hadKeyboard else {
        if pasted { report() }
        return true
      }
      let read = absorb(line) != nil || pasted
      guard var page = editedPage, let workspace, let pageID = shownPageID else { return taken }
      var selection = line.selectedRange
      if key == .returnKey, selection.length > 0 {
        // Return over a selection replaces it, as on the web: the selected words go, then the line splits.
        _ = page.replaceText(in: id, range: selection.location..<NSMaxRange(selection), with: "")
        selection.length = 0
      }
      guard let caret = page.press(key, at: EditablePage.Caret(block: id, offset: selection.location)) else {
        if read { report() }
        return taken
      }
      editedPage = page
      // Nesting keeps the selection in its words; the other keys leave a caret.
      let kept = key == .tab || key == .shiftTab ? selection.length : 0
      restructure(from: line, caret: caret, selectionLength: kept, pageID: pageID, workspace: workspace)
      report()
      return true
    }

    /// The page's rows changed under the line being typed in: the page is drawn again and the caret goes to `caret`.
    ///
    /// The keyboard stays up. The list resigns the first responder of a row it removes or reloads, and the keyboard
    /// goes down for want of another, so the line typed in never holds it when its row goes: the caret's row takes it
    /// first, before the list changes, when it has a cell already (a join); when the key made that row (a divider's
    /// new paragraph), the keyboard is held (`holdKeyboard`) until it is in the list. A row that stays (a split) keeps
    /// the keyboard until the new row takes it after the snapshot; one rebuilt as another kind is `draw`'s.
    ///
    /// The text views' own undo is emptied, so a shake or Command-Z cannot put a line's old words back over the new
    /// rows.
    private func restructure(
      from line: LineTextView, caret: EditablePage.Caret, selectionLength: Int, pageID: String, workspace: Workspace
    ) {
      let selection = NSRange(location: caret.offset, length: selectionLength)
      let leaving =
        line.rowID.map { id in
          editedPage.map { page in BlockRows.rows(for: page.blocks, in: workspace).contains { $0.id == id } } == false
        } ?? false
      if caret.block != line.rowID, let target = lineView(for: caret.block), target.isEditable {
        target.becomeFirstResponder()
      } else if leaving {
        holdKeyboard(from: line)
      }
      redraw(pageID: pageID, pageDate: pageDate, in: workspace)
      place(caretIn: caret.block, selection: selection)
      releaseKeyboardHold()
      line.undoManager?.removeAllActions()
      focusedLine?.undoManager?.removeAllActions()
    }

    private func report() {
      guard let editedPage else { return }
      if reportsHeld {
        reportWasHeld = true
        return
      }
      onChange?(editedPage.document, editedPage.singleDeleteIds)
    }

    /// Runs `body` without reporting a change; true when it made one, for the caller to report with its own.
    private func holdingReports(_ body: () -> Void) -> Bool {
      reportsHeld = true
      reportWasHeld = false
      defer { reportsHeld = false }
      body()
      return reportWasHeld
    }

    /// A line that loses the keyboard is no longer composing. Its commit is read here when the text view did not
    /// report it otherwise.
    fileprivate func lineDidEndEditing(_ line: LineTextView) {
      if let id = line.rowID, id == composingRow, line.markedTextRange == nil { read(line) }
    }

    /// Reads a line's words into the page once they are his: not while text is marked, and once when the composition
    /// ends, merged then with what arrived from outside meanwhile. A change is reported.
    private func read(_ line: LineTextView) {
      guard let id = line.rowID, editableIDs.contains(id), editedPage != nil else { return }
      if line.markedTextRange != nil {
        let began = composingRow == nil
        composingRow = id
        if began { onComposingChange?(true) }
        return
      }
      guard composingRow == id else {
        if absorb(line) != nil { report() }
        return
      }
      composingRow = nil
      if let held = heldReplace {
        heldReplace = nil
        commitHeld(line, in: id, held: held)
      } else {
        if absorb(line) != nil { report() }
        drawStaleFacts(after: line)
      }
      onComposingChange?(false)
    }

    /// Today changed while he composed, and the row he composed in kept the facts it had (`redraw`): now that the
    /// composition has ended, the page is drawn again, which reconfigures that row in place. A line its cell is giving
    /// up, or that is giving up the keyboard, is inside the list's own work: the draw waits for the next turn.
    private func drawStaleFacts(after line: LineTextView) {
      guard composingRowFactsAreStale, !leavingPage else { return }
      if line.isBeingReleased || line.isGivingUpKeyboard {
        perform(#selector(drawStaleFactsNow), with: nil, afterDelay: 0, inModes: [.common])
      } else {
        drawStaleFactsNow()
      }
    }

    @objc private func drawStaleFactsNow() {
      guard composingRowFactsAreStale, !isComposing, redrawAfterResign == nil, let workspace, let pageID = shownPageID
      else { return }
      redraw(pageID: pageID, pageDate: pageDate, in: workspace)
    }

    /// The line on screen is compared with what it was last synced with, around the caret, and the difference is the
    /// one change the page is given, so the page decides which run takes it; only while the page's line is still that
    /// text. When it has moved on, the screen was stale: the line is drawn again from the page and nothing is
    /// written. Returns the caret when the page changed; reports nothing.
    private func absorb(_ line: LineTextView) -> EditablePage.Caret? {
      guard let id = line.rowID, var page = editedPage, let words = page.content(of: id) else { return nil }
      let change = InlineTextStorage.change(
        from: line.syncedText, to: line.text, caret: NSMaxRange(line.selectedRange))
      if Array(words.plain.utf16) != Array(line.syncedText.utf16)
        || change.map({ LineTextView.holdsObjectReplacement($0.text) }) == true
      {
        // A token's character that came in by a way the line does not take one (a chip dragged within the line)
        // cannot be written as a chip: the line is drawn again from the page, as a stale one is.
        redrawLine(line, from: words)
        return nil
      }
      guard var change else { return nil }
      if LineTextView.needsCleaning(change.text) { change.text = flatten(change, in: line) }
      let caret = page.replaceText(in: id, range: change.range, with: change.text)
      editedPage = page
      line.syncedText = line.text
      typed(in: line, caret: caret)
      return caret
    }

    /// The composition in `id` ended with changes from outside held (`replace`). What he committed goes into the page
    /// as it was when the first of them arrived, and that is merged with the latest: neither replaces the other. A
    /// row the outside change removed gets his words back by the merge's rule for a line deleted on the server and
    /// changed by him. Reported once, when he committed anything.
    ///
    /// The caret follows his words: after what he committed, in the row that holds them. That is his row when the
    /// merge kept his words there; when it put them in a row of their own (the server changed that row's words too,
    /// or deleted the to-do he wrote in), it is that row, and the keyboard goes with it.
    ///
    /// Only while the line keeps the keyboard. A composition that ends because the keyboard is going (swiped down,
    /// the host ending editing, a tap elsewhere, another page) is merged and reported, and nothing takes the keyboard
    /// back: the page is drawn once the line has let it go (`lineDidGiveUpKeyboard`), so a row that leaves the list
    /// never holds it, or not at all when another page follows.
    private func commitHeld(_ line: LineTextView, in id: String, held: (base: String, document: String, workspace: Workspace)) {
      var mine = EditablePage(document: held.base, pageDate: pageDate)
      var committed: EditablePage.Caret?
      if let change = InlineTextStorage.change(
        from: line.syncedText, to: line.text, caret: NSMaxRange(line.selectedRange)),
        let words = mine.content(of: id), Array(words.plain.utf16) == Array(line.syncedText.utf16),
        !LineTextView.holdsObjectReplacement(change.text)
      {
        committed = mine.replaceText(in: id, range: change.range, with: LineTextView.cleaned(change.text))
      }
      let merged = mergeAfterComposing(held.base, mine.document, held.document)
      // The page shown meanwhile carries the rows he removed; the merged one goes on naming them.
      editedPage = editedPage.map { replacing($0, with: merged) } ?? EditablePage(document: merged, pageDate: pageDate)
      defer { if committed != nil { report() } }
      guard shownPageID != nil, !leavingPage else { return }
      let caret = committed.flatMap { committed in
        rowHolding(wordsOf: id, in: mine, theirs: held.document).map {
          EditablePage.Caret(block: $0, offset: committed.offset)
        }
      }
      if line.isGivingUpKeyboard {
        redrawAfterResign = AfterResign(workspace: held.workspace, row: id, caret: caret)
        return
      }
      drawMerge(from: line, composedIn: id, caret: caret, in: held.workspace)
    }

    /// Draws the page after a merge his composition in `id` ended with, the caret following his words to `caret`
    /// while `line` keeps the keyboard.
    private func drawMerge(from line: LineTextView, composedIn id: String, caret: EditablePage.Caret?, in workspace: Workspace) {
      guard let pageID = shownPageID else { return }
      if line.isFirstResponder, let caret, caret.block != id {
        restructure(from: line, caret: caret, selectionLength: 0, pageID: pageID, workspace: workspace)
        return
      }
      // No row holds his words for the caret to go to and his row leaves the list: the caret goes as for any row that
      // leaves while it holds it (`draw`).
      redraw(pageID: pageID, pageDate: pageDate, in: workspace)
    }

    /// A line's resign is over: what a commit during it left to draw is drawn now that no line holds the keyboard.
    ///
    /// A line its cell is giving to another row resigns inside the list's reuse of that cell: the draw waits for the
    /// main actor's next turn. The line has the keyboard no more, so nothing he types comes between; a `replace`
    /// that does is that draw's page, as during the resign.
    fileprivate func lineDidGiveUpKeyboard(_ line: LineTextView) {
      guard redrawAfterResign != nil else { return }
      guard !line.isBeingReleased else {
        // The run loop's next turn, as a line's deferred paste (`LineTextView.replaceSoon`).
        perform(#selector(drawAfterResign), with: nil, afterDelay: 0, inModes: [.common])
        return
      }
      drawAfterResign()
    }

    @objc private func drawAfterResign() {
      guard let pending = redrawAfterResign, let pageID = shownPageID else { return }
      redrawAfterResign = nil
      redraw(pageID: pageID, pageDate: pageDate, in: pending.workspace)
    }

    /// A line's resign was refused: it still has the keyboard, so what a commit during the resign left to draw is
    /// drawn as for a line that keeps it, the caret following his words.
    fileprivate func lineKeptKeyboard(_ line: LineTextView) {
      guard let pending = redrawAfterResign else { return }
      redrawAfterResign = nil
      drawMerge(from: line, composedIn: pending.row, caret: pending.caret, in: pending.workspace)
    }

    /// The row of the page that holds `id`'s words as he has them in `mine`: `id` itself when it still does,
    /// otherwise a row the merge made for them (in neither `mine` nor `theirs`) with exactly those words.
    private func rowHolding(wordsOf id: String, in mine: EditablePage, theirs: String) -> String? {
      guard let page = editedPage, let words = mine.content(of: id)?.plain else { return nil }
      if page.content(of: id)?.plain == words { return id }
      var known: Set<String> = []
      func collect(_ blocks: [Block]) {
        for block in blocks {
          known.insert(block.id)
          collect(block.children)
        }
      }
      collect(mine.blocks)
      collect(Document.blocks(theirs))
      return page.textBlocks.first { !known.contains($0) && page.content(of: $0)?.plain == words }
    }

    /// Draws what the page made of a change typed in `line`. When only that line's words changed, the text view
    /// already shows them: nothing is redrawn, and the row only learns its words. Otherwise (a typed shortcut changed
    /// the row's kind, or made rows) the page is drawn again and the caret goes where the page put it.
    private func typed(in line: LineTextView, caret: EditablePage.Caret) {
      guard let page = editedPage, let workspace, let id = line.rowID, let pageID = shownPageID else { return }
      // Without facts: they are read from the rows' to-dos and the workspace, which a keystroke does not change, so a
      // keystroke reads no to-do's facts and the rows keep theirs.
      let rows = BlockRows.rows(for: page.blocks, in: workspace)
      let onlyItsWords =
        caret.block == id && rows.map(\.id) == orderedIDs
        && rows.allSatisfy { row in
          guard row.id == id else { return rowsByID[row.id]?.withoutFacts == row }
          return rowsByID[id].map { $0.withoutFacts.kind == row.kind && $0.depth == row.depth } ?? false
        }
      guard onlyItsWords, let row = rows.first(where: { $0.id == id }), let before = rowsByID[id] else {
        restructure(from: line, caret: caret, selectionLength: 0, pageID: pageID, workspace: workspace)
        return
      }
      rowsByID[id] = BlockRow(id: id, kind: before.kind, depth: row.depth, content: row.content)
      let words = InlineAttributedText.make(InlineContent(row.content), pageDate: pageDate, in: workspace)
      drawn[id] = words
      (line.superview as? LineBlockCell)?.wordsWereTyped(words)
      setTypingAttributes(of: line)
    }

    /// Typing takes the attributes of the run the page would put a character in at the caret, as `InlineContent`
    /// decides it: after a bold word at the end of a line it is bold, after a link it is not the link's.
    private func setTypingAttributes(of line: LineTextView) {
      guard
        line.markedTextRange == nil, let id = line.rowID, let workspace, let cell = line.superview as? LineBlockCell,
        var probe = editedPage?.content(of: id), Array(probe.plain.utf16) == Array(line.text.utf16)
      else { return }
      let offset = line.selectedRange.location
      probe.replace(offset..<offset, with: "x")
      let drawn = InlineAttributedText.make(probe, pageDate: pageDate, in: workspace)
      if let attributes = cell.typingAttributes(for: drawn, at: offset) { line.typingAttributes = attributes }
    }

    private func redrawLine(_ line: LineTextView, from words: InlineContent) {
      guard let id = line.rowID, let workspace else { return }
      let current = InlineAttributedText.make(words, pageDate: pageDate, in: workspace)
      drawn[id] = current
      (line.superview as? LineBlockCell)?.redrawWords(current)
    }

    /// Words that reached the line by a way that let a line break or a tab through go in as one line, on screen as in
    /// the page. The text view's own undo would no longer match its text, so it is cleared.
    private func flatten(_ change: (range: Range<Int>, text: String), in line: LineTextView) -> String {
      let words = LineTextView.cleaned(change.text)
      let onScreen = NSRange(location: change.range.lowerBound, length: change.text.utf16.count)
      line.textStorage.replaceCharacters(
        in: onScreen, with: NSAttributedString(string: words, attributes: line.typingAttributes))
      line.selectedRange = NSRange(location: onScreen.location + words.utf16.count, length: 0)
      line.undoManager?.removeAllActions()
      return words
    }

    /// Every line the list holds a cell for, on screen or kept by the list off it.
    private var lines: [LineTextView] {
      collectionView.subviews.compactMap { ($0 as? LineBlockCell)?.line }
    }

    /// The line whose text view has the keyboard.
    var focusedLine: LineTextView? {
      lines.first { $0.isFirstResponder }
    }

    /// Gives the keyboard to a row's line, with `selection` clamped to its words.
    private func place(caretIn id: String, selection: NSRange) {
      guard let item = orderedIDs.firstIndex(of: id) else { return }
      let indexPath = IndexPath(item: item, section: 0)
      collectionView.layoutIfNeeded()
      if collectionView.cellForItem(at: indexPath) == nil {
        collectionView.scrollToItem(at: indexPath, at: [], animated: false)
        collectionView.layoutIfNeeded()
      }
      guard let cell = collectionView.cellForItem(at: indexPath) as? LineBlockCell, cell.line.isEditable else { return }
      cell.updateConfiguration(using: cell.configurationState)
      if !cell.line.isFirstResponder { cell.line.becomeFirstResponder() }
      let length = (cell.line.text as NSString).length
      let location = min(selection.location, length)
      cell.line.selectedRange = NSRange(location: location, length: min(selection.length, length - location))
    }

    /// The text view a row's cell holds now, if the list has made one.
    private func lineView(for id: String) -> LineTextView? {
      (cell(for: id) as? LineBlockCell)?.line
    }

    /// A row's cell, if the list has made one.
    private func cell(for id: String) -> UICollectionViewCell? {
      guard let item = orderedIDs.firstIndex(of: id) else { return nil }
      return collectionView.cellForItem(at: IndexPath(item: item, section: 0))
    }

    // MARK: the row's actions

    /// Hands what he asked of row `id` (of to-do `taskId`) to the host with the row's menu as it is now, unless an
    /// action is already out, or the request is stale: a swipe, a menu or ⌘/'s menu still open keeps the items it was
    /// made with after the row is redrawn, so the row must still be there with that to-do and still offer the action
    /// (`More` while its menu holds more, the button while the row shows it). True when it was handed on.
    private func reportRowAction(_ kind: RowRequest.Kind, row id: String, taskId: String) -> Bool {
      guard actingRow == nil, let onRowAction, let row = rowsByID[id],
        case .todo(let current, _, _, let facts?) = row.kind, current == taskId, let menu = facts.menu
      else { return false }
      let offered =
        switch kind {
        case .more: !menu.more.isEmpty
        case .action(.planForTodayButton): facts.planForToday
        case .action(let action):
          menu.groups.contains { $0.items.contains { $0.action == action } } || menu.swipe.contains { $0.action == action }
        }
      guard offered else { return false }
      onRowAction(RowRequest(kind: kind, rowID: id, taskId: taskId, menu: menu))
      return true
    }

    /// A to-do row's trailing swipe: the actions the web's phone bar puts first, then `More` when the menu holds more,
    /// none on a full swipe. None on the row being typed in (the system would take the keyboard away to open it),
    /// none anywhere while words are selected (a handle dragged sideways would open one), and none while an action is
    /// out.
    fileprivate func trailingSwipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
      guard actingRow == nil, orderedIDs.indices.contains(indexPath.item) else { return nil }
      let id = orderedIDs[indexPath.item]
      guard let row = rowsByID[id], case .todo(let taskId, _, _, let facts) = row.kind, let menu = facts?.menu else {
        return nil
      }
      if let line = focusedLine, line.rowID == id || line.selectedRange.length > 0 { return nil }
      func action(_ title: String, _ kind: RowRequest.Kind) -> UIContextualAction {
        UIContextualAction(style: .normal, title: title) { [weak self] _, _, done in
          done(self?.reportRowAction(kind, row: id, taskId: taskId) ?? false)
        }
      }
      // `More` holds the rest, `Cancel task` among it.
      let actions = menu.swipe.map { action($0.title, .action($0.action)) } + (menu.more.isEmpty ? [] : [action("More", .more)])
      guard !actions.isEmpty else { return nil }
      let configuration = UISwipeActionsConfiguration(actions: actions)
      // A swipe that runs on only shows the buttons.
      configuration.performsFirstActionWithFullSwipe = false
      return configuration
    }

    /// Whether ⌘/ has the row's actions to open for `line`.
    fileprivate func hasRowMenu(_ line: LineTextView) -> Bool {
      (line.superview as? TodoBlockCell)?.hasRowMenu ?? false
    }

    fileprivate func showRowMenu(_ line: LineTextView) {
      (line.superview as? TodoBlockCell)?.presentRowMenu()
    }

    // MARK: the arrow keys

    /// The next row up or down from `line`'s that takes a caret; rows that take none (a divider, a block the app does
    /// not draw) are passed over.
    fileprivate func row(after line: LineTextView, going direction: LineTextView.Direction) -> String? {
      guard let id = line.rowID, let index = orderedIDs.firstIndex(of: id) else { return nil }
      switch direction {
      case .up: return orderedIDs[..<index].last { editableIDs.contains($0) }
      case .down: return orderedIDs[(index + 1)...].first { editableIDs.contains($0) }
      }
    }

    /// The caret goes to the next row that takes one, on its visual line nearest to `line` (its last going up, its
    /// first going down), as near to `point` across as its words allow.
    fileprivate func moveCaret(from line: LineTextView, going direction: LineTextView.Direction, near point: CGPoint) {
      guard let id = row(after: line, going: direction) else { return }
      let across = line.convert(point, to: collectionView).x
      place(caretIn: id, selection: NSRange(location: 0, length: 0))
      guard let target = lineView(for: id), target.isFirstResponder else { return }
      let edge = target.caretRect(for: direction == .up ? target.endOfDocument : target.beginningOfDocument)
      let probe = CGPoint(x: target.convert(CGPoint(x: across, y: 0), from: collectionView).x, y: edge.midY)
      guard let position = target.closestPosition(to: probe) else { return }
      target.selectedTextRange = target.textRange(from: position, to: position)
    }

    // MARK: the space under the last line

    /// Whether a point in the list is in the empty space under its last row (and under its header, so a tap on the
    /// day's header is never this).
    func takesTapUnderTheLastLine(at point: CGPoint) -> Bool {
      guard editedPage?.isReadable == true else { return false }
      let layout = collectionView.collectionViewLayout
      var end: CGFloat = 0
      if let last = orderedIDs.indices.last, let row = layout.layoutAttributesForItem(at: IndexPath(item: last, section: 0)) {
        end = row.frame.maxY
      }
      if headerView != nil,
        let header = layout.layoutAttributesForSupplementaryView(
          ofKind: UICollectionView.elementKindSectionHeader, at: IndexPath(item: 0, section: 0))
      {
        end = max(end, header.frame.maxY)
      }
      return point.y > end
    }

    /// A tap under the last row: the caret goes to the end of the last row when it takes a caret; when the page ends
    /// with a block that holds no words, or has no rows, an empty paragraph is made after it for the caret.
    func tapUnderTheLastLine(at point: CGPoint) {
      guard takesTapUnderTheLastLine(at: point) else { return }
      if let composing = focusedLine, composing.markedTextRange != nil { composing.unmarkText() }
      if let last = orderedIDs.last, editableIDs.contains(last) {
        place(caretIn: last, selection: NSRange(location: Int.max, length: 0))
        return
      }
      guard var page = editedPage, let workspace, let pageID = shownPageID, let caret = page.appendParagraph() else {
        return
      }
      editedPage = page
      redraw(pageID: pageID, pageDate: pageDate, in: workspace)
      place(caretIn: caret.block, selection: NSRange(location: caret.offset, length: 0))
      report()
    }

    // MARK: the keyboard

    /// The list follows the keyboard layout guide: the part of it the keyboard covers is inset, so its last rows can
    /// be scrolled above the keyboard, and the line being typed is brought into view.
    private func followKeyboard() {
      let list = collectionView
      let keyboardTop = list.keyboardLayoutGuide.layoutFrame.minY
      let covered = max(0, list.frameLayoutGuide.layoutFrame.maxY - keyboardTop - list.safeAreaInsets.bottom)
      guard abs(list.contentInset.bottom - covered) > 0.5 else { return }
      list.contentInset.bottom = covered
      list.verticalScrollIndicatorInsets.bottom = covered
      // Laid out as the keyboard moves, so the scroll goes with the keyboard's own animation; one of its own would be
      // cut short by it.
      if let line = focusedLine { revealCaret(of: line, animated: false) }
    }

    /// Scrolls the list just enough that the caret, with a margin, is inside what the list shows: under its top inset
    /// and above the keyboard.
    private func revealCaret(of line: LineTextView, animated: Bool = true) {
      guard line.isFirstResponder, let end = line.selectedTextRange?.end else { return }
      let list = collectionView
      let caret = line.convert(line.caretRect(for: end), to: list).insetBy(dx: 0, dy: -Self.caretMargin)
      let shown = list.bounds.inset(by: list.adjustedContentInset)
      var offset = list.contentOffset.y
      if caret.maxY > shown.maxY {
        offset += caret.maxY - shown.maxY
      } else if caret.minY < shown.minY {
        offset -= shown.minY - caret.minY
      }
      setContentOffset(clamped: offset, animated: animated)
    }

    /// Moves the list to `offset`, kept between its top (under its top inset) and its bottom (above the keyboard).
    private func setContentOffset(clamped offset: CGFloat, animated: Bool) {
      let list = collectionView
      let top = -list.adjustedContentInset.top
      let bottom = max(top, list.contentSize.height + list.adjustedContentInset.bottom - list.bounds.height)
      let offset = min(max(offset, top), bottom)
      guard abs(offset - list.contentOffset.y) > 0.5 else { return }
      list.setContentOffset(CGPoint(x: list.contentOffset.x, y: offset), animated: animated)
    }

    // MARK: the header

    /// Scrolls the list so the row's top is at the top of what the list shows (under its top inset), as far as its
    /// content allows. False, and nothing moves, when the list has no row of that id. `rowID` is a row's id.
    @discardableResult public func scroll(toRow rowID: String, animated: Bool) -> Bool {
      guard let item = orderedIDs.firstIndex(of: rowID) else { return false }
      let list = collectionView
      let indexPath = IndexPath(item: item, section: 0)
      list.layoutIfNeeded()
      // The rows between are measured only once they are laid out, so a row far off reads where their estimates put
      // it: after the move it is read again, and the list moved again by what the measuring changed.
      for _ in 0..<(animated ? 1 : 3) {
        guard let row = list.layoutAttributesForItem(at: indexPath) else { return true }
        let before = list.contentOffset.y
        setContentOffset(clamped: row.frame.minY - list.adjustedContentInset.top, animated: animated)
        guard !animated else { break }
        list.layoutIfNeeded()
        if abs(list.contentOffset.y - before) <= 0.5 { break }
      }
      return true
    }
  }

  /// Holds the host's header view edge to edge, passing the list's margins on so the header lines up with the rows.
  private final class HeaderContainer: UICollectionReusableView {
    override init(frame: CGRect) {
      super.init(frame: frame)
      preservesSuperviewLayoutMargins = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func hold(_ view: UIView?) {
      for subview in subviews where subview !== view { subview.removeFromSuperview() }
      guard let view, view.superview !== self else { return }
      view.removeFromSuperview()
      view.translatesAutoresizingMaskIntoConstraints = false
      view.preservesSuperviewLayoutMargins = true
      addSubview(view)
      NSLayoutConstraint.activate([
        view.topAnchor.constraint(equalTo: topAnchor),
        view.leadingAnchor.constraint(equalTo: leadingAnchor),
        view.trailingAnchor.constraint(equalTo: trailingAnchor),
        view.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
    }
  }
#endif
