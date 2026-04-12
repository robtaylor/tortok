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
    let followerCount: Int?
    let followingCount: Int?
    let videoCount: Int?
    let createdAt: Date?

    // No CodingKeys needed - backend sends camelCase which matches property names
}

// MARK: - Auth Response

struct AuthResponse: Codable {
    let token: String
    let user: User

    // No CodingKeys needed - backend sends camelCase which matches property names
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

    // No CodingKeys needed - backend expects camelCase which matches property names
}
