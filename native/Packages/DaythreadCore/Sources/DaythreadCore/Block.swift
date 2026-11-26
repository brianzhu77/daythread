/// One node of a page's document: a BlockNote block.
///
/// A block is read from, and written through, the node it came from (`raw`), so key order and any
/// field this struct does not name are written back untouched.
public struct Block: Hashable, Sendable, Identifiable {
  public var id: String
  public var type: String
  public var props: JSONObject
  /// Absent, an array of inline items, or anything else: kept as is.
  public var content: JSONValue?
  public var children: [Block]
  /// The node as read; fields this struct does not name are written back from here, in place.
  public var raw: JSONObject

  /// A block that was not read from a document. Its `raw` starts as the node BlockNote expects,
  /// so every field is written.
  public init(
    id: String, type: String, props: JSONObject = JSONObject(), content: JSONValue? = nil,
    children: [Block] = []
  ) {
    self.id = id
    self.type = type
    self.props = props
    self.content = content
    self.children = children
    var node: JSONObject = ["id": .string(id), "type": .string(type), "props": .object(props)]
    if let content { node["content"] = content }
    node["children"] = .array([])
    raw = node
  }

  /// Reads a node, or returns nil when it has no string `id` or `type`, when `props` is present
  /// but not an object, or when `children` is present but not an array of readable nodes.
  init?(_ value: JSONValue) {
    guard
      let node = value.objectValue,
      let id = node["id"]?.stringValue,
      let type = node["type"]?.stringValue
    else { return nil }

    var props = JSONObject()
    if let declared = node["props"] {
      guard let object = declared.objectValue else { return nil }
      props = object
    }
    var children: [Block] = []
    if let declared = node["children"] {
      guard let items = declared.arrayValue else { return nil }
      for item in items {
        guard let child = Block(item) else { return nil }
        children.append(child)
      }
    }

    self.id = id
    self.type = type
    self.props = props
    content = node["content"]
    self.children = children
    raw = node
  }

  /// The node to write: `raw`, with each named field that differs from what the node reads as
  /// replacing its key in place, or appended when the node had no such key (`content` goes before
  /// `children`, as the web writes it). A field that was not
  /// changed is never re-emitted, so an id written with an escape keeps its escape.
  var value: JSONValue {
    var node = raw
    if !(node["id"]?.stringValue?.hasSameCodeUnits(as: id) ?? false) { node["id"] = .string(id) }
    if !(node["type"]?.stringValue?.hasSameCodeUnits(as: type) ?? false) { node["type"] = .string(type) }
    if node["props"] != nil || !props.keys.isEmpty { replace("props", with: .object(props), in: &node) }
    if node["content"] == nil, let content, node["children"] != nil {
      // The web writes `content` before `children`.
      node.set("content", to: content, before: "children")
    } else {
      replace("content", with: content, in: &node)
    }
    if node["children"] != nil || !children.isEmpty {
      replace("children", with: .array(children.map(\.value)), in: &node)
    }
    return .object(node)
  }

  /// Replaces the key only when `current` differs (by code units) from what the node holds.
  private func replace(_ key: String, with current: JSONValue?, in node: inout JSONObject) {
    if node[key] != current { node[key] = current }
  }
}
