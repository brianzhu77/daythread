import DaythreadSync
import UIKit

/// What the notice says (`native-phase-1.md` §11.5).
struct Notice: Equatable {
  /// How long it stays: 8 s after an action, 10 s after a draft's skip (the web's time for `Skipped`), 4 s for
  /// `Undone`, 6 s for a failure.
  enum Kind: Equatable { case done, skipped, undone, failed }
  let text: String
  let kind: Kind
  /// The operation an `Undo` would undo; nil for no button.
  let undoing: String?
}

extension Notice.Kind {
  fileprivate var stays: Duration {
    switch self {
    case .done: .seconds(8)
    case .skipped: .seconds(10)
    case .undone: .seconds(4)
    case .failed: .seconds(6)
    }
  }
}

/// One line of words with at most one button, floating at the top of the screen: on a phone directly under the
/// status bar, where the web's phone app shows its notices; at regular width under the navigation bar. iOS has no
/// component for it. The host pins this view to its own edges; only the
/// notice's surface takes touches, the rest of the page is reached through it.
///
/// The surface is the system's material (`UIBlurEffect(style: .systemMaterial)`), not its glass: on the device's
/// screen the glass let the rows beneath read through the notice's words (dark at the largest text size most of
/// all) and bent a row's circle into a mark at its end, while the material keeps the words on a quiet ground. It
/// never becomes first responder, so the keyboard and the caret of the page stay as they are.
@MainActor
final class NoticeView: UIView {
  /// What the button says, and the accessibility action with it.
  static let undoTitle = "Undo"
  /// An iPad or a Mac window is wider than a line of words should run.
  static let widest: CGFloat = 560

  var onUndo: ((_ operationId: String) -> Void)?
  /// Called whenever what it shows changes: shown, its Undo withdrawn, timed out, swiped away, dismissed.
  var onChange: ((Notice?) -> Void)?
  private(set) var shown: Notice?

  private let sleep: @Sendable (Duration) async throws -> Void
  private let voiceOverRunning: @MainActor () -> Bool
  private let announce: @MainActor (String) -> Void

  private let surface = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
  private let content = UIStackView()
  private let label = UILabel()
  private var button: UIButton?
  private var timer: Task<Void, Never>?
  /// Counts the notices shown, so a button or a wait of an earlier one can tell it is no longer the one showing.
  private var generation = 0

