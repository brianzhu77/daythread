import DaythreadCore
import Foundation
import Testing
import UIKit

@testable import DaythreadUI

/// The day's header drawn at the largest accessibility text size: the whole title is visible, on one line at an
/// iPhone 17's width, with the chevron after it.
@MainActor
@Suite struct DayHeaderViewTests {
  /// A header showing `date` in a window `width` points wide at `size`, laid out.
  private func header(_ date: String, width: CGFloat, size: UIContentSizeCategory) throws -> (DayHeaderView, UIWindow) {
    let window = try testWindow(width: width)
    let host = UIViewController()
    host.traitOverrides.preferredContentSizeCategory = size
    window.rootViewController = host
    window.makeKeyAndVisible()
    let header = DayHeaderView {}
    header.show(
      DayHeading(for: LocalDate(date)!, today: LocalDate("2026-11-25")!, locale: Locale(identifier: "en_US")),
      status: nil)
    header.translatesAutoresizingMaskIntoConstraints = false
    host.view.addSubview(header)
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: host.view.topAnchor, constant: 100),
      header.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
      header.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
    ])
    header.directionalLayoutMargins.leading = 20
    header.directionalLayoutMargins.trailing = 20
    window.layoutIfNeeded()
    return (header, window)
  }

  private func check(_ header: DayHeaderView, oneLine: Bool, sourceLocation: SourceLocation = #_sourceLocation) throws {
    let button = header.titleButton
    let title = try #require(button.titleLabel, sourceLocation: sourceLocation)
    let chevron = try #require(button.imageView, sourceLocation: sourceLocation)
    let drawn = title.convert(title.bounds, to: header)
    let text = title.textRect(forBounds: title.bounds, limitedToNumberOfLines: 0)
    let textInHeader = title.convert(text, to: header)
    #expect(drawn.minX >= -0.5 && drawn.maxX <= header.bounds.width + 0.5, "title \(drawn) in \(header.bounds)",
      sourceLocation: sourceLocation)
    #expect(text.width <= title.bounds.width + 0.5, "the text \(text.width) fits its label \(title.bounds.width)",
      sourceLocation: sourceLocation)
    #expect(textInHeader.minX >= -0.5, "nothing clipped at the leading edge", sourceLocation: sourceLocation)
    // The title grows with the reader's text size, as far as its cap: it is not drawn at the default size.
    let standard = UIFont.preferredFont(
      forTextStyle: .largeTitle, compatibleWith: UITraitCollection(preferredContentSizeCategory: .large))
    #expect(title.font.pointSize > standard.pointSize, "drawn at \(title.font.pointSize)", sourceLocation: sourceLocation)
    // The letters reach the button's edges (it has no insets), so no view from the title up to the button may round
    // its corners: a rounded corner cuts the first letter's corner off ("T" of "Thu" at the largest sizes).
    var ancestor = title.superview
    while let view = ancestor, view !== header {
      #expect(view.layer.cornerRadius == 0, "a \(type(of: view)) rounds its corners by \(view.layer.cornerRadius)",
        sourceLocation: sourceLocation)
      if view === button { break }
      ancestor = view.superview
    }
    let lineHeight = title.font.lineHeight
    if oneLine {
      #expect(text.height < lineHeight * 1.5, "one line: \(text.height) for a line of \(lineHeight)",
        sourceLocation: sourceLocation)
    }
    let image = chevron.convert(chevron.bounds, to: header)
    #expect(image.minX >= drawn.minX + text.width - 0.5, "the chevron after the title", sourceLocation: sourceLocation)
    #expect(image.maxX <= header.bounds.width - header.directionalLayoutMargins.trailing + 0.5, "the chevron within the margins", sourceLocation: sourceLocation)
  }

  @Test func at_the_largest_size_every_date_of_a_year_is_one_whole_line_on_an_iphone_17() throws {
    let (header, window) = try header("2026-09-30", width: 402, size: .accessibilityExtraExtraExtraLarge)
    try check(header, oneLine: true)
    var day = LocalDate("2026-01-01")
    while let date = day, date.value.hasPrefix("2026") {
      header.show(
        DayHeading(for: date, today: LocalDate("2026-11-25")!, locale: Locale(identifier: "en_US")), status: nil)
      window.layoutIfNeeded()
      try check(header, oneLine: true)
      day = date.adding(days: 1)
    }
    window.isHidden = true
  }

  @Test func on_a_narrow_screen_at_the_largest_size_the_title_wraps_without_clipping() throws {
    let (header, window) = try header("2026-11-26", width: 320, size: .accessibilityExtraExtraExtraLarge)
    try check(header, oneLine: false)
    window.isHidden = true
  }
}
