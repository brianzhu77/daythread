/// The plain words of a line, as `inlineText` in `src/domain/editor-document.ts` reads them.
public enum InlineText {
  /// A string is its own text; an array reads item by item (a `@date` chip as its stored text, a run
  /// as its `text`, a link or anything else with `content` as that content); anything else is empty.
  public static func plain(_ content: JSONValue?, pageDate: LocalDate?) -> String {
    if let text = content?.stringValue { return text }
    guard let items = content?.arrayValue else { return "" }
    var out = ""
    for item in items {
      guard let object = item.objectValue else { continue }
      if let mention = DateMention(item) {
        out += mention.text(pageDate: pageDate)
      } else if let text = object["text"] {
        out += javascriptString(text)
      } else if let nested = object["content"] {
        out += plain(nested, pageDate: pageDate)
      }
    }
    return out
  }

  /// An event's title (`titleOf`, `chip-events.ts`): a chip, good or not, is one space and a `[[` link its page's
  /// title, so the words read as the line without its chips; every run of white space is then one space.
  public static func eventTitle(_ content: JSONValue?, pageTitle: (String) -> String?) -> String {
    collapsingJavaScriptSpace(titleWords(content, pageTitle: pageTitle))
  }

  /// Every run of JavaScript's `\s` made one space, then trimmed as `String#trim` trims.
  static func collapsingJavaScriptSpace(_ text: String) -> String {
    var out = String.UnicodeScalarView()
    var inRun = false
    for scalar in text.unicodeScalars {
      if JavaScriptSpace.contains(scalar) {
        if !inRun { out.append(" ") }
        inRun = true
      } else {
        out.append(scalar)
        inRun = false
      }
    }
    return JavaScriptSpace.trimmed(String(out))
  }

  private static func titleWords(_ content: JSONValue?, pageTitle: (String) -> String?) -> String {
    if let text = content?.stringValue { return text }
    guard let items = content?.arrayValue else { return "" }
    var out = ""
    for item in items {
      guard let object = item.objectValue else { continue }
      let type = object["type"]?.stringValue
      if type?.hasSameCodeUnits(as: "dateMention") == true {
        out += " "
      } else if type?.hasSameCodeUnits(as: "pageRef") == true {
        // `String(props?.pageId ?? '')`: a missing or null id is empty, anything else reads as JavaScript spells it.
        if let id = object["props"]?.objectValue?["pageId"], id != .null {
          out += pageTitle(javascriptString(id)) ?? ""
        }
      } else if let text = object["text"] {
        out += javascriptString(text)
      } else if let nested = object["content"] {
        out += titleWords(nested, pageTitle: pageTitle)
      }
    }
    return out
  }

  /// `String(value)` in JavaScript, for what a stored `text` field can hold.
  private static func javascriptString(_ value: JSONValue) -> String {
    switch value {
    case .string(let text), .verbatim(let text, _): text
    case .number(let token): Int(token).map(String.init) ?? token
    case .bool(let flag): flag ? "true" : "false"
    case .null: "null"
    case .array(let items):
      items.map { if case .null = $0 { "" } else { javascriptString($0) } }.joined(separator: ",")
    case .object: "[object Object]"
    }
  }
}
