/// A line's words as the web editor stores them (BlockNote's inline content), typed so they can be edited by
/// position and written back exactly. Whatever a run, a link or an item holds beyond what editing needs
/// stays in its `raw` object and is written back as it was read.
///
/// Positions are UTF-16 units, as a text view's ranges are. A token is one unit wide: it stands where
/// the text view shows an attachment character. A link has no position of its own; its runs have theirs.
public struct InlineContent: Hashable, Sendable {
  public enum Item: Hashable, Sendable {
    /// A text run. `raw` is the object as read; its `text` is rewritten on writing only when `text` differs.
    case text(String, raw: JSONObject)
    /// A link holding runs. `raw` is the object as read; its `content` is rewritten from `items` on writing.
    case link(items: [Item], raw: JSONObject)
    /// A date chip, a page reference, or anything else this build does not read inside a line.
    case token(JSONValue)
  }

  public private(set) var items: [Item]

  /// What was read, while nothing has changed: a string, a number or an absent `content` goes back as it was.
  private var original: JSONValue??

  public init(_ content: JSONValue?) {
    original = .some(content)
    switch content {
    case .array(let values):
      items = values.map(Self.read)
    case .string(let text), .verbatim(let text, _):
      items = text.isEmpty ? [] : [.text(text, raw: Self.plainRaw(text))]
    default:
      items = []
    }
  }

  private init(items: [Item]) {
    self.items = items
    original = .none
  }

  /// Unedited, exactly what was read; edited, an array of runs.
  public var json: JSONValue? {
    if case .some(let content) = original { return content }
    return .array(items.map(Self.write))
  }

  public var length: Int { items.reduce(0) { $0 + Self.width($1) } }

  public var isEmpty: Bool { length == 0 }

  /// The words, with U+FFFC for each token.
  public var plain: String { Self.plain(of: items) }

  /// Replaces the units in `range` with `text`. The range is clamped to the line, and a range that cuts a
  /// UTF-16 surrogate pair is widened outward to whole characters (an empty range moves to the character's
  /// start), so the line never holds half a character. Typed text joins the run that ends at the start
  /// of the range, else the run that begins there, and keeps its styles; with neither (an empty line, or
  /// a token on both sides) it becomes a new plain run. A run emptied by the deletion is dropped, and so
  /// is a link left without words.
  public mutating func replace(_ range: Range<Int>, with text: String) {
    let units = Array(plain.utf16)
    var lower = min(max(range.lowerBound, 0), units.count)
    var upper = range.isEmpty ? lower : min(max(range.upperBound, lower), units.count)
    lower = Self.snapDown(lower, in: units)
    upper = range.isEmpty ? lower : Self.snapUp(upper, in: units)
    if lower == upper && text.isEmpty { return }

    var next = items
    var inserted = 0
    if !text.isEmpty {
      if !Self.insertAfterRun(in: &next, at: lower, text: text) { Self.insertNewRun(in: &next, at: lower, text: text) }
      inserted = text.utf16.count
    }
    if upper > lower { next = Self.delete(from: next, lower + inserted, upper + inserted) }
    items = next
    original = .none
  }

  /// The words before `offset` and the words from it. An offset inside a surrogate pair moves back to the
  /// character's start. A run or link that straddles the offset becomes two with the same fields.
  public func split(at offset: Int) -> (InlineContent, InlineContent) {
    let units = Array(plain.utf16)
    let at = Self.snapDown(min(max(offset, 0), units.count), in: units)
    let (left, right) = Self.split(items, at: at)
    return (InlineContent(items: left), InlineContent(items: right))
  }

  /// This line followed by `other`. Runs are not merged, so each keeps its own fields.
  public func appending(_ other: InlineContent) -> InlineContent {
    if other.items.isEmpty { return self }
    if items.isEmpty { return other }
    return InlineContent(items: items + other.items)
  }

  public static func == (lhs: InlineContent, rhs: InlineContent) -> Bool {
    lhs.items == rhs.items && lhs.json == rhs.json
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(items)
  }
}

// MARK: - Reading and writing

extension InlineContent {
  /// The run the web writes for typing into a line with no run to join.
  private static func plainRaw(_ text: String) -> JSONObject {
    ["type": .string("text"), "text": .string(text), "styles": .object(JSONObject())]
  }

  private static func read(_ value: JSONValue) -> Item {
    guard let object = value.objectValue else { return .token(value) }
    switch object["type"]?.stringValue {
    case "text":
      if let text = object["text"]?.stringValue { return .text(text, raw: object) }
    case "link":
      if let inner = object["content"]?.arrayValue {
        return .link(items: inner.map(read), raw: object)
      }
    default:
      break
    }
    return .token(value)
  }

  private static func write(_ item: Item) -> JSONValue {
    switch item {
    case .text(let text, var raw):
      // Keeps a `.verbatim` spelling when the words are the ones that were read.
      if raw["text"]?.stringValue?.hasSameCodeUnits(as: text) != true { raw["text"] = .string(text) }
      return .object(raw)
    case .link(let inner, var raw):
      raw["content"] = .array(inner.map(write))
      return .object(raw)
    case .token(let value):
      return value
    }
  }

