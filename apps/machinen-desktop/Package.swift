// swift-tools-version: 6.0
import Foundation
import PackageDescription

let packageRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
#if arch(arm64)
let ghosttySlice = "macos-arm64"
#elseif arch(x86_64)
let ghosttySlice = "macos-x86_64"
#else
#error("Machinen Desktop supports macOS arm64 and x86_64")
#endif
let ghosttyLibrary = "\(packageRoot)/Dependencies/GhosttyKit.xcframework/\(ghosttySlice)/libghostty.a"

let package = Package(
    name: "MachinenDesktop",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "MachinenDesktop", targets: ["MachinenDesktop"]),
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "MachinenDesktop",
            dependencies: ["GhosttyKit"],
            path: "Sources/MachinenDesktop",
            resources: [.copy("GhosttyResources")],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-force_load", "-Xlinker", ghosttyLibrary]),
                .linkedFramework("Carbon"),
                .linkedFramework("GameController"),
                .linkedLibrary("c++"),
            ]
        ),
        .binaryTarget(
            name: "GhosttyKit",
            path: "Dependencies/GhosttyKit.xcframework"
        ),
    ]
)
