#if canImport(UIKit)
  import UIKit

  /// A block this version does not draw: its name, with a dashed rectangle, in secondary colours.
  final class PlaceholderBlockCell: UICollectionViewListCell {
    private var name = ""

    func configure(name: String, depth: Int) {
      self.name = name
      indentationLevel = depth
      indentationWidth = DocumentViewController.indentationWidth
      isAccessibilityElement = true
      accessibilityLabel = name
      setNeedsUpdateConfiguration()
    }

    override func updateConfiguration(using state: UICellConfigurationState) {
      var content = defaultContentConfiguration()
      content.text = name
      content.textProperties.font = .preferredFont(forTextStyle: .body, compatibleWith: state.traitCollection)
      content.textProperties.color = .secondaryLabel
      content.textProperties.adjustsFontForContentSizeCategory = true
      content.image = UIImage(systemName: "rectangle.dashed")
      content.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body)
      content.imageProperties.tintColor = .secondaryLabel
      contentConfiguration = content
    }
  }
#endif
