// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MachinenDesktop",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(
            url: "https://github.com/migueldeicaza/SwiftTerm.git",
            revision: "dd2fb8ac5b861e7bf617c872895e338f38165648"
        ),
    ],
    targets: [
        .executableTarget(
            name: "MachinenDesktop",
            dependencies: [.product(name: "SwiftTerm", package: "SwiftTerm")],
            path: "Sources/MachinenDesktop"
        ),
    ]
)
