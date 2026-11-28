#if canImport(UIKit)
  import UIKit

  /// The day's header, the page's first row as on the web: the relative word, the title button that opens the day
  /// picker, and the status line. System text styles and colours; the button is the system's, plainly configured.
  @MainActor
  final class DayHeaderView: UIView {
    let relativeLabel = UILabel()
    let titleButton: UIButton
    let statusLabel = UILabel()
    /// The title's stack, then what goes under it.
    private let outer = UIStackView()
    /// Called when the header's height changes: what is laid out under it follows.
    var onResize: (() -> Void)?
    private var laidOutHeight: CGFloat = 0

    override func layoutSubviews() {
      super.layoutSubviews()
      guard bounds.height != laidOutHeight else { return }
      laidOutHeight = bounds.height
      onResize?()
    }

    init(onTitle: @escaping () -> Void) {
      var configuration = UIButton.Configuration.plain()
      configuration.contentInsets = .zero
      // With no insets the letters reach the button's edge, where its default rounded corners cut the first letter's
      // corner off at large sizes: a plain button has no background to round.
      configuration.cornerStyle = .fixed
      configuration.background.cornerRadius = 0
      configuration.baseForegroundColor = .label
      configuration.titleLineBreakMode = .byWordWrapping
      // A wrapped title starts each line at the leading edge, as the text above and below it does.
      configuration.titleAlignment = .leading
      configuration.image = UIImage(systemName: "chevron.down")
      configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
        textStyle: .title3, scale: .small)
      configuration.imagePlacement = .trailing
      configuration.imagePadding = 6
      configuration.imageColorTransformer = UIConfigurationColorTransformer { _ in .secondaryLabel }
      titleButton = UIButton(configuration: configuration, primaryAction: UIAction { _ in onTitle() })
      super.init(frame: .zero)

      relativeLabel.font = Self.semiboldSubheadline()
      relativeLabel.adjustsFontForContentSizeCategory = true
      relativeLabel.numberOfLines = 0
      // The title button's label already says it.
      relativeLabel.isAccessibilityElement = false

      titleButton.contentHorizontalAlignment = .leading
      // As the system's own large titles do, the title stops growing before the widest short date ("Wed, Sep 30")
      // and its chevron no longer fit one line on a phone.
      titleButton.maximumContentSizeCategory = Self.largestTitleSize
      // The font is read from the button's own traits, so the cap above applies to it as it does to the chevron.
      titleButton.configurationUpdateHandler = { button in
        let font = Self.boldLargeTitle(for: button.traitCollection)
        button.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
          var attributes = attributes
          attributes.font = font
          return attributes
        }
      }
      titleButton.registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (button: UIButton, _) in
        button.setNeedsUpdateConfiguration()
      }

      statusLabel.font = .preferredFont(forTextStyle: .footnote)
      statusLabel.adjustsFontForContentSizeCategory = true
      statusLabel.textColor = .secondaryLabel
      statusLabel.numberOfLines = 0

      let titles = UIStackView(arrangedSubviews: [relativeLabel, titleButton, statusLabel])
      titles.axis = .vertical
      titles.alignment = .leading
      titles.spacing = 2
      titles.setCustomSpacing(4, after: titleButton)
      // The titles keep their own widths; what goes under them (the strip, 1d.2's draft line above it) takes the
      // header's whole width inside its margins.
      outer.addArrangedSubview(titles)
      outer.axis = .vertical
      outer.alignment = .fill
      outer.spacing = UIStackView.spacingUseSystem
      outer.translatesAutoresizingMaskIntoConstraints = false
      addSubview(outer)
      directionalLayoutMargins.top = 8
      directionalLayoutMargins.bottom = 16
      let margins = layoutMarginsGuide
      NSLayoutConstraint.activate([
        outer.topAnchor.constraint(equalTo: margins.topAnchor),
        outer.leadingAnchor.constraint(equalTo: margins.leadingAnchor),
        outer.trailingAnchor.constraint(equalTo: margins.trailingAnchor),
        outer.bottomAnchor.constraint(equalTo: margins.bottomAnchor),
      ])
    }

    /// Puts `view` under the title's stack, the header's full width inside its margins; hidden, it takes no room.
    func hold(facts view: UIView) {
      guard view.superview !== outer else { return }
      outer.addArrangedSubview(view)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Shows `heading` and `status`; returns whether anything changed, so the host lays the list out again only then.
    @discardableResult
    func show(_ heading: DayHeading, status: String?) -> Bool {
      let relative = heading.relative?.text
      let label = heading.accessibilityLabel
      guard relativeLabel.text != relative || titleButton.configuration?.title != heading.title
        || titleButton.accessibilityLabel != label || statusLabel.text != status
      else { return false }
      relativeLabel.text = relative
      relativeLabel.isHidden = relative == nil
      relativeLabel.textColor = heading.relative == .today ? .tintColor : .secondaryLabel
      titleButton.configuration?.title = heading.title
      titleButton.accessibilityLabel = label
      statusLabel.text = status
      statusLabel.isHidden = status == nil
      return true
    }

    /// The largest text size the title follows; see `maximumContentSizeCategory` in `init`.
    static let largestTitleSize = UIContentSizeCategory.accessibilityExtraLarge

    private static func boldLargeTitle(for traits: UITraitCollection) -> UIFont {
      let font = UIFont.preferredFont(forTextStyle: .largeTitle, compatibleWith: traits)
      return font.fontDescriptor.withSymbolicTraits(.traitBold).map { UIFont(descriptor: $0, size: 0) } ?? font
    }

    private nonisolated static func semiboldSubheadline() -> UIFont {
      let base = UIFont.preferredFont(
        forTextStyle: .subheadline, compatibleWith: UITraitCollection(preferredContentSizeCategory: .large))
      return UIFontMetrics(forTextStyle: .subheadline).scaledFont(
        for: .systemFont(ofSize: base.pointSize, weight: .semibold))
    }
  }
#endif