  private static func width(_ item: Item) -> Int {
    switch item {
    case .text(let text, _): text.utf16.count
    case .link(let inner, _): inner.reduce(0) { $0 + width($1) }
    case .token: 1
    }
  }

  private static func plain(of items: [Item]) -> String {
    var out = ""
    for item in items {
      switch item {
      case .text(let text, _): out += text
      case .link(let inner, _): out += plain(of: inner)
      case .token: out += "\u{FFFC}"
      }
    }
    return out
  }
}

// MARK: - Editing

extension InlineContent {
  private static func isHigh(_ unit: UInt16) -> Bool { (0xD800...0xDBFF).contains(unit) }
  private static func isLow(_ unit: UInt16) -> Bool { (0xDC00...0xDFFF).contains(unit) }

  private static func cutsPair(_ offset: Int, in units: [UInt16]) -> Bool {
    offset > 0 && offset < units.count && isHigh(units[offset - 1]) && isLow(units[offset])
  }

  private static func snapDown(_ offset: Int, in units: [UInt16]) -> Int {
    cutsPair(offset, in: units) ? offset - 1 : offset
  }

  private static func snapUp(_ offset: Int, in units: [UInt16]) -> Int {
    cutsPair(offset, in: units) ? offset + 1 : offset
  }

  private static func utf16Replace(_ text: String, at offset: Int, with inserted: String) -> String {
    var units = Array(text.utf16)
    units.insert(contentsOf: inserted.utf16, at: offset)
    return String(decoding: units, as: UTF16.self)
  }

  /// Types into the run that ends at `offset` (inside it or at its end), else the run that starts there.
  /// Returns false when there is neither.
  private static func insertAfterRun(in items: inout [Item], at offset: Int, text: String) -> Bool {
    insert(in: &items, at: offset, text: text) { start, end in start < offset && offset <= end }
      || insert(in: &items, at: offset, text: text) { start, _ in start == offset }
  }

  private static func insert(
    in items: inout [Item], at offset: Int, text: String, accepts: (_ start: Int, _ end: Int) -> Bool
  ) -> Bool {
    var position = 0
    for index in items.indices {
      let end = position + width(items[index])
      defer { position = end }
      guard end > position, accepts(position, end) else { continue }
      switch items[index] {
      case .text(let run, let raw):
        items[index] = .text(utf16Replace(run, at: offset - position, with: text), raw: raw)
        return true
      case .link(var inner, let raw):
        // Inside the link, the same rule on its own positions.
        let local = offset - position
        if insert(in: &inner, at: local, text: text, accepts: { start, finish in
          accepts(start + position, finish + position)
        }) {
          items[index] = .link(items: inner, raw: raw)
          return true
        }
      case .token:
        break
      }
    }
    return false
  }

  private static func insertNewRun(in items: inout [Item], at offset: Int, text: String) {
    var position = 0
    for index in items.indices {
      if position >= offset {
        items.insert(.text(text, raw: plainRaw(text)), at: index)
        return
      }
      position += width(items[index])
    }
    items.append(.text(text, raw: plainRaw(text)))
  }

  /// Removes the units in `[lower, upper)`, dropping each run it empties and each link left without words.
  private static func delete(from items: [Item], _ lower: Int, _ upper: Int) -> [Item] {
    var out: [Item] = []
    var position = 0
    for item in items {
      let size = width(item)
      let start = max(lower, position) - position
      let end = min(upper, position + size) - position
      defer { position += size }
      guard start < end else {
        out.append(item)
        continue
      }
      switch item {
      case .text(let text, let raw):
        var units = Array(text.utf16)
        units.removeSubrange(start..<end)
        if !units.isEmpty { out.append(.text(String(decoding: units, as: UTF16.self), raw: raw)) }
      case .link(let inner, let raw):
        let remaining = delete(from: inner, lower - position, upper - position)
        if remaining.contains(where: { width($0) > 0 }) { out.append(.link(items: remaining, raw: raw)) }
      case .token:
        break
      }
    }
    return out
  }

  private static func split(_ items: [Item], at offset: Int) -> ([Item], [Item]) {
    var left: [Item] = []
    var right: [Item] = []
    var position = 0
    for item in items {
      let size = width(item)
      defer { position += size }
      if position + size <= offset {
        left.append(item)
      } else if position >= offset {
        right.append(item)
      } else {
        let local = offset - position
        switch item {
        case .text(let text, let raw):
          let units = Array(text.utf16)
          left.append(.text(String(decoding: units[..<local], as: UTF16.self), raw: raw))
          right.append(.text(String(decoding: units[local...], as: UTF16.self), raw: raw))
        case .link(let inner, let raw):
          let (first, second) = split(inner, at: local)
          left.append(.link(items: first, raw: raw))
          right.append(.link(items: second, raw: raw))
        case .token:
          right.append(item)
        }
      }
    }
    return (left, right)
  }
}
