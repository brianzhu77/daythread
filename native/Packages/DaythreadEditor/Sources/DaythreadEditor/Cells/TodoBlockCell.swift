#if canImport(UIKit)
  import UIKit
  import DaythreadCore

  /// A to-do: the system's checkmark symbol and its title; a finished one is dimmed and struck through.
  final class TodoBlockCell: LineBlockCell {
    private var status: TodoTask.Status?
    /// The SF Symbol drawn at the leading edge.
    private(set) var symbolName = "circle"

    /// The circle. It is its own element for VoiceOver (label and value), before the words; the cell is not one. A tap
    /// ticks; a touch and hold opens the row's actions (its menu).
    let circle = UIButton(type: .system)
    /// Set on every configure so a reused cell never reports an old row.
    private var onTick: (() -> Void)?
    private var canBeTicked = false

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
      // A circle that is enabled only for its menu (a cancelled to-do's) reports no tick, and nor does a disabled one,
      // which still sends actions to `sendActions(for:)`.
      circle.addAction(
        UIAction { [weak self] _ in
          guard let self, self.circle.isEnabled, self.canBeTicked else { return }
          self.onTick?()
        }, for: .primaryActionTriggered)
      // A tap ticks; only a touch and hold (a click and hold, a secondary click) opens the menu.
      circle.showsMenuAsPrimaryAction = false

      planButton.translatesAutoresizingMaskIntoConstraints = false
      planButton.isHidden = true
      addSubview(planButton)
      planButton.addAction(
        UIAction { [weak self] _ in _ = self?.onRowAction?(.action(.planForTodayButton)) }, for: .primaryActionTriggered)
      NSLayoutConstraint.activate([planHeight, planWidth])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The button's room is counted from the cell's own margin (`updateConfiguration`), which the list may set after
    /// the row was configured.
    override func layoutMarginsDidChange() {
      super.layoutMarginsDidChange()
      if !planButton.isHidden { setNeedsUpdateConfiguration() }
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      // The list cell's content view covers the whole cell and is kept above the circle, and so are the words; the
      // circle and the button must be on top to get the touch.
      bringSubviewToFront(circle)
      bringSubviewToFront(planButton)
      // The first line is known once the words are laid out at their width; a change of width can change it.
      placeOnFirstLine(firstLineMidline(traits: traitCollection))
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

      /// The frame VoiceOver and UI automation read. The system's own works it out from the container-space frame it
      /// was given, never from the getter above, so with nothing given it was empty and the element was passed over.
      override var accessibilityFrame: CGRect {
        get {
          guard let cell = accessibilityContainer as? UIView else { return .zero }
          return UIAccessibility.convertToScreenCoordinates(accessibilityFrameInContainerSpace, in: cell)
        }
        set {}
      }
    }

    /// The marks line as last made, and what it was made from: `updateConfiguration` runs on every keystroke in the
    /// row, and the same marks are handed back then rather than made again.
    private struct MarksKey: Equatable {
      var facts: RowFacts?
      var regularWidth: Bool
      var dimmed: Bool
      var contentSize: UIContentSizeCategory
      var legibilityWeight: UILegibilityWeight
    }
    private var madeMarks: (key: MarksKey, text: NSAttributedString?, spoken: String?)?

    /// The marks at the cell's own width (`Reference` and `Moved to` only at a regular one, so a rotation needs no
    /// new rows), one quiet line, ` · ` between marks, `Blocked by` on a line of its own; nil when there are none.
    private func marksLine(traits: UITraitCollection) -> (text: NSAttributedString?, spoken: String?) {
      let key = MarksKey(
        facts: facts, regularWidth: traits.horizontalSizeClass == .regular, dimmed: dimmed,
        contentSize: traits.preferredContentSizeCategory, legibilityWeight: traits.legibilityWeight)
      if let madeMarks, madeMarks.key == key { return (madeMarks.text, madeMarks.spoken) }
      let text = facts.flatMap {
        Self.marksText($0, regularWidth: key.regularWidth, dimmed: key.dimmed, traits: traits)
      }
      let spoken = facts?.spoken(regularWidth: key.regularWidth)
      madeMarks = (key, text, spoken)
      return (text, spoken)
    }

    /// `dimmed`: every mark in the tertiary colour, a passed date tag too, as the words are.
    private static func marksText(_ facts: RowFacts, regularWidth: Bool, dimmed: Bool, traits: UITraitCollection)
      -> NSAttributedString?
    {
      let font = UIFont.preferredFont(forTextStyle: .footnote, compatibleWith: traits)
      let quiet: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: dimmed ? UIColor.tertiaryLabel : UIColor.secondaryLabel,
      ]
      let text = NSMutableAttributedString()
      for mark in facts.marks(regularWidth: regularWidth) {
        if text.length > 0 { text.append(NSAttributedString(string: " · ", attributes: quiet)) }
        switch mark {
        case .dateTag(let words, passed: true) where !dimmed:
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

    // MARK: the actions

    /// What the row's actions report to, set on every configure so a reused cell never reports an old row. False when
    /// nothing was reported (another action is out).
    private var onRowAction: ((RowRequest.Kind) -> Bool)?
    /// The actions the circle's menu, ⌘/ and VoiceOver offer now; nil when the row has none.
    private var actions: RowMenu?

    /// The row and the to-do a menu or a custom action was made for.
    private struct ActionsOwner: Equatable {
      let rowID: String
      let taskId: String
    }

    /// The row and to-do the cell shows now; nil before its first configure.
    private var actionsOwner: ActionsOwner?

    /// The circle's menu, ⌘/'s and VoiceOver's custom actions, made again only when the row's actions change or the
    /// cell is given another row or to-do (the row reconfigured in place, a reused cell): never on a keystroke.
    private func showActions(_ menu: RowMenu?, for owner: ActionsOwner) {
      guard owner != actionsOwner || menu != actions else { return }
      actions = menu
      actionsOwner = owner
      circle.menu = menu.map { makeMenu($0, for: owner) }
      line.accessibilityCustomActions = menu.map { menu in
        menu.groups.flatMap(\.items).map { item in
          UIAccessibilityCustomAction(name: item.title) { [weak self] _ in
            self?.report(.action(item.action), for: owner) ?? false
          }
        }
      }
    }

    /// Reports `kind` only while the cell still shows the row and to-do the menu or custom action was made for: UIKit
    /// may keep a menu up while its cell is given another row offering the same action, and the request would go to
    /// that row, one he never asked for.
    private func report(_ kind: RowRequest.Kind, for owner: ActionsOwner) -> Bool {
      guard owner == actionsOwner, let onRowAction else { return false }
      return onRowAction(kind)
    }

    /// The row's actions as one system menu, in the web's `⋯` order: each group inline, `Another day` with its title,
    /// `Cancel task` destructive.
    private func makeMenu(_ menu: RowMenu, for owner: ActionsOwner) -> UIMenu {
      UIMenu(
        children: menu.groups.map { group in
          UIMenu(
            title: group.title ?? "", options: .displayInline,
            children: group.items.map { item in
              UIAction(title: item.title, attributes: item.destructive ? .destructive : []) { [weak self] _ in
                _ = self?.report(.action(item.action), for: owner)
              }
            })
        })
    }

    /// Whether ⌘/ has a menu to open here.
    var hasRowMenu: Bool { circle.menu != nil }

    /// The interaction ⌘/ presents the row's menu with; made the first time.
    private(set) var rowMenuInteraction: UIEditMenuInteraction?
    /// Where ⌘/ last presented the menu, in the cell's coordinates.
    private(set) var rowMenuSourcePoint: CGPoint?

    /// ⌘/: the row's menu, at the caret, as the system's edit menu. The line keeps the keyboard and the caret.
    func presentRowMenu() {
      guard hasRowMenu, let caret = line.selectedTextRange else { return }
      let interaction: UIEditMenuInteraction
      if let rowMenuInteraction {
        interaction = rowMenuInteraction
      } else {
        interaction = UIEditMenuInteraction(delegate: self)
        addInteraction(interaction)
        rowMenuInteraction = interaction
      }
      let rect = line.convert(line.caretRect(for: caret.end), to: self)
      let point = CGPoint(x: rect.midX, y: rect.midY)
      rowMenuSourcePoint = point
      interaction.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: point))
    }

    // MARK: Plan for today

    /// The reference row's one control: plans the to-do for today. Shown exactly when the facts say
    /// (`RowFacts.planForToday`). Beside the words, at the trailing end and level with their first line, the words
    /// ending before it; from the accessibility text sizes, under the words and marks, where the words keep the row's
    /// width (as the web wraps it under a title that would get too narrow, and as the notice puts its button).
    let planButton = UIButton(type: .system)
    private lazy var planHeight = planButton.heightAnchor.constraint(equalToConstant: Self.minimumTouchTarget)
    private lazy var planWidth = planButton.widthAnchor.constraint(equalToConstant: 0)
    private lazy var planOnFirstLine = planButton.centerYAnchor.constraint(equalTo: line.topAnchor)
    private var planBeside: [NSLayoutConstraint] = []
    private var planUnder: [NSLayoutConstraint] = []
    private weak var planMargins: UILayoutGuide?
    /// The text size and weight the button was last made for, so a keystroke makes nothing again.
    private var planMadeFor: (contentSize: UIContentSizeCategory, legibilityWeight: UILegibilityWeight)?
    /// Between the words' end and the button's title, when it is beside them.
    private static let planGap: CGFloat = 8

    /// What the words give up for the button: across beside them, down under them; nothing when it is not shown.
    private struct PlanRoom: Equatable {
      var trailing: CGFloat = 0
      var bottom: CGFloat = 0
    }

    private func makeRoomForPlanButton(traits: UITraitCollection) -> PlanRoom {
      planButton.isHidden = facts?.planForToday != true
      guard !planButton.isHidden else { return PlanRoom() }
      let under = traits.preferredContentSizeCategory.isAccessibilityCategory
      let madeFor = (traits.preferredContentSizeCategory, traits.legibilityWeight)
      if planMadeFor.map({ $0 != madeFor }) ?? true {
        var button = UIButton.Configuration.plain()
        var title = AttributeContainer()
        title.font = UIFont.preferredFont(forTextStyle: .caption1, compatibleWith: traits)
        button.attributedTitle = AttributedString("Plan for today", attributes: title)
        button.baseForegroundColor = .secondaryLabel
        // Beside, the title ends where the other rows' words end and the gap before it is the words'; under, it
        // starts where the words start.
        button.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: under ? 0 : Self.planGap, bottom: 0, trailing: 0)
        planButton.configuration = button
        let size = planButton.intrinsicContentSize
        planWidth.constant = ceil(size.width)
        planHeight.constant = max(Self.minimumTouchTarget, ceil(size.height))
        planMadeFor = madeFor
      }
      return under ? PlanRoom(bottom: planHeight.constant) : PlanRoom(trailing: planWidth.constant)
    }

    /// The content's margins are widened by the room: the button sits in it, where the words would have ended or
    /// under them.
    private func pinPlanButton(_ room: PlanRoom) {
      guard let content = contentView as? UIListContentView else { return }
      if planMargins !== content.layoutMarginsGuide {
        NSLayoutConstraint.deactivate(planBeside + planUnder)
        let margins = content.layoutMarginsGuide
        planBeside = [planButton.trailingAnchor.constraint(equalTo: margins.trailingAnchor), planOnFirstLine]
        planUnder = [
          planButton.leadingAnchor.constraint(equalTo: line.leadingAnchor),
          planButton.topAnchor.constraint(equalTo: margins.bottomAnchor),
        ]
        planMargins = margins
      }
      let under = room.bottom > 0
      if let trailing = planBeside.first, abs(trailing.constant - room.trailing) > 0.01 { trailing.constant = room.trailing }
      if under, planBeside.first?.isActive == true { NSLayoutConstraint.deactivate(planBeside) }
      if !under, planUnder.first?.isActive == true { NSLayoutConstraint.deactivate(planUnder) }
      NSLayoutConstraint.activate(under ? planUnder : planBeside)
    }

    // MARK: configure

    /// While another action is out for this row: words and marks in the tertiary colour.
    private var dimmed = false

    func configure(
      status: TodoTask.Status?, facts: RowFacts?, canBeTicked: Bool, dimmed: Bool = false, depth: Int,
      text: AttributedString,
      editable: Bool, rowID: String, taskId: String, delegate: LineTextViewDelegate?, onTick: @escaping () -> Void,
      onRowAction: @escaping (RowRequest.Kind) -> Bool = { _ in false }
    ) {
      self.status = status
      self.facts = facts
      self.dimmed = dimmed
      symbolName = Self.symbol(for: status)
      self.onTick = onTick
      self.onRowAction = onRowAction
      self.canBeTicked = canBeTicked
      // A cancelled to-do cannot be ticked, but its circle still opens its menu (`Restore`).
      circle.isEnabled = canBeTicked || facts?.menu != nil
      circle.accessibilityTraits = canBeTicked ? .button : [.button, .notEnabled]
      setDepth(depth)
      setWords(text, look: wordsLook, editable: editable, rowID: rowID, delegate: delegate)
      showActions(facts?.menu, for: ActionsOwner(rowID: rowID, taskId: taskId))
      isAccessibilityElement = false
      circle.accessibilityValue =
        switch status {
        case .done: "done"
        case .cancelled: "cancelled"
        case .open, .other, nil: "not done"
        }
    }

    /// Dims the row, or no longer, in place: the words keep the caret and the keyboard.
    func setDimmed(_ dimmed: Bool) {
      guard dimmed != self.dimmed else { return }
      self.dimmed = dimmed
      setLook(wordsLook)
    }

    private var wordsLook: LineLook {
      let finished = status == .done || status == .cancelled
      return LineLook(
        textStyle: .body, color: dimmed ? .tertiaryLabel : finished ? .secondaryLabel : .label,
        struckThrough: finished)
    }

    override func wordsDidChange() {
      circle.accessibilityLabel = "Complete " + String(words.characters)
    }

    override func updateConfiguration(using state: UICellConfigurationState) {
      var content = defaultContentConfiguration()
      let finished = status == .done || status == .cancelled
      let room = makeRoomForPlanButton(traits: state.traitCollection)
      if room.trailing > 0 {
        // The list content view keeps the larger of its configuration's margin and the cell's own, so the room is
        // added to the one the words would end at, or the button would sit past it by the difference. The cell's own
        // counts the safe area (a phone on its side), which the content view adds to its margins again: it is taken
        // out, or the button would sit that far in from the other rows' end.
        let safeArea = effectiveUserInterfaceLayoutDirection == .rightToLeft ? safeAreaInsets.left : safeAreaInsets.right
        content.directionalLayoutMargins.trailing =
          max(content.directionalLayoutMargins.trailing, directionalLayoutMargins.trailing - safeArea) + room.trailing
      }
      content.directionalLayoutMargins.bottom += room.bottom
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
      pinPlanButton(room)
      let elements: [Any] =
        [circle, line] + (marks.spoken == nil ? [] : [marksElement]) + (planButton.isHidden ? [] : [planButton])
      if marksElement.accessibilityLabel != marks.spoken || (accessibilityElements?.count ?? 0) != elements.count {
        marksElement.accessibilityLabel = marks.spoken
        accessibilityElements = elements
      }

      let tint: UIColor = finished ? .tintColor : .secondaryLabel
      var button = UIButton.Configuration.plain()
      button.image = symbol
      button.preferredSymbolConfigurationForImage = symbolConfiguration
      button.contentInsets = .zero
      button.baseForegroundColor = tint
      // A circle that cannot be ticked looks as it does for its status, not the system's disabled grey; one that can
      // keeps the system's pressed look (docs/design/native-system.md).
      if !canBeTicked { button.imageColorTransformer = UIConfigurationColorTransformer { _ in tint } }
      button.symbolContentTransition = UISymbolContentTransition(.replace)
      circle.configuration = button

      let glyph = symbol?.withConfiguration(symbolConfiguration.withTraitCollection(state.traitCollection)).size ?? .zero
      circleWidth.constant = max(Self.minimumTouchTarget, glyph.width)
      circleHeight.constant = max(Self.minimumTouchTarget, glyph.height)
      placeOnFirstLine(firstLineMidline(traits: state.traitCollection))
      centreOnImageSlot()
    }

    /// The circle and the button, level with the middle of the words' first line.
    private func placeOnFirstLine(_ midline: CGFloat) {
      if abs(circleOnFirstLine.constant - midline) > 0.01 { circleOnFirstLine.constant = midline }
      if abs(planOnFirstLine.constant - midline) > 0.01 { planOnFirstLine.constant = midline }
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

  extension TodoBlockCell: @MainActor UIEditMenuInteractionDelegate {
    /// The row's own menu, not the text's suggested actions.
    func editMenuInteraction(
      _ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration,
      suggestedActions: [UIMenuElement]
    ) -> UIMenu? {
      circle.menu
    }

    /// The menu keeps clear of the caret it was opened at.
    func editMenuInteraction(_ interaction: UIEditMenuInteraction, targetRectFor configuration: UIEditMenuConfiguration)
      -> CGRect
    {
      guard let caret = line.selectedTextRange else { return .null }
      return line.convert(line.caretRect(for: caret.end), to: self)
    }
  }
#endif
