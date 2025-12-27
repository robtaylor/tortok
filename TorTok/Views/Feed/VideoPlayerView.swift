//
//  VideoPlayerView.swift
//  TorTok - Video Player UI Component
//
//  SwiftUI wrapper around AVPlayer with P2P support
//

import SwiftUI
import AVKit

struct VideoPlayerView: View {
    let video: Video
    @StateObject private var player = VideoPlayer()
    @State private var showControls = true
    @State private var showStats = false

    var body: some View {
        ZStack {
            // Video player
            if let avPlayer = player.getAVPlayer() {
                AVKit.VideoPlayer(player: avPlayer)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation {
                            showControls.toggle()
                        }
                    }
            } else {
                // Loading state
                ZStack {
                    Color.black
                    ProgressView()
                        .tint(.white)
                }
            }

            // P2P Statistics overlay (top-right)
            if showStats {
                VStack {
                    HStack {
                        Spacer()
                        P2PStatsView(
                            downloadSpeed: player.downloadSpeed,
                            uploadSpeed: player.uploadSpeed,
                            peerCount: player.peerCount,
                            p2pRatio: player.p2pRatio
                        )
                        .padding()
                    }
                    Spacer()
                }
            }

            // Buffering indicator
            if player.isBuffering {
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.5)
            }

            // Controls overlay (optional, can be hidden)
            if showControls {
                VideoControlsOverlay(
                    isPlaying: player.isPlaying,
                    currentTime: player.currentTime,
                    duration: player.duration,
                    onPlayPause: {
                        if player.isPlaying {
                            player.pause()
                        } else {
                            player.play()
                        }
                    },
                    onSeek: { time in
                        player.seek(to: time)
                    },
                    onToggleStats: {
                        showStats.toggle()
                    }
                )
                .transition(.opacity)
            }

            // Error overlay
            if let error = player.error {
                ErrorOverlay(error: error) {
                    Task {
                        try? await player.loadVideo(video)
                    }
                }
            }
        }
        .task {
            // Load video when view appears
            try? await player.loadVideo(video, p2pEnabled: true)
        }
        .onDisappear {
            player.pause()
        }
    }
}

// MARK: - P2P Statistics View

struct P2PStatsView: View {
    let downloadSpeed: Int64
    let uploadSpeed: Int64
    let peerCount: Int
    let p2pRatio: Double

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Label {
                Text("\(formatSpeed(downloadSpeed))")
            } icon: {
                Image(systemName: "arrow.down.circle.fill")
            }

            Label {
                Text("\(formatSpeed(uploadSpeed))")
            } icon: {
                Image(systemName: "arrow.up.circle.fill")
            }

            Label {
                Text("\(peerCount) peers")
            } icon: {
                Image(systemName: "person.3.fill")
            }

            Label {
                Text("P2P: \(Int(p2pRatio * 100))%")
            } icon: {
                Image(systemName: "chart.pie.fill")
            }
        }
        .font(.caption)
        .foregroundColor(.white)
        .padding(8)
        .background(Color.black.opacity(0.7))
        .cornerRadius(8)
    }

    private func formatSpeed(_ bytesPerSec: Int64) -> String {
        if bytesPerSec < 1024 {
            return "\(bytesPerSec) B/s"
        } else if bytesPerSec < 1024 * 1024 {
            return String(format: "%.1f KB/s", Double(bytesPerSec) / 1024)
        } else {
            return String(format: "%.2f MB/s", Double(bytesPerSec) / (1024 * 1024))
        }
    }
}

// MARK: - Video Controls Overlay

struct VideoControlsOverlay: View {
    let isPlaying: Bool
    let currentTime: TimeInterval
    let duration: TimeInterval
    let onPlayPause: () -> Void
    let onSeek: (TimeInterval) -> Void
    let onToggleStats: () -> Void

    var body: some View {
        VStack {
            // Top bar with stats toggle
            HStack {
                Spacer()
                Button(action: onToggleStats) {
                    Image(systemName: "chart.bar.fill")
                        .font(.title3)
                        .foregroundColor(.white)
                        .padding()
                }
            }

            Spacer()

            // Center play/pause button
            Button(action: onPlayPause) {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 60))
                    .foregroundColor(.white)
            }

            Spacer()

            // Bottom progress bar
            VStack(spacing: 4) {
                Slider(
                    value: Binding(
                        get: { currentTime },
                        set: { onSeek($0) }
                    ),
                    in: 0...max(duration, 1)
                )
                .tint(.white)

                HStack {
                    Text(formatTime(currentTime))
                    Spacer()
                    Text(formatTime(duration))
                }
                .font(.caption)
                .foregroundColor(.white)
            }
            .padding(.horizontal)
            .padding(.bottom, 20)
        }
        .background(
            LinearGradient(
                colors: [.black.opacity(0.5), .clear, .black.opacity(0.5)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Error Overlay

struct ErrorOverlay: View {
    let error: Error
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 50))
                .foregroundColor(.red)

            Text("Playback Error")
                .font(.title2.bold())
                .foregroundColor(.white)

            Text(error.localizedDescription)
                .font(.body)
                .foregroundColor(.white.opacity(0.8))
                .multilineTextAlignment(.center)

            Button(action: onRetry) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .foregroundColor(.white)
                    .padding()
                    .background(Color.purple)
                    .cornerRadius(12)
            }
        }
        .padding()
        .background(Color.black.opacity(0.8))
        .cornerRadius(16)
    }
}

// MARK: - Preview

#Preview {
    VideoPlayerView(video: Video(
        id: UUID(),
        user: User(
            id: UUID(),
            username: "demo_user",
            displayName: "Demo User",
            email: nil,
            avatarURL: nil,
            bio: nil,
            followerCount: 0,
            followingCount: 0,
            videoCount: 0,
            createdAt: Date()
        ),
        caption: "Test video",
        magnetLink: "",
        hlsURL: URL(string: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"),
        thumbnailURL: URL(string: "https://example.com/thumb.jpg")!,
        durationSeconds: 30,
        width: 1080,
        height: 1920,
        hashtags: [],
        likeCount: 0,
        isLiked: false,
        createdAt: Date()
    ))
}
