//
//  APIClient.swift
//  TorTok
//

import Foundation
import Alamofire

class APIClient: ObservableObject {
    static let shared = APIClient()

    private let baseURL: String
    private let session: Session

    init(baseURL: String = "https://tortok-api.fly.dev") {
        self.baseURL = baseURL

        // Configure session
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 300

        self.session = Session(configuration: configuration)
    }

    // MARK: - Generic Request Methods

    func get<T: Decodable>(_ path: String, parameters: Parameters? = nil) async throws -> T {
        try await request(path, method: .get, parameters: parameters)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await request(path, method: .post, body: body)
    }

    func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await request(path, method: .put, body: body)
    }

    func delete<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: .delete)
    }

    // MARK: - Core Request

    private func request<T: Decodable>(
        _ path: String,
        method: HTTPMethod,
        parameters: Parameters? = nil,
        body: Encodable? = nil
    ) async throws -> T {
        let url = baseURL + path

        var headers = HTTPHeaders()
        headers.add(.contentType("application/json"))

        // Add auth token if available
        if let token = getAuthToken() {
            headers.add(.authorization(bearerToken: token))
        }

        // Create request
        let dataRequest: DataRequest

        if let body = body {
            // Encode body to JSON data and upload
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let jsonData = try encoder.encode(body)

            var request = URLRequest(url: URL(string: url)!)
            request.httpMethod = method.rawValue
            request.httpBody = jsonData
            headers.forEach { request.headers.add($0) }

            dataRequest = session.request(request)
        } else {
            dataRequest = session.request(
                url,
                method: method,
                parameters: parameters,
                encoding: URLEncoding.default,
                headers: headers
            )
        }

        // Execute request
        let response = await dataRequest.serializingData().response

        // Handle response
        switch response.result {
        case .success(let data):
            let decoder = JSONDecoder()
            // Use custom date formatter to handle ISO8601 with fractional seconds
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            decoder.dateDecodingStrategy = .custom { decoder in
                let container = try decoder.singleValueContainer()
                let dateString = try container.decode(String.self)
                if let date = formatter.date(from: dateString) {
                    return date
                }
                // Fallback for dates without fractional seconds
                formatter.formatOptions = [.withInternetDateTime]
                if let date = formatter.date(from: dateString) {
                    return date
                }
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode date: \(dateString)")
            }

            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                print("Decoding error: \(error)")
                print("Raw data: \(String(data: data, encoding: .utf8) ?? "nil")")
                throw APIError.decodingError(error)
            }

        case .failure(let error):
            if let statusCode = response.response?.statusCode {
                throw APIError.httpError(statusCode, error.localizedDescription)
            }
            throw APIError.networkError(error)
        }
    }

    // MARK: - Multipart Upload

    func uploadMultipart<T: Decodable>(
        _ path: String,
        parameters: [String: String],
        files: [MultipartFile]
    ) async throws -> T {
        let url = baseURL + path

        var headers = HTTPHeaders()
        if let token = getAuthToken() {
            headers.add(.authorization(bearerToken: token))
        }

        let uploadData = await session.upload(
            multipartFormData: { multipartFormData in
                // Add parameters
                for (key, value) in parameters {
                    if let data = value.data(using: .utf8) {
                        multipartFormData.append(data, withName: key)
                    }
                }

                // Add files
                for file in files {
                    multipartFormData.append(
                        file.data,
                        withName: file.name,
                        fileName: file.fileName,
                        mimeType: file.mimeType
                    )
                }
            },
            to: url,
            headers: headers
        ).serializingData().response

        switch uploadData.result {
        case .success(let data):
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(T.self, from: data)

        case .failure(let error):
            throw APIError.uploadError(error)
        }
    }

    // MARK: - Helper Methods

    private func getAuthToken() -> String? {
        UserDefaults.standard.string(forKey: "tortok.auth.token")
    }
}

// MARK: - Multipart File

struct MultipartFile {
    let data: Data
    let name: String
    let fileName: String
    let mimeType: String
}

// MARK: - API Errors

enum APIError: LocalizedError {
    case networkError(Error)
    case httpError(Int, String)
    case decodingError(Error)
    case uploadError(Error)
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .httpError(let code, let message):
            return "HTTP \(code): \(message)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        case .uploadError(let error):
            return "Upload error: \(error.localizedDescription)"
        case .invalidURL:
            return "Invalid URL"
        }
    }
}
