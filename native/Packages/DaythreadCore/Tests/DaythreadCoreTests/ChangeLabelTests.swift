import Testing

@testable import DaythreadCore

@Suite struct ChangeLabelTests {
  @Test func labels_are_the_webs() throws {
    let cases = try Fixtures.cases("labels/cases.json")
    #expect(cases.count >= 8)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? ""
      let ws = try #require(entry["workspace"].flatMap(Workspace.init))
      let action = try #require(entry["action"])
      let expected = try #require(entry["label"]?.stringValue)
      let label = ChangeLabel.text(for: action, in: ws)
      #expect(label.hasSameCodeUnits(as: expected), "\(name): \(label)")
    }
  }
}
