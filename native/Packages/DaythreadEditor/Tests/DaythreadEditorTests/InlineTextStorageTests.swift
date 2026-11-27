import DaythreadCore
import Testing

@testable import DaythreadEditor

@Suite struct InlineTextStorageTests {
  /// Applies the change read from the screen to a line, as the page does.
  private func apply(_ before: InlineContent, to shown: String, caret: Int) throws -> InlineContent {
    let change = try #require(InlineTextStorage.change(from: before.plain, to: shown, caret: caret))
    var after = before
    after.replace(change.range, with: change.text)
    return after
  }

  /// Autocorrection rewrites a word away from the caret: only that word changes, and the bold run after it keeps its
  /// words.
  @Test func autocorrection_before_a_bold_run_with_the_caret_after_it_replaces_only_the_word() throws {
    let before = InlineContent(.array([run("teh "), run("bold", ["bold": .bool(true)])]))
    #expect(InlineTextStorage.change(from: "teh bold", to: "the bold", caret: 8)?.range == 1..<3)
    let after = try apply(before, to: "the bold", caret: 8)
    try #require(after.items.count == 2, "the runs are \(after.items)")
    guard case .text(let plain, _) = after.items[0], case .text(let bold, _) = after.items[1] else {
      Issue.record("the runs are gone: \(after.items)")
      return
    }
    #expect(plain == "the ")
    #expect(bold == "bold")
  }

  /// A character typed beside the same character is taken where the caret says it was typed.
  @Test func a_character_typed_beside_the_same_character_lands_at_the_caret() throws {
    let typed = try #require(InlineTextStorage.change(from: "aa", to: "aaa", caret: 2))
    #expect(typed.range == 1..<1)
    #expect(typed.text == "a")
    let deleted = try #require(InlineTextStorage.change(from: "abba", to: "aba", caret: 1))
    #expect(deleted.range == 1..<2)
    #expect(deleted.text == "")
    // Typed into the run before a bold run, at their seam: the plain run takes it.
    let seam = InlineContent(.array([run("b"), run("b", ["bold": .bool(true)])]))
    let after = try apply(seam, to: "bbb", caret: 1)
    guard case .text(let plain, _) = after.items[0] else {
      Issue.record("no plain run")
      return
    }
    #expect(plain == "bb")
  }

  @Test func nothing_changed_is_no_change() {
    #expect(InlineTextStorage.change(from: "same", to: "same", caret: 2) == nil)
  }
}
