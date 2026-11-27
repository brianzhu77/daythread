import Foundation

/// Blocks as the web's editor writes a new one, so a page this app saves is the page the web would have saved.
public enum NewBlock {
  public enum Kind: Hashable, Sendable {
    case paragraph, heading(level: Int), bullet, numbered(start: Int?), quote, divider, todo
  }

  /// A lowercase UUID, as the web's block ids are (BlockNote's `uuidv4()`).
  public static func id() -> String {
    UUID().uuidString.lowercased()
  }

  /// A block as the web's editor writes a new one of that kind. For `.todo`, `taskId` is
  /// `editor-task:<id>`, and `role` / `planDate` are `plan` and the date on a day page, `reference` and `""`
  /// otherwise. A divider has no `content` key, whatever is passed.
  public static func make(_ kind: Kind, id: String, content: JSONValue?, pageDate: LocalDate?) -> Block {
    switch kind {
    case .paragraph:
      return Block(id: id, type: "paragraph", props: textBlockProps, content: content)
    case .bullet:
      return Block(id: id, type: "bulletListItem", props: textBlockProps, content: content)
    case .numbered(let start):
      var props = textBlockProps
      if let start { props["start"] = .number(String(start)) }
      return Block(id: id, type: "numberedListItem", props: props, content: content)
    case .heading(let level):
      var props = textBlockProps
      props["level"] = .number(String(level))
      props["isToggleable"] = .bool(false)
      return Block(id: id, type: "heading", props: props, content: content)
    case .quote:
      return Block(id: id, type: "quote", props: quoteProps, content: content)
    case .divider:
      return Block(id: id, type: "divider", props: JSONObject(), content: nil)
    case .todo:
      return Block(id: id, type: "task", props: todoProps(id: id, pageDate: pageDate), content: content)
    }
  }

  /// BlockNote 0.56 `blocks/defaultProps.ts` (`backgroundColor`, `textColor`, `textAlignment`), which its
  /// paragraph, bullet, numbered and heading specs all carry; a page the web saved shows them in this order
  /// (`tests/evidence/ratchet-b49/candidate/saved.json`). `start` and the heading's `level` and
  /// `isToggleable` follow, in the order of `NumberedListItem/block.ts` and `Heading/block.ts`.
  private static let textBlockProps: JSONObject = [
    "backgroundColor": .string("default"),
    "textColor": .string("default"),
    "textAlignment": .string("left"),
  ]

  /// BlockNote 0.56 `blocks/Quote/block.ts`: the colour props only, no `textAlignment`.
  private static let quoteProps: JSONObject = [
    "backgroundColor": .string("default"),
    "textColor": .string("default"),
  ]

  /// The web's `task` block spec (`page-editor.tsx`, custom specs) and the row it makes before its first save
  /// (`insertionRole`): `plan` and the page's date on a day page, `reference` and `""` otherwise. Seen stored in
  /// `tests/evidence/ratchet-b49/candidate/saved.json`.
  private static func todoProps(id: String, pageDate: LocalDate?) -> JSONObject {
    [
      "taskId": .string("editor-task:\(id)"),
      "role": .string(pageDate == nil ? "reference" : "plan"),
      "planDate": .string(pageDate?.value ?? ""),
    ]
  }
}
