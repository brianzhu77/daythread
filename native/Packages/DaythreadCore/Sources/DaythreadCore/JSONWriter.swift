/// Namespace for reading and writing JSON text.
public enum JSON {}

extension JSON {
  /// Writes a value as `JSON.stringify` does: no spaces, and only `"`, `\` and characters below
  /// U+0020 escaped (`\b \t \n \f \r`, else `\u00xx`). A `.verbatim` string is written as it was read.
  public static func write(_ value: JSONValue) -> String {
    var out: [UInt8] = []
    append(value, to: &out)
    return String(decoding: out, as: UTF8.self)
  }

  /// The text between the quotes that `write(.string(value))` produces.
  static func escapedContents(of value: String) -> String {
    var out: [UInt8] = []
    appendEscaped(value, to: &out)
    return String(decoding: out, as: UTF8.self)
  }

  /// What is left to write. Containers push their members on a stack instead of recursing, so a
  /// deeply nested value costs heap rather than stack.
  private enum Pending {
    case value(JSONValue)
    case punctuation(UInt8)
    case key(String)
  }

  private static func append(_ root: JSONValue, to out: inout [UInt8]) {
    var pending: [Pending] = [.value(root)]
    while let next = pending.popLast() {
      switch next {
      case .punctuation(let byte): out.append(byte)
      case .key(let name):
        appendQuoted(name, to: &out)
        out.append(UInt8(ascii: ":"))
      case .value(let value):
        switch value {
        case .null: out.append(contentsOf: "null".utf8)
        case .bool(let flag): out.append(contentsOf: (flag ? "true" : "false").utf8)
        case .number(let token): out.append(contentsOf: token.utf8)
        case .string(let text): appendQuoted(text, to: &out)
        case .verbatim(_, let raw):
          out.append(UInt8(ascii: "\""))
          out.append(contentsOf: raw.utf8)
          out.append(UInt8(ascii: "\""))
        case .array(let items):
          out.append(UInt8(ascii: "["))
          pending.append(.punctuation(UInt8(ascii: "]")))
          for index in items.indices.reversed() {
            pending.append(.value(items[index]))
            if index > 0 { pending.append(.punctuation(UInt8(ascii: ","))) }
          }
        case .object(let object):
          out.append(UInt8(ascii: "{"))
          pending.append(.punctuation(UInt8(ascii: "}")))
          for (index, key) in object.keys.enumerated().reversed() {
            if let member = object[key] { pending.append(.value(member)) }
            pending.append(.key(key))
            if index > 0 { pending.append(.punctuation(UInt8(ascii: ","))) }
          }
        }
      }
    }
  }

  private static func appendQuoted(_ text: String, to out: inout [UInt8]) {
    out.append(UInt8(ascii: "\""))
    appendEscaped(text, to: &out)
    out.append(UInt8(ascii: "\""))
  }

  private static func appendEscaped(_ text: String, to out: inout [UInt8]) {
    let hex = Array("0123456789abcdef".utf8)
    for byte in text.utf8 {
      switch byte {
      case UInt8(ascii: "\""): out.append(contentsOf: [UInt8(ascii: "\\"), UInt8(ascii: "\"")])
      case UInt8(ascii: "\\"): out.append(contentsOf: [UInt8(ascii: "\\"), UInt8(ascii: "\\")])
      case 0x08: out.append(contentsOf: [UInt8(ascii: "\\"), UInt8(ascii: "b")])
      case 0x09: out.append(contentsOf: [UInt8(ascii: "\\"), UInt8(ascii: "t")])
      case 0x0A: out.append(contentsOf: [UInt8(ascii: "\\"), UInt8(ascii: "n")])
      case 0x0C: out.append(contentsOf: [UInt8(ascii: "\\"), UInt8(ascii: "f")])
      case 0x0D: out.append(contentsOf: [UInt8(ascii: "\\"), UInt8(ascii: "r")])
      case ..<0x20:
        out.append(contentsOf: Array("\\u00".utf8))
        out.append(hex[Int(byte >> 4)])
        out.append(hex[Int(byte & 0xF)])
      default: out.append(byte)
      }
    }
  }
}
