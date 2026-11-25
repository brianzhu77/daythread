// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "DaythreadSync",
  platforms: [.iOS(.v26), .macOS(.v26)],
  products: [
    .library(name: "DaythreadSync", targets: ["DaythreadSync"])
  ],
  dependencies: [
    .package(path: "../DaythreadCore")
  ],
  targets: [
    .target(
      name: "DaythreadSync",
      dependencies: [.product(name: "DaythreadCore", package: "DaythreadCore")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
    .testTarget(
      name: "DaythreadSyncTests",
      dependencies: ["DaythreadSync", .product(name: "DaythreadCore", package: "DaythreadCore")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
