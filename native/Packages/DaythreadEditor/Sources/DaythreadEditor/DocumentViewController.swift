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
    private var rowsByID: [String: BlockRow] = [:]
    private var orderedIDs: [String] = []
    private var drawn: [String: AttributedString] = [:]
    /// The rows whose words can be typed into.
    private var editableIDs: Set<String> = []
    /// The id of the page drawn last; nil before the first.
    private var shownPageID: String?
    /// The row whose text view holds marked text. What is being composed is not the document yet.
    private var composingRow: String?
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
        collectionView.setCollectionViewLayout(Self.layout(withHeader: headerView != nil), animated: false)
      }
    }

    private lazy var collectionView: UICollectionView = {
      let view = UICollectionView(frame: .zero, collectionViewLayout: Self.layout(withHeader: false))
      view.backgroundColor = .systemBackground
      view.allowsSelection = false
      view.alwaysBounceVertical = true
      // Dragging the page down puts the keyboard away.
      view.keyboardDismissMode = .interactive
      return view
    }()

    private static func layout(withHeader: Bool) -> UICollectionViewLayout {
      var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
      configuration.showsSeparators = false
      // The section's own background lies over the list's background view, where a day without a page says so; the
      // list itself is the page's background.
      configuration.backgroundColor = .clear
      configuration.headerMode = withHeader ? .supplementary : .none
      // The header is the page's first line, not a section title: no gap above it beyond its own margins.
      configuration.headerTopPadding = 0
      return UICollectionViewCompositionalLayout { _, environment in
        let section = NSCollectionLayoutSection.list(using: configuration, layoutEnvironment: environment)
        // A plain list pins its header to the top; this one is the page's first line and scrolls away with it.
        for header in section.boundarySupplementaryItems { header.pinToVisibleBounds = false }
        return section
      }
    }

    /// Lays the header out again after the host changed what it holds, which may change its height.
    public func headerDidChange() {
      guard headerView != nil else { return }
      collectionView.collectionViewLayout.invalidateLayout()
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
      draw(BlockRows.rows(for: page, in: workspace), pageID: page.id, pageDate: page.date, in: workspace, editable: [])
    }

    /// Shows a page for editing. `page` is the workspace's (the draft's document when it has one). The page that is
    /// being edited, given again, is a change from outside, as `replace`.
    public func edit(page: Page, in workspace: Workspace) {
      if editedPage != nil, page.id == shownPageID {
        replace(document: page.document, in: workspace)
        return
      }
      finishEditing()
      editedPage = EditablePage(document: page.document, pageDate: page.date)
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
      // Its line was not found to commit (its cell had gone): the composition ends with nothing read.
      if composingRow != nil {
        composingRow = nil
        onComposingChange?(false)
      }
    }

    /// Replaces the page from outside (a merge, a load) keeping the caret where its line still exists. While he
    /// composes, every row but the composing one is drawn from it at once; that row's part waits until the
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
      var rows = BlockRows.rows(for: editedPage.blocks, in: workspace)
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
      dataSource.apply(snapshot, animatingDifferences: animated)
      if let focus, rebuilt {
        place(caretIn: focus.id, selection: focus.selection)
        releaseKeyboardHold()
      }
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
        guard let self, let row = self.rowsByID[id], case .todo(let taskId, let status, _) = row.kind else { return }
        cell.configure(
          status: status, canBeTicked: row.canBeTicked, depth: row.depth, text: self.drawn[id] ?? AttributedString(),
          editable: self.editableIDs.contains(id), rowID: id, delegate: self.lineInput
        ) { [weak self] in self?.onTick?(taskId) }
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
      } else if absorb(line) != nil {
        report()
      }
      onComposingChange?(false)
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
      // No row holds his words for the caret to go to, and his row leaves the list: the keyboard is given up first,
      // so it is not taken away with the row.
      if line.isFirstResponder, !rowsOfThePage(in: workspace).contains(id) {
        line.resignFirstResponder()
      }
      redraw(pageID: pageID, pageDate: pageDate, in: workspace)
    }

    /// The ids of the rows the page being edited is drawn with.
    private func rowsOfThePage(in workspace: Workspace) -> Set<String> {
      Set((editedPage.map { BlockRows.rows(for: $0.blocks, in: workspace) } ?? []).map(\.id))
    }

    /// A line's resign is over: what a commit during it left to draw is drawn now that no line holds the keyboard.
    fileprivate func lineDidGiveUpKeyboard(_ line: LineTextView) {
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
      let rows = BlockRows.rows(for: page.blocks, in: workspace)
      let onlyItsWords =
        caret.block == id && rows.map(\.id) == orderedIDs
        && rows.allSatisfy { row in
          guard row.id == id else { return rowsByID[row.id] == row }
          return rowsByID[id].map { $0.kind == row.kind && $0.depth == row.depth } ?? false
        }
      guard onlyItsWords, let row = rows.first(where: { $0.id == id }) else {
        restructure(from: line, caret: caret, selectionLength: 0, pageID: pageID, workspace: workspace)
        return
      }
      rowsByID[id] = row
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
      guard let item = orderedIDs.firstIndex(of: id) else { return nil }
      return (collectionView.cellForItem(at: IndexPath(item: item, section: 0)) as? LineBlockCell)?.line
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
      let top = -list.adjustedContentInset.top
      let bottom = max(top, list.contentSize.height + list.adjustedContentInset.bottom - list.bounds.height)
      offset = min(max(offset, top), bottom)
      guard abs(offset - list.contentOffset.y) > 0.5 else { return }
      list.setContentOffset(CGPoint(x: list.contentOffset.x, y: offset), animated: animated)
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
