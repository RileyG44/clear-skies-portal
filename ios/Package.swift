// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ClearSkiesPlatform",
    platforms: [.macOS(.v14)],
    products: [.library(name: "EngineSupport", targets: ["EngineSupport"])],
    targets: [
        .target(name: "EngineSupport", path: "Sources/Engine",
                exclude: ["LocalEngine.swift", "NetworkTransport.swift", "EngineRuntime.swift",
                          "EngineAppDelegate.swift", "BackgroundDownloads.swift", "EngineBackground.swift"],
                sources: ["TransferJournal.swift"]),
        .testTarget(name: "EngineSupportTests", dependencies: ["EngineSupport"], path: "Tests")
    ]
)
