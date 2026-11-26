#if canImport(UIKit)
  import UIKit
  import DaythreadCore

  /// A to-do: the system's checkmark symbol and its title; a finished one is dimmed and struck through.
  final class TodoBlockCell: LineBlockCell {
    private var status: TodoTask.Status?
    /// The SF Symbol drawn at the leading edge.
    private(set) var symbolName = "circle"

    /// The circle. It is its own element for VoiceOver (label and value), before the words; the cell is not one.
    let circle = UIButton(type: .system)
    /// Set on every configure so a reused cell never reports an old row.
    private var onTick: (() -> Void)?

    /// The touch target is larger than the glyph, never the other way round, so a row does not grow.
    private static let minimumTouchTarget: CGFloat = 44

    private lazy var circleWidth = circle.widthAnchor.constraint(equalToConstant: Self.minimumTouchTarget)
    private lazy var circleHeight = circle.heightAnchor.constraint(equalToConstant: Self.minimumTouchTarget)
    /// The circle is centred on the slot the list content view lays out for its (hidden) image, so the system places
    /// it with the words: margins, indent and safe area included. Remade when the content view gives a new guide.
    private var slotConstraints: [NSLayoutConstraint] = []
    private weak var slot: UILayoutGuide?

    override init(frame: CGRect) {
      super.init(frame: frame)
      circle.translatesAutoresizingMaskIntoConstraints = false
      // On the cell, above its content view: a button inside the list's content view does not get the touch.
      addSubview(circle)
      NSLayoutConstraint.activate([circleWidth, circleHeight])
      // A disabled control still sends actions to `sendActions(for:)`; a to-do that cannot be ticked reports nothing.
      circle.addAction(
        UIAction { [weak self] _ in
          if self?.circle.isEnabled == true { self?.onTick?() }
        }, for: .primaryActionTriggered)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
      super.layoutSubviews()
      // The list cell's content view covers the whole cell and is kept above the circle, and so are the words; the
      // circle must be on top to get the touch.
      bringSubviewToFront(circle)
    }

    func configure(
      status: TodoTask.Status?, canBeTicked: Bool, depth: Int, text: AttributedString, editable: Bool, rowID: String,
      delegate: LineTextViewDelegate?, onTick: @escaping () -> Void
    ) {
      self.status = status
      symbolName = Self.symbol(for: status)
      self.onTick = onTick
      circle.isEnabled = canBeTicked
      setDepth(depth)
      let finished = status == .done || status == .cancelled
      setWords(
        text, look: LineLook(textStyle: .body, color: finished ? .secondaryLabel : .label, struckThrough: finished),
        editable: editable, rowID: rowID, delegate: delegate)
      isAccessibilityElement = false
      accessibilityElements = [circle, line]
      circle.accessibilityValue =
        switch status {
        case .done: "done"
        case .cancelled: "cancelled"
        case .open, .other, nil: "not done"
        }
    }

    override func wordsDidChange() {
      circle.accessibilityLabel = "Complete " + String(words.characters)
    }

    override func updateConfiguration(using state: UICellConfigurationState) {
      var content = defaultContentConfiguration()
      let finished = status == .done || status == .cancelled
      applyWords(to: &content, traits: state.traitCollection)

      let symbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body, scale: .medium)
      let symbol = UIImage(systemName: symbolName)
      // The symbol is the content's image, as it was before the circle was a button, so the system lays out its slot
      // and the words exactly as then; it is not seen: the button draws it.
      content.image = symbol
      content.imageProperties.preferredSymbolConfiguration = symbolConfiguration
      content.imageProperties.tintColor = .clear
      contentConfiguration = content
      pinWords()

      let tint: UIColor = finished ? .tintColor : .secondaryLabel
      var button = UIButton.Configuration.plain()
      button.image = symbol
      button.preferredSymbolConfigurationForImage = symbolConfiguration
      button.contentInsets = .zero
      button.baseForegroundColor = tint
      // A circle that cannot be ticked looks as it does for its status, not the system's disabled grey; one that can
      // keeps the system's pressed look (docs/design/native-system.md).
      if !circle.isEnabled { button.imageColorTransformer = UIConfigurationColorTransformer { _ in tint } }
      button.symbolContentTransition = UISymbolContentTransition(.replace)
      circle.configuration = button

      let glyph = symbol?.withConfiguration(symbolConfiguration.withTraitCollection(state.traitCollection)).size ?? .zero
      circleWidth.constant = max(Self.minimumTouchTarget, glyph.width)
      circleHeight.constant = max(Self.minimumTouchTarget, glyph.height)
      centreOnImageSlot()
    }

    private func centreOnImageSlot() {
      guard let guide = (contentView as? UIListContentView)?.imageLayoutGuide, guide !== slot else { return }
      NSLayoutConstraint.deactivate(slotConstraints)
      slotConstraints = [
        circle.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
        circle.centerYAnchor.constraint(equalTo: guide.centerYAnchor),
      ]
      NSLayoutConstraint.activate(slotConstraints)
      slot = guide
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
