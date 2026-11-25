#if canImport(UIKit)
  import UIKit

  /// A divider: one hairline in the system's separator colour, across the list's margins.
  final class SeparatorBlockCell: UICollectionViewListCell {
    private let line = UIView()

    override init(frame: CGRect) {
      super.init(frame: frame)
      line.backgroundColor = .separator
      line.translatesAutoresizingMaskIntoConstraints = false
      contentView.addSubview(line)
      NSLayoutConstraint.activate([
        line.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
        line.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
        line.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
        line.heightAnchor.constraint(equalToConstant: 1 / max(traitCollection.displayScale, 1)),
      ])
      isAccessibilityElement = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func configure(depth: Int) {
      indentationLevel = depth
      indentationWidth = DocumentViewController.indentationWidth
    }
  }
#endif
