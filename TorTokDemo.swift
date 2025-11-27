//
//  TorTokDemo.swift
//  Standalone demo that runs without any dependencies
//
//  To run:
//  1. Open Xcode
//  2. File > New > Project > iOS > App
//  3. Name: TorTokDemo, Interface: SwiftUI
//  4. Replace ContentView.swift with this file
//  5. Press ⌘R to run
//

import SwiftUI

@main
struct TorTokDemoApp: App {
    var body: some Scene {
        WindowGroup {
            DemoRootView()
        }
    }
}

struct DemoRootView: View {
    @State private var isLoggedIn = false

    var body: some View {
        Group {
            if isLoggedIn {
                DemoMainView(isLoggedIn: $isLoggedIn)
            } else {
                DemoLoginView(isLoggedIn: $isLoggedIn)
            }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Login View

struct DemoLoginView: View {
    @Binding var isLoggedIn: Bool
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [.black, .purple.opacity(0.3), .black],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 30) {
                Spacer()

                // Logo
                VStack(spacing: 8) {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 80))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.purple, .pink],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )

                    Text("TorTok")
                        .font(.largeTitle.bold())
                        .foregroundColor(.white)

                    Text("TikTok meets BitTorrent")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }

                Spacer()

                // Login form
                VStack(spacing: 16) {
                    TextField("Email", text: $email)
                        .textFieldStyle(DemoRoundedTextFieldStyle())
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)

                    SecureField("Password", text: $password)
                        .textFieldStyle(DemoRoundedTextFieldStyle())

                    Button {
                        // Demo: Just log in without validation
                        withAnimation {
                            isLoggedIn = true
                        }
                    } label: {
                        Text("Sign In (Demo)")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(
                                LinearGradient(
                                    colors: [.purple, .pink],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .foregroundColor(.white)
                            .cornerRadius(12)
                    }
                }
                .padding(.horizontal, 32)

                Text("Demo Mode - No backend required")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.5))

                Spacer()
            }
        }
    }
}

struct DemoRoundedTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding()
            .background(Color.white.opacity(0.1))
            .cornerRadius(12)
            .foregroundColor(.white)
    }
}

// MARK: - Main View (After Login)

struct DemoMainView: View {
    @Binding var isLoggedIn: Bool
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // Home Feed
            DemoFeedView()
                .tabItem {
                    Image(systemName: "house.fill")
                    Text("Home")
                }
                .tag(0)

            // Record (placeholder)
            Color.clear
                .tabItem {
                    Image(systemName: "plus.circle.fill")
                    Text("Record")
                }
                .tag(1)

            // Profile
            DemoProfileView(isLoggedIn: $isLoggedIn)
                .tabItem {
                    Image(systemName: "person.fill")
                    Text("Profile")
                }
                .tag(2)
        }
        .accentColor(.white)
    }
}

// MARK: - Feed View

struct DemoFeedView: View {
    let demoVideos = [
        DemoVideo(username: "alice", caption: "Check out this amazing sunset! 🌅", likes: 1234),
        DemoVideo(username: "bob", caption: "Cooking tutorial 🍳", likes: 567),
        DemoVideo(username: "carol", caption: "Dancing in the rain 💃", likes: 891)
    ]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(demoVideos) { video in
                        DemoVideoCard(video: video)
                            .frame(height: UIScreen.main.bounds.height - 100)
                    }
                }
            }
            .ignoresSafeArea()

            // Top bar
            VStack {
                HStack {
                    Text("TorTok")
                        .font(.title2.bold())
                        .foregroundColor(.white)

                    Spacer()

                    Image(systemName: "camera.fill")
                        .font(.title2)
                        .foregroundColor(.white)
                }
                .padding()

                Spacer()
            }
        }
    }
}

struct DemoVideo: Identifiable {
    let id = UUID()
    let username: String
    let caption: String
    let likes: Int
}

struct DemoVideoCard: View {
    let video: DemoVideo
    @State private var isLiked = false

    var body: some View {
        ZStack {
            // Video placeholder (gradient)
            LinearGradient(
                colors: [
                    Color(hue: Double.random(in: 0...1), saturation: 0.7, brightness: 0.5),
                    Color(hue: Double.random(in: 0...1), saturation: 0.7, brightness: 0.3)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            // Play icon
            Image(systemName: "play.fill")
                .font(.system(size: 60))
                .foregroundColor(.white.opacity(0.3))

            // Overlay UI
            VStack {
                Spacer()

                HStack(alignment: .bottom) {
                    // Caption & user
                    VStack(alignment: .leading, spacing: 8) {
                        Text("@\(video.username)")
                            .font(.headline)
                            .foregroundColor(.white)

                        Text(video.caption)
                            .font(.body)
                            .foregroundColor(.white)
                    }
                    .padding(.leading)

                    Spacer()

                    // Actions
                    VStack(spacing: 24) {
                        // Like button
                        Button {
                            isLiked.toggle()
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: isLiked ? "heart.fill" : "heart")
                                    .font(.title)
                                    .foregroundColor(isLiked ? .red : .white)

                                Text("\(video.likes + (isLiked ? 1 : 0))")
                                    .font(.caption)
                                    .foregroundColor(.white)
                            }
                        }

                        // Share button
                        Button {} label: {
                            Image(systemName: "square.and.arrow.up")
                                .font(.title2)
                                .foregroundColor(.white)
                        }
                    }
                    .padding(.trailing)
                }
                .padding(.bottom, 100)
            }
        }
    }
}

// MARK: - Profile View

struct DemoProfileView: View {
    @Binding var isLoggedIn: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                VStack(spacing: 20) {
                    // Avatar
                    Circle()
                        .fill(Color.purple.opacity(0.3))
                        .frame(width: 100, height: 100)
                        .overlay {
                            Image(systemName: "person.fill")
                                .font(.system(size: 40))
                                .foregroundColor(.white)
                        }

                    // User info
                    VStack(spacing: 4) {
                        Text("@demo_user")
                            .font(.title2.bold())
                            .foregroundColor(.white)

                        Text("Demo User")
                            .font(.body)
                            .foregroundColor(.white.opacity(0.7))
                    }

                    // Stats
                    HStack(spacing: 40) {
                        DemoStatView(count: 1234, label: "Followers")
                        DemoStatView(count: 567, label: "Following")
                        DemoStatView(count: 89, label: "Videos")
                    }

                    Text("This is a demo mode. Full app coming soon!")
                        .font(.body)
                        .foregroundColor(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding()

                    Button("Log Out") {
                        withAnimation {
                            isLoggedIn = false
                        }
                    }
                    .foregroundColor(.red)

                    Spacer()
                }
                .padding(.top, 40)
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct DemoStatView: View {
    let count: Int
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Text("\(count)")
                .font(.title3.bold())
                .foregroundColor(.white)

            Text(label)
                .font(.caption)
                .foregroundColor(.white.opacity(0.7))
        }
    }
}

// MARK: - Preview

#Preview {
    DemoRootView()
}
