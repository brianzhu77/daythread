#if canImport(UIKit)
  import UIKit

  /// What every block cell shares: how far its row is moved in by its depth. Cells take their depth only
  /// through `setDepth`, so no kind of row can forget the indent.
  class BlockCell: UICollectionViewListCell {
    /// How far the row is moved in, in points.
    final var indentation: CGFloat { CGFloat(indentationLevel) * indentationWidth }

    final func setDepth(_ depth: Int) {
      indentationLevel = depth
      indentationWidth = DocumentViewController.indentationWidth
      indentationDidChange()
    }

    /// A cell that places a view of its own (not part of its content configuration) moves it here.
    func indentationDidChange() {}
  }
#endif