  init(
    sleep: @escaping @Sendable (Duration) async throws -> Void = SyncEngine.sleep,
    voiceOverRunning: @escaping @MainActor () -> Bool = { UIAccessibility.isVoiceOverRunning },
    announce: @escaping @MainActor (String) -> Void = {
      UIAccessibility.post(notification: .announcement, argument: $0)
    }
  ) {
    self.sleep = sleep
    self.voiceOverRunning = voiceOverRunning
    self.announce = announce
    super.init(frame: .zero)
    build()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  isolated deinit {
    timer?.cancel()
  }

  /// Replaces the notice showing, if any, and starts its time.
  func show(_ notice: Notice) {
    timer?.cancel()
    timer = nil
    generation += 1
    let wasShowing = shown != nil
    shown = notice
    apply(notice)
    surface.layer.removeAllAnimations()
    surface.isHidden = false
    if !wasShowing {
      surface.alpha = 0
      UIView.animate(withDuration: 0.2) { self.surface.alpha = 1 }
    } else {
      surface.alpha = 1
    }
    let voiceOver = voiceOverRunning()
    if voiceOver { announce(notice.text) }
    // A person using VoiceOver may need longer than the timer gives to reach the button.
    if !(voiceOver && notice.undoing != nil) { startTimer() }
    onChange?(shown)
  }

  /// The `Undo` leaves for good; the words stay until their time is up.
  func withdrawUndo() {
    guard let notice = shown, notice.undoing != nil else { return }
    let rest = Notice(text: notice.text, kind: notice.kind, undoing: nil)
    shown = rest
    apply(rest)
    // Counted from now, when the timer was held back for the button.
    if timer == nil { startTimer() }
    onChange?(shown)
  }

  func dismiss() {
    guard shown != nil else { return }
    timer?.cancel()
    timer = nil
    generation += 1
    shown = nil
    // Gone for VoiceOver at once, not when the fade ends: its words and their action would otherwise still be read.
    surface.accessibilityElements = []
    label.accessibilityCustomActions = nil
    UIView.animate(
      withDuration: 0.2,
      animations: { self.surface.alpha = 0 },
      completion: { [weak self] _ in
        guard let self, shown == nil else { return }
        surface.isHidden = true
      })
    onChange?(nil)
  }

  /// The surface, and nothing around it, takes touches.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }

  override func accessibilityPerformEscape() -> Bool {
    guard shown != nil else { return false }
    dismiss()
    return true
  }

  @objc func swipedUp() {
    dismiss()
  }

  // MARK: Where it sits

  /// The guide whose top is the navigation bar's bottom. Its own safe area unless the host says otherwise: a host
  /// that puts the notice above its navigation bar (so it can cover the bar on a phone) gives the page's guide.
  var barGuide: UILayoutGuide? {
    didSet {
      guard barGuide !== oldValue else { return }
      let active = underNavigationBar.isActive
      underNavigationBar.isActive = false
      underNavigationBar = Self.underBar(surface, of: barGuide ?? safeAreaLayoutGuide)
      underNavigationBar.isActive = active
      setNeedsLayout()
    }
  }

  /// Regular width (iPad, Mac): one system spacing under the bar guide's top, so under the navigation bar.
  private lazy var underNavigationBar = Self.underBar(surface, of: safeAreaLayoutGuide)

  private static func underBar(_ surface: UIView, of guide: UILayoutGuide) -> NSLayoutConstraint {
    surface.topAnchor.constraint(equalToSystemSpacingBelow: guide.topAnchor, multiplier: 1)
  }
  /// A phone (compact width or compact height): one spacing under the window's own top inset, the status bar or the
  /// island, as the web's phone notice sits; over the navigation bar's band, so the day's title and the first rows of
  /// a page at its top stay uncovered.
  private lazy var underStatusBar = surface.topAnchor.constraint(equalTo: topAnchor)
  private static let spacing: CGFloat = 8

  private var onAPhone: Bool {
    traitCollection.horizontalSizeClass == .compact || traitCollection.verticalSizeClass == .compact
  }

  /// The place for the traits and the window's inset now; changes a constraint only when it moves.
  private func place() {
    let phone = onAPhone
    if phone, let window {
      let statusBar = convert(CGPoint(x: 0, y: window.safeAreaInsets.top), from: window).y
      let top = statusBar + Self.spacing
      if abs(underStatusBar.constant - top) > 0.01 { underStatusBar.constant = top }
    }
    guard underStatusBar.isActive != phone else { return }
    NSLayoutConstraint.deactivate([phone ? underNavigationBar : underStatusBar])
    NSLayoutConstraint.activate([phone ? underStatusBar : underNavigationBar])
  }

  override func layoutSubviews() {
    place()
    super.layoutSubviews()
    // At the accessibility sizes the button goes under the words, so neither is squeezed.
    let axis: NSLayoutConstraint.Axis = traitCollection.preferredContentSizeCategory.isAccessibilityCategory ? .vertical : .horizontal
    if content.axis != axis {
      content.axis = axis
      content.alignment = axis == .vertical ? .fill : .center
      fitContent()
      setNeedsLayout()
    }
  }

  private func build() {
    surface.isHidden = true
    surface.cornerConfiguration = .capsule(maximumRadius: 24)
    // A material, unlike the glass, is drawn to its corners only when clipped to them.
    surface.clipsToBounds = true
    surface.translatesAutoresizingMaskIntoConstraints = false
    addSubview(surface)

    label.font = .preferredFont(forTextStyle: .footnote)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = .label
    label.numberOfLines = 0
    label.setContentHuggingPriority(.defaultLow, for: .horizontal)
    // Just under the gutters' priority, so a long line wraps rather than widens the surface.
    label.setContentCompressionResistancePriority(UILayoutPriority(749), for: .horizontal)

    content.axis = .horizontal
    content.alignment = .center
    content.spacing = 12
    content.addArrangedSubview(label)
    content.isLayoutMarginsRelativeArrangement = true
    content.translatesAutoresizingMaskIntoConstraints = false
    surface.contentView.addSubview(content)

    let swipe = UISwipeGestureRecognizer(target: self, action: #selector(swipedUp))
    swipe.direction = .up
    surface.addGestureRecognizer(swipe)

    let gutter = surface.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 16)
    gutter.priority = UILayoutPriority(999)
    let gutterEnd = surface.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -16)
    gutterEnd.priority = UILayoutPriority(999)
    NSLayoutConstraint.activate([
      underNavigationBar,
      surface.centerXAnchor.constraint(equalTo: centerXAnchor),
      surface.widthAnchor.constraint(lessThanOrEqualToConstant: Self.widest),
      surface.leadingAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.leadingAnchor, constant: 8),
      surface.trailingAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor, constant: -8),
      gutter, gutterEnd,
      content.topAnchor.constraint(equalTo: surface.contentView.topAnchor),
      content.bottomAnchor.constraint(equalTo: surface.contentView.bottomAnchor),
      content.leadingAnchor.constraint(equalTo: surface.contentView.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: surface.contentView.trailingAnchor),
    ])
  }

  /// Draws `notice`: its words, its button if it has an operation to undo, and what VoiceOver reads.
  private func apply(_ notice: Notice) {
    label.text = notice.text
    button?.removeFromSuperview()
    button = nil
    if let operation = notice.undoing {
      let mine = generation
      var configuration = UIButton.Configuration.plain()
      configuration.title = Self.undoTitle
      let undo = UIButton(
        configuration: configuration,
        primaryAction: UIAction { [weak self] _ in self?.undo(operation, of: mine) })
      // The plain style's title is body text; footnote like the words, in the size this button's own traits give.
      undo.configurationUpdateHandler = { button in
        let font = UIFont.preferredFont(forTextStyle: .footnote, compatibleWith: button.traitCollection)
        button.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
          var attributes = $0
          attributes.font = font
          return attributes
        }
      }
      undo.isAccessibilityElement = true
      undo.setContentCompressionResistancePriority(.required, for: .horizontal)
      undo.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      content.addArrangedSubview(undo)
      button = undo
    }
    fitContent()

    // The words are the element VoiceOver reads and the one that carries the action; the button stays an element of
    // its own so Voice Control and Full Keyboard Access reach it.
    surface.isAccessibilityElement = false
    surface.accessibilityElements = [label] + (button.map { [$0] } ?? [])
    label.isAccessibilityElement = true
    label.accessibilityLabel = notice.text
    if let operation = notice.undoing {
      let mine = generation
      label.accessibilityCustomActions = [
        UIAccessibilityCustomAction(name: Self.undoTitle) { [weak self] _ in
          self?.undo(operation, of: mine) ?? false
        }
      ]
    } else {
      label.accessibilityCustomActions = nil
    }
  }

  /// The margins and the button's room for the notice showing and the axis in use. The title inside the button's
  /// own 12-point inset ends 16 points from the surface's edge, as the words start 16 points from the other.
  private func fitContent() {
    let hasButton = button != nil
    if content.axis == .vertical {
      content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 16, leading: 16, bottom: 4, trailing: 16)
    } else {
      let side: CGFloat = hasButton ? 0 : 12
      content.directionalLayoutMargins = NSDirectionalEdgeInsets(
        top: side, leading: 16, bottom: side, trailing: hasButton ? 4 : 16)
    }
    // Beside the words it keeps its own width; under them it takes the surface's, which the words' hugging would
    // otherwise pull narrow.
    button?.setContentHuggingPriority(content.axis == .vertical ? .defaultLow : .required, for: .horizontal)
  }

  /// Reports `operation` once, and only while it is the notice showing and its button still stands.
  @discardableResult
  private func undo(_ operation: String, of notice: Int) -> Bool {
    guard notice == generation, shown?.undoing == operation else { return false }
    withdrawUndo()
    onUndo?(operation)
    return true
  }

  private func startTimer() {
    guard let notice = shown else { return }
    let mine = generation
    let sleep = sleep
    let stays = notice.kind.stays
    timer = Task { [weak self] in
      do { try await sleep(stays) } catch { return }
      guard let self, generation == mine else { return }
      dismiss()
    }
  }
}
