/// JavaScript's white space (`\s`, `String#trim`): U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A,
/// U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Not Swift's: U+0085 and U+200B are not in it.
enum JavaScriptSpace {
  static func contains(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }

  /// `text.trim()`.
  static func trimmed(_ text: String) -> String {
    var scalars = Substring(text).unicodeScalars
    while let first = scalars.first, contains(first) { scalars.removeFirst() }
    while let last = scalars.last, contains(last) { scalars.removeLast() }
    return String(scalars)
  }
}
