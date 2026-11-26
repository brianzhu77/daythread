#if canImport(UIKit)
  import DaythreadCore
  import UIKit

  /// A page drawn from its stored document: one list row per block. A to-do's circle reports a tick (`onTick`);
  /// nothing else on the page edits.
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

    /// Called when a to-do's circle is tapped, with the to-do's id. The caller draws the result by calling
    /// `show` before it returns, and the circle is then drawn in the same turn of the run loop.
    public var onTick: ((_ taskId: String) -> Void)?

    private var rowsByID: [String: BlockRow] = [:]
    private var orderedIDs: [String] = []
    private var drawn: [String: AttributedString] = [:]
    /// The id of the page drawn last; nil before the first.
    private var shownPageID: String?
    /// Whether each snapshot `show` applied was animated, in order; a call that changes nothing applies none.
    private(set) var appliedAnimated: [Bool] = []
    var appliedSnapshots: Int { appliedAnimated.count }

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

    /// Draws `page`. A row that is the same as before is left alone, one whose content or status changed is
    /// reconfigured in place, and the scroll position is kept. The first call, and the first for another page, do not
    /// animate.
    public func show(page: Page, in workspace: Workspace) {
      let rows = BlockRows.rows(for: page, in: workspace)
      var newRows: [String: BlockRow] = [:]
      var newDrawn: [String: AttributedString] = [:]
      for row in rows {
        newRows[row.id] = row
        switch row.kind {
        case .text, .todo:
          newDrawn[row.id] = InlineAttributedText.make(row.content, pageDate: page.date, in: workspace)
        case .separator, .placeholder: break
        }
      }
      let ids = rows.map(\.id)
      let changed = ids.filter { rowsByID[$0] != nil && (rowsByID[$0] != newRows[$0] || drawn[$0] != newDrawn[$0]) }
      if page.id == shownPageID, changed.isEmpty, ids == orderedIDs { return }

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
      let animated = page.id == shownPageID
      shownPageID = page.id
      appliedAnimated.append(animated)
      dataSource.apply(snapshot, animatingDifferences: animated)
    }

    /// The number of rows the list holds (tests and accessibility use it; nothing else does).
    var itemCount: Int { collectionView.numberOfItems(inSection: 0) }

    private func makeDataSource() -> UICollectionViewDiffableDataSource<Section, String> {
      let text = UICollectionView.CellRegistration<TextBlockCell, String> { [weak self] cell, _, id in
        guard let self, let row = self.rowsByID[id], case .text(let style) = row.kind else { return }
        cell.configure(style: style, depth: row.depth, text: self.drawn[id] ?? AttributedString())
      }
      let todo = UICollectionView.CellRegistration<TodoBlockCell, String> { [weak self] cell, _, id in
        guard let self, let row = self.rowsByID[id], case .todo(let taskId, let status, _) = row.kind else { return }
        cell.configure(
          status: status, canBeTicked: row.canBeTicked, depth: row.depth, text: self.drawn[id] ?? AttributedString()
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
