//
//  Video.swift
//  TorTok
//

import Foundation

struct Video: Identifiable, Codable, Equatable {
    let id: UUID
    let user: User
    let caption: String
    let magnetLink: String
    let hlsURL: URL?           // HTTP fallback URL for HLS master playlist
    let thumbnailURL: URL
    let durationSeconds: Int
    let width: Int
    let height: Int
    let hashtags: [String]
    var likeCount: Int
    var isLiked: Bool
    let createdAt: Date

    // No CodingKeys needed - backend sends camelCase which matches property names
    // Backend keys: magnetLink, hlsURL, thumbnailURL, durationSeconds, likeCount, isLiked, createdAt

    static func == (lhs: Video, rhs: Video) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Feed Response

struct FeedResponse: Codable {
    let videos: [Video]
    let nextCursor: String?
    let hasMore: Bool

    // No CodingKeys needed - backend sends camelCase which matches property names
}

// MARK: - Create Video Request

struct CreateVideoRequest: Codable {
    let caption: String
    let magnetLink: String
    let thumbnailData: Data
    let durationSeconds: Int
    let width: Int
    let height: Int
    let hashtags: [String]

    enum CodingKeys: String, CodingKey {
        case caption
        case magnetLink = "magnet_link"
        case thumbnailData = "thumbnail"
        case durationSeconds = "duration_seconds"
        case width
        case height
        case hashtags
    }
}
