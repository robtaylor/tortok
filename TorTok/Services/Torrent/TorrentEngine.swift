//
//  TorrentEngine.swift
//  TorTok
//
//  Swift wrapper around LibTorrent C++ library
//

import Foundation
import Combine

class TorrentEngine: ObservableObject {
    // NOTE: This will use LibTorrentSession from the Obj-C++ bridge once compiled
    // private let session: LibTorrentSession

    @Published var activeTorrents: [TorrentInfo] = []
    @Published var downloadRate: Int64 = 0
    @Published var uploadRate: Int64 = 0
    @Published var isActive: Bool = false

    private var cancellables = Set<AnyCancellable>()
    private let fileManager = FileManager.default

    init() {
        // TODO: Initialize LibTorrentSession when bridge is ready
        // self.session = LibTorrentSession()
        // self.session.start()

        print("⚠️ TorrentEngine initialized (stub - compile LibTorrent bridge to enable)")

        // Start monitoring
        startMonitoring()
    }

    deinit {
        stop()
    }

    // MARK: - Session Control

    func start() {
        // TODO: session.start()
        isActive = true
        print("🚀 Torrent engine started")
    }

    func stop() {
        // TODO: session.stop()
        isActive = false
        print("🛑 Torrent engine stopped")
    }

    func pause() {
        // TODO: session.pause()
        isActive = false
    }

    func resume() {
        // TODO: session.resume()
        isActive = true
    }

    // MARK: - Torrent Operations

    /// Create a torrent from a file/directory and return magnet link
    func createTorrent(from fileURL: URL) throws -> String {
        // TODO: Implement with LibTorrent bridge
        // let trackers = [
        //     "udp://tracker.opentrackr.org:1337/announce",
        //     "udp://tracker.openbittorrent.com:6969/announce",
        //     "udp://open.demonii.com:1337/announce"
        // ]
        //
        // var error: NSError?
        // guard let magnetLink = session.createTorrent(fromFile: fileURL.path,
        //                                              trackers: trackers,
        //                                              error: &error) else {
        //     throw error ?? TorrentError.creationFailed
        // }
        //
        // return magnetLink

        // Stub implementation for testing
        let hash = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(40)
        return "magnet:?xt=urn:btih:\(hash)&dn=\(fileURL.lastPathComponent)"
    }

    /// Download content via magnet link
    func download(magnetLink: String) throws {
        let savePath = getCacheDirectory()

        // TODO: Implement with LibTorrent bridge
        // var error: NSError?
        // let success = session.addMagnetLink(magnetLink,
        //                                     savePath: savePath.path,
        //                                     error: &error)
        // if !success {
        //     throw error ?? TorrentError.downloadFailed
        // }

        print("📥 Downloading: \(magnetLink)")
        print("   Save path: \(savePath.path)")
    }

    /// Remove a torrent by info hash
    func remove(infoHash: String, deleteFiles: Bool = true) throws {
        // TODO: Implement with LibTorrent bridge
        // var error: NSError?
        // let success = session.removeTorrent(infoHash,
        //                                     deleteFiles: deleteFiles,
        //                                     error: &error)
        // if !success {
        //     throw error ?? TorrentError.removalFailed
        // }

        print("🗑️ Removing torrent: \(infoHash)")
    }

    // MARK: - Status

    func status(for infoHash: String) -> TorrentInfo? {
        // TODO: Implement with LibTorrent bridge
        // guard let statusDict = session.status(forTorrent: infoHash) else {
        //     return nil
        // }
        // return parseTorrentInfo(from: statusDict)

        return nil
    }

    func allTorrents() -> [TorrentInfo] {
        // TODO: Implement with LibTorrent bridge
        // let torrentsData = session.allTorrents()
        // return torrentsData.compactMap { parseTorrentInfo(from: $0) }

        return activeTorrents
    }

    // MARK: - Private Methods

    private func startMonitoring() {
        // Update stats every second
        Timer.publish(every: 1.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.updateStats()
            }
            .store(in: &cancellables)
    }

    private func updateStats() {
        // TODO: Get real stats from LibTorrent
        // downloadRate = session.totalDownloadRate()
        // uploadRate = session.totalUploadRate()
        // let torrentsData = session.allTorrents()
        // activeTorrents = torrentsData.compactMap { parseTorrentInfo(from: $0) }
    }

    private func parseTorrentInfo(from dict: [String: Any]) -> TorrentInfo? {
        guard let infoHash = dict["infoHash"] as? String,
              let name = dict["name"] as? String,
              let progress = dict["progress"] as? Double,
              let downloadRate = dict["downloadRate"] as? Int64,
              let uploadRate = dict["uploadRate"] as? Int64,
              let numPeers = dict["numPeers"] as? Int,
              let stateRaw = dict["state"] as? Int,
              let state = TorrentInfo.TorrentState(rawValue: stateRaw) else {
            return nil
        }

        return TorrentInfo(
            id: infoHash,
            name: name,
            progress: progress,
            downloadRate: downloadRate,
            uploadRate: uploadRate,
            numPeers: numPeers,
            state: state
        )
    }

    func getCacheDirectory() -> URL {
        let cacheDir = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let torrentDir = cacheDir.appendingPathComponent("Torrents", isDirectory: true)

        // Create directory if it doesn't exist
        if !fileManager.fileExists(atPath: torrentDir.path) {
            try? fileManager.createDirectory(at: torrentDir,
                                            withIntermediateDirectories: true)
        }

        return torrentDir
    }
}

// MARK: - Errors

enum TorrentError: LocalizedError {
    case creationFailed
    case downloadFailed
    case removalFailed
    case notFound
    case invalidMagnetLink

    var errorDescription: String? {
        switch self {
        case .creationFailed:
            return "Failed to create torrent"
        case .downloadFailed:
            return "Failed to download torrent"
        case .removalFailed:
            return "Failed to remove torrent"
        case .notFound:
            return "Torrent not found"
        case .invalidMagnetLink:
            return "Invalid magnet link format"
        }
    }
}
