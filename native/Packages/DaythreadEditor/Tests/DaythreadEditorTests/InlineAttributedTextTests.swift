import DaythreadCore
import Foundation
import Testing

@testable import DaythreadEditor

/// What one run of an attributed string looks like to a client.
private struct Piece: Equatable {
  var text: String
  var intent: InlinePresentationIntent?
  var underlined = false
  var link: String?
}

private func pieces(_ string: AttributedString) -> [Piece] {
  string.runs.map { run in
    Piece(
      text: String(string[run.range].characters), intent: run.inlinePresentationIntent,
      underlined: run.attributes[InlineUnderline.self] ?? false, link: run.link?.absoluteString)
  }
}

private func mention(date: String, time: String = "", id: String = "e") -> JSONValue {
  .object([
    "type": .string("dateMention"),
    "props": .object(["eventId": .string(id), "date": .string(date), "time": .string(time)]),
  ])
}

private func pageRef(_ pageId: String) -> JSONValue {
  .object(["type": .string("pageRef"), "props": .object(["pageId": .string(pageId), "refId": .string("r")])])
}

@Suite struct InlineAttributedTextTests {
  private let day = LocalDate("2026-10-22")

  private func make(_ items: [JSONValue], workspace: Workspace? = nil) throws -> AttributedString {
    InlineAttributedText.make(.array(items), pageDate: day, in: try workspace ?? makeWorkspace())
  }

  @Test func eachStyleBecomesItsAttribute() throws {
    let styled = try make([
      run("b", ["bold": .bool(true)]), run("i", ["italic": .bool(true)]), run("u", ["underline": .bool(true)]),
      run("s", ["strike": .bool(true)]), run("c", ["code": .bool(true)]), run("p"),
      run("all", ["bold": .bool(true), "italic": .bool(true), "strike": .bool(true), "code": .bool(true)]),
      run("off", ["bold": .bool(false), "textColor": .string("red")]),
    ])
    #expect(String(styled.characters) == "biscpalloff")
    #expect(pieces(styled) == [
      Piece(text: "b", intent: .stronglyEmphasized), Piece(text: "i", intent: .emphasized),
      Piece(text: "u", underlined: true), Piece(text: "s", intent: .strikethrough),
      Piece(text: "c", intent: .code), Piece(text: "p"),
      Piece(text: "all", intent: [.stronglyEmphasized, .emphasized, .strikethrough, .code]),
      Piece(text: "off"),
    ])
  }

  @Test func aLinkKeepsItsTextAndCarriesTheLink() throws {
    let styled = try make([
      run("see "),
      .object([
        "type": .string("link"), "href": .string("https://example.com/x"),
        "content": .array([run("this ", ["bold": .bool(true)]), run("link")]),
      ]),
    ])
    #expect(pieces(styled) == [
      Piece(text: "see "),
      Piece(text: "this ", intent: .stronglyEmphasized, link: "https://example.com/x"),
      Piece(text: "link", link: "https://example.com/x"),
    ])
  }

  @Test func aLinkWithoutAUsableHrefKeepsItsTextOnly() throws {
    let styled = try make([
      .object(["type": .string("link"), "content": .array([run("bare")])]),
      .object(["type": .string("link"), "href": .string("not a url \u{0}"), "content": .array([run(" odd")])]),
    ])
    #expect(String(styled.characters) == "bare odd")
    #expect(styled.runs.allSatisfy { $0.link == nil })
  }

  @Test func aDateMentionReadsAsInlineTextGivesIt() throws {
    let styled = try make([
      run("Meet "), mention(date: "2026-10-22"), run(" or "), mention(date: "2026-10-22", time: "09:30"),
      run(" or "), mention(date: "2027-01-05", time: "15:00"),
    ])
    #expect(String(styled.characters) == "Meet @Oct 22 or @Oct 22 9:30am or @Jan 5, 2027 3pm")
  }

  @Test func aDateMentionInsideABoldRunIsBold() throws {
    var chip = mention(date: "2026-10-22").objectValue ?? JSONObject()
    chip["styles"] = .object(["bold": .bool(true)])
    let styled = try make([run("a", ["bold": .bool(true)]), .object(chip), run("b")])
    #expect(pieces(styled) == [Piece(text: "a@Oct 22", intent: .stronglyEmphasized), Piece(text: "b")])
  }

  @Test func aPageRefReadsAsThePagesTitleOrUntitled() throws {
    let workspace = try EditorFixtures.workspace()
    let styled = try make(
      [run("see "), pageRef("doc-a"), run(" and "), pageRef("gone"), run(" ")], workspace: workspace)
    #expect(String(styled.characters) == "see Reading list and Untitled ")
  }

  @Test func aPageRefInsideABoldRunAndALinkTakesTheirAttributes() throws {
    var ref = pageRef("doc-a").objectValue ?? JSONObject()
    ref["styles"] = .object(["bold": .bool(true), "underline": .bool(true)])
    let linked: JSONValue = .object([
      "type": .string("link"), "href": .string("https://example.com"),
      "content": .array([mention(date: "2026-10-22"), pageRef("doc-a")]),
    ])
    let styled = try make([.object(ref), linked], workspace: try EditorFixtures.workspace())
    #expect(pieces(styled) == [
      Piece(text: "Reading list", intent: .stronglyEmphasized, underlined: true),
      Piece(text: "@Oct 22Reading list", link: "https://example.com"),
    ])
  }

  @Test func anEmptyTitleReadsAsUntitled() throws {
    let blank = try #require(
      Page(.object([
        "id": .string("blank"), "type": .string("document"), "date": .null, "title": .string(""),
        "document": .string("[]"),
      ])))
    let workspace = try makeWorkspace(pages: [blank])
    #expect(String(try make([pageRef("blank")], workspace: workspace).characters) == "Untitled")
  }

  @Test func aStringIsItsOwnText() throws {
    let styled = InlineAttributedText.make(.string("plain words"), pageDate: nil, in: try makeWorkspace())
    #expect(pieces(styled) == [Piece(text: "plain words")])
  }

  @Test(arguments: [JSONValue?.none, .null, .number("3"), .object(JSONObject()), .array([])])
  func contentThatIsNotTextIsEmpty(content: JSONValue?) throws {
    #expect(InlineAttributedText.make(content, pageDate: nil, in: try makeWorkspace()).characters.isEmpty)
  }

  @Test func theTextMatchesInlineTextPlainForEveryFixtureLine() throws {
    let workspace = try EditorFixtures.workspace()
    let page = try EditorFixtures.dayPage()
    for block in Document.blocks(page.document) {
      let drawn = InlineAttributedText.make(block.content, pageDate: page.date, in: workspace)
      let plain = InlineText.plain(block.content, pageDate: page.date)
      // A page reference reads as a title here and as nothing in the plain text.
      if block.id != "d16" { #expect(String(drawn.characters) == plain, "block \(block.id)") }
    }
  }
}
