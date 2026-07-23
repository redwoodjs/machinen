// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MachinenDesktop",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "MachinenDesktop", targets: ["MachinenDesktop"]),
    ],
    dependencies: [
        .package(path: "Vendor/SwiftTerm"),
    ],
    targets: [
        .executableTarget(
            name: "MachinenDesktop",
            dependencies: [.product(name: "SwiftTerm", package: "SwiftTerm")],
            path: "Sources/MachinenDesktop"
        ),
    ]
)
