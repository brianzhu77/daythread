/// A page's document: the JSON string BlockNote stored, as an array of blocks.
public enum Document {
  /// The blocks of a stored document. A string that does not parse, or has a node this package
  /// cannot read, reads as `[]`, never as a partial list; `parses` tells that apart from an empty page.
  public static func blocks(_ document: String) -> [Block] {
    read(document) ?? []
  }

  public static func parses(_ document: String) -> Bool {
    read(document) != nil
  }

  /// Writes blocks as `JSON.stringify` would. Blocks that were not edited write back as they were read.
  public static func write(_ blocks: [Block]) -> String {
    JSON.write(.array(blocks.map(\.value)))
  }

  private static func read(_ document: String) -> [Block]? {
    guard let items = try? JSON.parse(document).arrayValue else { return nil }
    var blocks: [Block] = []
    blocks.reserveCapacity(items.count)
    for item in items {
      guard let block = Block(item) else { return nil }
      blocks.append(block)
    }
    return blocks
  }
}
