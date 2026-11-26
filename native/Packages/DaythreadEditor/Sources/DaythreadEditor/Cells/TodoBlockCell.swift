#if canImport(UIKit)
  import UIKit
  import DaythreadCore

  /// A to-do: the system's checkmark symbol and its title; a finished one is dimmed and struck through.
  final class TodoBlockCell: BlockCell {
    private var status: TodoTask.Status?
    /// The SF Symbol drawn at the leading edge.
    private(set) var symbolName = "circle"
    private var text = AttributedString()

    /// The circle. It is the row's interactive element, so VoiceOver reads it (label and value) and not the
    /// cell.
    let circle = UIButton(type: .system)
    /// Set on every configure so a reused cell never reports an old row.
    private var onTick: (() -> Void)?

    /// The touch target is larger than the glyph, never the other way round, so a row does not grow.
    private static let minimumTouchTarget: CGFloat = 44

    private lazy var circleWidth = circle.widthAnchor.constraint(equalToConstant: Self.minimumTouchTarget)
    private lazy var circleHeight = circle.heightAnchor.constraint(equalToConstant: Self.minimumTouchTarget)
    private lazy var circleCenterX = circle.centerXAnchor.constraint(equalTo: leadingAnchor)
    private var glyphSlotWidth: CGFloat = 0

    /// The system's own side margin for a list row.
    private static let margin = UIListContentConfiguration.cell().directionalLayoutMargins.leading

    override init(frame: CGRect) {
      super.init(frame: frame)
      circle.translatesAutoresizingMaskIntoConstraints = false
      // On the cell, so the indent is the cell's own and not the system's for its content view.
      addSubview(circle)
      NSLayoutConstraint.activate([
        circleWidth, circleHeight, circleCenterX, circle.centerYAnchor.constraint(equalTo: centerYAnchor),
      ])
      // A disabled control still sends actions to `sendActions(for:)`; a to-do that cannot be ticked reports nothing.
      circle.addAction(
        UIAction { [weak self] _ in
          if self?.circle.isEnabled == true { self?.onTick?() }
        }, for: .primaryActionTriggered)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func indentationDidChange() {
      circleCenterX.constant = Self.margin + indentation + glyphSlotWidth / 2
    }

    func configure(
      status: TodoTask.Status?, canBeTicked: Bool, depth: Int, text: AttributedString, onTick: @escaping () -> Void
    ) {
      self.status = status
      symbolName = Self.symbol(for: status)
      self.text = text
      self.onTick = onTick
      circle.isEnabled = canBeTicked
      setDepth(depth)
      isAccessibilityElement = false
      accessibilityElements = [circle]
      circle.accessibilityLabel = "Complete " + String(text.characters)
      circle.accessibilityValue =
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

      let symbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body, scale: .medium)
      let symbol = UIImage(systemName: symbolName)
      let tint: UIColor = finished ? .tintColor : .secondaryLabel
      var button = UIButton.Configuration.plain()
      button.image = symbol
      button.preferredSymbolConfigurationForImage = symbolConfiguration
      button.contentInsets = .zero
      // A circle that cannot be ticked looks as it does for its status; the system must not grey it further.
      button.imageColorTransformer = UIConfigurationColorTransformer { _ in tint }
      button.symbolContentTransition = UISymbolContentTransition(.replace)
      circle.configuration = button

      // The text starts where it did when the glyph was the content's image; the button is centered on that
      // glyph and reaches past it to its touch target.
      let glyph = symbol?.withConfiguration(symbolConfiguration).size ?? .zero
      // A list row gave its image a box 4 points wider than the glyph (measured: 24 for the 20-point glyph at
      // the default text size), and the text started after it.
      glyphSlotWidth = glyph.width.rounded(.up) + 4
      var padded = content
      padded.directionalLayoutMargins.leading += glyphSlotWidth + content.imageToTextPadding
      contentConfiguration = padded
      circleWidth.constant = max(Self.minimumTouchTarget, glyphSlotWidth)
      circleHeight.constant = max(Self.minimumTouchTarget, glyph.height)
      indentationDidChange()
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
