#if canImport(UIKit)
  import UIKit
  import DaythreadCore

  /// A to-do: the system's checkmark symbol and its title; a finished one is dimmed and struck through.
  final class TodoBlockCell: BlockCell {
    private var status: TodoTask.Status?
    /// The SF Symbol drawn at the leading edge.
    private(set) var symbolName = "circle"
    private var text = AttributedString()

    func configure(status: TodoTask.Status?, depth: Int, text: AttributedString) {
      self.status = status
      symbolName = Self.symbol(for: status)
      self.text = text
      setDepth(depth)
      isAccessibilityElement = true
      accessibilityLabel = String(text.characters)
      accessibilityValue =
        switch status {
        case .done: "done"
        case .cancelled: "cancelled"
        case .open, .other, nil: "not done"
        }
      setNeedsUpdateConfiguration()
    }

    override func updateConfiguration(using state: UICellConfigurationState) {
      var content = defaultContentConfiguration()
      let finished = status == .done || status == .cancelled
      content.attributedText = InlineAttributedText.display(
        text, textStyle: .body, color: finished ? .secondaryLabel : .label, struckThrough: finished,
        compatibleWith: state.traitCollection)
      content.textProperties.adjustsFontForContentSizeCategory = true
      content.image = UIImage(systemName: symbolName)
      content.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body)
      content.imageProperties.tintColor = finished ? .tintColor : .secondaryLabel
      contentConfiguration = content
    }

    private static func symbol(for status: TodoTask.Status?) -> String {
      switch status {
      case .done: "checkmark.circle.fill"
      case .cancelled: "xmark.circle"
      case .open, .other, nil: "circle"
      }
    }
  }
#endif
