#if canImport(UIKit)
  import UIKit

  /// A paragraph, heading, list item or quote: its line in the system's text style for it.
  final class TextBlockCell: BlockCell {
    private var style: BlockRow.TextStyle = .paragraph
    private var text = AttributedString()
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
      setDepth(depth)
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
      if let marker = markerImage(traits: state.traitCollection) {
        content.image = marker
        content.imageProperties.tintColor = .secondaryLabel
      }
      contentConfiguration = content
      quoteBarLeading.constant = Self.defaultLeadingMargin + indentation
      bringSubviewToFront(quoteBar)
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

    /// The bullet or number, as the leading image of the row, in a column as wide as the widest number the
    /// system font would need: every item's text starts on one edge, and the marker moves with the indent
    /// like the checkmark of a to-do does.
    private func markerImage(traits: UITraitCollection) -> UIImage? {
      let text: String
      switch style {
      case .bullet: text = "•"
      case .numbered(let number): text = "\(number)."
      default: return nil
      }
      let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits)
      let width = ceil(("99." as NSString).size(withAttributes: [.font: font]).width)
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .right
      let size = CGSize(width: width, height: ceil(font.lineHeight))
      let image = UIGraphicsImageRenderer(size: size).image { _ in
        (text as NSString).draw(
          in: CGRect(origin: .zero, size: size),
          withAttributes: [.font: font, .foregroundColor: UIColor.black, .paragraphStyle: paragraph])
      }
      return image.withRenderingMode(.alwaysTemplate)
    }
  }
#endif
