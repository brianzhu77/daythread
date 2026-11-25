/// Checks the app can run over a workspace before it trusts what it reads.
public enum Audit {
  /// The ids of pages, in the workspace's order, whose document does not parse or does not write back
  /// byte for byte. A day's draft is held to the same writing back, as the object it is.
  public static func pagesThatDoNotRoundTrip(_ workspace: Workspace) -> [String] {
    workspace.pages.filter { !roundTrips($0) }.map(\.id)
  }

  private static func roundTrips(_ page: Page) -> Bool {
    if page.isDraft {
      guard let value = try? JSON.parse(page.document) else { return false }
      return JSON.write(value).hasSameCodeUnits(as: page.document)
    }
    return Document.parses(page.document)
      && Document.write(Document.blocks(page.document)).hasSameCodeUnits(as: page.document)
  }
}
