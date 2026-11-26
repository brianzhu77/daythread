#if canImport(UIKit)
  import UIKit

  /// The day's header, the page's first row as on the web: the relative word, the title button that opens the day
  /// picker, and the status line. System text styles and colours; the button is the system's, plainly configured.
  @MainActor
  final class DayHeaderView: UIView {
    let relativeLabel = UILabel()
    let titleButton: UIButton
    let statusLabel = UILabel()
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
      configuration.baseForegroundColor = .label
      configuration.titleLineBreakMode = .byWordWrapping
      configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var attributes = attributes
        attributes.font = Self.boldLargeTitle()
        return attributes
      }
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

      statusLabel.font = .preferredFont(forTextStyle: .footnote)
      statusLabel.adjustsFontForContentSizeCategory = true
      statusLabel.textColor = .secondaryLabel
      statusLabel.numberOfLines = 0

      let stack = UIStackView(arrangedSubviews: [relativeLabel, titleButton, statusLabel])
      stack.axis = .vertical
      stack.alignment = .leading
      stack.spacing = 2
      stack.setCustomSpacing(4, after: titleButton)
      stack.translatesAutoresizingMaskIntoConstraints = false
      addSubview(stack)
      directionalLayoutMargins.top = 8
      directionalLayoutMargins.bottom = 16
      let margins = layoutMarginsGuide
      NSLayoutConstraint.activate([
        stack.topAnchor.constraint(equalTo: margins.topAnchor),
        stack.leadingAnchor.constraint(equalTo: margins.leadingAnchor),
        stack.trailingAnchor.constraint(lessThanOrEqualTo: margins.trailingAnchor),
        stack.bottomAnchor.constraint(equalTo: margins.bottomAnchor),
      ])
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

    private nonisolated static func boldLargeTitle() -> UIFont {
      let font = UIFont.preferredFont(forTextStyle: .largeTitle)
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
