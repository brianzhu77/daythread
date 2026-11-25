/// Checks the app can run over a workspace before it trusts what it reads.
public enum Audit {
  /// The ids of pages, in the workspace's order, whose document does not parse or does not write back
  /// byte for byte.
  public static func pagesThatDoNotRoundTrip(_ workspace: Workspace) -> [String] {
    workspace.pages.filter { page in
      !Document.parses(page.document)
        || !Document.write(Document.blocks(page.document)).hasSameCodeUnits(as: page.document)
    }.map(\.id)
  }
}
