import Foundation
import Testing

@testable import DaythreadCore

@Suite struct NewBlockTests {
  private static let defaults = #""backgroundColor":"default","textColor":"default","textAlignment":"left""#
  private let text = JSONValue.array([
    .object(["type": .string("text"), "text": .string("hi"), "styles": .object(JSONObject())])
  ])
  private let words = #""content":[{"type":"text","text":"hi","styles":{}}]"#

  private func written(_ kind: NewBlock.Kind, content: JSONValue?, pageDate: LocalDate? = nil) -> String {
    Document.write([NewBlock.make(kind, id: "x", content: content, pageDate: pageDate)])
  }

  @Test func each_kind_is_written_as_the_web_writes_it() throws {
    let d = Self.defaults
    #expect(
      written(.paragraph, content: text)
        == #"[{"id":"x","type":"paragraph","props":{\#(d)},\#(words),"children":[]}]"#)
    #expect(
      written(.bullet, content: text)
        == #"[{"id":"x","type":"bulletListItem","props":{\#(d)},\#(words),"children":[]}]"#)
    #expect(
      written(.numbered(start: nil), content: text)
        == #"[{"id":"x","type":"numberedListItem","props":{\#(d)},\#(words),"children":[]}]"#)
    #expect(
      written(.numbered(start: 7), content: text)
        == #"[{"id":"x","type":"numberedListItem","props":{\#(d),"start":7},\#(words),"children":[]}]"#)
    #expect(
      written(.heading(level: 2), content: text)
        == #"[{"id":"x","type":"heading","props":{\#(d),"level":2,"isToggleable":false},\#(words),"children":[]}]"#)
    #expect(
      written(.quote, content: text)
        == #"[{"id":"x","type":"quote","props":{"backgroundColor":"default","textColor":"default"},\#(words),"children":[]}]"#
    )
    #expect(written(.divider, content: text) == #"[{"id":"x","type":"divider","props":{},"children":[]}]"#)
    #expect(written(.divider, content: nil) == #"[{"id":"x","type":"divider","props":{},"children":[]}]"#)
  }

  @Test func a_todo_is_written_with_its_task_id_and_the_page_it_was_made_on() throws {
    let day = try #require(LocalDate("2026-10-23"))
    #expect(
      written(.todo, content: text, pageDate: day)
        == #"[{"id":"x","type":"task","props":{"taskId":"editor-task:x","role":"plan","planDate":"2026-10-23"},\#(words),"children":[]}]"#
    )
    #expect(
      written(.todo, content: text)
        == #"[{"id":"x","type":"task","props":{"taskId":"editor-task:x","role":"reference","planDate":""},\#(words),"children":[]}]"#
    )
  }

  @Test func a_block_made_without_words_has_no_content_key_and_is_read_back_the_same() {
    let s = written(.paragraph, content: nil)
    #expect(s == #"[{"id":"x","type":"paragraph","props":{\#(Self.defaults)},"children":[]}]"#)
    #expect(Document.write(Document.blocks(s)) == s)
  }

  @Test func an_id_is_a_lowercase_uuid() throws {
    let id = NewBlock.id()
    #expect(id == id.lowercased())
    #expect(UUID(uuidString: id) != nil)
    #expect(id.count == 36)
    #expect(NewBlock.id() != id)
  }
}
