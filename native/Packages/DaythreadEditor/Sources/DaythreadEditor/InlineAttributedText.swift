import DaythreadCore
import Foundation

/// Underline, which Foundation's attributes have no name for; the UIKit layer draws it.
enum InlineUnderline: AttributedStringKey {
  typealias Value = Bool
  static let name = "daythread.underline"
}

/// Marks the words a token (a chip, a page reference, an item this build does not read) is drawn with. The value
/// is the token's place in its line, so two tokens side by side stay two runs; a text view draws each as one
/// attachment, one position wide, as `InlineContent` counts it.
enum InlineToken: AttributedStringKey {
  typealias Value = Int
  static let name = "daythread.token"
}

/// A line's inline content as an attributed string, in Foundation's own attributes.
public enum InlineAttributedText {
  /// Bold, italic, strike and code from a run's `styles` (as `inlinePresentationIntent`), underline,
  /// and a link's `href` as the `link` attribute over the text inside it. A `@date` chip reads as
  /// `InlineText` gives it, a page reference as the page's title, or "Untitled".
  public static func make(_ content: JSONValue?, pageDate: LocalDate?, in workspace: Workspace) -> AttributedString {
    if let text = content?.stringValue { return AttributedString(text) }
    guard let items = content?.arrayValue else { return AttributedString() }
    var out = AttributedString()
    for item in items { out.append(piece(item, pageDate: pageDate, in: workspace, inLink: false)) }
    return out
  }

  /// The words of a line being edited, item by item as `InlineContent` reads them: a run as its words with its
  /// styles, a link as its runs with the `link` attribute, and a token as the words `make` gives it, marked with
  /// `InlineToken`. A token with no words is drawn as a space, so it still takes its position.
  static func make(_ content: InlineContent, pageDate: LocalDate?, in workspace: Workspace) -> AttributedString {
    var tokens = 0
    func pieces(_ items: [InlineContent.Item], link: URL?) -> AttributedString {
      var out = AttributedString()
      for item in items {
        var piece: AttributedString
        switch item {
        case .text(let text, var raw):
          raw["text"] = .string(text)
          piece = Self.piece(.object(raw), pageDate: pageDate, in: workspace, inLink: link != nil)
        case .link(let inner, let raw):
          let url = raw["href"]?.stringValue.flatMap { URL(string: $0) }
          piece = pieces(inner, link: url ?? link)
        case .token(let value):
          piece = Self.piece(value, pageDate: pageDate, in: workspace, inLink: link != nil)
          if piece.characters.isEmpty { piece = AttributedString(" ") }
          piece[InlineToken.self] = tokens
          tokens += 1
        }
        if let link { piece.link = link }
        out.append(piece)
      }
      return out
    }
    return pieces(content.items, link: nil)
  }

  private static func piece(
    _ item: JSONValue, pageDate: LocalDate?, in workspace: Workspace, inLink: Bool
  ) -> AttributedString {
    guard let object = item.objectValue else { return AttributedString() }
    var piece: AttributedString
    if object["type"]?.stringValue == "pageRef" {
      piece = AttributedString(title(of: object, in: workspace))
    } else if object["type"]?.stringValue == "link", !inLink, let nested = object["content"]?.arrayValue {
      piece = AttributedString()
      for inner in nested { piece.append(Self.piece(inner, pageDate: pageDate, in: workspace, inLink: true)) }
      if let url = object["href"]?.stringValue.flatMap({ URL(string: $0) }) {
        piece.link = url
      }
      return piece
    } else {
      // The words of the item are `InlineText`'s, so a line reads the same here as everywhere else.
      piece = AttributedString(InlineText.plain(.array([item]), pageDate: pageDate))
    }
    apply(object["styles"]?.objectValue, to: &piece)
    return piece
  }

  private static func title(of object: JSONObject, in workspace: Workspace) -> String {
    let title = object["props"]?.objectValue?["pageId"]?.stringValue.flatMap { workspace.page($0)?.title }
    guard let title, !title.isEmpty else { return "Untitled" }
    return title
  }

  private static func apply(_ styles: JSONObject?, to piece: inout AttributedString) {
    guard let styles else { return }
    var intent: InlinePresentationIntent = []
    if styles["bold"]?.boolValue == true { intent.insert(.stronglyEmphasized) }
    if styles["italic"]?.boolValue == true { intent.insert(.emphasized) }
    if styles["strike"]?.boolValue == true { intent.insert(.strikethrough) }
    if styles["code"]?.boolValue == true { intent.insert(.code) }
    if !intent.isEmpty { piece.inlinePresentationIntent = intent }
    if styles["underline"]?.boolValue == true { piece[InlineUnderline.self] = true }
  }
}

#if canImport(UIKit)
  import UIKit

  extension InlineAttributedText {
    /// What a line shows: the string set in the system's fonts for `textStyle` (in the user's Dynamic Type size)
    /// and the system's colours. A link is drawn as one, but is not tappable: it carries no `.link` attribute. A
    /// token is one attachment character that draws its words as the words around it are drawn.
    static func display(
      _ text: AttributedString, textStyle: UIFont.TextStyle, bold: Bool = false, color: UIColor = .label,
      struckThrough: Bool = false, compatibleWith traits: UITraitCollection?
    ) -> NSAttributedString {
      let base = UIFont.preferredFont(forTextStyle: textStyle, compatibleWith: traits)
      let result = NSMutableAttributedString()
      for run in text.runs {
        let intent = run.inlinePresentationIntent ?? []
        var attributes: [NSAttributedString.Key: Any] = [
          .font: font(
            base, bold: bold || intent.contains(.stronglyEmphasized), italic: intent.contains(.emphasized),
            code: intent.contains(.code)),
          .foregroundColor: run.link == nil ? color : UIColor.link,
        ]
        if run.attributes[InlineUnderline.self] == true || run.link != nil {
          attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
        }
        // Said either way: a label whose text loses the line keeps drawing it unless told there is none.
        let struck = struckThrough || intent.contains(.strikethrough)
        attributes[.strikethroughStyle] = struck ? NSUnderlineStyle.single.rawValue : 0
        let words = NSAttributedString(string: String(text[run.range].characters), attributes: attributes)
        if run.attributes[InlineToken.self] != nil {
          attributes[.attachment] = InlineTextStorage.token(drawing: words)
          result.append(NSAttributedString(string: "\u{FFFC}", attributes: attributes))
        } else {
          result.append(words)
        }
      }
      return result
    }

    private static func font(_ base: UIFont, bold: Bool, italic: Bool, code: Bool) -> UIFont {
      var descriptor = base.fontDescriptor
      if code { descriptor = descriptor.withDesign(.monospaced) ?? descriptor }
      var traits: UIFontDescriptor.SymbolicTraits = []
      if bold { traits.insert(.traitBold) }
      if italic { traits.insert(.traitItalic) }
      if !traits.isEmpty { descriptor = descriptor.withSymbolicTraits(traits) ?? descriptor }
      return UIFont(descriptor: descriptor, size: 0)
    }
  }
#endif
