// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TorTok",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(
            name: "TorTok",
            targets: ["TorTok"]
        )
    ],
    dependencies: [
        // HTTP Networking
        .package(url: "https://github.com/Alamofire/Alamofire", from: "5.8.0"),

        // Image Loading & Caching
        .package(url: "https://github.com/onevcat/Kingfisher", from: "7.0.0"),

        // SQLite Database
        .package(url: "https://github.com/groue/GRDB.swift", from: "6.0.0"),
    ],
    targets: [
        // Main app target
        .target(
            name: "TorTok",
            dependencies: [
                "Alamofire",
                "Kingfisher",
                .product(name: "GRDB", package: "GRDB.swift"),
                "LibTorrentBridge"
            ],
            path: "TorTok"
        ),

        // LibTorrent Objective-C++ Bridge
        .target(
            name: "LibTorrentBridge",
            dependencies: [],
            path: "TorTok/Services/Torrent/Bridge",
            publicHeadersPath: "include",
            cxxSettings: [
                .headerSearchPath("../../../../../libtorrent/include"),
                .define("TORRENT_USE_OPENSSL"),
                .define("TORRENT_USE_I2P", to: "0"),
                .unsafeFlags(["-std=c++17"])
            ],
            linkerSettings: [
                .linkedLibrary("torrent-rasterbar"),
                .linkedFramework("Security"),
                .linkedFramework("SystemConfiguration")
            ]
        ),

        // Tests
        .testTarget(
            name: "TorTokTests",
            dependencies: ["TorTok"],
            path: "TorTokTests"
        )
    ],
    cxxLanguageStandard: .cxx17
)
