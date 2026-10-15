// swift-tools-version: 6.2
import PackageDescription

let strict: [SwiftSetting] = [
    .enableUpcomingFeature("ExistentialAny"),
]

let package = Package(
    name: "TeakKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "TeakCore", targets: ["TeakCore"]),
        .library(name: "TeakSync", targets: ["TeakSync"]),
        .library(name: "TeakUI", targets: ["TeakUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/get-convex/convex-swift", exact: "0.8.1"),
    ],
    targets: [
        .target(
            name: "TeakCore",
            resources: [.process("Resources")],
            swiftSettings: strict
        ),
        .target(
            name: "TeakSync",
            dependencies: [
                "TeakCore",
                .product(name: "ConvexMobile", package: "convex-swift"),
            ],
            swiftSettings: strict
        ),
        .target(
            name: "TeakUI",
            dependencies: ["TeakCore"],
            swiftSettings: strict
        ),
        .testTarget(
            name: "TeakCoreTests",
            dependencies: ["TeakCore"],
            swiftSettings: strict
        ),
    ]
)
