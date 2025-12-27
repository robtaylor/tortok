//
//  User.swift
//  TorTok
//

import Foundation

struct User: Identifiable, Codable {
    let id: UUID
    let username: String
    let displayName: String
    let email: String?
    let avatarURL: URL?
    let bio: String?
    let followerCount: Int
    let followingCount: Int
    let videoCount: Int
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case displayName = "display_name"
        case email
        case avatarURL = "avatar_url"
        case bio
        case followerCount = "follower_count"
        case followingCount = "following_count"
        case videoCount = "video_count"
        case createdAt = "created_at"
    }
}

// MARK: - Auth Response

struct AuthResponse: Codable {
    let token: String
    let refreshToken: String
    let user: User

    enum CodingKeys: String, CodingKey {
        case token
        case refreshToken = "refresh_token"
        case user
    }
}

// MARK: - Login/Register Requests

struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct RegisterRequest: Codable {
    let email: String
    let password: String
    let username: String
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case email
        case password
        case username
        case displayName = "display_name"
    }
}
