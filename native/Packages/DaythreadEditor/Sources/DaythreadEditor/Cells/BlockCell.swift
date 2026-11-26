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

  /// How a line's words are set: the system text style, and what the row's kind adds to it.
  struct LineLook: Equatable {
    var textStyle: UIFont.TextStyle
    var bold = false
    var color: UIColor = .label
    var struckThrough = false
  }

  /// A row whose words are a text view: a paragraph, heading, list item, quote or to-do.
  ///
  /// The row is still laid out by the system's list content view, from a label that holds the same words in no colour
  /// (`InlineTextStorage.measure`): it sizes the row, places the bullet, number or circle in its image slot and keeps
  /// the margins, indent and safe area as before. The text view lies over that label, on the cell (a view inside the
  /// list's content view gets no touches), and draws the words and the caret.
  class LineBlockCell: BlockCell {
    let line = LineTextView()
    /// The row's words as last configured or typed.
    private(set) var words = AttributedString()
    private var look = LineLook(textStyle: .body)

    /// What the text view was last given, so a configure that changes nothing leaves the words, the caret and the
    /// selection alone.
    private struct Shown: Equatable {
      var words: AttributedString
      var look: LineLook
      var contentSize: UIContentSizeCategory
      var appearance: UIUserInterfaceStyle
    }
    private var shown: Shown?
    private var lineHeight: CGFloat = 0
    private var wordConstraints: [NSLayoutConstraint] = []
    private weak var wordGuide: UILayoutGuide?

    override init(frame: CGRect) {
      super.init(frame: frame)
      line.translatesAutoresizingMaskIntoConstraints = false
      addSubview(line)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Sets the row's words and whether they can be typed into. `delegate` hears what is typed.
    final func setWords(
      _ words: AttributedString, look: LineLook, editable: Bool, rowID: String, delegate: LineTextViewDelegate?
    ) {
      self.words = words
      self.look = look
      line.rowID = rowID
      line.delegate = delegate
      line.isEditable = editable
      line.isSelectable = editable
      // A page that is only shown is drawn as before: its words take no touch, and the row gets it.
      line.isUserInteractionEnabled = editable
      line.words = String(words.characters)
      wordsDidChange()
      setNeedsUpdateConfiguration()
    }

    /// The words he typed are on screen already: they become the row's without being drawn again.
    final func wordsWereTyped(_ words: AttributedString) {
      self.words = words
      shown?.words = words
      line.words = String(words.characters)
      wordsDidChange()
    }

    /// The text view's text changed, typed or composed: the label follows it, and the list is told the row's
    /// height changed when it did. The cell is not reconfigured and the list does not rebuild it, so the keyboard and
    /// the caret stay; `selfSizingInvalidation` lets the list size the row again in place.
    final func lineTextDidChange() {
      updateConfiguration(using: configurationState)
      let height = fittedLineHeight()
      if abs(height - lineHeight) > 0.5 {
        lineHeight = height
        invalidateIntrinsicContentSize()
      }
    }

    /// The attributes typing at a place in the line takes: those `probe` (the words with a character typed there)
    /// is drawn with at `offset`.
    final func typingAttributes(for probe: AttributedString, at offset: Int) -> [NSAttributedString.Key: Any]? {
      let drawn = display(probe, traits: traitCollection)
      guard offset < drawn.length else { return nil }
      var attributes = drawn.attributes(at: offset, effectiveRange: nil)
      attributes[.attachment] = nil
      return attributes
    }

    /// For a subclass: the circle's name, say, which is made from the words.
    func wordsDidChange() {}

    /// Called by a subclass's `updateConfiguration` on its content: the text view is given the words when they or how
    /// they look changed (never while it holds marked text), and the content is given the label that lays them out.
    final func applyWords(to content: inout UIListContentConfiguration, traits: UITraitCollection) {
      let next = Shown(
        words: words, look: look, contentSize: traits.preferredContentSizeCategory,
        appearance: traits.userInterfaceStyle)
      if next != shown, line.markedTextRange == nil {
        let drawn = display(words, traits: traits)
        line.show(drawn)
        // Until the screen sets them from the run at the caret, typing looks like the line's last words.
        var typing = drawn.length > 0 ? drawn.attributes(at: drawn.length - 1, effectiveRange: nil) : [:]
        typing[.attachment] = nil
        line.typingAttributes = typing.isEmpty ? baseAttributes(traits: traits) : typing
        shown = next
      }
      content.attributedText = InlineTextStorage.measure(line.attributedText, typing: baseAttributes(traits: traits))
      content.textProperties.adjustsFontForContentSizeCategory = false
    }

    /// Called by a subclass once its content configuration is set: the text view lies over the label's frame, across
    /// to the content's trailing margin, so it wraps where the label does. Remade when the content view gives a new
    /// guide.
    final func pinWords() {
      guard let content = contentView as? UIListContentView, let guide = content.textLayoutGuide, guide !== wordGuide
      else { return }
      NSLayoutConstraint.deactivate(wordConstraints)
      wordConstraints = [
        line.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
        line.trailingAnchor.constraint(equalTo: content.layoutMarginsGuide.trailingAnchor),
        line.topAnchor.constraint(equalTo: guide.topAnchor),
        line.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
      ]
      NSLayoutConstraint.activate(wordConstraints)
      wordGuide = guide
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      // The list cell keeps its content view on top; the words must be above it to get the touch.
      bringSubviewToFront(line)
      lineHeight = fittedLineHeight()
    }

    /// A touch anywhere in an editable row that is not on a control (the circle) goes to its words, so a tap in the
    /// row's margins or on its bullet puts the caret in the line.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
      guard let hit = super.hitTest(point, with: event) else { return nil }
      guard line.isEditable, !(hit is UIControl), !hit.isDescendant(of: line) else { return hit }
      return line
    }

    private func display(_ words: AttributedString, traits: UITraitCollection) -> NSAttributedString {
      var drawn = NSAttributedString()
      // A token's attachment is an image of its words, drawn in the colours of these traits.
      traits.performAsCurrent {
        drawn = InlineAttributedText.display(
          words, textStyle: look.textStyle, bold: look.bold, color: look.color, struckThrough: look.struckThrough,
          compatibleWith: traits)
      }
      return drawn
    }

    private func baseAttributes(traits: UITraitCollection) -> [NSAttributedString.Key: Any] {
      display(AttributedString("x"), traits: traits).attributes(at: 0, effectiveRange: nil)
    }

    private func fittedLineHeight() -> CGFloat {
      line.sizeThatFits(CGSize(width: line.bounds.width, height: .greatestFiniteMagnitude)).height
    }
  }
#endif
