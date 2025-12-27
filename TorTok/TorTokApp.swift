//
//  TorTokApp.swift
//  TorTok
//
//  Decentralized video reels platform with P2P streaming
//  "TikTok meets BitTorrent"
//

import SwiftUI

@main
struct TorTokApp: App {
    // Shared services
    @StateObject private var torrentEngine = TorrentEngine()
    @StateObject private var apiClient = APIClient()
    @StateObject private var authManager: AuthManager

    init() {
        // Check for UI test arguments
        if CommandLine.arguments.contains("-clearAuth") {
            UserDefaults.standard.removeObject(forKey: "tortok.auth.token")
            UserDefaults.standard.removeObject(forKey: "tortok.auth.refresh_token")
        }
        _authManager = StateObject(wrappedValue: AuthManager())
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(torrentEngine)
                .environmentObject(apiClient)
                .environmentObject(authManager)
                .preferredColorScheme(.dark) // TikTok-style dark theme
        }
    }
}

// MARK: - Main Content View

struct ContentView: View {
    @EnvironmentObject var authManager: AuthManager

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainTabView()
            } else {
                LoginView()
            }
        }
    }
}

// MARK: - Main Tab Navigation

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // Home Feed (swipeable videos)
            VideoFeedView()
                .tabItem {
                    Image(systemName: "house.fill")
                    Text("Home")
                }
                .tag(0)

            // Record Video
            Color.clear
                .tabItem {
                    Image(systemName: "plus.circle.fill")
                    Text("Record")
                }
                .tag(1)
                .onAppear {
                    // Show record modal when tapped
                    if selectedTab == 1 {
                        // TODO: Present recording view
                        selectedTab = 0 // Reset back to home
                    }
                }

            // Profile
            ProfileView()
                .tabItem {
                    Image(systemName: "person.fill")
                    Text("Profile")
                }
                .tag(2)
        }
        .accentColor(.white)
    }
}

// MARK: - Preview

#Preview {
    ContentView()
        .environmentObject(TorrentEngine())
        .environmentObject(APIClient())
        .environmentObject(AuthManager())
}
