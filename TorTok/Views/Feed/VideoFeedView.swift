//
//  VideoFeedView.swift
//  TorTok
//

import SwiftUI

struct VideoFeedView: View {
    @StateObject private var viewModel = FeedViewModel()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if viewModel.videos.isEmpty {
                // Empty state
                VStack(spacing: 20) {
                    Image(systemName: "film")
                        .font(.system(size: 60))
                        .foregroundColor(.white.opacity(0.5))

                    Text("No videos yet")
                        .font(.title2)
                        .foregroundColor(.white)

                    Text("Start by recording your first video!")
                        .font(.body)
                        .foregroundColor(.white.opacity(0.7))
                }
            } else {
                // Swipeable vertical video feed
                TabView(selection: $viewModel.currentIndex) {
                    ForEach(Array(viewModel.videos.enumerated()), id: \.element.id) { index, video in
                        VideoFeedItemView(
                            video: video,
                            onLike: { viewModel.toggleLike(video) },
                            onShare: { viewModel.share(video) }
                        )
                        .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .ignoresSafeArea()
                .onChange(of: viewModel.currentIndex) { newIndex in
                    viewModel.handleScroll(to: newIndex)
                }
            }
        }
        .task {
            await viewModel.loadInitialVideos()
        }
    }
}

// MARK: - Feed Item View

struct VideoFeedItemView: View {
    let video: Video
    let onLike: () -> Void
    let onShare: () -> Void

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            // Full-screen video player
            VideoPlayerView(video: video)

            // Overlay with video info and actions
            VStack(alignment: .trailing, spacing: 20) {
                Spacer()

                // Actions (right side)
                VStack(spacing: 24) {
                    // Like button
                    ActionButton(
                        icon: video.isLiked ? "heart.fill" : "heart",
                        label: formatCount(video.likeCount),
                        color: video.isLiked ? .red : .white,
                        action: onLike
                    )

                    // Share button
                    ActionButton(
                        icon: "square.and.arrow.up",
                        label: "Share",
                        color: .white,
                        action: onShare
                    )
                }
                .padding(.trailing, 12)

                // Video info (bottom left)
                VStack(alignment: .leading, spacing: 8) {
                    Text("@\(video.user.username)")
                        .font(.headline.bold())
                        .foregroundColor(.white)

                    Text(video.caption)
                        .font(.body)
                        .foregroundColor(.white)
                        .lineLimit(3)

                    if !video.hashtags.isEmpty {
                        Text(video.hashtags.map { "#\($0)" }.joined(separator: " "))
                            .font(.body)
                            .foregroundColor(.white.opacity(0.9))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 12)
                .padding(.bottom, 100)
            }
        }
    }

    private func formatCount(_ count: Int) -> String {
        if count < 1000 {
            return "\(count)"
        } else if count < 1_000_000 {
            return String(format: "%.1fK", Double(count) / 1000)
        } else {
            return String(format: "%.1fM", Double(count) / 1_000_000)
        }
    }
}

struct ActionButton: View {
    let icon: String
    let label: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 28))
                    .foregroundColor(color)

                Text(label)
                    .font(.caption)
                    .foregroundColor(.white)
            }
        }
    }
}

// MARK: - Feed ViewModel

@MainActor
class FeedViewModel: ObservableObject {
    @Published var videos: [Video] = []
    @Published var isLoading = false
    @Published var currentIndex: Int = 0

    private let apiClient = APIClient.shared

    func loadInitialVideos() async {
        guard !isLoading else { return }

        isLoading = true

        do {
            // For now, load demo videos if API fails
            let response: FeedResponse = try await apiClient.get("/videos/feed", parameters: ["limit": 20])
            videos = response.videos
        } catch {
            print("Error loading feed: \(error). Loading demo videos...")
            videos = createDemoVideos()
        }

        isLoading = false
    }

    func loadMore() async {
        // TODO: Implement pagination
    }

    func handleScroll(to index: Int) {
        currentIndex = index

        // Preload next video
        if index + 1 < videos.count {
            preloadVideo(at: index + 1)
        }

        // Load more videos when near the end
        if index >= videos.count - 2 {
            Task {
                await loadMore()
            }
        }
    }

    func preloadVideo(at index: Int) {
        // TODO: Start downloading next video's torrent
        guard index < videos.count else { return }
        let video = videos[index]
        print("📦 Preloading video: \(video.id)")
    }

    func toggleLike(_ video: Video) {
        guard let index = videos.firstIndex(where: { $0.id == video.id }) else { return }

        videos[index].isLiked.toggle()
        videos[index].likeCount += videos[index].isLiked ? 1 : -1

        Task {
            do {
                let _: EmptyResponse = try await apiClient.post(
                    "/videos/\(video.id)/like",
                    body: ["liked": videos[index].isLiked]
                )
            } catch {
                // Revert on error
                videos[index].isLiked.toggle()
                videos[index].likeCount += videos[index].isLiked ? 1 : -1
            }
        }
    }

    func share(_ video: Video) {
        // TODO: Implement sharing
        print("Share video: \(video.id)")
    }

    // Demo videos for testing
    private func createDemoVideos() -> [Video] {
        let demoUser = User(
            id: UUID(),
            username: "demo_user",
            displayName: "Demo User",
            email: nil,
            avatarURL: nil,
            bio: "Testing TorTok",
            followerCount: 1234,
            followingCount: 567,
            videoCount: 10,
            createdAt: Date()
        )

        return [
            Video(
                id: UUID(),
                user: demoUser,
                caption: "Testing P2P video streaming with HLS! 🚀",
                magnetLink: "",
                hlsURL: URL(string: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"), // Test HLS stream
                thumbnailURL: URL(string: "https://picsum.photos/1080/1920")!,
                durationSeconds: 30,
                width: 1080,
                height: 1920,
                hashtags: ["p2p", "decentralized", "tortok"],
                likeCount: 1234,
                isLiked: false,
                createdAt: Date()
            )
        ]
    }
}

struct EmptyResponse: Codable {}

#Preview {
    VideoFeedView()
}
