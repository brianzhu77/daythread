import DaythreadCore
import Testing

/// The UI tests keep their own copy of the content key (`SeededServer.contentKey` in `UITests/Launch.swift`), so the
/// key the app sends is not checked against itself, and cannot import the Core. Both are held to one value here and
/// in `WritingUITests.test_the_seeded_servers_content_key_is_the_cores`: a change to either fails one of them.
@Suite struct SeededContentKeyTests {
  /// The same text and key as `seededContentKeyText` and `seededContentKey` in `UITests/WritingUITests.swift`.
  private let text =
    #"[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"café 今天 😀","styles":{}}],"children":[]}]"#
  private let key = "d:116:dfbd672cde24dcdbbce455a0224dab9f"

  @Test func the_cores_key_is_the_one_the_ui_tests_copy_is_held_to() {
    #expect(
      ContentKey.of(text) == key,
      "the Core's key changed: change seededContentKey in UITests/WritingUITests.swift and SeededServer.contentKey too")
  }
}
