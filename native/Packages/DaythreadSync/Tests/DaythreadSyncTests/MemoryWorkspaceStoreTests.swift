import Testing

@testable import DaythreadSync

@Suite struct MemoryWorkspaceStoreTests {
  @Test(arguments: WorkspaceStoreContract.cases)
  func keepsTheContract(_ contract: StoreCase) async throws {
    try await contract.run(MemoryWorkspaceStore())
  }
}
