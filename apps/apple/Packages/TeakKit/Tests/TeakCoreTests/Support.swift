import Foundation
@testable import TeakCore

/// Answers HTTP requests in tests. Each handler sees the request and its JSON body.
final class ScriptedTransport: HTTPTransport, FileUploadTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest, [String: Any]) async throws -> (Int, Any)

    private let lock = NSLock()
    private var handler: Handler
    private var _requests: [(URLRequest, [String: Any])] = []

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    var requests: [(URLRequest, [String: Any])] { lock.withLock { _requests } }
    var count: Int { requests.count }

    func respond(_ handler: @escaping Handler) { lock.withLock { self.handler = handler } }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let current = lock.withLock { () -> Handler in
            _requests.append((request, body))
            return handler
        }
        let (status, json) = try await current(request, body)
        let data = try JSONSerialization.data(withJSONObject: json, options: [.fragmentsAllowed])
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    func put(_ file: URL, to url: URL, contentType: String) async throws -> (status: Int, etag: String?) {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (data, response) = try await data(for: request)
        _ = data
        return (response.statusCode, "\"etag-1\"")
    }
}

/// The shared keychain item, in memory.
final class MemoryStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Data?
    var failReads = false

    init(_ value: Data? = nil) { self.value = value }

    func load() throws -> Data? {
        try lock.withLock {
            if failReads { throw KeychainError(status: errSecInteractionNotAllowed) }
            return value
        }
    }

    func save(_ data: Data) throws { lock.withLock { value = data } }
    func clear() throws { lock.withLock { value = nil } }

    var json: [String: Any]? {
        lock.withLock { value.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    }
}

/// A gate a test opens to release a waiting request.
actor Gate {
    private var open = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var arrivals = 0
    private var arrivalWaiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        arrivals += 1
        arrivalWaiters.forEach { $0.resume() }
        arrivalWaiters = []
        if open { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func arrived() async {
        if arrivals > 0 { return }
        await withCheckedContinuation { arrivalWaiters.append($0) }
    }

    func release() {
        open = true
        waiters.forEach { $0.resume() }
        waiters = []
    }
}

enum Fixture {
    static let clientId = "client_TEST"

    static func tempDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "teak-tests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func token(sub: String = "user_ONE", sid: String = "session_ONE", expiry: Date) -> String {
        let claims: [String: Any] = [
            "iss": "https://api.workos.com/user_management/\(clientId)",
            "sub": sub, "sid": sid, "exp": Int(expiry.timeIntervalSince1970),
        ]
        let payload = try! JSONSerialization.data(withJSONObject: claims).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "header.\(payload).signature-\(UUID().uuidString.prefix(6))"
    }

    static func response(refresh: String = "refresh-1", expiry: Date = Date().addingTimeInterval(120),
                         sub: String = "user_ONE", sid: String = "session_ONE",
                         vault: String? = "permanent-vault") -> [String: Any] {
        [
            "access_token": token(sub: sub, sid: sid, expiry: expiry),
            "refresh_token": refresh,
            "user": [
                "id": sub, "email": "hello@example.com", "email_verified": true,
                "external_id": vault as Any, "first_name": "Praveen", "last_name": "Juge",
            ],
            "oauth_tokens": ["access_token": "unneeded-provider-token"],
        ]
    }

    /// A stored session record, as the keychain holds it.
    static func stored(refresh: String = "old", expiry: Date = Date().addingTimeInterval(-1)) -> Data {
        let response = response(refresh: refresh, expiry: expiry)
        let user = response["user"] as! [String: Any]
        let record: [String: Any] = [
            "clientId": clientId,
            "access_token": response["access_token"]!,
            "refresh_token": refresh,
            "user": user.filter { $0.key != "oauth_tokens" },
        ]
        return try! JSONSerialization.data(withJSONObject: record)
    }
}
