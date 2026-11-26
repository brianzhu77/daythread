import Foundation

/// How a line's words on screen are read back into `InlineContent`, and, on UIKit, how they are drawn.
enum InlineTextStorage {
  /// The one replacement of UTF-16 units that turns `old` into `new`: the units the two share at the start and at the
  /// end are kept, so a change made away from the caret (an autocorrection) replaces only what changed. Only where the
  /// two could share more than the shorter holds (a character typed beside the same character) does the caret say
  /// where the change was. A replacement never starts or ends inside a surrogate pair. Nil when the two are the same.
  static func change(from old: String, to new: String, caret: Int) -> (range: Range<Int>, text: String)? {
    let before = Array(old.utf16)
    let after = Array(new.utf16)
    if before == after { return nil }
    let shortest = min(before.count, after.count)
    var prefix = 0
    while prefix < shortest, before[prefix] == after[prefix] { prefix += 1 }
    var suffix = 0
    while suffix < shortest, before[before.count - 1 - suffix] == after[after.count - 1 - suffix] { suffix += 1 }
    if prefix + suffix > shortest {
      // The changed units could be anywhere in a run of repeats: take the place that ends where the caret is.
      let inserted = max(0, after.count - before.count)
      prefix = min(max(caret - inserted, shortest - suffix), prefix)
      suffix = shortest - prefix
    }
    while prefix > 0, splitsPair(before, at: prefix) || splitsPair(after, at: prefix) { prefix -= 1 }
    while suffix > 0, splitsPair(before, at: before.count - suffix) || splitsPair(after, at: after.count - suffix) {
      suffix -= 1
    }
    let inserted = String(decoding: after[prefix..<(after.count - suffix)], as: UTF16.self)
    return (prefix..<(before.count - suffix), inserted)
  }

  private static func splitsPair(_ units: [UInt16], at offset: Int) -> Bool {
    offset > 0 && offset < units.count && UTF16.isLeadSurrogate(units[offset - 1])
      && UTF16.isTrailSurrogate(units[offset])
  }
}

#if canImport(UIKit)
  import UIKit

  extension InlineTextStorage {
    /// On a token's attachment character: the words the token is drawn with, for the pasteboard.
    static let tokenWords = NSAttributedString.Key("daythread.tokenWords")

    /// A token's attachment: an image of its words, set on the line's baseline as the words around it are, at most
    /// `maxWidth` wide, its words cut at the end when they are longer.
    static func token(drawing words: NSAttributedString, maxWidth: CGFloat = .greatestFiniteMagnitude)
      -> NSTextAttachment
    {
      let font = words.length > 0 ? words.attribute(.font, at: 0, effectiveRange: nil) as? UIFont : nil
      let measured = words.size()
      let size = CGSize(width: max(min(ceil(measured.width), floor(maxWidth)), 1), height: ceil(measured.height))
      let shown = NSMutableAttributedString(attributedString: words)
      let paragraph = NSMutableParagraphStyle()
      paragraph.lineBreakMode = .byTruncatingTail
      shown.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: shown.length))
      let image = UIGraphicsImageRenderer(size: size).image { _ in
        shown.draw(
          with: CGRect(origin: .zero, size: size), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
          context: nil)
      }
      return attachment(image, bounds: CGRect(origin: CGPoint(x: 0, y: font?.descender ?? 0), size: size))
    }

    /// An attachment that keeps the bounds it is given: the one `NSTextAttachment(image:)` makes keeps none (seen on
    /// the simulator), so the words would sit on the baseline at the image's own size.
    private static func attachment(_ image: UIImage, bounds: CGRect) -> NSTextAttachment {
      let attachment = NSTextAttachment()
      attachment.image = image
      attachment.bounds = bounds
      return attachment
    }

    /// The same line for the row's label to lay out, drawn in no colour: the list content view sizes the row and
    /// places its bullet, number or circle from its label, and the text view over it draws the words and the caret.
    /// Each attachment becomes a blank of the same size, and a line that is empty or ends in a line break gets one
    /// zero-width character in `typing`'s font, so the label lays out every line the text view does.
    static func measure(_ shown: NSAttributedString, typing: [NSAttributedString.Key: Any]) -> NSAttributedString {
      let measure = NSMutableAttributedString(attributedString: shown)
      let whole = NSRange(location: 0, length: measure.length)
      measure.addAttribute(.foregroundColor, value: UIColor.clear, range: whole)
      measure.enumerateAttribute(.attachment, in: whole) { value, range, _ in
        guard let attachment = value as? NSTextAttachment else { return }
        let blank = Self.attachment(
          UIGraphicsImageRenderer(size: attachment.bounds.size).image { _ in }, bounds: attachment.bounds)
        measure.addAttribute(.attachment, value: blank, range: range)
      }
      if measure.length == 0 || measure.string.hasSuffix("\n") {
        var attributes = typing
        attributes[.foregroundColor] = UIColor.clear
        attributes[.attachment] = nil
        measure.append(NSAttributedString(string: "\u{200B}", attributes: attributes))
      }
      return measure
    }
  }
#endif
