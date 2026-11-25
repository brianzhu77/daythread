// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "DaythreadCore",
  platforms: [.iOS(.v26), .macOS(.v26)],
  products: [
    .library(name: "DaythreadCore", targets: ["DaythreadCore"])
  ],
  targets: [
    .target(
      name: "DaythreadCore",
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
    .testTarget(
      name: "DaythreadCoreTests",
      dependencies: ["DaythreadCore"],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
