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
    /// The last change from outside that arrived while he composed, with the page as it was when the first did.
    private var heldReplace: (base: String, document: String, workspace: Workspace)?
    /// Whether each snapshot applied was animated, in order; a call that changes nothing applies none.
    private(set) var appliedAnimated: [Bool] = []
    var appliedSnapshots: Int { appliedAnimated.count }
    /// The rows the last snapshot redrew, reconfigured or reloaded, in page order.
    private(set) var redrawnRows: [String] = []
    /// The keys that change the page's structure, as they reached the screen, in order (tests read it).
    private(set) var pressedKeys: [EditablePage.Key] = []
    /// Space kept between the caret and the edge of what the list shows when the list scrolls to it.
    private static let caretMargin: CGFloat = 8
    /// A view held at the top of the keyboard layout guide, so the list is laid out again when the keyboard moves.
    private let keyboardEdge = UIView()
    private lazy var lineInput = LineInput(self)

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
    /// and the keyboard is put away, so nothing of this page is read into the next.
    private func finishEditing() {
      guard editedPage != nil else { return }
      for line in lines where line.markedTextRange != nil { line.unmarkText() }
      collectionView.endEditing(true)
      composingRow = nil
    }

    /// Replaces the page from outside (a merge, a load) keeping the caret where its line still exists. Deferred until
    /// composition ends when `isComposing`; his composed words and this page are then merged (`read`).
    public func replace(document: String, in workspace: Workspace) {
      guard let editedPage, let pageID = shownPageID else { return }
      if isComposing {
        heldReplace = (heldReplace?.base ?? editedPage.document, document, workspace)
        return
      }
      self.editedPage = EditablePage(document: document, pageDate: pageDate)
      redraw(pageID: pageID, pageDate: pageDate, in: workspace)
    }

    /// Draws the page being edited from its blocks.
    private func redraw(pageID: String, pageDate: LocalDate?, in workspace: Workspace) {
      guard let editedPage else { return }
      let editable = editedPage.isReadable ? Set(editedPage.textBlocks) : []
      draw(
        BlockRows.rows(for: editedPage.blocks, in: workspace), pageID: pageID, pageDate: pageDate, in: workspace,
        editable: editable)
    }

    private func draw(
      _ rows: [BlockRow], pageID: String, pageDate: LocalDate?, in workspace: Workspace, editable: Set<String>
    ) {
      var newRows: [String: BlockRow] = [:]
      var newDrawn: [String: AttributedString] = [:]
      for row in rows {
        newRows[row.id] = row
        switch row.kind {
        case .text, .todo:
          // A line that is edited is drawn by its runs, a chip one position wide; one that is only shown as 1a drew it.
          newDrawn[row.id] =
            editable.contains(row.id)
            ? InlineAttributedText.make(InlineContent(row.content), pageDate: pageDate, in: workspace)
            : InlineAttributedText.make(row.content, pageDate: pageDate, in: workspace)
        case .separator, .placeholder: break
        }
      }
      let ids = rows.map(\.id)
      let changed = ids.filter {
        rowsByID[$0] != nil
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
      dataSource.apply(snapshot, animatingDifferences: animated)
      // A reconfigured row keeps its cell, and its text view the caret; a reloaded one has a new cell to give it to.
      if let focus, reloaded.contains(focus.id) { place(caretIn: focus.id, selection: focus.selection) }
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

    func textViewDidBeginEditing(_ textView: UITextView) {
      guard let line = textView as? LineTextView else { return }
      screen?.lineSelectionDidChange(line)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      guard let line = textView as? LineTextView else { return }
      screen?.lineSelectionDidChange(line)
    }

    func lineTextView(_ line: LineTextView, didPress key: EditablePage.Key) -> Bool {
      screen?.line(line, didPress: key) ?? false
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

    /// The keys that change the page's structure. None is taken yet: Return is refused, so a line never holds a
    /// newline, and Backspace at the start of a line and Tab do nothing.
    fileprivate func line(_ line: LineTextView, didPress key: EditablePage.Key) -> Bool {
      pressedKeys.append(key)
      return false
    }

    /// Reads a line's words into the page once they are his: not while text is marked, and once when the composition
    /// ends. The line on screen is compared with what it was last synced with, around the caret, and the difference is
    /// the one change the page is given, so the page decides which run takes it; only while the page's line is still
    /// that text. When it has moved on, the screen was stale: the line is drawn again from the page and nothing is
    /// written.
    private func read(_ line: LineTextView) {
      guard let id = line.rowID, editableIDs.contains(id), var page = editedPage else { return }
      if line.markedTextRange != nil {
        composingRow = id
        return
      }
      if composingRow == id { composingRow = nil }
      guard let words = page.content(of: id) else { return }
      var caret: EditablePage.Caret?
      let change = InlineTextStorage.change(
        from: line.syncedText, to: line.text, caret: NSMaxRange(line.selectedRange))
      if Array(words.plain.utf16) != Array(line.syncedText.utf16)
        || change?.text.contains(LineTextView.objectReplacement) == true
      {
        // A token's character that came in by a way the line does not take one (a chip dragged within the line)
        // cannot be written as a chip: the line is drawn again from the page, as a stale one is.
        redrawLine(line, from: words)
      } else if var change {
        if LineTextView.needsCleaning(change.text) { change.text = flatten(change, in: line) }
        caret = page.replaceText(in: id, range: change.range, with: change.text)
        editedPage = page
        line.syncedText = line.text
        if let caret { typed(in: line, caret: caret) }
      }
      if !isComposing, let held = heldReplace {
        // What arrived while he composed, merged with what he composed: neither replaces the other.
        heldReplace = nil
        let merged = PageMerge.merge(base: held.base, mine: page.document, theirs: held.document).document
        editedPage = EditablePage(document: merged, pageDate: pageDate)
        if let pageID = shownPageID { redraw(pageID: pageID, pageDate: pageDate, in: held.workspace) }
      }
      guard caret != nil, let editedPage else { return }
      onChange?(editedPage.document, editedPage.singleDeleteIds)
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
        redraw(pageID: pageID, pageDate: pageDate, in: workspace)
        place(caretIn: caret.block, selection: NSRange(location: caret.offset, length: 0))
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
