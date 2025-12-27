//
//  P2PResourceLoader.swift
//  TorTok - P2P Video Resource Loader
//
//  Custom AVAssetResourceLoader that downloads HLS segments via BitTorrent
//

import Foundation
import AVFoundation
import Combine

/// Custom resource loader that fetches HLS segments via P2P
class P2PResourceLoader: NSObject, AVAssetResourceLoaderDelegate {
    // MARK: - Published Properties (for statistics)

    @Published var downloadSpeed: Int64 = 0
    @Published var uploadSpeed: Int64 = 0
    @Published var peerCount: Int = 0
    @Published var p2pRatio: Double = 0

    // MARK: - Private Properties

    private let videoId: UUID
    private let magnetLink: String
    private let httpFallbackURL: URL?

    private var torrentEngine: TorrentEngine?
    private var cache: VideoSegmentCache
    private var pendingRequests: [AVAssetResourceLoadingRequest] = []

    // Statistics
    private var bytesFromP2P: Int64 = 0
    private var bytesFromHTTP: Int64 = 0

    // MARK: - Initialization

    init(videoId: UUID, magnetLink: String, httpFallbackURL: URL?) {
        self.videoId = videoId
        self.magnetLink = magnetLink
        self.httpFallbackURL = httpFallbackURL
        self.cache = VideoSegmentCache()

        super.init()
    }

    // MARK: - AVAssetResourceLoaderDelegate

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        guard let url = loadingRequest.request.url else {
            return false
        }

        // Handle P2P URL scheme
        if url.scheme == "p2p" {
            handleP2PRequest(loadingRequest)
            return true
        }

        return false
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        didCancel loadingRequest: AVAssetResourceLoadingRequest
    ) {
        pendingRequests.removeAll { $0 == loadingRequest }
    }

    // MARK: - P2P Request Handling

    private func handleP2PRequest(_ loadingRequest: AVAssetResourceLoadingRequest) {
        Task { [weak self] in
            guard let self = self else { return }

            do {
                let data = try await self.fetchSegment(from: loadingRequest)
                await self.fulfillRequest(loadingRequest, with: data)
            } catch {
                print("❌ P2P fetch failed: \(error). Falling back to HTTP...")
                await self.fallbackToHTTP(loadingRequest)
            }
        }
    }

    // MARK: - Segment Fetching

    private func fetchSegment(from request: AVAssetResourceLoadingRequest) async throws -> Data {
        guard let url = request.request.url else {
            throw P2PError.invalidURL
        }

        let path = url.path

        // Check cache first
        if let cached = cache.get(path) {
            print("✅ Cache hit: \(path)")
            return cached
        }

        // Try P2P download
        if let data = try? await fetchViaP2P(path) {
            print("✅ P2P download: \(path)")
            bytesFromP2P += Int64(data.count)
            cache.store(path, data: data)
            updateStatistics()
            return data
        }

        // Fallback to HTTP
        if let httpURL = constructHTTPURL(for: path) {
            print("⚠️ HTTP fallback: \(path)")
            let data = try await fetchViaHTTP(httpURL)
            bytesFromHTTP += Int64(data.count)
            cache.store(path, data: data)
            updateStatistics()
            return data
        }

        throw P2PError.fetchFailed
    }

    private func fetchViaP2P(_ path: String) async throws -> Data {
        // TODO: Implement actual P2P fetch via LibTorrent
        // For now, this is stubbed

        guard let torrentEngine = torrentEngine else {
            throw P2PError.torrentEngineNotAvailable
        }

        // In real implementation:
        // 1. Map HLS segment path to torrent file index
        // 2. Set piece priorities (prioritize first 5 seconds)
        // 3. Wait for pieces to download
        // 4. Return data

        // Stubbed implementation
        throw P2PError.notImplemented
    }

    private func fetchViaHTTP(_ url: URL) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw P2PError.httpFailed
        }

        return data
    }

    // MARK: - Request Fulfillment

    private func fulfillRequest(_ request: AVAssetResourceLoadingRequest, with data: Data) async {
        // Fill content information
        if let infoRequest = request.contentInformationRequest {
            infoRequest.contentType = contentType(for: request.request.url?.pathExtension ?? "")
            infoRequest.contentLength = Int64(data.count)
            infoRequest.isByteRangeAccessSupported = true
        }

        // Fill data request
        if let dataRequest = request.dataRequest {
            let requestedData: Data
            if dataRequest.requestsAllDataToEndOfResource {
                requestedData = data
            } else {
                let offset = Int(dataRequest.requestedOffset)
                let length = dataRequest.requestedLength
                let range = offset..<min(offset + length, data.count)
                requestedData = data.subdata(in: range)
            }

            dataRequest.respond(with: requestedData)
        }

        request.finishLoading()
    }

    private func fallbackToHTTP(_ request: AVAssetResourceLoadingRequest) async {
        guard let url = request.request.url,
              let httpURL = constructHTTPURL(for: url.path) else {
            request.finishLoading(with: P2PError.noFallbackAvailable)
            return
        }

        do {
            let data = try await fetchViaHTTP(httpURL)
            bytesFromHTTP += Int64(data.count)
            updateStatistics()
            await fulfillRequest(request, with: data)
        } catch {
            request.finishLoading(with: error)
        }
    }

    // MARK: - Helper Methods

    private func constructHTTPURL(for path: String) -> URL? {
        guard let baseURL = httpFallbackURL else { return nil }
        return baseURL.deletingLastPathComponent().appendingPathComponent(path)
    }

    private func contentType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "m3u8":
            return "application/vnd.apple.mpegurl"
        case "ts":
            return "video/mp2t"
        case "m4s":
            return "video/iso.segment"
        default:
            return "application/octet-stream"
        }
    }

    private func updateStatistics() {
        let totalBytes = bytesFromP2P + bytesFromHTTP
        if totalBytes > 0 {
            p2pRatio = Double(bytesFromP2P) / Double(totalBytes)
        }
    }

    // MARK: - Torrent Engine Integration

    func startTorrent() async throws {
        // TODO: Initialize torrent download
        // torrentEngine = TorrentEngine.shared
        // try torrentEngine.download(magnetLink: magnetLink)

        print("📦 Starting P2P download for video \(videoId)")
    }

    func stopTorrent() {
        // TODO: Stop torrent
        // torrentEngine.remove(infoHash: ...)
        print("🛑 Stopping P2P download for video \(videoId)")
    }
}

// MARK: - Video Segment Cache

class VideoSegmentCache {
    private var cache: [String: Data] = [:]
    private let maxCacheSize: Int = 50 * 1024 * 1024 // 50 MB
    private var currentSize: Int = 0

    func get(_ key: String) -> Data? {
        return cache[key]
    }

    func store(_ key: String, data: Data) {
        // Simple eviction: clear cache if too large
        if currentSize + data.count > maxCacheSize {
            clear()
        }

        cache[key] = data
        currentSize += data.count
    }

    func clear() {
        cache.removeAll()
        currentSize = 0
    }
}

// MARK: - Errors

enum P2PError: LocalizedError {
    case invalidURL
    case fetchFailed
    case torrentEngineNotAvailable
    case httpFailed
    case noFallbackAvailable
    case notImplemented

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid P2P URL"
        case .fetchFailed:
            return "Failed to fetch video segment"
        case .torrentEngineNotAvailable:
            return "Torrent engine not initialized"
        case .httpFailed:
            return "HTTP fallback failed"
        case .noFallbackAvailable:
            return "No HTTP fallback URL available"
        case .notImplemented:
            return "P2P fetching not yet implemented"
        }
    }
}
