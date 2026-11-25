/// Why `JSON.parse` rejected its input, and the byte offset (in UTF-8) where it noticed.
public struct JSONError: Error, Hashable, Sendable {
  public enum Reason: Hashable, Sendable {
    case unexpectedEnd
    case unexpectedCharacter
    case trailingCharacters
    case unterminatedString
    case controlCharacterInString
    case badEscape
    case badNumber
    case tooDeep
  }

  public var reason: Reason
  public var offset: Int

  public init(reason: Reason, offset: Int) {
    self.reason = reason
    self.offset = offset
  }
}

extension JSON {
  /// The deepest nesting of arrays and objects `parse` accepts, so a hostile document cannot
  /// overflow the stack.
  static let maximumDepth = 512

  /// Reads a JSON text. Whitespace between tokens is accepted and not kept; a repeated object key
  /// keeps its first position and last value, as `JSON.parse` does.
  public static func parse(_ text: String) throws -> JSONValue {
    var parser = JSONParser(bytes: Array(text.utf8))
    return try parser.parseDocument()
  }
}

private struct JSONParser {
  let bytes: [UInt8]
  var position = 0

  init(bytes: [UInt8]) { self.bytes = bytes }

  /// An array or object being filled. The parser keeps these on an explicit stack instead of
  /// recursing, so a deeply nested document costs heap rather than stack.
  private struct Container {
    var isObject: Bool
    var items: [JSONValue] = []
    var members = JSONObject()
    var pendingKey = ""
  }

  mutating func parseDocument() throws -> JSONValue {
    let value = try parseValue()
    skipWhitespace()
    guard position == bytes.count else { throw error(.trailingCharacters) }
    return value
  }

  // MARK: Values

  private mutating func parseValue() throws -> JSONValue {
    var stack: [Container] = []
    while true {
      // nil: a non-empty container was opened, so read its first member.
      guard var value = try parseOpeningOrScalar(into: &stack) else { continue }
      // Attach the value to its parent, closing every container it completes.
      while true {
        guard stack.indices.last != nil else { return value }
        let last = stack.count - 1
        if stack[last].isObject {
          stack[last].members[stack[last].pendingKey] = value
        } else {
          stack[last].items.append(value)
        }
        skipWhitespace()
        guard let byte = peek() else { throw error(.unexpectedEnd) }
        let closer = stack[last].isObject ? UInt8(ascii: "}") : UInt8(ascii: "]")
        if byte == closer {
          position += 1
          let closed = stack.removeLast()
          value = closed.isObject ? .object(closed.members) : .array(closed.items)
          continue
        }
        guard byte == UInt8(ascii: ",") else { throw error(.unexpectedCharacter) }
        position += 1
        if stack[last].isObject { stack[last].pendingKey = try parseMemberKey() }
        break
      }
    }
  }

  /// Reads one value. A scalar, or an empty array or object, is returned. A non-empty array or
  /// object is pushed on `stack` (with its first member's key read) and nil is returned.
  private mutating func parseOpeningOrScalar(into stack: inout [Container]) throws -> JSONValue? {
    skipWhitespace()
    guard let byte = peek() else { throw error(.unexpectedEnd) }
    switch byte {
    case UInt8(ascii: "["), UInt8(ascii: "{"):
      guard stack.count < JSON.maximumDepth else { throw error(.tooDeep) }
      let isObject = byte == UInt8(ascii: "{")
      position += 1
      skipWhitespace()
      if peek() == (isObject ? UInt8(ascii: "}") : UInt8(ascii: "]")) {
        position += 1
        return isObject ? .object(JSONObject()) : .array([])
      }
      var container = Container(isObject: isObject)
      if isObject { container.pendingKey = try parseMemberKey() }
      stack.append(container)
      return nil
    case UInt8(ascii: "\""): return try parseString()
    case UInt8(ascii: "t"): return try parseLiteral("true", as: .bool(true))
    case UInt8(ascii: "f"): return try parseLiteral("false", as: .bool(false))
    case UInt8(ascii: "n"): return try parseLiteral("null", as: .null)
    case UInt8(ascii: "-"), UInt8(ascii: "0")...UInt8(ascii: "9"): return try parseNumber()
    default: throw error(.unexpectedCharacter)
    }
  }

  /// A quoted key and the colon after it.
  private mutating func parseMemberKey() throws -> String {
    skipWhitespace()
    guard let quote = peek() else { throw error(.unexpectedEnd) }
    guard quote == UInt8(ascii: "\"") else { throw error(.unexpectedCharacter) }
    let key = try parseString().stringValue ?? ""
    skipWhitespace()
    guard let colon = peek() else { throw error(.unexpectedEnd) }
    guard colon == UInt8(ascii: ":") else { throw error(.unexpectedCharacter) }
    position += 1
    return key
  }

  private mutating func parseLiteral(_ word: StaticString, as value: JSONValue) throws -> JSONValue {
    let start = position
    for expected in UnsafeBufferPointer(start: word.utf8Start, count: word.utf8CodeUnitCount) {
      guard peek() == expected else { throw JSONError(reason: .unexpectedCharacter, offset: start) }
      position += 1
    }
    return value
  }

  // MARK: Numbers

