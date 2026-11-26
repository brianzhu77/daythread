import Testing

@testable import DaythreadCore

@Suite struct ContentKeyTests {
  @Test func keys_are_the_webs() throws {
    let cases = try Fixtures.cases("content-key/cases.json")
    #expect(!cases.isEmpty)
    for entry in cases {
      let name = try #require(entry["name"]?.stringValue)
      let document = try #require(entry["document"]?.stringValue)
      let key = try #require(entry["key"]?.stringValue)
      #expect(ContentKey.of(document) == key, "\(name)")
    }
  }

  // The expected keys below are the web's `pageContentKey` run over the same text.
  @Test func a_page_with_no_text_has_a_key() {
    #expect(ContentKey.of("") == "d:0:027ae52ecfc796215593990d4b41437c")
    #expect(ContentKey.of("[]") == "d:2:6cec00d0556f7072473e37b06d814675")
  }

  private static let withLines = #"""
    [{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Before","styles":{}}],"children":[]},{"id":"s1","type":"syncedBlock","props":{"syncId":"sync-1","rev":3,"key":"k-9","roles":""},"children":[{"id":"l1","type":"paragraph","props":{},"content":[{"type":"text","text":"Lines","styles":{}}],"children":[]},{"id":"r1:s1","type":"task","props":{"taskId":"editor-task:r1","role":"plan","planDate":"2026-10-22"},"content":[],"children":[{"id":"r2:s1","type":"task","props":{"taskId":"editor-task:r2","role":"reference","planDate":""},"content":[],"children":[]}]}]}]
    """#

  @Test func a_synced_blocks_lines_and_stamps_are_not_part_of_the_key_but_its_rows_roles_are() {
    #expect(ContentKey.of(Self.withLines) == "d:254:e4f1352852855cb50f84469159c1faec")
  }

  @Test func a_synced_block_without_roles_gets_an_empty_roles_prop() {
    let bare = #"[{"id":"s1","type":"syncedBlock","props":{"syncId":"s","rev":2},"children":[]}]"#
    #expect(ContentKey.of(bare) == "d:82:cb8199e1abfcb7c6f407e4fbe86ed400")
  }

  @Test func a_synced_block_inside_another_block_is_stripped_too() {
    let nested =
      #"[{"id":"q","type":"quote","props":{},"content":[],"children":[{"id":"s2","type":"syncedBlock","props":{"syncId":"s","key":"x","roles":"old"},"children":[{"id":"z","type":"paragraph","props":{},"content":[{"type":"text","text":"Zed","styles":{}}],"children":[]}]}]}]"#
    #expect(ContentKey.of(nested) == "d:145:c718e39082de70fcb4f177e910e394ea")
  }
}
