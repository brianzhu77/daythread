#if canImport(UIKit)
  import UIKit

  /// A divider: one hairline in the system's separator colour, across the list's margins.
  final class SeparatorBlockCell: BlockCell {
    private let line = UIView()
    private lazy var lineLeading = line.leadingAnchor.constraint(equalTo: leadingAnchor)

    override init(frame: CGRect) {
      super.init(frame: frame)
      line.backgroundColor = .separator
      line.translatesAutoresizingMaskIntoConstraints = false
      // On the cell, so the indent is the cell's own and not the system's for its content view.
      addSubview(line)
      NSLayoutConstraint.activate([
        lineLeading,
        line.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Self.margin),
        line.centerYAnchor.constraint(equalTo: centerYAnchor),
        line.heightAnchor.constraint(equalToConstant: 1 / max(traitCollection.displayScale, 1)),
      ])
      isAccessibilityElement = false
      indentationDidChange()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The system's own side margin for a list row.
    private static let margin = UIListContentConfiguration.cell().directionalLayoutMargins.leading

    override func indentationDidChange() {
      lineLeading.constant = Self.margin + indentation
    }

    func configure(depth: Int) {
      setDepth(depth)
    }
  }
#endif
