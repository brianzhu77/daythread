#if canImport(UIKit)
  import DaythreadCore
  import UIKit

  /// A page drawn from its stored document, read only: one list row per block.
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
    private var hasShownAPage = false
    /// How many snapshots `show` has applied; a call that changes nothing applies none.
    private(set) var appliedSnapshots = 0

    private lazy var collectionView: UICollectionView = {
      var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
      configuration.showsSeparators = false
      // The section's own background lies over the list's background view, where a day without a page says so; the
      // list itself is the page's background.
      configuration.backgroundColor = .clear
      let view = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: configuration))
      view.backgroundColor = .systemBackground
      view.allowsSelection = false
      view.alwaysBounceVertical = true
      return view
    }()

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
    /// reconfigured in place, and the scroll position is kept. The first call does not animate.
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
      if hasShownAPage, changed.isEmpty, ids == orderedIDs { return }

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
      let animated = hasShownAPage
      hasShownAPage = true
      appliedSnapshots += 1
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
      return UICollectionViewDiffableDataSource(collectionView: collectionView) { [weak self] collectionView, indexPath, id in
        switch self?.rowsByID[id].map({ CellKind($0.kind) }) {
        case .text: collectionView.dequeueConfiguredReusableCell(using: text, for: indexPath, item: id)
        case .todo: collectionView.dequeueConfiguredReusableCell(using: todo, for: indexPath, item: id)
        case .placeholder: collectionView.dequeueConfiguredReusableCell(using: placeholder, for: indexPath, item: id)
        case .separator, nil: collectionView.dequeueConfiguredReusableCell(using: separator, for: indexPath, item: id)
        }
      }
    }
  }
#endif
