//
//  AuthManager.swift
//  TorTok
//

import Foundation
import Combine

@MainActor
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var authToken: String?

    private let apiClient: APIClient
    private let tokenKey = "tortok.auth.token"
    private let refreshTokenKey = "tortok.auth.refresh_token"

    init(apiClient: APIClient = .shared) {
        self.apiClient = apiClient

        // Load saved token
        if let savedToken = UserDefaults.standard.string(forKey: tokenKey) {
            self.authToken = savedToken
            self.isAuthenticated = true
            // TODO: Validate token and load user
        }
    }

    // MARK: - Authentication

    func login(email: String, password: String) async throws {
        let request = LoginRequest(email: email, password: password)
        let response: AuthResponse = try await apiClient.post("/auth/login", body: request)

        // Save tokens
        saveTokens(access: response.token, refresh: response.refreshToken)

        // Update state
        authToken = response.token
        currentUser = response.user
        isAuthenticated = true
    }

    func register(email: String, password: String, username: String, displayName: String) async throws {
        let request = RegisterRequest(
            email: email,
            password: password,
            username: username,
            displayName: displayName
        )
        let response: AuthResponse = try await apiClient.post("/auth/register", body: request)

        // Save tokens
        saveTokens(access: response.token, refresh: response.refreshToken)

        // Update state
        authToken = response.token
        currentUser = response.user
        isAuthenticated = true
    }

    func logout() {
        // Clear tokens
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: refreshTokenKey)

        // Clear state
        authToken = nil
        currentUser = nil
        isAuthenticated = false
    }

    // MARK: - Token Management

    private func saveTokens(access: String, refresh: String) {
        UserDefaults.standard.set(access, forKey: tokenKey)
        UserDefaults.standard.set(refresh, forKey: refreshTokenKey)
    }

    func refreshAccessToken() async throws {
        guard let refreshToken = UserDefaults.standard.string(forKey: refreshTokenKey) else {
            throw AuthError.noRefreshToken
        }

        struct RefreshRequest: Codable {
            let refreshToken: String
        }

        struct RefreshResponse: Codable {
            let token: String
        }

        let request = RefreshRequest(refreshToken: refreshToken)
        let response: RefreshResponse = try await apiClient.post("/auth/refresh", body: request)

        authToken = response.token
        UserDefaults.standard.set(response.token, forKey: tokenKey)
    }
}

// MARK: - Errors

enum AuthError: LocalizedError {
    case noRefreshToken
    case invalidCredentials
    case networkError

    var errorDescription: String? {
        switch self {
        case .noRefreshToken:
            return "No refresh token available"
        case .invalidCredentials:
            return "Invalid email or password"
        case .networkError:
            return "Network error occurred"
        }
    }
}
