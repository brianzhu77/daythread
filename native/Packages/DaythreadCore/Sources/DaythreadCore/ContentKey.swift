/// The key the server compares to tell whether a page changed since this client loaded it: a hash of the page's
/// stored text. It must come out exactly as the web's `pageContentKey` does (`src/domain/editor-document.ts`).
public enum ContentKey {
  public static func of(_ document: String) -> String { textKey(storedDocument(document)) }

  /// `textKey`: a cyrb128-style hash over UTF-16 code units. JavaScript's `Math.imul` and `>>>` are 32-bit, so
  /// the arithmetic here wraps in `UInt32`.
  static func textKey(_ text: String) -> String {
    var h1: UInt32 = 1_779_033_703
    var h2: UInt32 = 3_144_134_277
    var h3: UInt32 = 1_013_904_242
    var h4: UInt32 = 2_773_480_762
    var length = 0
    for unit in text.utf16 {
      let k = UInt32(unit)
      h1 = h2 ^ ((h1 ^ k) &* 597_399_067)
      h2 = h3 ^ ((h2 ^ k) &* 2_869_860_233)
      h3 = h4 ^ ((h3 ^ k) &* 951_274_213)
      h4 = h1 ^ ((h4 ^ k) &* 2_716_044_179)
      length += 1
    }
    h1 = (h3 ^ (h1 >> 18)) &* 597_399_067
    h2 = (h4 ^ (h2 >> 22)) &* 2_869_860_233
    h3 = (h1 ^ (h3 >> 17)) &* 951_274_213
    h4 = (h2 ^ (h4 >> 19)) &* 2_716_044_179
    h1 ^= h2 ^ h3 ^ h4
    h2 ^= h1
    h3 ^= h1
    h4 ^= h1
    let digits = [h1, h2, h3, h4].map { value -> String in
      let hex = String(value, radix: 16)
      return String(repeating: "0", count: 8 - hex.count) + hex
    }
    return "d:\(length):\(digits.joined())"
  }

  private static let syncedBlockType = "syncedBlock"

  /// `storedDocument` in `src/domain/synced.ts`: a document that mentions a synced block, with each block
  /// stripped of its lines, `rev` and `key`, and its rows' roles kept in `roles`. Any other string is returned
  /// unchanged, as is one that does not parse (the web would throw; the server never holds such a page).
  public static func storedDocument(_ document: String) -> String {
    guard document.contains("\"\(syncedBlockType)\""),
      let nodes = try? JSON.parse(document).arrayValue
    else { return document }
    let stripped = JSONValue.array(nodes.map(strip))
    // Nothing to strip: the string itself, so the key does not depend on the writer spelling it as the web does.
    return stripped == .array(nodes) ? document : JSON.write(stripped)
  }

  private static func strip(_ node: JSONValue) -> JSONValue {
    guard var object = node.objectValue else { return node }
    let children = object["children"]?.arrayValue ?? []
    guard object["type"]?.stringValue == syncedBlockType else {
      if !children.isEmpty { object["children"] = .array(children.map(strip)) }
      return .object(object)
    }
    var props = object["props"]?.objectValue ?? JSONObject()
    var roles = JSONObject()
    if !children.isEmpty { collectRoles(of: children, blockId: object["id"]?.stringValue ?? "", into: &roles) }
    props["rev"] = nil
    props["key"] = nil
    if !children.isEmpty {
      props["roles"] = .string(roles.keys.isEmpty ? "" : JSON.write(.object(roles)))
    } else if props["roles"] == nil || props["roles"] == .null {
      props["roles"] = .string("")
    }
    object["props"] = .object(props)
    object["children"] = .array([])
    return .object(object)
  }

  /// `unplaced`'s roles: each to-do row of a place that is not a plain reference, under its line's own id (the
  /// place's id with the block's suffix taken off).
  private static func collectRoles(of lines: [JSONValue], blockId: String, into roles: inout JSONObject) {
    for line in lines {
      guard let object = line.objectValue else { continue }
      if object["type"]?.stringValue == "task", let role = object["props"]?.objectValue?["role"],
        isTruthy(role), role.stringValue != "reference", let id = object["id"]?.stringValue
      {
        var entry = JSONObject()
        entry["role"] = .string(plain(role))
        var planDate = ""
        if let value = object["props"]?.objectValue?["planDate"], value != .null { planDate = plain(value) }
        entry["planDate"] = .string(planDate)
        roles[lineId(id, blockId: blockId)] = .object(entry)
      }
      collectRoles(of: object["children"]?.arrayValue ?? [], blockId: blockId, into: &roles)
    }
  }

  private static func lineId(_ id: String, blockId: String) -> String {
    let suffix = ":\(blockId)"
    return id.hasSuffix(suffix) ? String(id.dropLast(suffix.count)) : id
  }

  /// JavaScript truthiness for a prop's value.
  private static func isTruthy(_ value: JSONValue) -> Bool {
    switch value {
    case .null: false
    case .bool(let flag): flag
    case .string(let text): !text.isEmpty
    case .verbatim(let text, _): !text.isEmpty
    case .number(let token): Double(token).map { $0 != 0 && !$0.isNaN } ?? true
    case .array, .object: true
    }
  }

  /// `String(value)`, for the text values a row's role and plan date hold.
  private static func plain(_ value: JSONValue) -> String {
    value.stringValue ?? (value == .null ? "null" : JSON.write(value))
  }
}
