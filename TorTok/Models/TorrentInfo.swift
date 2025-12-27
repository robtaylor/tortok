//
//  TorrentInfo.swift
//  TorTok
//

import Foundation

struct TorrentInfo: Identifiable {
    let id: String // infoHash
    let name: String
    var progress: Double
    var downloadRate: Int64
    var uploadRate: Int64
    var numPeers: Int
    var state: TorrentState

    enum TorrentState: Int {
        case checkingFiles = 0
        case downloadingMetadata = 1
        case downloading = 2
        case finished = 3
        case seeding = 4
        case allocating = 5
        case checkingResumeData = 6
    }

    var isComplete: Bool {
        progress >= 1.0
    }

    var isSeeding: Bool {
        state == .seeding || state == .finished
    }
}

// MARK: - Formatted Properties

extension TorrentInfo {
    var formattedDownloadRate: String {
        ByteCountFormatter.string(fromByteCount: downloadRate, countStyle: .binary) + "/s"
    }

    var formattedUploadRate: String {
        ByteCountFormatter.string(fromByteCount: uploadRate, countStyle: .binary) + "/s"
    }

    var progressPercentage: String {
        String(format: "%.1f%%", progress * 100)
    }
}
