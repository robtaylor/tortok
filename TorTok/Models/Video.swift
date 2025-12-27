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

    enum CodingKeys: String, CodingKey {
        case id
        case user
        case caption
        case magnetLink = "magnet_link"
        case hlsURL = "hls_url"
        case thumbnailURL = "thumbnail_url"
        case durationSeconds = "duration_seconds"
        case width
        case height
        case hashtags
        case likeCount = "like_count"
        case isLiked = "is_liked"
        case createdAt = "created_at"
    }

    static func == (lhs: Video, rhs: Video) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Feed Response

struct FeedResponse: Codable {
    let videos: [Video]
    let nextCursor: String?
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case videos
        case nextCursor = "next_cursor"
        case hasMore = "has_more"
    }
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
