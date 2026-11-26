import Testing

@testable import DaythreadCore

/// The three-way merge of a page (spec §10.6): the page the draft started from, his draft, and the page as the server
/// has it now, put together line by line without asking him.
@Suite struct PageMergeTests {
  private let base = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("c", "Three"))

  /// New lines the merge makes get `n1`, `n2`, … in the order they are made.
  private func merge(_ base: String, _ mine: String, _ theirs: String) -> PageMerge.Merged {
    let counter = Lines.Counter()
    return PageMerge.merge(base: base, mine: mine, theirs: theirs, makeID: { "n\(counter.next())" })
  }

  private func outline(_ document: String) -> [String] {
    Lines.outline(EditablePage(document: document, pageDate: nil))
  }

  private func written(_ id: String, in document: String) -> String? {
    Lines.find(id, in: Document.blocks(document)).map { JSON.write($0.value) }
  }

  private static func todo(_ id: String, _ text: String) -> String {
    Lines.line(id, "task", props: #"{"taskId":"editor-task:\#(id)","role":"plan","planDate":"2026-11-26"}"#, text)
  }

  // MARK: - One row per line of the table

  @Test func a_line_only_he_changed_is_his() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two, mine"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("c", "Three, theirs"))

    let merged = merge(base, mine, theirs)

    #expect(outline(merged.document) == ["a paragraph 'One'", "b paragraph 'Two, mine'", "c paragraph 'Three, theirs'"])
    #expect(written("b", in: merged.document) == Lines.line("b", "Two, mine"))
    #expect(!merged.bothChanged)
  }

  @Test func only_the_server_changed_is_theirs() {
    let mine = Lines.document(Lines.line("a", "One, mine"), Lines.line("b", "Two"), Lines.line("c", "Three"))
    let theirs = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "bulletListItem", "Two, theirs"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(
      outline(merged.document) == ["a paragraph 'One, mine'", "b bulletListItem 'Two, theirs'", "c paragraph 'Three'"])
    #expect(!merged.bothChanged)
  }

  @Test func both_changed_to_the_same_words_is_once() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two!"), Lines.line("c", "Three, mine"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two!"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(outline(merged.document) == ["a paragraph 'One'", "b paragraph 'Two!'", "c paragraph 'Three, mine'"])
    #expect(!merged.bothChanged)
  }

  @Test func both_changed_differently_keeps_theirs_and_puts_his_below() {
    let colour = #"{"backgroundColor":"default","textColor":"red","textAlignment":"left"}"#
    let base = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "bulletListItem", "Two", children: [Lines.line("k", "Kid")]),
      Lines.line("c", "Three"))
    let mine = Lines.document(
      Lines.line("a", "One"),
      Lines.line("b", "bulletListItem", props: colour, "Two, mine", children: [Lines.line("k", "Kid")]),
      Lines.line("c", "Three"))
    let theirs = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "bulletListItem", "Two, theirs", children: [Lines.line("k", "Kid")]),
      Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(
      outline(merged.document) == [
        "a paragraph 'One'", "b bulletListItem 'Two, theirs'", "  k paragraph 'Kid'", "n1 bulletListItem 'Two, mine'",
        "c paragraph 'Three'",
      ])
    #expect(written("n1", in: merged.document) == Lines.line("n1", "bulletListItem", props: colour, "Two, mine"))
    #expect(merged.bothChanged)
  }

  @Test func a_line_he_added_goes_after_the_line_it_followed() {
    let mine = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("x", "Added"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("c", "Three, theirs"))

    let merged = merge(base, mine, theirs)

    #expect(
      outline(merged.document) == [
        "a paragraph 'One'", "b paragraph 'Two'", "x paragraph 'Added'", "c paragraph 'Three, theirs'",
      ])
    #expect(!merged.bothChanged)
  }

  @Test func a_line_he_added_goes_after_the_line_it_followed_or_after_the_nearest_earlier_line_that_still_exists() {
    let mine = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("x", "Added"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("c", "Three"))

    #expect(
      outline(merge(base, mine, theirs).document) == [
        "a paragraph 'One'", "x paragraph 'Added'", "c paragraph 'Three'",
      ])

    // Nested under a line that is gone: after the nearest earlier line that is still there, at that line's depth.
    let nested = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two", children: [Lines.line("y", "Under two")]),
      Lines.line("c", "Three"))
    #expect(
      outline(merge(base, nested, theirs).document) == [
        "a paragraph 'One'", "y paragraph 'Under two'", "c paragraph 'Three'",
      ])
  }

  @Test func several_lines_he_added_keep_their_order() {
    let mine = Lines.document(
      Lines.line("a", "One"), Lines.line("x", "First"), Lines.line("y", "Second", children: [Lines.line("z", "Third")]),
      Lines.line("b", "Two"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two, theirs"), Lines.line("c", "Three"))

    #expect(
      outline(merge(base, mine, theirs).document) == [
        "a paragraph 'One'", "x paragraph 'First'", "y paragraph 'Second'", "  z paragraph 'Third'",
        "b paragraph 'Two, theirs'", "c paragraph 'Three'",
      ])
  }

  @Test func a_line_the_server_added_stays_where_the_server_has_it() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("c", "Three, mine"))
    let theirs = Lines.document(
      Lines.line("a", "One", children: [Lines.line("s", "Server's")]), Lines.line("b", "Two"), Lines.line("c", "Three"))

    #expect(
      outline(merge(base, mine, theirs).document) == [
        "a paragraph 'One'", "  s paragraph 'Server's'", "b paragraph 'Two'", "c paragraph 'Three, mine'",
      ])
  }

  @Test func he_deleted_and_the_server_did_not_touch_is_deleted() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One, theirs"), Lines.line("b", "Two"), Lines.line("c", "Three"))

    #expect(outline(merge(base, mine, theirs).document) == ["a paragraph 'One, theirs'", "c paragraph 'Three'"])
  }

  @Test func he_deleted_and_the_server_changed_stays() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two, theirs"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(outline(merged.document) == ["a paragraph 'One'", "b paragraph 'Two, theirs'", "c paragraph 'Three'"])
    #expect(!merged.bothChanged)
  }

  @Test func the_server_deleted_and_he_did_not_touch_is_deleted() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("c", "Three, mine"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("c", "Three"))

    #expect(outline(merge(base, mine, theirs).document) == ["a paragraph 'One'", "c paragraph 'Three, mine'"])
  }

  @Test func the_server_deleted_and_he_changed_puts_his_words_back() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two, mine"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(outline(merged.document) == ["a paragraph 'One'", "b paragraph 'Two, mine'", "c paragraph 'Three'"])
    #expect(written("b", in: merged.document) == Lines.line("b", "Two, mine"))
    #expect(!merged.bothChanged)
  }

  // MARK: - To-dos

  private func rows(carrying taskId: String, in document: String) -> Int {
    func count(_ blocks: [Block]) -> Int {
      blocks.reduce(0) { total, block in
        total + (block.props["taskId"]?.stringValue == taskId ? 1 : 0) + count(block.children)
      }
    }
    return count(Document.blocks(document))
  }

  @Test func a_to_do_both_changed_stays_one_to_do_with_his_words_as_a_line_below() {
    let base = Lines.document(Lines.line("a", "One"), Self.todo("t", "Call"), Lines.line("c", "Three"))
    let mine = Lines.document(Lines.line("a", "One"), Self.todo("t", "Call mum"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Self.todo("t", "Call dad"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(
      outline(merged.document) == [
        "a paragraph 'One'", "t task 'Call dad'", "n1 paragraph 'Call mum'", "c paragraph 'Three'",
      ])
    #expect(written("t", in: merged.document) == Self.todo("t", "Call dad"))
    #expect(written("n1", in: merged.document) == Lines.line("n1", "Call mum"))
    #expect(rows(carrying: "editor-task:t", in: merged.document) == 1)
    #expect(merged.bothChanged)
  }

  @Test func a_to_do_the_server_deleted_and_he_changed_comes_back_as_a_plain_line() {
    let base = Lines.document(Lines.line("a", "One"), Self.todo("t", "Call"), Lines.line("c", "Three"))
    let mine = Lines.document(Lines.line("a", "One"), Self.todo("t", "Call mum"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(outline(merged.document) == ["a paragraph 'One'", "n1 paragraph 'Call mum'", "c paragraph 'Three'"])
    #expect(written("n1", in: merged.document) == Lines.line("n1", "Call mum"))
    #expect(rows(carrying: "editor-task:t", in: merged.document) == 0)
    #expect(!merged.bothChanged)
  }

  @Test func a_to_do_he_added_comes_back_as_a_to_do_once() {
    // His save landed with its answer lost: the server already has his to-do, and something else since.
    let mine = Lines.document(
      Lines.line("a", "One"), Self.todo("t", "Buy milk"), Lines.line("b", "Two"), Lines.line("c", "Three"))
    let theirs = Lines.document(
      Lines.line("a", "One"), Self.todo("t", "Buy milk"), Lines.line("b", "Two"), Lines.line("c", "Three, theirs"))

    let merged = merge(base, mine, theirs)

    #expect(
      outline(merged.document) == [
        "a paragraph 'One'", "t task 'Buy milk'", "b paragraph 'Two'", "c paragraph 'Three, theirs'",
      ])
    #expect(rows(carrying: "editor-task:t", in: merged.document) == 1)
    #expect(!merged.bothChanged)

    // Merged once more from the merged page, nothing is added again.
    let again = merge(merged.document, merged.document, theirs)
    #expect(rows(carrying: "editor-task:t", in: again.document) == 1)
  }

  @Test func a_to_dos_row_keeps_its_taskId() {
    let base = Lines.document(Lines.line("a", "One"), Self.todo("t", "Call"), Lines.line("c", "Three"))
    let mine = Lines.document(Lines.line("a", "One"), Self.todo("t", "Call mum"), Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One, theirs"), Self.todo("t", "Call"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(written("t", in: merged.document) == Self.todo("t", "Call mum"))
    #expect(rows(carrying: "editor-task:t", in: merged.document) == 1)
  }

  // MARK: - Arrangement

  @Test func only_he_nested_lines_keeps_his_arrangement_with_their_words() {
    let mine = Lines.document(Lines.line("a", "One", children: [Lines.line("b", "Two")]), Lines.line("c", "Three"))
    let theirs = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two, theirs"), Lines.line("s", "Server's"), Lines.line("c", "Three"))

    #expect(
      outline(merge(base, mine, theirs).document) == [
        "a paragraph 'One'", "  b paragraph 'Two, theirs'", "  s paragraph 'Server's'", "c paragraph 'Three'",
      ])
  }

  @Test func only_the_server_moved_lines_keeps_theirs_with_his_words() {
    let mine = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two, mine"), Lines.line("c", "Three"), Lines.line("x", "Added"))
    let theirs = Lines.document(Lines.line("a", "One", children: [Lines.line("b", "Two")]), Lines.line("c", "Three"))

    #expect(
      outline(merge(base, mine, theirs).document) == [
        "a paragraph 'One'", "  b paragraph 'Two, mine'", "c paragraph 'Three'", "x paragraph 'Added'",
      ])
  }

  @Test func both_rearranged_keeps_theirs_and_his_words() {
    let base = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("c", "Three"), Lines.line("d", "Four"))
    let mine = Lines.document(
      Lines.line("a", "One"), Lines.line("x", "Added"),
      Lines.line("b", "Two", children: [Lines.line("c", "Three, mine")]))
    let theirs = Lines.document(
      Lines.line("a", "One", children: [Lines.line("b", "Two")]), Lines.line("c", "Three"), Lines.line("d", "Four"))

    #expect(
      outline(merge(base, mine, theirs).document) == [
        "a paragraph 'One'", "  b paragraph 'Two'", "x paragraph 'Added'", "c paragraph 'Three, mine'",
      ])
  }

  // MARK: - Blocks the app does not draw

  @Test func a_database_or_synced_block_is_always_the_servers() {
    let database = { (props: String, row: String) in
      Lines.block("db", "database", props: props, children: [Lines.line("r", row)])
    }
    let synced = { (text: String) in
      Lines.block("sy", "syncedBlock", props: #"{"syncedId":"s1"}"#, children: [Lines.line("sr", text)])
    }
    let base = Lines.document(
      Lines.line("a", "One"), database(#"{"databaseId":"d1"}"#, "Row"), synced("Shared"), Lines.line("c", "Three"))
    // He cannot change either from the app; a draft that did is still not taken over the server's.
    let mine = Lines.document(
      Lines.line("a", "One"), database(#"{"databaseId":"d9"}"#, "Row, mine"), synced("Shared, mine"),
      Lines.line("c", "Three, mine"))
    let theirs = Lines.document(
      Lines.line("a", "One, theirs"), database(#"{"databaseId":"d2"}"#, "Row, theirs"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(
      merged.document
        == Lines.document(
          Lines.line("a", "One, theirs"), database(#"{"databaseId":"d2"}"#, "Row, theirs"),
          Lines.line("c", "Three, mine")))
    #expect(!merged.bothChanged)

    // A draft without the block, on a server that still has it: the block stays, as the server has it.
    let without = Lines.document(Lines.line("a", "One"), Lines.line("c", "Three, mine"))
    let kept = Lines.document(
      Lines.line("a", "One, theirs"), database(#"{"databaseId":"d1"}"#, "Row"), synced("Shared"),
      Lines.line("c", "Three"))
    #expect(
      merge(base, without, kept).document
        == Lines.document(
          Lines.line("a", "One, theirs"), database(#"{"databaseId":"d1"}"#, "Row"), synced("Shared"),
          Lines.line("c", "Three, mine")))
  }

  // MARK: - Pages that do not read

  @Test func a_server_page_that_does_not_parse_leaves_his_draft() {
    let mine = Lines.document(Lines.line("a", "One, mine"), Lines.line("b", "Two"), Lines.line("c", "Three"))

    #expect(merge(base, mine, "[{") == PageMerge.Merged(document: mine, bothChanged: false))
  }

  @Test func a_draft_that_does_not_parse_leaves_the_servers_page() {
    let theirs = Lines.document(Lines.line("a", "One, theirs"), Lines.line("b", "Two"), Lines.line("c", "Three"))

    #expect(merge(base, "[{", theirs) == PageMerge.Merged(document: theirs, bothChanged: false))
  }

  @Test func a_base_that_does_not_parse_keeps_every_line_of_both() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two, mine"), Lines.line("x", "Added"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two, theirs"), Lines.line("s", "Server's"))

    let merged = merge("[{", mine, theirs)

    #expect(
      outline(merged.document) == [
        "a paragraph 'One'", "b paragraph 'Two, theirs'", "n1 paragraph 'Two, mine'", "x paragraph 'Added'",
        "s paragraph 'Server's'",
      ])
    #expect(merged.bothChanged)
  }

  @Test func a_page_with_a_repeated_id_merges_without_repeating_it() {
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two"), Lines.line("b", "Two again"))
    let mine = Lines.document(Lines.line("a", "One, mine"), Lines.line("b", "Two"), Lines.line("c", "Three"))

    let merged = merge(base, mine, theirs)

    #expect(outline(merged.document) == ["a paragraph 'One, mine'", "b paragraph 'Two'", "n1 paragraph 'Two again'"])
    #expect(Generated.repeatedIDs(merged.document).isEmpty)
  }

  @Test func a_block_undrawn_only_in_his_version_is_the_servers_line_with_its_nested_lines_once() {
    let base = Lines.document(
      Lines.line("a", "One"), Lines.line("p", "P", children: [Lines.line("k1", "Kid"), Lines.line("k2", "Kid two")]),
      Lines.line("c", "Three"))
    let mine = Lines.document(
      Lines.line("a", "One, mine"),
      Lines.block(
        "p", "database", props: #"{"databaseId":"d1"}"#,
        children: [Lines.line("k1", "Kid"), Lines.line("k2", "Kid two")]),
      Lines.line("c", "Three"))
    let theirs = Lines.document(
      Lines.line("a", "One"),
      Lines.line("p", "P", children: [Lines.line("k1", "Kid"), Lines.line("k2", "Kid two, theirs")]),
      Lines.line("c", "Three"))

    #expect(
      merge(base, mine, theirs)
        == PageMerge.Merged(
          document: Lines.document(
            Lines.line("a", "One, mine"),
            Lines.line("p", "P", children: [Lines.line("k1", "Kid"), Lines.line("k2", "Kid two, theirs")]),
            Lines.line("c", "Three")),
          bothChanged: false))
  }

  @Test func a_task_id_on_two_rows_stays_on_the_servers_row() {
    let row = { (id: String, text: String) in
      Lines.line(id, "task", props: #"{"taskId":"editor-task:x","role":"plan","planDate":"2026-11-26"}"#, text)
    }
    let mine = Lines.document(Lines.line("a", "One"), row("r1", "Mine"))
    let theirs = Lines.document(Lines.line("a", "One"), row("r2", "Theirs"))

    let merged = merge("[{", mine, theirs)

    #expect(
      merged
        == PageMerge.Merged(
          document: Lines.document(Lines.line("a", "One"), Lines.line("r1", "Mine"), row("r2", "Theirs")),
          bothChanged: false))
  }

  @Test func an_untouched_line_is_written_exactly_as_it_was_read() {
    // An escaped slash, a non-ASCII character written as an escape, a number as written, and the keys out of order.
    let odd =
      #"{"type":"paragraph","id":"odd","children":[],"props":{"textColor":"default","x":1.50},"content":"#
      + #"[{"type":"text","text":"a\/b "# + "\\" + #"u00e9","styles":{}}]}"#
    let base = Lines.document(Lines.line("a", "One"), odd, Lines.line("c", "Three"))
    let mine = Lines.document(Lines.line("a", "One, mine"), odd, Lines.line("c", "Three"))
    let theirs = Lines.document(Lines.line("a", "One"), odd, Lines.line("c", "Three, theirs"))

    #expect(
      merge(base, mine, theirs).document
        == Lines.document(Lines.line("a", "One, mine"), odd, Lines.line("c", "Three, theirs")))
  }

  // MARK: - Field by field

  @Test func he_kept_typing_in_a_new_to_do_while_the_server_planned_it_is_one_to_do_with_his_words() {
    let sent = #"{"taskId":"editor-task:r","role":"reference","planDate":""}"#
    let planned = #"{"taskId":"editor-task:r","role":"plan","planDate":"2026-11-26"}"#
    let base = Lines.document(Lines.line("a", "One"), Lines.line("r", "task", props: sent, "Buy"))
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("r", "task", props: sent, "Buy milk"))
    let theirs = Lines.document(Lines.line("a", "One"), Lines.line("r", "task", props: planned, "Buy"))

    #expect(
      merge(base, mine, theirs)
        == PageMerge.Merged(
          document: Lines.document(Lines.line("a", "One"), Lines.line("r", "task", props: planned, "Buy milk")),
          bothChanged: false))
  }

  @Test func a_link_the_server_stamped_while_he_typed_on_keeps_his_words_and_the_stamp() {
    let link = { (page: String) in #"{"type":"pageRef","props":{"pageId":"\#(page)"}}"# }
    let stamped = { (page: String) in #"{"type":"pageRef","props":{"pageId":"\#(page)","at":7}}"# }
    let base = Lines.document(
      Lines.line("a", "One"), Lines.block("l", words: [Lines.run("See "), link("p1"), Lines.run(" and "), link("p2")]))
    let mine = Lines.document(
      Lines.line("a", "One"),
      Lines.block("l", words: [Lines.run("See "), link("p1"), Lines.run(" and "), link("p2"), Lines.run(" today")]))
    let theirs = Lines.document(
      Lines.line("a", "One"),
      Lines.block("l", words: [Lines.run("See "), stamped("p1"), Lines.run(" and "), stamped("p2")]))

    #expect(
      merge(base, mine, theirs)
        == PageMerge.Merged(
          document: Lines.document(
            Lines.line("a", "One"),
            Lines.block(
              "l", words: [Lines.run("See "), stamped("p1"), Lines.run(" and "), stamped("p2"), Lines.run(" today")])),
          bothChanged: false))
  }

  @Test func a_page_link_block_the_server_stamped_while_he_changed_another_prop_is_one_line() {
    // A page link is a block the app does not draw, so the server's version is the line.
    let base = Lines.document(Lines.line("a", "One"), Lines.block("pl", "pageLink", props: #"{"pageId":"p1"}"#))
    let mine = Lines.document(
      Lines.line("a", "One"), Lines.block("pl", "pageLink", props: #"{"pageId":"p1","textColor":"red"}"#))
    let theirs = Lines.document(
      Lines.line("a", "One"), Lines.block("pl", "pageLink", props: #"{"pageId":"p1","at":7}"#))

    #expect(merge(base, mine, theirs) == PageMerge.Merged(document: theirs, bothChanged: false))
  }

  @Test func he_changed_the_words_and_the_server_the_kind_is_one_line_of_the_servers_kind_with_his_words() {
    let mine = Lines.document(Lines.line("a", "One"), Lines.line("b", "Two, mine"), Lines.line("c", "Three"))
    let theirs = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "bulletListItem", "Two"), Lines.line("c", "Three"))

    #expect(
      merge(base, mine, theirs)
        == PageMerge.Merged(
          document: Lines.document(
            Lines.line("a", "One"), Lines.line("b", "bulletListItem", "Two, mine"), Lines.line("c", "Three")),
          bothChanged: false))
  }

  @Test func both_changed_the_same_prop_differently_puts_his_line_below() {
    let red = #"{"backgroundColor":"default","textColor":"red","textAlignment":"left"}"#
    let blue = #"{"backgroundColor":"default","textColor":"blue","textAlignment":"left"}"#
    let mine = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "paragraph", props: red, "Two, mine"), Lines.line("c", "Three"))
    let theirs = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "paragraph", props: blue, "Two"), Lines.line("c", "Three"))

    #expect(
      merge(base, mine, theirs)
        == PageMerge.Merged(
          document: Lines.document(
            Lines.line("a", "One"), Lines.line("b", "paragraph", props: blue, "Two"),
            Lines.line("n1", "paragraph", props: red, "Two, mine"), Lines.line("c", "Three")),
          bothChanged: true))
  }

  @Test func a_prop_one_side_removed_stays_removed() {
    let base = Lines.document(
      Lines.line("a", "One"),
      Lines.line(
        "b", "paragraph",
        props: #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","x":"1","y":"2"}"#, "Two"))
    // The server removed `x` and changed the colour; he removed `y` and changed the words.
    let theirs = Lines.document(
      Lines.line("a", "One"),
      Lines.line(
        "b", "paragraph", props: #"{"backgroundColor":"default","textColor":"red","textAlignment":"left","y":"2"}"#,
        "Two"))
    let mine = Lines.document(
      Lines.line("a", "One"),
      Lines.line(
        "b", "paragraph", props: #"{"backgroundColor":"default","textColor":"default","textAlignment":"left","x":"1"}"#,
        "Two, mine"))

    #expect(
      merge(base, mine, theirs)
        == PageMerge.Merged(
          document: Lines.document(
            Lines.line("a", "One"),
            Lines.line(
              "b", "paragraph", props: #"{"backgroundColor":"default","textColor":"red","textAlignment":"left"}"#,
              "Two, mine")),
          bothChanged: false))
  }

  // MARK: - Two devices

  @Test func a_merge_of_a_merge_settles() {
    let start = base
    let deviceA = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two from A"), Lines.line("xa", "A's line"), Lines.line("c", "Three"))
    let deviceB = Lines.document(
      Lines.line("a", "One"), Lines.line("b", "Two from B"), Lines.line("c", "Three"), Lines.line("xb", "B's line"))

    // A saves. B's save is refused; B merges and saves, and its draft is now the merged page on A's page.
    let onB = merge(start, deviceB, deviceA)
    #expect(onB.bothChanged)
    // A's draft is the page A saved; A merges what B saved.
    let onA = merge(deviceA, deviceA, onB.document)

    #expect(onA.document == onB.document)
    #expect(
      outline(onA.document) == [
        "a paragraph 'One'", "b paragraph 'Two from A'", "n1 paragraph 'Two from B'", "xa paragraph 'A's line'",
        "c paragraph 'Three'", "xb paragraph 'B's line'",
      ])
    // Once more, on either device, nothing changes.
    #expect(merge(onB.document, onA.document, onB.document).document == onB.document)
    #expect(merge(deviceA, onB.document, onB.document).document == onB.document)
    #expect(!merge(deviceA, onB.document, onB.document).bothChanged)
  }

  // MARK: - What must always hold

  /// The merge without its short cuts, so the properties below are answered by the line-by-line merge itself.
  private func lineByLine(_ base: String, _ mine: String, _ theirs: String) -> PageMerge.Merged {
    let counter = Lines.Counter()
    return PageMerge.mergeLineByLine(base: base, mine: mine, theirs: theirs, makeID: { "n\(counter.next())" })
  }

  @Test func merging_with_an_unchanged_server_page_gives_his_draft_exactly() {
    for seed in Generated.seeds {
      let (base, mine, _) = Generated.pages(seed)
      let expected = PageMerge.Merged(document: mine, bothChanged: false)
      #expect(merge(base, mine, base) == expected, "seed \(seed)")
      #expect(lineByLine(base, mine, base) == expected, "seed \(seed), line by line")
    }
  }

  @Test func merging_an_unchanged_draft_gives_the_servers_page_exactly() {
    for seed in Generated.seeds {
      let (base, _, theirs) = Generated.pages(seed)
      let expected = PageMerge.Merged(document: theirs, bothChanged: false)
      #expect(merge(base, base, theirs) == expected, "seed \(seed)")
      #expect(lineByLine(base, base, theirs) == expected, "seed \(seed), line by line")
    }
  }

  @Test func the_same_change_on_both_sides_is_that_change() {
    for seed in Generated.seeds {
      let (base, mine, _) = Generated.pages(seed)
      let expected = PageMerge.Merged(document: mine, bothChanged: false)
      #expect(merge(base, mine, mine) == expected, "seed \(seed)")
      #expect(lineByLine(base, mine, mine) == expected, "seed \(seed), line by line")
    }
  }

  @Test func no_words_either_side_wrote_are_missing() {
    for seed in Generated.seeds {
      let (base, mine, theirs) = Generated.pages(seed)
      let result = Generated.Result(merge(base, mine, theirs).document)
      for (side, isHis) in [(mine, true), (theirs, false)] {
        for line in Generated.written(side, since: base) {
          #expect(
            result.holds(line, isHis: isHis),
            "seed \(seed): \(line.block.id) as \(isHis ? "he" : "the server") wrote it is missing")
        }
      }
    }
  }

  @Test func no_line_is_doubled() {
    for seed in Generated.seeds {
      let (base, mine, theirs) = Generated.pages(seed)
      let original = Generated.everyID(mine).union(Generated.everyID(theirs))
      let made = Generated.drawnLines(merge(base, mine, theirs).document).filter { !original.contains($0.id) }
      #expect(made.count <= Generated.linesTheMergeMayMake(base, mine, theirs), "seed \(seed)")
    }
  }

  @Test func merging_again_changes_nothing() {
    for seed in Generated.seeds {
      let (base, mine, theirs) = Generated.pages(seed)
      let merged = merge(base, mine, theirs).document
      #expect(merge(base, merged, theirs).document == merged, "seed \(seed)")
      #expect(merge(theirs, merged, theirs).document == merged, "seed \(seed), on the server's page")
      #expect(lineByLine(theirs, merged, theirs).document == merged, "seed \(seed), on the server's page, line by line")
    }
  }

  @Test func no_block_id_appears_twice() {
    for seed in Generated.seeds {
      let (base, mine, theirs) = Generated.pages(seed)
      #expect(Generated.repeatedIDs(merge(base, mine, theirs).document).isEmpty, "seed \(seed)")
    }
  }

  @Test func no_task_id_appears_twice() {
    for seed in Generated.seeds {
      let (base, mine, theirs) = Generated.pages(seed)
      #expect(Generated.repeatedTaskIDs(merge(base, mine, theirs).document).isEmpty, "seed \(seed)")
    }
  }

  @Test func the_result_parses_and_round_trips() {
    for seed in Generated.seeds {
      let (base, mine, theirs) = Generated.pages(seed)
      let document = merge(base, mine, theirs).document
      #expect(Document.parses(document), "seed \(seed)")
      #expect(Document.write(Document.blocks(document)) == document, "seed \(seed)")
    }
  }
}