  /// `-? (0 | [1-9][0-9]*) (. [0-9]+)? ([eE] [+-]? [0-9]+)?`, kept as the token that was written.
  private mutating func parseNumber() throws -> JSONValue {
    let start = position
    if peek() == UInt8(ascii: "-") { position += 1 }
    guard let first = peek(), isDigit(first) else { throw error(.badNumber) }
    position += 1
    if first == UInt8(ascii: "0") {
      if let next = peek(), isDigit(next) { throw error(.badNumber) }
    } else {
      skipDigits()
    }
    if peek() == UInt8(ascii: ".") {
      position += 1
      try requireDigits()
    }
    if let marker = peek(), marker == UInt8(ascii: "e") || marker == UInt8(ascii: "E") {
      position += 1
      if let sign = peek(), sign == UInt8(ascii: "+") || sign == UInt8(ascii: "-") { position += 1 }
      try requireDigits()
    }
    return .number(String(decoding: bytes[start..<position], as: UTF8.self))
  }

  private mutating func requireDigits() throws {
    guard let byte = peek(), isDigit(byte) else { throw error(.badNumber) }
    skipDigits()
  }

  private mutating func skipDigits() {
    while let byte = peek(), isDigit(byte) { position += 1 }
  }

  // MARK: Strings

  /// Reads a string and chooses `.string` when the writer would reproduce the source text, and
  /// `.verbatim` otherwise.
  private mutating func parseString() throws -> JSONValue {
    position += 1  // opening quote
    let start = position
    var hasEscape = false
    while true {
      guard let byte = peek() else { throw error(.unterminatedString) }
      if byte == UInt8(ascii: "\"") { break }
      if byte < 0x20 { throw error(.controlCharacterInString) }
      if byte == UInt8(ascii: "\\") {
        hasEscape = true
        position += 2  // the escape's first two bytes; hex digits are checked below
        if position > bytes.count { throw error(.unterminatedString) }
      } else {
        position += 1
      }
    }
    let end = position
    position += 1  // closing quote

    let source = bytes[start..<end]
    guard hasEscape else { return .string(String(decoding: source, as: UTF8.self)) }

    let value = try decodeEscapes(start: start, end: end)
    let raw = String(decoding: source, as: UTF8.self)
    return JSON.escapedContents(of: value).hasSameCodeUnits(as: raw) ? .string(value) : .verbatim(value, raw: raw)
  }

  private func decodeEscapes(start: Int, end: Int) throws -> String {
    var out: [UInt8] = []
    out.reserveCapacity(end - start)
    var index = start
    while index < end {
      let byte = bytes[index]
      guard byte == UInt8(ascii: "\\") else {
        out.append(byte)
        index += 1
        continue
      }
      let kind = bytes[index + 1]
      index += 2
      switch kind {
      case UInt8(ascii: "\""): out.append(UInt8(ascii: "\""))
      case UInt8(ascii: "\\"): out.append(UInt8(ascii: "\\"))
      case UInt8(ascii: "/"): out.append(UInt8(ascii: "/"))
      case UInt8(ascii: "b"): out.append(0x08)
      case UInt8(ascii: "f"): out.append(0x0C)
      case UInt8(ascii: "n"): out.append(0x0A)
      case UInt8(ascii: "r"): out.append(0x0D)
      case UInt8(ascii: "t"): out.append(0x09)
      case UInt8(ascii: "u"):
        var unit = try hexUnit(at: index, end: end)
        index += 4
        if (0xD800...0xDBFF).contains(unit) {
          if index + 1 < end, bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u"),
            let low = try? hexUnit(at: index + 2, end: end), (0xDC00...0xDFFF).contains(low)
          {
            unit = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
            index += 6
          }
        }
        // A surrogate left unpaired cannot be a Swift scalar; it reads as U+FFFD.
        out.append(contentsOf: String(Unicode.Scalar(unit) ?? "\u{FFFD}").utf8)
      default:
        throw JSONError(reason: .badEscape, offset: index - 1)
      }
    }
    return String(decoding: out, as: UTF8.self)
  }

  /// Four hex digits at `index`, in either case. `end` is where the string's contents end, so a
  /// truncated escape is reported there.
  private func hexUnit(at index: Int, end: Int) throws -> UInt32 {
    var unit: UInt32 = 0
    for offset in index..<(index + 4) {
      guard offset < end else { throw JSONError(reason: .badEscape, offset: offset) }
      guard let digit = hexValue(bytes[offset]) else { throw JSONError(reason: .badEscape, offset: offset) }
      unit = unit << 4 | digit
    }
    return unit
  }

  // MARK: Bytes

  private func peek() -> UInt8? { position < bytes.count ? bytes[position] : nil }

  private func error(_ reason: JSONError.Reason) -> JSONError {
    JSONError(reason: reason, offset: position)
  }

  private mutating func skipWhitespace() {
    while let byte = peek(), byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D {
      position += 1
    }
  }

  private func isDigit(_ byte: UInt8) -> Bool {
    byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9")
  }

  private func hexValue(_ byte: UInt8) -> UInt32? {
    switch byte {
    case UInt8(ascii: "0")...UInt8(ascii: "9"): UInt32(byte - UInt8(ascii: "0"))
    case UInt8(ascii: "a")...UInt8(ascii: "f"): UInt32(byte - UInt8(ascii: "a")) + 10
    case UInt8(ascii: "A")...UInt8(ascii: "F"): UInt32(byte - UInt8(ascii: "A")) + 10
    default: nil
    }
  }
}
