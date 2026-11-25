// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "DaythreadUI",
  platforms: [.iOS(.v26), .macOS(.v26)],
  products: [
    .library(name: "DaythreadUI", targets: ["DaythreadUI"])
  ],
  dependencies: [
    .package(path: "../DaythreadCore"),
    .package(path: "../DaythreadSync"),
    .package(path: "../DaythreadEditor"),
  ],
  targets: [
    .target(
      name: "DaythreadUI",
      dependencies: [
        .product(name: "DaythreadCore", package: "DaythreadCore"),
        .product(name: "DaythreadSync", package: "DaythreadSync"),
        .product(name: "DaythreadEditor", package: "DaythreadEditor"),
      ],
      swiftSettings: [.swiftLanguageMode(.v6)]
    )
  ]
)