/// Pages made by a seeded generator, and each side's random edits made through `EditablePage`.
enum Generated {
  static let seeds: [UInt64] = Array(1...200)

  /// SplitMix64: the same seed gives the same page and edits on every run and platform.
  struct Generator: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
      state &+= 0x9E37_79B9_7F4A_7C15
      var z = state
      z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
      z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
      return z ^ (z >> 31)
    }
  }

  /// The page both sides started from, his draft and the server's page.
  static func pages(_ seed: UInt64) -> (base: String, mine: String, theirs: String) {
    var random = Generator(state: seed)
    let base = page(&random, seed: seed)
    let mine = edited(base, &random, prefix: "m\(seed)-")
    let theirs = edited(base, &random, prefix: "t\(seed)-")
    return (base, mine, theirs)
  }

  private static func page(_ random: inout Generator, seed: UInt64) -> String {
    var count = 0
    func line(depth: Int) -> Block {
      count += 1
      let id = "b\(seed)-\(count)"
      let content = JSONValue.array([
        .object(["type": .string("text"), "text": .string(phrase(&random)), "styles": .object(JSONObject())])
      ])
      let kinds: [NewBlock.Kind] = [
        .paragraph, .paragraph, .bullet, .numbered(start: nil), .heading(level: 2), .quote, .todo,
      ]
      let kind = kinds[Int.random(in: 0..<kinds.count, using: &random)]
      var block = NewBlock.make(kind, id: id, content: content, pageDate: nil)
      if depth < 2, Int.random(in: 0..<4, using: &random) == 0 {
        block.children = (0..<Int.random(in: 1...2, using: &random)).map { _ in line(depth: depth + 1) }
      }
      return block
    }
    var blocks = (0..<Int.random(in: 3...7, using: &random)).map { _ in line(depth: 0) }
    if Int.random(in: 0..<4, using: &random) == 0 {
      count += 1
      let database = Block(
        id: "db\(seed)", type: "database", props: ["databaseId": .string("d1")], children: [line(depth: 2)])
      blocks.insert(database, at: Int.random(in: 0...blocks.count, using: &random))
    }
    return Document.write(blocks)
  }

  /// Words of random letters, so two lines rarely hold the same words by chance.
  private static func phrase(_ random: inout Generator) -> String {
    let letters = Array("abcdefghijklmnopqrstuvwxyz")
    let han = Array("雨写茶山风")
    func word() -> String {
      if Int.random(in: 0..<8, using: &random) == 0 {
        return String(han[Int.random(in: 0..<han.count, using: &random)])
      }
      let length = Int.random(in: 3...7, using: &random)
      return String((0..<length).map { _ in letters[Int.random(in: 0..<26, using: &random)] })
    }
    return (0..<Int.random(in: 1...3, using: &random)).map { _ in word() }.joined(separator: " ")
  }

  private static func edited(_ document: String, _ random: inout Generator, prefix: String) -> String {
    let counter = Lines.Counter()
    var page = EditablePage(document: document, pageDate: nil, makeID: { "\(prefix)\(counter.next())" })
    for _ in 0..<Int.random(in: 0...5, using: &random) {
      let lines = page.textBlocks
      guard !lines.isEmpty else { break }
      let line = lines[Int.random(in: 0..<lines.count, using: &random)]
      let length = page.content(of: line)?.length ?? 0
      let offset = Int.random(in: 0...length, using: &random)
      switch Int.random(in: 0..<7, using: &random) {
      case 0, 1: _ = page.replaceText(in: line, range: offset..<offset, with: " " + phrase(&random))
      case 2: _ = page.replaceText(in: line, range: 0..<length, with: phrase(&random))
      case 3: _ = page.press(.returnKey, at: EditablePage.Caret(block: line, offset: offset))
      case 4: _ = page.press(.backspace, at: EditablePage.Caret(block: line, offset: 0))
      case 5: _ = page.press(.tab, at: EditablePage.Caret(block: line, offset: offset))
      default: _ = page.press(.shiftTab, at: EditablePage.Caret(block: line, offset: offset))
      }
    }
    return page.document
  }

  /// Each line the app draws, nested lines included, in page order.
  static func drawnLines(_ document: String) -> [Block] {
    var out: [Block] = []
    func walk(_ blocks: [Block]) {
      for block in blocks where EditablePage.drawnTypes.contains(block.type) {
        out.append(block)
        walk(block.children)
      }
    }
    walk(Document.blocks(document))
    return out
  }

  /// A line's fields as the merge reads them: its keys but `id`, `props` and `children`, and each key of its props.
  static func fields(_ block: Block) -> [String: JSONValue] {
    var alone = block
    alone.children = []
    guard let node = alone.value.objectValue else { return [:] }
    var out: [String: JSONValue] = [:]
    for key in node.keys where !["id", "props", "children"].contains(key) { out[key] = node[key] }
    for key in alone.props.keys { out["props." + key] = alone.props[key] }
    return out
  }

  private static func byID(_ lines: [Block]) -> [String: Block] {
    Dictionary(lines.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
  }

  static func isToDoRow(_ block: Block) -> Bool {
    block.type == "task" && block.props["taskId"]?.stringValue != nil
  }

  /// A line a side added or changed, with the fields it wrote (nil for a field it removed).
  struct Written {
    let block: Block
    let fields: [String: JSONValue?]
  }

  static func written(_ side: String, since base: String) -> [Written] {
    let before = byID(drawnLines(base))
    return drawnLines(side).compactMap { block in
      let now = fields(block)
      guard let old = before[block.id].map(fields) else { return Written(block: block, fields: now) }
      var changed: [String: JSONValue?] = [:]
      for key in Set(now.keys).union(old.keys) where now[key] != old[key] { changed.updateValue(now[key], forKey: key) }
      return changed.isEmpty ? nil : Written(block: block, fields: changed)
    }
  }

  /// The merged page, by line id.
  struct Result {
    let lines: [Block]
    /// Each line by id, with the line right after it at its level.
    let byID: [String: (block: Block, next: Block?)]

    init(_ document: String) {
      var byID: [String: (block: Block, next: Block?)] = [:]
      func walk(_ blocks: [Block]) {
        for (index, block) in blocks.enumerated() where EditablePage.drawnTypes.contains(block.type) {
          byID[block.id] = (block, index + 1 < blocks.count ? blocks[index + 1] : nil)
          walk(block.children)
        }
      }
      walk(Document.blocks(document))
      lines = Generated.drawnLines(document)
      self.byID = byID
    }

    /// The line is there under its own id holding what that side wrote; or, when a field conflicted, his words are
    /// the line right after the server's; or his to-do's row came back as a plain line.
    func holds(_ line: Written, isHis: Bool) -> Bool {
      if let found = byID[line.block.id] {
        let now = Generated.fields(found.block)
        if line.fields.allSatisfy({ now[$0.key] == $0.value }) { return true }
        guard isHis, let below = found.next else { return false }
        return Self.isCopy(below, of: line.block)
      }
      return isHis && Generated.isToDoRow(line.block) && lines.contains { Self.isCopy($0, of: line.block) }
    }

    private static func isCopy(_ line: Block, of his: Block) -> Bool {
      guard line.content == his.content else { return false }
      if Generated.isToDoRow(his) { return line.type == "paragraph" && line.props["taskId"] == nil }
      return line.type == his.type && line.props == his.props
    }
  }

  /// At most one line for each line changed by both in some same field differently, and one for each to-do's row
  /// he changed that the server deleted.
  static func linesTheMergeMayMake(_ base: String, _ mine: String, _ theirs: String) -> Int {
    let before = byID(drawnLines(base))
    let server = byID(drawnLines(theirs))
    var count = 0
    for his in drawnLines(mine) {
      guard let old = before[his.id].map(fields) else { continue }
      let now = fields(his)
      if let theirs = server[his.id].map(fields) {
        let keys = Set(now.keys).union(theirs.keys).union(old.keys)
        if keys.contains(where: { now[$0] != old[$0] && theirs[$0] != old[$0] && now[$0] != theirs[$0] }) { count += 1 }
      } else if isToDoRow(his), now != old {
        count += 1
      }
    }
    return count
  }

  static func everyID(_ document: String) -> Set<String> {
    var ids = Set<String>()
    func walk(_ blocks: [Block]) {
      for block in blocks {
        ids.insert(block.id)
        walk(block.children)
      }
    }
    walk(Document.blocks(document))
    return ids
  }

  /// Ids that occur more than once, at any depth, inside blocks the app does not draw too.
  static func repeatedIDs(_ document: String) -> [String] {
    repeated(in: document) { [$0.id] }
  }

  /// `taskId`s carried by more than one to-do's row, at any depth.
  static func repeatedTaskIDs(_ document: String) -> [String] {
    repeated(in: document) { block in isToDoRow(block) ? [block.props["taskId"]?.stringValue ?? ""] : [] }
  }

  private static func repeated(in document: String, _ keys: (Block) -> [String]) -> [String] {
    var seen = Set<String>()
    var repeated: [String] = []
    func walk(_ blocks: [Block]) {
      for block in blocks {
        for key in keys(block) where !seen.insert(key).inserted { repeated.append(key) }
        walk(block.children)
      }
    }
    walk(Document.blocks(document))
    return repeated
  }
}
