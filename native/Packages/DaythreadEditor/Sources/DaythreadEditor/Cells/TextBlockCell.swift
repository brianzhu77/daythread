#if canImport(UIKit)
  import UIKit

  /// A paragraph, heading, list item or quote: its line in the system's text style for it.
  final class TextBlockCell: UICollectionViewListCell {
    private var style: BlockRow.TextStyle = .paragraph
    private var text = AttributedString()
    private var marker: (text: String, width: CGFloat)?
    private let quoteBar = UIView()
    private lazy var quoteBarLeading = quoteBar.leadingAnchor.constraint(equalTo: leadingAnchor)

    override init(frame: CGRect) {
      super.init(frame: frame)
      quoteBar.backgroundColor = .separator
      quoteBar.isHidden = true
      quoteBar.translatesAutoresizingMaskIntoConstraints = false
      // On the cell, not its content view: a content configuration replaces the content view.
      addSubview(quoteBar)
      NSLayoutConstraint.activate([
        quoteBarLeading,
        quoteBar.widthAnchor.constraint(equalToConstant: Self.quoteBarWidth),
        quoteBar.topAnchor.constraint(equalTo: topAnchor),
        quoteBar.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private static let quoteBarWidth: CGFloat = 3
    private static let defaultLeadingMargin = UIListContentConfiguration.cell().directionalLayoutMargins.leading

    func configure(style: BlockRow.TextStyle, depth: Int, text: AttributedString) {
      self.style = style
      self.text = text
      indentationLevel = depth
      indentationWidth = DocumentViewController.indentationWidth
      isAccessibilityElement = true
      accessibilityLabel = String(text.characters)
      if case .heading = style { accessibilityTraits.insert(.header) } else { accessibilityTraits.remove(.header) }
      setNeedsUpdateConfiguration()
    }

    override func updateConfiguration(using state: UICellConfigurationState) {
      var content = defaultContentConfiguration()
      let (textStyle, bold) = Self.font(for: style)
      content.attributedText = InlineAttributedText.display(
        text, textStyle: textStyle, bold: bold, compatibleWith: state.traitCollection)
      content.textProperties.adjustsFontForContentSizeCategory = true

      if case .quote = style {
        content.directionalLayoutMargins.leading += Self.quoteBarWidth + content.imageToTextPadding
        quoteBar.isHidden = false
      } else {
        quoteBar.isHidden = true
      }
      contentConfiguration = content
      quoteBarLeading.constant = Self.defaultLeadingMargin + CGFloat(indentationLevel) * indentationWidth
      bringSubviewToFront(quoteBar)
      updateMarker(traits: state.traitCollection)
    }

    private static func font(for style: BlockRow.TextStyle) -> (UIFont.TextStyle, bold: Bool) {
      switch style {
      case .heading(let level):
        switch level {
        case 1: (.title1, true)
        case 3: (.title3, true)
        default: (.title2, true)
        }
      default: (.body, false)
      }
    }

    /// The bullet or number, in a column as wide as the widest number the system font would need, so
    /// every item's text starts on the same edge.
    private func updateMarker(traits: UITraitCollection) {
      let text: String?
      switch style {
      case .bullet: text = "•"
      case .numbered(let number): text = "\(number)."
      default: text = nil
      }
      guard let text else {
        if marker != nil { accessories = [] }
        marker = nil
        return
      }
      let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits)
      let width = ceil(("99." as NSString).size(withAttributes: [.font: font]).width)
      if let marker, marker.text == text, marker.width == width { return }
      marker = (text, width)

      let label = UILabel()
      label.text = text
      label.font = font
      label.adjustsFontForContentSizeCategory = true
      label.textColor = .secondaryLabel
      label.textAlignment = .right
      label.isAccessibilityElement = false
      accessories = [
        .customView(
          configuration: .init(
            customView: label, placement: .leading(displayed: .always), reservedLayoutWidth: .custom(width)))
      ]
    }
  }
#endif
