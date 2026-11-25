// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "DaythreadEditor",
  platforms: [.iOS(.v26), .macOS(.v26)],
  products: [
    .library(name: "DaythreadEditor", targets: ["DaythreadEditor"])
  ],
  dependencies: [
    .package(path: "../DaythreadCore")
  ],
  targets: [
    .target(
      name: "DaythreadEditor",
      dependencies: [.product(name: "DaythreadCore", package: "DaythreadCore")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
    .testTarget(
      name: "DaythreadEditorTests",
      dependencies: ["DaythreadEditor", .product(name: "DaythreadCore", package: "DaythreadCore")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
