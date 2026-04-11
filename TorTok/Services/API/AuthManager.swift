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

        saveToken(response.token)

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

        saveToken(response.token)

        // Update state
        authToken = response.token
        currentUser = response.user
        isAuthenticated = true
    }

    func logout() {
        UserDefaults.standard.removeObject(forKey: tokenKey)

        authToken = nil
        currentUser = nil
        isAuthenticated = false
    }

    // MARK: - Token Management
    //
    // The backend currently issues a single JWT with no refresh flow.
    // When the token expires, the client must re-authenticate. A proper
    // refresh-token mechanism is tracked as future work — see ADR-005.

    private func saveToken(_ access: String) {
        UserDefaults.standard.set(access, forKey: tokenKey)
    }
}

// MARK: - Errors

enum AuthError: LocalizedError {
    case invalidCredentials
    case networkError

    var errorDescription: String? {
        switch self {
        case .invalidCredentials:
            return "Invalid email or password"
        case .networkError:
            return "Network error occurred"
        }
    }
}
