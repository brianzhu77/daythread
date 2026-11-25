#if canImport(UIKit)
  import DaythreadCore
  import UIKit

  /// A page drawn from its stored document, read only: one list row per block.
  @MainActor
  public final class DocumentViewController: UIViewController {
    /// How far each level of nesting moves a row in.
    static let indentationWidth: CGFloat = 20

    private enum Section { case main }

    private var rowsByID: [String: BlockRow] = [:]
    private var orderedIDs: [String] = []
    private var drawn: [String: AttributedString] = [:]
    private var hasShownAPage = false
    /// How many snapshots `show` has applied; a call that changes nothing applies none.
    private(set) var appliedSnapshots = 0

    private lazy var collectionView: UICollectionView = {
      var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
      configuration.showsSeparators = false
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

      rowsByID = newRows
      drawn = newDrawn
      orderedIDs = ids
      var snapshot = NSDiffableDataSourceSnapshot<Section, String>()
      snapshot.appendSections([.main])
      snapshot.appendItems(ids)
      snapshot.reconfigureItems(changed)
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
        guard let self, let row = self.rowsByID[id], case .todo(let status, _) = row.kind else { return }
        cell.configure(status: status, depth: row.depth, text: self.drawn[id] ?? AttributedString())
      }
      let separator = UICollectionView.CellRegistration<SeparatorBlockCell, String> { [weak self] cell, _, id in
        cell.configure(depth: self?.rowsByID[id]?.depth ?? 0)
      }
      let placeholder = UICollectionView.CellRegistration<PlaceholderBlockCell, String> { [weak self] cell, _, id in
        guard let self, let row = self.rowsByID[id], case .placeholder(let name) = row.kind else { return }
        cell.configure(name: name, depth: row.depth)
      }
      return UICollectionViewDiffableDataSource(collectionView: collectionView) { [weak self] collectionView, indexPath, id in
        switch self?.rowsByID[id]?.kind {
        case .text: collectionView.dequeueConfiguredReusableCell(using: text, for: indexPath, item: id)
        case .todo: collectionView.dequeueConfiguredReusableCell(using: todo, for: indexPath, item: id)
        case .placeholder: collectionView.dequeueConfiguredReusableCell(using: placeholder, for: indexPath, item: id)
        case .separator, nil: collectionView.dequeueConfiguredReusableCell(using: separator, for: indexPath, item: id)
        }
      }
    }
  }
#endif
