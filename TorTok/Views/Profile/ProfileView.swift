//
//  ProfileView.swift
//  TorTok
//

import SwiftUI

struct ProfileView: View {
    @EnvironmentObject var authManager: AuthManager

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                if let user = authManager.currentUser {
                    ScrollView {
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
                                Text("@\(user.username)")
                                    .font(.title2.bold())
                                    .foregroundColor(.white)

                                Text(user.displayName)
                                    .font(.body)
                                    .foregroundColor(.white.opacity(0.7))
                            }

                            // Stats
                            HStack(spacing: 40) {
                                StatView(count: user.followerCount, label: "Followers")
                                StatView(count: user.followingCount, label: "Following")
                                StatView(count: user.videoCount, label: "Videos")
                            }

                            if let bio = user.bio {
                                Text(bio)
                                    .font(.body)
                                    .foregroundColor(.white)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal)
                            }

                            // TODO: Video grid

                            Spacer()
                        }
                        .padding(.top, 20)
                    }
                } else {
                    ProgressView()
                        .tint(.white)
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        authManager.logout()
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .foregroundColor(.white)
                    }
                }
            }
        }
    }
}

struct StatView: View {
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

#Preview {
    ProfileView()
        .environmentObject(AuthManager())
}
