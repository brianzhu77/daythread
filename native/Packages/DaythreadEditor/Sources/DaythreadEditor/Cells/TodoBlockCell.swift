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
    /// The circle is placed by the slot the list content view lays out for its (hidden) image, so the system places
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

    // MARK: the marks

    /// What the row draws under its words: its to-do's marks and `Blocked by`, read by VoiceOver as one element after
    /// the words.
    private var facts: RowFacts?
    private lazy var marksElement = MarksElement(accessibilityContainer: self)

    /// The marks for VoiceOver. Its frame is the marks line's as laid out when asked: other marks of the same height
    /// lay the content view out again without the cell, so a frame kept from the cell's layout would be stale.
    private final class MarksElement: UIAccessibilityElement {
      override var accessibilityFrameInContainerSpace: CGRect {
        get {
          guard let cell = accessibilityContainer as? UIView,
            let content = (cell as? UICollectionViewListCell)?.contentView as? UIListContentView,
            let guide = content.secondaryTextLayoutGuide
          else { return .zero }
          return content.convert(guide.layoutFrame, to: cell)
        }
        set {}
      }
    }

    /// The marks line as last made, and what it was made from: `updateConfiguration` runs on every keystroke in the
    /// row, and the same marks are handed back then rather than made again.
    private struct MarksKey: Equatable {
      var facts: RowFacts?
      var regularWidth: Bool
      var contentSize: UIContentSizeCategory
      var legibilityWeight: UILegibilityWeight
    }
    private var madeMarks: (key: MarksKey, text: NSAttributedString?, spoken: String?)?

    /// The marks at the cell's own width (`Reference` and `Moved to` only at a regular one, so a rotation needs no
    /// new rows), one quiet line, ` · ` between marks, `Blocked by` on a line of its own; nil when there are none.
    private func marksLine(traits: UITraitCollection) -> (text: NSAttributedString?, spoken: String?) {
      let key = MarksKey(
        facts: facts, regularWidth: traits.horizontalSizeClass == .regular,
        contentSize: traits.preferredContentSizeCategory, legibilityWeight: traits.legibilityWeight)
      if let madeMarks, madeMarks.key == key { return (madeMarks.text, madeMarks.spoken) }
      let text = facts.flatMap { Self.marksText($0, regularWidth: key.regularWidth, traits: traits) }
      let spoken = facts?.spoken(regularWidth: key.regularWidth)
      madeMarks = (key, text, spoken)
      return (text, spoken)
    }

    private static func marksText(_ facts: RowFacts, regularWidth: Bool, traits: UITraitCollection)
      -> NSAttributedString?
    {
      let font = UIFont.preferredFont(forTextStyle: .footnote, compatibleWith: traits)
      let quiet: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.secondaryLabel]
      let text = NSMutableAttributedString()
      for mark in facts.marks(regularWidth: regularWidth) {
        if text.length > 0 { text.append(NSAttributedString(string: " · ", attributes: quiet)) }
        switch mark {
        case .dateTag(let words, passed: true):
          var passed = quiet
          passed[.foregroundColor] = UIColor.systemRed
          text.append(NSAttributedString(string: words, attributes: passed))
        case .repeats:
          // The symbol stands for the words; VoiceOver reads them from the marks' element.
          let symbol = UIImage(systemName: "repeat", withConfiguration: UIImage.SymbolConfiguration(font: font))
          let attachment = NSMutableAttributedString(attachment: NSTextAttachment(image: symbol ?? UIImage()))
          attachment.addAttributes(quiet, range: NSRange(location: 0, length: attachment.length))
          text.append(attachment)
        default:
          text.append(NSAttributedString(string: mark.words, attributes: quiet))
        }
      }
      if let blockedBy = facts.blockedBy {
        if text.length > 0 { text.append(NSAttributedString(string: "\n", attributes: quiet)) }
        text.append(NSAttributedString(string: blockedBy, attributes: quiet))
      }
      return text.length > 0 ? text : nil
    }

    func configure(
      status: TodoTask.Status?, facts: RowFacts?, canBeTicked: Bool, depth: Int, text: AttributedString,
      editable: Bool, rowID: String, delegate: LineTextViewDelegate?, onTick: @escaping () -> Void
    ) {
      self.status = status
      self.facts = facts
      symbolName = Self.symbol(for: status)
      self.onTick = onTick
      circle.isEnabled = canBeTicked
      setDepth(depth)
      let finished = status == .done || status == .cancelled
      setWords(
        text, look: LineLook(textStyle: .body, color: finished ? .secondaryLabel : .label, struckThrough: finished),
        editable: editable, rowID: rowID, delegate: delegate)
      isAccessibilityElement = false
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
      let marks = marksLine(traits: state.traitCollection)
      content.secondaryAttributedText = marks.text
      contentConfiguration = content
      pinWords()
      if marksElement.accessibilityLabel != marks.spoken || accessibilityElements == nil {
        marksElement.accessibilityLabel = marks.spoken
        accessibilityElements = marks.spoken == nil ? [circle, line] : [circle, line, marksElement]
      }

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
      let midline = firstLineMidline(traits: state.traitCollection)
      if abs(circleOnFirstLine.constant - midline) > 0.01 { circleOnFirstLine.constant = midline }
      centreOnImageSlot()
    }

    /// Across, the circle is centred on the image's slot, which keeps the words' leading edge and the indent; down, it
    /// is level with the middle of the words' first line, as on the web, whatever lies under the words (the marks, the
    /// words' further lines). The slot alone centres it on the whole text at the smaller sizes.
    private lazy var circleOnFirstLine = circle.centerYAnchor.constraint(equalTo: line.topAnchor)

    private func centreOnImageSlot() {
      guard let guide = (contentView as? UIListContentView)?.imageLayoutGuide, guide !== slot else { return }
      NSLayoutConstraint.deactivate(slotConstraints)
      slotConstraints = [circle.centerXAnchor.constraint(equalTo: guide.centerXAnchor), circleOnFirstLine]
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
