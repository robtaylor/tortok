//
//  WebTorrentBridge.swift
//  TorTok
//
//  Bridge to WebTorrent running in a hidden WKWebView

import Foundation
import WebKit
import Combine

/// WebTorrent client running in a WKWebView
@MainActor
class WebTorrentBridge: NSObject, ObservableObject {
    static let shared = WebTorrentBridge()

    // Published stats
    @Published var isReady = false
    @Published var activeTorrents: [String: TorrentInfo] = [:]
    @Published var totalDownloadSpeed: Double = 0
    @Published var totalUploadSpeed: Double = 0
    @Published var totalPeers: Int = 0

    private var webView: WKWebView?
    private var pendingTorrentRequests: [String: CheckedContinuation<TorrentInfo, Error>] = [:]
    private var pendingDataRequests: [String: CheckedContinuation<Data, Error>] = [:]
    private var pendingVoidRequests: [String: CheckedContinuation<Void, Error>] = [:]
    private var requestCounter = 0

    struct TorrentInfo {
        let infoHash: String
        let name: String
        var files: [FileInfo]
        var progress: Double = 0
        var downloadSpeed: Double = 0
        var uploadSpeed: Double = 0
        var numPeers: Int = 0
    }

    struct FileInfo {
        let name: String
        let path: String
        let length: Int
    }

    override init() {
        super.init()
        setupWebView()
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        // Set up message handlers
        let contentController = config.userContentController
        contentController.add(self, name: "log")
        contentController.add(self, name: "response")
        contentController.add(self, name: "event")

        webView = WKWebView(frame: .zero, configuration: config)
        webView?.navigationDelegate = self

        // Load the bridge HTML
        if let htmlURL = Bundle.main.url(forResource: "webtorrent-bridge", withExtension: "html") {
            webView?.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
        } else {
            print("⚠️ WebTorrent bridge HTML not found in bundle")
            // Try loading from Resources directory during development
            loadFromDevelopmentPath()
        }
    }

