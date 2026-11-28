extension TodoTask {
  /// `eligibleTask` (`day-draft.ts:182`): open and not set aside.
  public var eligibleForADraft: Bool { status == .open && !paused }
}

/// Where an item goes on the page as it is now (`Placement`, `day-draft.ts:257`).
public struct DraftPlacement: Hashable, Sendable {
  public enum Kind: Hashable, Sendable { case fill, after }
  public let kind: Kind
  /// The anchor's index (fill) or the insertion index (after), among the page's top-level blocks.
  public let index: Int
  public let anchorId: String?

  init(kind: Kind, index: Int, anchorId: String?) {
    self.kind = kind
    self.index = index
    self.anchorId = anchorId
  }
}

/// The planning part of a day page and an item's place in it, over the page's top-level blocks (`day-draft.ts:200-314`).
/// `tasks` is the workspace's to-do ids.
enum DraftPlanning {
  /// `level` (`day-draft.ts:200`): `Number(n.props?.level ?? 1)`. NaN compares false with everything, as in the web.
  private static func level(_ block: Block) -> Double {
    guard let value = block.props["level"], value != .null else { return 1 }
    return JavaScriptNumber.of(value)
  }

  private static func isHeading(_ block: Block) -> Bool { block.type == "heading" }

  /// `planningRange` (`day-draft.ts:208-226`): by structure only, the outermost section that holds the page's first
  /// to-do row; with no to-do row the first section; with no heading the whole page. Its lower bound is never negative.
  static func range(of blocks: [Block]) -> Range<Int> {
    let headings = blocks.indices.filter { isHeading(blocks[$0]) }
    guard let firstHeading = headings.first else { return 0..<blocks.count }
    var start = -1
    if let firstRow = blocks.firstIndex(where: { $0.flattened.contains(where: \.isTaskRow) }) {
      // Climb from the row to the outermost heading whose section holds it.
      var lowest = Double.infinity
      for index in stride(from: firstRow, through: 0, by: -1)
      where isHeading(blocks[index]) && level(blocks[index]) < lowest {
        lowest = level(blocks[index])
        start = index
      }
    } else {
      start = firstHeading
    }
    // Only a level that is no number (NaN) leaves no heading to start from.
    if start < 0 { return 0..<firstHeading }
    var end = start + 1
    while end < blocks.count, !(isHeading(blocks[end]) && level(blocks[end]) <= level(blocks[start])) { end += 1 }
    return start..<end
  }

  /// `planningEndIndex` (`day-draft.ts:229-234`): right after the planning heading's own group, where the fallback and
  /// anything without a usable anchor go.
  static func end(of blocks: [Block], tasks: Set<CodeUnitKey>) -> Int {
    let range = Self.range(of: blocks)
    var at = blocks.indices.contains(range.lowerBound) && isHeading(blocks[range.lowerBound]) ? range.lowerBound + 1 : range.lowerBound
    while at < range.upperBound, let taskId = taskId(of: blocks[at]), tasks.contains(CodeUnitKey(taskId)) { at += 1 }
    return at
  }

  /// `moreOpenAfterIndex` (`day-draft.ts:241-250`): where "N more open" goes, after his own rows and before a divider
  /// closing the planning part. `-1`: nowhere (no heading, no to-do row, and the planning end is the page's start).
  static func moreOpenAfter(in blocks: [Block], planningEnd: Int) -> Int {
    guard blocks.contains(where: isHeading) else {
      for index in blocks.indices.reversed() where blocks[index].flattened.contains(where: \.isTaskRow) { return index }
      return planningEnd - 1
    }
    let range = Self.range(of: blocks)
    var last = range.upperBound - 1
    while last > range.lowerBound, blocks[last].type == "divider" { last -= 1 }
    return last
  }

