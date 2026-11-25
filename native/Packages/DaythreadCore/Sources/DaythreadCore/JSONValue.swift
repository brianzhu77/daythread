/// A JSON value that keeps what a client needs to write a document back exactly as it was read.
public enum JSONValue: Hashable, Sendable {
  case null
  case bool(Bool)
  case string(String)
  /// The token as written, so it is written back the same (`1.50`, `1e21`).
  case number(String)
  case array([JSONValue])
  case object(JSONObject)
  /// A parsed string whose canonical writing differs from the source, because it used an escape
  /// `JSON.stringify` would not (`\/`, an upper-case hex digit, `é`) or because it holds a lone
  /// surrogate, which a Swift `String` cannot. `value` is what it reads as (a lone surrogate reads
  /// as U+FFFD); `raw` is the text between the quotes exactly as it was.
  case verbatim(String, raw: String)

  public var stringValue: String? {
    switch self {
    case .string(let value), .verbatim(let value, _): value
    default: nil
    }
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let items) = self { items } else { nil }
  }

  public var objectValue: JSONObject? {
    if case .object(let object) = self { object } else { nil }
  }

  /// The number when it is spelled as an integer that fits an `Int`.
  public var intValue: Int? {
    if case .number(let token) = self { Int(token) } else { nil }
  }

  public var boolValue: Bool? {
    if case .bool(let value) = self { value } else { nil }
  }
}

extension String {
  /// Equality by UTF-8 code units. `==` treats canonically equivalent strings (NFC and NFD forms)
  /// as equal, which would hide an edit that only changes the normalization.
  func hasSameCodeUnits(as other: String) -> Bool {
    utf8.elementsEqual(other.utf8)
  }
}

/// Strings compare and hash by code units, so two values are equal only when they write the same bytes.
extension JSONValue {
  public static func == (lhs: JSONValue, rhs: JSONValue) -> Bool {
    switch (lhs, rhs) {
    case (.null, .null): true
    case (.bool(let a), .bool(let b)): a == b
    case (.string(let a), .string(let b)), (.number(let a), .number(let b)): a.hasSameCodeUnits(as: b)
    case (.verbatim(let a, let rawA), .verbatim(let b, let rawB)):
      a.hasSameCodeUnits(as: b) && rawA.hasSameCodeUnits(as: rawB)
    case (.array(let a), .array(let b)): a == b
    case (.object(let a), .object(let b)): a == b
    default: false
    }
  }

  public func hash(into hasher: inout Hasher) {
    switch self {
    case .null: hasher.combine(0 as UInt8)
    case .bool(let flag):
      hasher.combine(1 as UInt8)
      hasher.combine(flag)
    case .string(let text):
      hasher.combine(2 as UInt8)
      hasher.combine(codeUnits: text)
    case .number(let token):
      hasher.combine(3 as UInt8)
      hasher.combine(codeUnits: token)
    case .array(let items):
      hasher.combine(4 as UInt8)
      hasher.combine(items)
    case .object(let object):
      hasher.combine(5 as UInt8)
      hasher.combine(object)
    case .verbatim(let value, let raw):
      hasher.combine(6 as UInt8)
      hasher.combine(codeUnits: value)
      hasher.combine(codeUnits: raw)
    }
  }
}

extension Hasher {
  fileprivate mutating func combine(codeUnits text: String) {
    for byte in text.utf8 { combine(byte) }
    combine(0xFF as UInt8)
  }
}

/// A JSON object whose keys keep the order they were read in.
public struct JSONObject: Hashable, Sendable {
  public private(set) var keys: [String]
  // Keys are plain identifiers (addition 2), so the index compares them as `String` does.
  private var storage: [String: JSONValue]

  public init() {
    keys = []
    storage = [:]
  }

  /// Reading is O(1). Setting an existing key keeps its position, a new key is appended, and
  /// `nil` removes the key.
  public subscript(key: String) -> JSONValue? {
    get { storage[key] }
    set {
      if let newValue {
        if storage.updateValue(newValue, forKey: key) == nil { keys.append(key) }
      } else if storage.removeValue(forKey: key) != nil {
        keys.removeAll { $0 == key }
      }
    }
  }
}

extension JSONObject: ExpressibleByDictionaryLiteral {
  /// Keys keep the order they are written in; a repeated key keeps its first position and last value.
  public init(dictionaryLiteral elements: (String, JSONValue)...) {
    self.init()
    for (key, value) in elements { self[key] = value }
  }
}
