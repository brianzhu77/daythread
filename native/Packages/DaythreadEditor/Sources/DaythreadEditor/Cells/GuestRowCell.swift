#if canImport(UIKit)
  import CoreText
  import UIKit

  /// A guest row: laid out as his row of its kind would be, in quiet ink. The system's list content view lays the row
  /// out from words in no colour, with the mark of his row's kind (unseen) in its image slot, so the words take that
  /// row's column at every text size; the words, the mark and the buttons are drawn on the cell, over that layout, as
  /// `LineBlockCell` lays its text view over it. The small text under the words is the content's own, as a to-do's
  /// marks line is. One element for VoiceOver, its actions the row's custom actions.
  final class GuestRowCell: BlockCell {
    /// The words, over the content view's own (unseen) label.
    let wordsLabel = UILabel()
    /// The leading mark, level with the words' first line.
    private let mark = UIImageView()
    /// Where in the mark's image its dot or circle is centred.
    private var markCentreInImage = CGPoint.zero
    private let buttons = UIStackView()

    private var guest: GuestRow?
    private var dimmed = false
    /// What a button or a custom action reports to, set on every configure so a reused cell never reports an old
    /// guest. False when nothing was reported (an action is out).
    private var onAction: ((String) -> Bool)?
    /// The actions the buttons were made for.
    private var shownActions: [GuestRow.Action] = []
    /// Each button's size constraints, set from the symbol's size at the text size.
    private var buttonSizes: [(width: NSLayoutConstraint, height: NSLayoutConstraint)] = []

    /// The touch target is larger than the glyph, never the other way round.
    private static let minimumTouchTarget: CGFloat = 44
    private static let symbolRoom: CGFloat = 4

    override init(frame: CGRect) {
      super.init(frame: frame)
      wordsLabel.numberOfLines = 0
      wordsLabel.adjustsFontForContentSizeCategory = false
      wordsLabel.translatesAutoresizingMaskIntoConstraints = false
      mark.translatesAutoresizingMaskIntoConstraints = false
      buttons.axis = .horizontal
      buttons.spacing = 0
      buttons.translatesAutoresizingMaskIntoConstraints = false
      // On the cell, not in its content view: a content configuration replaces the content view, and a button inside
      // it gets no touch.
      for view in [wordsLabel, mark, buttons] as [UIView] { addSubview(view) }
      isAccessibilityElement = true
      accessibilityTraits = []
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The buttons, in the order of the guest's actions (tests read them).
    var actionButtons: [UIButton] { buttons.arrangedSubviews.compactMap { $0 as? UIButton } }

    /// The button of the action with that symbol (tests read it).
    func button(symbol: String) -> UIButton? {
      shownActions.firstIndex { $0.symbol == symbol }.flatMap { actionButtons.indices.contains($0) ? actionButtons[$0] : nil }
    }

    /// The middle of the drawn circle or dot, in the cell; nil for a guest drawn with no mark.
    var markCentre: CGPoint? {
      guard !mark.isHidden else { return nil }
      layoutIfNeeded()
      return CGPoint(x: mark.frame.minX + markCentreInImage.x, y: mark.frame.minY + markCentreInImage.y)
    }

    func configure(_ guest: GuestRow, dimmed: Bool, onAction: @escaping (String) -> Bool) {
      self.guest = guest
      self.dimmed = dimmed
      self.onAction = onAction
      setDepth(guest.depth)
      if guest.actions != shownActions { makeButtons(guest.actions) }
      accessibilityLabel = guest.spokenLabel
      accessibilityCustomActions = guest.actions.map { action in
        UIAccessibilityCustomAction(name: action.spokenName) { [weak self] _ in self?.report(action.id) ?? false }
      }
      setNeedsUpdateConfiguration()
    }

    private func report(_ actionID: String) -> Bool {
      onAction?(actionID) ?? false
    }

    private var ink: UIColor { dimmed ? .tertiaryLabel : .secondaryLabel }

    // MARK: the buttons

    private func makeButtons(_ actions: [GuestRow.Action]) {
      for view in buttons.arrangedSubviews { view.removeFromSuperview() }
      buttonSizes = []
      for action in actions {
        let button = UIButton(
          configuration: .plain(), primaryAction: UIAction { [weak self] _ in _ = self?.report(action.id) })
        button.accessibilityLabel = action.label
        button.translatesAutoresizingMaskIntoConstraints = false
        // The symbol is the button's own image view's, centred: the button's configuration placed a large symbol by
        // its baseline and drew the checkmark out of the bottom of its target at the largest text size.
        let symbol = UIImageView()
        symbol.translatesAutoresizingMaskIntoConstraints = false
        symbol.contentMode = .center
        symbol.isUserInteractionEnabled = false
        button.addSubview(symbol)
        NSLayoutConstraint.activate([
          symbol.centerXAnchor.constraint(equalTo: button.centerXAnchor),
          symbol.centerYAnchor.constraint(equalTo: button.centerYAnchor),
        ])
        // Pressed, it dims as a plain button's image does.
        button.configurationUpdateHandler = { button in
          symbol.alpha = button.isHighlighted ? 0.4 : 1
        }
        let size = (
          width: button.widthAnchor.constraint(equalToConstant: Self.minimumTouchTarget),
          height: button.heightAnchor.constraint(equalToConstant: Self.minimumTouchTarget)
        )
        NSLayoutConstraint.activate([size.width, size.height])
        buttonSizes.append(size)
        buttons.addArrangedSubview(button)
      }
      shownActions = actions
      madeButtonsFor = nil
    }

    /// The text size, weight and ink the buttons were last drawn for, so a configure that changes none of them makes
    /// nothing again.
    private var madeButtonsFor: (contentSize: UIContentSizeCategory, legibilityWeight: UILegibilityWeight, ink: UIColor)?

    /// Each button's symbol at the body's text style, so it is no larger than the words, in their quiet ink; its target
    /// 44 points or the glyph's size, whichever is larger, so the symbol is never cut.
    private func drawButtons(traits: UITraitCollection) {
      let madeFor = (traits.preferredContentSizeCategory, traits.legibilityWeight, ink)
      if let made = madeButtonsFor, made.contentSize == madeFor.0, made.legibilityWeight == madeFor.1, made.ink == madeFor.2 {
        return
      }
      let symbolConfiguration = UIImage.SymbolConfiguration(textStyle: .body)
      for (index, action) in shownActions.enumerated() where actionButtons.indices.contains(index) {
        let symbol = UIImage(systemName: action.symbol, withConfiguration: symbolConfiguration.withTraitCollection(traits))
        let imageView = symbolView(of: actionButtons[index])
        imageView?.image = symbol
        imageView?.tintColor = ink
        let glyph = symbol?.size ?? .zero
        // A little room round the glyph: a symbol whose ink meets its frame's edge is drawn cut at that edge.
        buttonSizes[index].width.constant = max(Self.minimumTouchTarget, ceil(glyph.width) + Self.symbolRoom)
        buttonSizes[index].height.constant = max(Self.minimumTouchTarget, ceil(glyph.height) + Self.symbolRoom)
      }
      // One row of buttons, as tall as its tallest symbol needs: the stack gives them all one height.
      let height = buttonSizes.map(\.height.constant).max() ?? Self.minimumTouchTarget
      for size in buttonSizes { size.height.constant = height }
      madeButtonsFor = madeFor
    }

    /// The view that draws a button's symbol (tests read it).
    func symbolView(of button: UIButton) -> UIImageView? {
      button.subviews.lazy.compactMap { $0 as? UIImageView }.first
    }

    /// What the words give up for the buttons: across beside them on the first line, down under them from the
    /// accessibility text sizes (as `Plan for today` does on a to-do row); nothing without actions.
    private struct ButtonRoom: Equatable {
      var trailing: CGFloat = 0
      var bottom: CGFloat = 0
    }

    private func buttonRoom(traits: UITraitCollection) -> ButtonRoom {
      guard !buttonSizes.isEmpty else { return ButtonRoom() }
      if traits.preferredContentSizeCategory.isAccessibilityCategory {
        return ButtonRoom(bottom: buttonSizes.map(\.height.constant).max() ?? 0)
      }
      return ButtonRoom(trailing: buttonSizes.map(\.width.constant).reduce(0, +))
    }

    override func layoutMarginsDidChange() {
      super.layoutMarginsDidChange()
      // The buttons' room is counted from the cell's own margin, which the list may set after the row was configured.
      if !buttonSizes.isEmpty { setNeedsUpdateConfiguration() }
    }

    // MARK: configure

    override func updateConfiguration(using state: UICellConfigurationState) {
      guard let guest else { return }
      let traits = state.traitCollection
      let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits)
      drawButtons(traits: traits)
      let room = buttonRoom(traits: traits)

      var content = defaultContentConfiguration()
      if room.trailing > 0 {
        // As on a to-do row with `Plan for today`: the content view keeps the larger of its configuration's margin and
        // the cell's own (which counts the safe area it adds again), and the room goes on that.
        let safeArea = effectiveUserInterfaceLayoutDirection == .rightToLeft ? safeAreaInsets.left : safeAreaInsets.right
        content.directionalLayoutMargins.trailing =
          max(content.directionalLayoutMargins.trailing, directionalLayoutMargins.trailing - safeArea) + room.trailing
      }
      content.directionalLayoutMargins.bottom += room.bottom
      // The words in no colour lay the row out; the label over them draws them.
      content.attributedText = NSAttributedString(
        string: guest.words.isEmpty ? "\u{200B}" : guest.words, attributes: [.font: font, .foregroundColor: UIColor.clear])
      content.textProperties.adjustsFontForContentSizeCategory = false
      content.secondaryAttributedText =
        guest.detail.isEmpty
        ? nil
        : NSAttributedString(
          string: guest.detail,
          attributes: [
            .font: UIFont.preferredFont(forTextStyle: .footnote, compatibleWith: traits), .foregroundColor: ink,
          ])
      let marks = Self.marks(for: guest.kind, traits: traits)
      // The slot holds the mark his row of this kind has, so the system places the words where it places his; it is
      // not seen: the mark is drawn on the cell, on the first line.
      content.image = marks?.slot
      content.imageProperties.tintColor = .clear
      if let configuration = marks?.slotConfiguration {
        content.imageProperties.preferredSymbolConfiguration = configuration
      }
      contentConfiguration = content

      wordsLabel.font = font
      wordsLabel.textColor = ink
      wordsLabel.text = guest.words
      mark.isHidden = marks == nil
      mark.image = marks?.drawn
      mark.tintColor = ink
      markCentreInImage = marks?.centre ?? .zero
      pin(firstLineMiddle: font.lineHeight / 2, room: room)
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      // The list cell keeps its content view on top; what is drawn and touched is the cell's own.
      bringSubviewToFront(wordsLabel)
      bringSubviewToFront(mark)
      bringSubviewToFront(buttons)
    }

    // MARK: placing

    private var wordConstraints: [NSLayoutConstraint] = []
    private weak var wordGuide: UILayoutGuide?
    private var markConstraints: [NSLayoutConstraint] = []
    private weak var markSlot: UILayoutGuide?
    private lazy var markOnFirstLine = mark.centerYAnchor.constraint(equalTo: wordsLabel.topAnchor)
    private lazy var buttonsOnFirstLine = buttons.centerYAnchor.constraint(equalTo: wordsLabel.topAnchor)
    private var buttonsBeside: [NSLayoutConstraint] = []
    private var buttonsUnder: [NSLayoutConstraint] = []
    private weak var buttonMargins: UILayoutGuide?

    /// The words over the content's label, across to its trailing margin so they wrap where it does (as
    /// `LineBlockCell.pinWords`); the mark centred across on the slot and down on the words' first line; the buttons
    /// in their room. Each remade when the content view gives a new guide.
    private func pin(firstLineMiddle: CGFloat, room: ButtonRoom) {
      guard let content = contentView as? UIListContentView, let words = content.textLayoutGuide else { return }
      if words !== wordGuide {
        NSLayoutConstraint.deactivate(wordConstraints)
        wordConstraints = [
          wordsLabel.leadingAnchor.constraint(equalTo: words.leadingAnchor),
          wordsLabel.trailingAnchor.constraint(equalTo: content.layoutMarginsGuide.trailingAnchor),
          wordsLabel.topAnchor.constraint(equalTo: words.topAnchor),
        ]
        NSLayoutConstraint.activate(wordConstraints)
        wordGuide = words
      }
      if let slot = content.imageLayoutGuide, slot !== markSlot {
        NSLayoutConstraint.deactivate(markConstraints)
        markConstraints = [mark.centerXAnchor.constraint(equalTo: slot.centerXAnchor), markOnFirstLine]
        NSLayoutConstraint.activate(markConstraints)
        markSlot = slot
      }
      // The mark's image is centred on the line's middle: its dot or circle is where the image has it.
      let imageMiddle = (mark.image?.size.height ?? 0) / 2
      let markOffset = firstLineMiddle + imageMiddle - markCentreInImage.y
      if abs(markOnFirstLine.constant - markOffset) > 0.01 { markOnFirstLine.constant = markOffset }
      if abs(buttonsOnFirstLine.constant - firstLineMiddle) > 0.01 { buttonsOnFirstLine.constant = firstLineMiddle }

      let margins = content.layoutMarginsGuide
      if margins !== buttonMargins {
        NSLayoutConstraint.deactivate(buttonsBeside + buttonsUnder)
        buttonsBeside = [buttons.trailingAnchor.constraint(equalTo: margins.trailingAnchor), buttonsOnFirstLine]
        buttonsUnder = [
          buttons.leadingAnchor.constraint(equalTo: wordsLabel.leadingAnchor),
          buttons.topAnchor.constraint(equalTo: margins.bottomAnchor),
        ]
        buttonMargins = margins
      }
      // Beside, the buttons end where the other rows' words end: the room was added to the margin.
      if let trailing = buttonsBeside.first, abs(trailing.constant - room.trailing) > 0.01 { trailing.constant = room.trailing }
      let under = room.bottom > 0
      NSLayoutConstraint.deactivate(under ? buttonsBeside : buttonsUnder)
      NSLayoutConstraint.activate(under ? buttonsUnder : buttonsBeside)
    }

    // MARK: the marks

    /// A kind's marks: the image his row of that kind puts in the slot (so the words take its column), the image drawn
    /// on the first line, and where its circle or dot is centred in that image; nil for a line, which has none.
    private static func marks(for kind: GuestRow.Kind, traits: UITraitCollection)
      -> (slot: UIImage?, slotConfiguration: UIImage.SymbolConfiguration?, drawn: UIImage?, centre: CGPoint)?
    {
      switch kind {
      case .todo:
        // His to-do's circle is `circle` at the body's style (`TodoBlockCell`); the guest's is the system's dashed one.
        let configuration = UIImage.SymbolConfiguration(textStyle: .body, scale: .medium)
        let drawn = UIImage(systemName: "circle.dashed", withConfiguration: configuration.withTraitCollection(traits))
        let size = drawn?.size ?? .zero
        return (UIImage(systemName: "circle"), configuration, drawn, CGPoint(x: size.width / 2, y: size.height / 2))
      case .bullet:
        let dot = dashedDot(traits: traits)
        return (dot.image, nil, dot.image, dot.centre)
      case .line:
        return nil
      }
    }

    /// A small dashed dot where a bullet has its dot, in an image the size of a bullet's column
    /// (`TextBlockCell.markerImage`): as wide as the widest number, a line of the body's text tall, the bullet drawn at
    /// its trailing edge. The dot is centred where the bullet glyph's ink is.
    private static func dashedDot(traits: UITraitCollection) -> (image: UIImage, centre: CGPoint) {
      let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits)
      let width = ceil(("99." as NSString).size(withAttributes: [.font: font]).width)
      let size = CGSize(width: width, height: ceil(font.lineHeight))
      let bullet = bulletInk(font: font)
      // The bullet is drawn right-aligned with its baseline at the font's ascender from the image's top.
      let centre = CGPoint(x: width - bullet.advance + bullet.ink.midX, y: font.ascender - bullet.ink.midY)
      let dot = UIImage(
        systemName: "circle.dashed",
        withConfiguration: UIImage.SymbolConfiguration(pointSize: font.pointSize * 0.5, weight: .semibold))
      let image = UIGraphicsImageRenderer(size: size).image { _ in
        guard let dot else { return }
        dot.withTintColor(.black).draw(
          in: CGRect(
            x: centre.x - dot.size.width / 2, y: centre.y - dot.size.height / 2, width: dot.size.width,
            height: dot.size.height))
      }
      return (image.withRenderingMode(.alwaysTemplate), centre)
    }

    /// The bullet glyph's advance, and its ink's bounds above its baseline (y up).
    private static func bulletInk(font: UIFont) -> (advance: CGFloat, ink: CGRect) {
      let ctFont = font as CTFont
      var character: UniChar = 0x2022
      var glyph: CGGlyph = 0
      guard CTFontGetGlyphsForCharacters(ctFont, &character, &glyph, 1) else {
        let advance = ("•" as NSString).size(withAttributes: [.font: font]).width
        return (advance, CGRect(x: 0, y: 0, width: advance, height: font.xHeight))
      }
      var bounds = CGRect.zero
      CTFontGetBoundingRectsForGlyphs(ctFont, .default, &glyph, &bounds, 1)
      var advance = CGSize.zero
      CTFontGetAdvancesForGlyphs(ctFont, .default, &glyph, &advance, 1)
      return (advance.width, bounds)
    }
  }
#endif