  /// `placeItem` (`day-draft.ts:263-275`): a fill only into a still-empty block of the right kind, else after it; an
  /// anchor that is gone or outside the planning part goes to the planning end. Nil: nothing safe.
  static func place(_ item: DayDraft.Item, in blocks: [Block], tasks: Set<CodeUnitKey>) -> DraftPlacement? {
    let range = Self.range(of: blocks)
    let at = blocks.firstIndex { $0.id.hasSameCodeUnits(as: item.anchor) }
    if let at, range.contains(at) {
      let anchor = blocks[at]
      if item.place == .fill, anchor.isEmptyLine, compatible(anchor, with: item) {
        return DraftPlacement(kind: .fill, index: at, anchorId: anchor.id)
      }
      return DraftPlacement(kind: .after, index: at + 1, anchorId: anchor.id)
    }
    let end = Self.end(of: blocks, tasks: tasks)
    if end < range.lowerBound || end > range.upperBound { return nil }
    return DraftPlacement(kind: .after, index: end, anchorId: end > 0 ? blocks[end - 1].id : nil)
  }

  /// `compatible` (`day-draft.ts:252`): a to-do wants a to-do row, a line a paragraph or list item.
  private static func compatible(_ anchor: Block, with item: DayDraft.Item) -> Bool {
    let wantsTask = !(item.taskId ?? "").isEmpty || item.block?.type == "task"
    if wantsTask { return anchor.type == "task" }
    return ["paragraph", "bulletListItem", "numberedListItem"].contains(anchor.type)
  }

  /// `amongApplied` (`day-draft.ts:284-314`): where an item applied on its own goes among the rows already applied
  /// from the same draft at its spot, so applying one at a time ends in the order offered.
  static func amongApplied(_ item: DayDraft.Item, at placed: DraftPlacement, in blocks: [Block], draft: DayDraft)
    -> DraftPlacement
  {
    let order = draft.items.firstIndex { $0.id.hasSameCodeUnits(as: item.id) } ?? -1
    var byRow: [CodeUnitKey: Int] = [:], byTask: [CodeUnitKey: Int] = [:], byWords: [CodeUnitKey: Int] = [:]
    for (position, other) in draft.items.enumerated() {
      guard other.state == .applied, other.anchor.hasSameCodeUnits(as: item.anchor),
        !other.id.hasSameCodeUnits(as: item.id)
      else { continue }
      // Applied before rows were kept: a to-do by its row, a line by its words.
      if let row = other.row {
        byRow[CodeUnitKey(row)] = position
      } else if let taskId = other.taskId, !taskId.isEmpty {
        byTask[CodeUnitKey(taskId)] = position
      } else if let words = other.words {
        byWords[CodeUnitKey(words)] = position
      }
    }
    var known: [Int: Int?] = [:]
    func orderOf(_ index: Int) -> Int? {
      if let cached = known[index] { return cached }
      let block = blocks[index]
      let found =
        byRow[CodeUnitKey(block.id)]
        ?? taskId(of: block).flatMap { byTask[CodeUnitKey($0)] }
        ?? byWords[CodeUnitKey(sameWords(InlineText.plain(block.content, pageDate: nil)))]
      known[index] = .some(found)
      return found
    }
    // The group around where it would go, looking back too: a slot an earlier tap filled is that row itself, and a
    // missing anchor's fallback already sits past the rows applied there.
    func groupStart(_ from: Int) -> Int {
      var index = from
      while index > 0, orderOf(index - 1) != nil { index -= 1 }
      return index
    }
    func earlierIn(_ from: Int) -> Bool {
      for index in groupStart(from)..<blocks.count {
        guard let found = orderOf(index) else { return false }
        if found < order { return true }
      }
      return false
    }
    var placed = placed
    // An empty slot is filled only by the first of the group: with one offered before it already applied there (a line
    // that couldn't fill it went after it), this one goes after that, as Apply all does.
    if placed.kind == .fill {
      if !earlierIn(placed.index + 1) { return placed }
      placed = DraftPlacement(kind: .after, index: placed.index + 1, anchorId: blocks[placed.index].id)
    }
    let start = groupStart(placed.index)
    var index = start
    for position in start..<blocks.count {
      guard let found = orderOf(position), found <= order else { break }
      index = position + 1
    }
    return DraftPlacement(kind: .after, index: index, anchorId: index > 0 ? blocks[index - 1].id : nil)
  }

