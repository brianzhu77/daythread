import DaythreadSync
import UIKit

/// What the notice says (`native-phase-1.md` §11.5).
struct Notice: Equatable {
  /// How long it stays: 8 s after an action, 4 s for `Undone`, 6 s for a failure.
  enum Kind: Equatable { case done, undone, failed }
  let text: String
  let kind: Kind
  /// The operation an `Undo` would undo; nil for no button.
  let undoing: String?
}

extension Notice.Kind {
  fileprivate var stays: Duration {
    switch self {
    case .done: .seconds(8)
    case .undone: .seconds(4)
    case .failed: .seconds(6)
    }
  }
}

/// One line of words with at most one button, floating at the top of the screen under the navigation bar, where the
/// web's phone app shows its notices. iOS has no component for it. The host pins this view to its own edges; only the
/// notice's surface takes touches, the rest of the page is reached through it.
///
/// The surface is the system's glass (`UIGlassEffect`), which is the material iOS 26 gives a surface that floats
/// over content, as its tab bar and bar buttons float; a blur is what an older system gave such a surface. It
/// never becomes first responder, so the keyboard and the caret of the page stay as they are.
@MainActor
final class NoticeView: UIView {
  /// What the button says, and the accessibility action with it.
  static let undoTitle = "Undo"
  /// An iPad or a Mac window is wider than a line of words should run.
  static let widest: CGFloat = 560

  var onUndo: ((_ operationId: String) -> Void)?
  private(set) var shown: Notice?

  private let sleep: @Sendable (Duration) async throws -> Void
  private let voiceOverRunning: @MainActor () -> Bool
  private let announce: @MainActor (String) -> Void

  private let surface = UIVisualEffectView(effect: UIGlassEffect())
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
  }

  /// The `Undo` leaves for good; the words stay until their time is up.
  func withdrawUndo() {
    guard let notice = shown, notice.undoing != nil else { return }
    let rest = Notice(text: notice.text, kind: notice.kind, undoing: nil)
    shown = rest
    apply(rest)
    // Counted from now, when the timer was held back for the button.
    if timer == nil { startTimer() }
  }

  func dismiss() {
    guard shown != nil else { return }
    timer?.cancel()
    timer = nil
    generation += 1
    shown = nil
    surface.isAccessibilityElement = false
    UIView.animate(
      withDuration: 0.2,
      animations: { self.surface.alpha = 0 },
      completion: { [weak self] _ in
        guard let self, shown == nil else { return }
        surface.isHidden = true
      })
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

  override func layoutSubviews() {
    super.layoutSubviews()
    // At the accessibility sizes the button goes under the words, so neither is squeezed.
    let axis: NSLayoutConstraint.Axis = traitCollection.preferredContentSizeCategory.isAccessibilityCategory ? .vertical : .horizontal
    if content.axis != axis {
      content.axis = axis
      content.alignment = axis == .vertical ? .leading : .center
      setNeedsLayout()
    }
  }

  private func build() {
    surface.isHidden = true
    surface.cornerConfiguration = .capsule(maximumRadius: 24)
    surface.translatesAutoresizingMaskIntoConstraints = false
    addSubview(surface)

    label.font = .preferredFont(forTextStyle: .footnote)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = .label
    label.numberOfLines = 0
    label.setContentHuggingPriority(.defaultLow, for: .horizontal)
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

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
    gutter.priority = .defaultHigh
    let gutterEnd = surface.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -16)
    gutterEnd.priority = .defaultHigh
    NSLayoutConstraint.activate([
      surface.topAnchor.constraint(equalToSystemSpacingBelow: safeAreaLayoutGuide.topAnchor, multiplier: 1),
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
      configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
        var attributes = $0
        attributes.font = .preferredFont(forTextStyle: .footnote)
        return attributes
      }
      let undo = UIButton(
        configuration: configuration,
        primaryAction: UIAction { [weak self] _ in self?.undo(operation, of: mine) })
      undo.setContentHuggingPriority(.required, for: .horizontal)
      undo.setContentCompressionResistancePriority(.required, for: .horizontal)
      undo.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      content.addArrangedSubview(undo)
      button = undo
    }
    content.directionalLayoutMargins = NSDirectionalEdgeInsets(
      top: notice.undoing == nil ? 12 : 0, leading: 16, bottom: notice.undoing == nil ? 12 : 0, trailing: 8)

    surface.isAccessibilityElement = true
    surface.accessibilityLabel = notice.text
    surface.accessibilityTraits = .staticText
    if let operation = notice.undoing {
      let mine = generation
      surface.accessibilityCustomActions = [
        UIAccessibilityCustomAction(name: Self.undoTitle) { [weak self] _ in
          self?.undo(operation, of: mine) ?? false
        }
      ]
    } else {
      surface.accessibilityCustomActions = nil
    }
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
