import Foundation

/// How a line's words on screen are read back into `InlineContent`, and, on UIKit, how they are drawn.
enum InlineTextStorage {
  /// The one replacement of UTF-16 units that turns `old` into `new`, read around the caret. The units after the
  /// caret are kept first, so a character typed beside the same character lands where he typed it, inside the run
  /// he typed it in. A replacement never starts or ends inside a surrogate pair. Nil when the two are the same.
  static func change(from old: String, to new: String, caret: Int) -> (range: Range<Int>, text: String)? {
    let before = Array(old.utf16)
    let after = Array(new.utf16)
    if before == after { return nil }
    let shortest = min(before.count, after.count)
    var suffix = 0
    let suffixLimit = min(shortest, max(0, after.count - caret))
    while suffix < suffixLimit, before[before.count - 1 - suffix] == after[after.count - 1 - suffix] { suffix += 1 }
    while suffix > 0, splitsPair(before, at: before.count - suffix) || splitsPair(after, at: after.count - suffix) {
      suffix -= 1
    }
    var prefix = 0
    let prefixLimit = shortest - suffix
    while prefix < prefixLimit, before[prefix] == after[prefix] { prefix += 1 }
    while prefix > 0, splitsPair(before, at: prefix) || splitsPair(after, at: prefix) { prefix -= 1 }
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
    /// A token's attachment: an image of its words, set on the line's baseline as the words around it are.
    static func token(drawing words: NSAttributedString) -> NSTextAttachment {
      let font = words.length > 0 ? words.attribute(.font, at: 0, effectiveRange: nil) as? UIFont : nil
      let measured = words.size()
      let size = CGSize(width: max(ceil(measured.width), 1), height: ceil(measured.height))
      let image = UIGraphicsImageRenderer(size: size).image { _ in words.draw(at: .zero) }
      let attachment = NSTextAttachment(image: image)
      attachment.bounds = CGRect(origin: CGPoint(x: 0, y: font?.descender ?? 0), size: size)
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
        let blank = NSTextAttachment(image: UIGraphicsImageRenderer(size: attachment.bounds.size).image { _ in })
        blank.bounds = attachment.bounds
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