  private static func taskId(of block: Block) -> String? {
    block.type == "task" ? block.props["taskId"]?.stringValue : nil
  }
}

/// `Number(value)` for what a stored prop can hold, so a heading's `level` reads as the web reads it.
private enum JavaScriptNumber {
  static func of(_ value: JSONValue) -> Double {
    switch value {
    case .null: 0
    case .bool(let flag): flag ? 1 : 0
    case .number(let token): Double(token) ?? .nan
    case .string(let text), .verbatim(let text, _): parse(text)
    case .array, .object: parse(string(of: value))
    }
  }

  /// `String(value)`: an array joins its items with commas, an object is `[object Object]`.
  private static func string(of value: JSONValue) -> String {
    switch value {
    case .null: ""
    case .bool(let flag): flag ? "true" : "false"
    case .number(let token): token
    case .string(let text), .verbatim(let text, _): text
    case .array(let items): items.map(string(of:)).joined(separator: ",")
    case .object: "[object Object]"
    }
  }

  /// `StringToNumber`: white space trimmed; empty is 0; `Infinity`; `0x`, `0o` and `0b` integers; else a decimal literal.
  private static func parse(_ text: String) -> Double {
    let trimmed = JavaScriptSpace.trimmed(text)
    if trimmed.isEmpty { return 0 }
    switch trimmed {
    case "Infinity", "+Infinity": return .infinity
    case "-Infinity": return -.infinity
    default: break
    }
    let bytes = Array(trimmed.utf8)
    if bytes.count > 2, bytes[0] == UInt8(ascii: "0") {
      let radix: Double? =
        switch bytes[1] {
        case UInt8(ascii: "x"), UInt8(ascii: "X"): 16
        case UInt8(ascii: "o"), UInt8(ascii: "O"): 8
        case UInt8(ascii: "b"), UInt8(ascii: "B"): 2
        default: nil
        }
      if let radix {
        var number = 0.0
        for byte in bytes[2...] {
          guard let digit = Self.digit(byte), Double(digit) < radix else { return .nan }
          number = number * radix + Double(digit)
        }
        return number
      }
    }
    return isDecimalLiteral(bytes) ? Double(trimmed) ?? .nan : .nan
  }

  private static func digit(_ byte: UInt8) -> Int? {
    switch byte {
    case UInt8(ascii: "0")...UInt8(ascii: "9"): Int(byte - UInt8(ascii: "0"))
    case UInt8(ascii: "a")...UInt8(ascii: "f"): Int(byte - UInt8(ascii: "a")) + 10
    case UInt8(ascii: "A")...UInt8(ascii: "F"): Int(byte - UInt8(ascii: "A")) + 10
    default: nil
    }
  }

  /// `[+-]? (digits [. digits?]? | . digits) ([eE] [+-]? digits)?`, which Swift's own parser alone would widen
  /// (`nan`, `inf`, hex floats).
  private static func isDecimalLiteral(_ bytes: [UInt8]) -> Bool {
    var index = 0
    func digits() -> Int {
      let from = index
      while index < bytes.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(bytes[index]) { index += 1 }
      return index - from
    }
    if index < bytes.count, bytes[index] == UInt8(ascii: "+") || bytes[index] == UInt8(ascii: "-") { index += 1 }
    var mantissa = digits()
    if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
      index += 1
      mantissa += digits()
    }
    guard mantissa > 0 else { return false }
    if index < bytes.count, bytes[index] == UInt8(ascii: "e") || bytes[index] == UInt8(ascii: "E") {
      index += 1
      if index < bytes.count, bytes[index] == UInt8(ascii: "+") || bytes[index] == UInt8(ascii: "-") { index += 1 }
      guard digits() > 0 else { return false }
    }
    return index == bytes.count
  }
}
