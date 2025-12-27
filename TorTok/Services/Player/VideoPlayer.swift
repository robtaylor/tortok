//
//  VideoPlayer.swift
//  TorTok - Video Playback Service
//
//  Handles video playback with HLS streaming and P2P support
//

import Foundation
import AVFoundation
import Combine
import SwiftUI

/// Video player that supports both HTTP and P2P streaming
@MainActor
class VideoPlayer: ObservableObject {
    // MARK: - Published Properties

    @Published var isPlaying = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var isBuffering = false
    @Published var error: Error?

    // P2P Statistics
    @Published var downloadSpeed: Int64 = 0  // Bytes/sec
    @Published var uploadSpeed: Int64 = 0    // Bytes/sec
    @Published var peerCount: Int = 0
    @Published var p2pRatio: Double = 0      // 0-1, how much came from P2P vs HTTP

    // MARK: - Private Properties

    private var player: AVPlayer?
    private var playerItem: AVPlayerItem?
    private var timeObserver: Any?
    private var cancellables = Set<AnyCancellable>()

    private var p2pResourceLoader: P2PResourceLoader?
    private var currentVideoId: UUID?

    // MARK: - Initialization

    init() {
        setupNotifications()
    }

    nonisolated deinit {
        // Cleanup is handled by SwiftUI lifecycle
        // No need to explicitly call cleanup here
    }

    // MARK: - Public API

    /// Load and play a video
    func loadVideo(_ video: Video, p2pEnabled: Bool = true) async throws {
        cleanup()
        currentVideoId = video.id

        if p2pEnabled && !video.magnetLink.isEmpty {
            try await loadP2PVideo(video)
        } else if let hlsURL = video.hlsURL {
            try await loadHTTPVideo(hlsURL)
        } else {
            throw VideoPlayerError.noValidSource
        }
    }

    /// Play the video
    func play() {
        player?.play()
        isPlaying = true
    }

    /// Pause the video
    func pause() {
        player?.pause()
        isPlaying = false
    }

    /// Seek to a specific time
    func seek(to time: TimeInterval) {
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: cmTime)
    }

    /// Get the AVPlayer instance for SwiftUI VideoPlayer
    func getAVPlayer() -> AVPlayer? {
        return player
    }

    // MARK: - Private Methods - HTTP Playback

    private func loadHTTPVideo(_ url: URL) async throws {
        let asset = AVURLAsset(url: url)

        // Check if asset is playable
        let isPlayable = try await asset.load(.isPlayable)
        guard isPlayable else {
            throw VideoPlayerError.assetNotPlayable
        }

        // Create player item and player
        let playerItem = AVPlayerItem(asset: asset)
        self.playerItem = playerItem

        let player = AVPlayer(playerItem: playerItem)
        self.player = player

        // Get duration
        let duration = try await asset.load(.duration)
        self.duration = duration.seconds

        // Setup observers
        setupPlayerObservers()

        // Auto-play
        play()
    }

    // MARK: - Private Methods - P2P Playback

    private func loadP2PVideo(_ video: Video) async throws {
        // Set up P2P resource loader
        let resourceLoader = P2PResourceLoader(
            videoId: video.id,
            magnetLink: video.magnetLink,
            httpFallbackURL: video.hlsURL
        )
        self.p2pResourceLoader = resourceLoader

        // Start the torrent download first
        do {
            try await resourceLoader.startTorrent()
        } catch {
            print("⚠️ Failed to start P2P: \(error). Falling back to HTTP...")
            // Fall back to HTTP if P2P fails to initialize
            if let hlsURL = video.hlsURL {
                try await loadHTTPVideo(hlsURL)
                return
            }
            throw VideoPlayerError.p2pInitFailed
        }

        // Create custom URL scheme for P2P: p2p://video-id/playlist.m3u8
        let p2pURL = URL(string: "p2p://\(video.id.uuidString)/playlist.m3u8")!

        // Create asset with custom resource loader
        let asset = AVURLAsset(url: p2pURL)

        // Register resource loader delegate
        asset.resourceLoader.setDelegate(
            resourceLoader,
            queue: DispatchQueue(label: "com.tortok.resourceloader")
        )

        // Subscribe to P2P statistics
        resourceLoader.$downloadSpeed
            .assign(to: &$downloadSpeed)
        resourceLoader.$uploadSpeed
            .assign(to: &$uploadSpeed)
        resourceLoader.$peerCount
            .assign(to: &$peerCount)
        resourceLoader.$p2pRatio
            .assign(to: &$p2pRatio)

        // Create player item and player
        let playerItem = AVPlayerItem(asset: asset)
        self.playerItem = playerItem

        let player = AVPlayer(playerItem: playerItem)
        self.player = player

        // Setup observers
        setupPlayerObservers()

        // Auto-play
        play()
    }

    // MARK: - Observers & Notifications

    private func setupPlayerObservers() {
        guard let player = player else { return }

        // Time observer (updates current time)
        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            self?.currentTime = time.seconds
        }

        // Player item status observer
        playerItem?.publisher(for: \.status)
            .sink { [weak self] status in
                switch status {
                case .failed:
                    self?.error = self?.playerItem?.error
                    self?.isPlaying = false
                case .readyToPlay:
                    self?.error = nil
                case .unknown:
                    break
                @unknown default:
                    break
                }
            }
            .store(in: &cancellables)

        // Buffering observer
        playerItem?.publisher(for: \.isPlaybackBufferEmpty)
            .assign(to: &$isBuffering)
    }

    private func setupNotifications() {
        NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)
            .sink { [weak self] _ in
                self?.isPlaying = false
            }
            .store(in: &cancellables)
    }

    // MARK: - Cleanup

    private func cleanup() {
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }

        player?.pause()
        player = nil
        playerItem = nil

        // Stop the torrent
        p2pResourceLoader?.stopTorrent()
        p2pResourceLoader = nil

        cancellables.removeAll()

        isPlaying = false
        currentTime = 0
        duration = 0
        downloadSpeed = 0
        uploadSpeed = 0
        peerCount = 0
        p2pRatio = 0
    }
}

// MARK: - Errors

enum VideoPlayerError: LocalizedError {
    case noValidSource
    case assetNotPlayable
    case p2pInitFailed

    var errorDescription: String? {
        switch self {
        case .noValidSource:
            return "No valid video source available"
        case .assetNotPlayable:
            return "Video asset is not playable"
        case .p2pInitFailed:
            return "Failed to initialize P2P streaming"
        }
    }
}