    private func loadFromDevelopmentPath() {
        // For development, load directly from project
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <script src="https://cdn.jsdelivr.net/npm/webtorrent@2.5.1/webtorrent.min.js"></script>
        </head>
        <body>
        <script>
        const client = new WebTorrent();
        const torrents = new Map();

        function log(msg) {
            window.webkit?.messageHandlers?.log?.postMessage(msg);
        }

        function sendResponse(reqId, success, data, error) {
            window.webkit?.messageHandlers?.response?.postMessage({
                requestId: reqId, success: success, data: data, error: error
            });
        }

        function sendEvent(event, data) {
            window.webkit?.messageHandlers?.event?.postMessage({ event: event, data: data });
        }

        window.addTorrent = function(reqId, magnetURI) {
            client.add(magnetURI, (torrent) => {
                torrents.set(torrent.infoHash, torrent);
                sendResponse(reqId, true, {
                    infoHash: torrent.infoHash,
                    name: torrent.name,
                    files: torrent.files.map(f => ({ name: f.name, path: f.path, length: f.length }))
                });

                torrent.on('download', () => {
                    sendEvent('download', {
                        infoHash: torrent.infoHash,
                        downloadSpeed: torrent.downloadSpeed,
                        progress: torrent.progress,
                        numPeers: torrent.numPeers
                    });
                });
            });
        };

        window.getFile = function(reqId, infoHash, filePath) {
            const torrent = torrents.get(infoHash);
            if (!torrent) { sendResponse(reqId, false, null, 'Not found'); return; }
            const file = torrent.files.find(f => f.path === filePath || f.name === filePath);
            if (!file) { sendResponse(reqId, false, null, 'File not found'); return; }
            file.getBlob((err, blob) => {
                if (err) { sendResponse(reqId, false, null, err.message); return; }
                const reader = new FileReader();
                reader.onload = () => sendResponse(reqId, true, {
                    filePath: filePath, data: reader.result.split(',')[1], size: blob.size
                });
                reader.readAsDataURL(blob);
            });
        };

        log('WebTorrent Bridge ready');
        sendEvent('ready', { version: WebTorrent.VERSION });
        </script>
        </body>
        </html>
        """
        webView?.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - Public API

    /// Add a torrent by magnet URI
    func addTorrent(magnetURI: String) async throws -> TorrentInfo {
        guard isReady else {
            throw WebTorrentError.notReady
        }

        let requestId = nextRequestId()

        return try await withCheckedThrowingContinuation { continuation in
            pendingTorrentRequests[requestId] = continuation

            let escapedMagnet = magnetURI.replacingOccurrences(of: "'", with: "\\'")
            let js = "addTorrent('\(requestId)', '\(escapedMagnet)')"

            webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    self.pendingTorrentRequests.removeValue(forKey: requestId)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Get file data from a torrent
    func getFile(infoHash: String, filePath: String) async throws -> Data {
        guard isReady else {
            throw WebTorrentError.notReady
        }

        let requestId = nextRequestId()

        return try await withCheckedThrowingContinuation { continuation in
            pendingDataRequests[requestId] = continuation

            let js = "getFile('\(requestId)', '\(infoHash)', '\(filePath)')"

            webView?.evaluateJavaScript(js) { _, error in
                if let error = error {
                    self.pendingDataRequests.removeValue(forKey: requestId)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Remove a torrent
    func removeTorrent(infoHash: String) async throws {
        guard isReady else { return }

        let requestId = nextRequestId()
        let js = "removeTorrent('\(requestId)', '\(infoHash)')"
        try await webView?.evaluateJavaScript(js)
        activeTorrents.removeValue(forKey: infoHash)
    }

    private func nextRequestId() -> String {
        requestCounter += 1
        return "req_\(requestCounter)"
    }

    private func handleResponse(_ dict: [String: Any]) {
        guard let requestId = dict["requestId"] as? String,
              let success = dict["success"] as? Bool else {
            return
        }

        // Check for torrent request
        if let continuation = pendingTorrentRequests.removeValue(forKey: requestId) {
            if success {
                if let data = dict["data"] as? [String: Any],
                   let infoHash = data["infoHash"] as? String {
                    let files = (data["files"] as? [[String: Any]] ?? []).map { f in
                        FileInfo(
                            name: f["name"] as? String ?? "",
                            path: f["path"] as? String ?? "",
                            length: f["length"] as? Int ?? 0
                        )
                    }
                    let info = TorrentInfo(
                        infoHash: infoHash,
                        name: data["name"] as? String ?? "",
                        files: files
                    )
                    activeTorrents[infoHash] = info
                    continuation.resume(returning: info)
                } else {
                    continuation.resume(throwing: WebTorrentError.torrentError("Invalid response"))
                }
            } else {
                let error = dict["error"] as? String ?? "Unknown error"
                continuation.resume(throwing: WebTorrentError.torrentError(error))
            }
            return
        }

        // Check for data request
        if let continuation = pendingDataRequests.removeValue(forKey: requestId) {
            if success {
                if let data = dict["data"] as? [String: Any],
                   let base64 = data["data"] as? String,
                   let fileData = Data(base64Encoded: base64) {
                    continuation.resume(returning: fileData)
                } else {
                    continuation.resume(throwing: WebTorrentError.torrentError("Invalid file data"))
                }
            } else {
                let error = dict["error"] as? String ?? "Unknown error"
                continuation.resume(throwing: WebTorrentError.torrentError(error))
            }
            return
        }

        // Check for void request
        if let continuation = pendingVoidRequests.removeValue(forKey: requestId) {
            if success {
                continuation.resume(returning: ())
            } else {
                let error = dict["error"] as? String ?? "Unknown error"
                continuation.resume(throwing: WebTorrentError.torrentError(error))
            }
            return
        }
    }

    private func handleEvent(_ dict: [String: Any]) {
        guard let event = dict["event"] as? String,
              let data = dict["data"] as? [String: Any] else {
            return
        }

        switch event {
        case "ready":
            isReady = true
            print("✅ WebTorrent Bridge ready (v\(data["version"] ?? "?"))")

        case "download":
            if let infoHash = data["infoHash"] as? String {
                if var info = activeTorrents[infoHash] {
                    info.downloadSpeed = data["downloadSpeed"] as? Double ?? 0
                    info.progress = data["progress"] as? Double ?? 0
                    info.numPeers = data["numPeers"] as? Int ?? 0
                    activeTorrents[infoHash] = info
                }
                updateTotalStats()
            }

        case "upload":
            if let infoHash = data["infoHash"] as? String {
                if var info = activeTorrents[infoHash] {
                    info.uploadSpeed = data["uploadSpeed"] as? Double ?? 0
                    activeTorrents[infoHash] = info
                }
                updateTotalStats()
            }

        case "peerConnect":
            if let infoHash = data["infoHash"] as? String,
               let numPeers = data["numPeers"] as? Int {
                if var info = activeTorrents[infoHash] {
                    info.numPeers = numPeers
                    activeTorrents[infoHash] = info
                }
                updateTotalStats()
            }

        case "done":
            if let infoHash = data["infoHash"] as? String {
                print("🎉 Torrent complete: \(infoHash)")
            }

        case "error":
            if let error = data["error"] as? String {
                print("❌ Torrent error: \(error)")
            }

        default:
            break
        }
    }

    private func updateTotalStats() {
        totalDownloadSpeed = activeTorrents.values.reduce(0) { $0 + $1.downloadSpeed }
        totalUploadSpeed = activeTorrents.values.reduce(0) { $0 + $1.uploadSpeed }
        totalPeers = activeTorrents.values.reduce(0) { $0 + $1.numPeers }
    }
}

// MARK: - WKScriptMessageHandler

extension WebTorrentBridge: WKScriptMessageHandler {
    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor in
            switch message.name {
            case "log":
                if let msg = message.body as? String {
                    print("🌐 [WebTorrent] \(msg)")
                }

            case "response":
                if let dict = message.body as? [String: Any] {
                    handleResponse(dict)
                }

            case "event":
                if let dict = message.body as? [String: Any] {
                    handleEvent(dict)
                }

            default:
                break
            }
        }
    }
}

// MARK: - WKNavigationDelegate

extension WebTorrentBridge: WKNavigationDelegate {
    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            print("📄 WebTorrent WebView loaded")
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            print("❌ WebTorrent WebView failed: \(error)")
        }
    }
}

// MARK: - Errors

enum WebTorrentError: LocalizedError {
    case notReady
    case torrentError(String)
    case fileNotFound

    var errorDescription: String? {
        switch self {
        case .notReady:
            return "WebTorrent bridge not ready"
        case .torrentError(let message):
            return "Torrent error: \(message)"
        case .fileNotFound:
            return "File not found in torrent"
        }
    }
}
