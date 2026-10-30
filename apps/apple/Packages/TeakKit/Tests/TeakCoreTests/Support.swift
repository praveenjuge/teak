import Foundation
@testable import TeakCore

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

actor Gate {
    private var open = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var arrivals = 0
    private var arrivalWaiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        arrive()
        if open { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func arrive() {
        arrivals += 1
        arrivalWaiters.forEach { $0.resume() }
        arrivalWaiters = []
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

final class ScriptedActivity: BackgroundActivity, @unchecked Sendable {
    private let mutex = NSLock()
    private let granted: Bool
    private let lockDirectory: URL?
    private var expiry: (@Sendable () -> Void)?
    private var _lockedAtEnd: [Bool] = []

    init(granted: Bool = true, watching lockDirectory: URL? = nil) {
        self.granted = granted
        self.lockDirectory = lockDirectory
    }

    var lockedAtEnd: [Bool] { mutex.withLock { _lockedAtEnd } }

    func begin(reason: String, onExpiry: @escaping @Sendable () -> Void) async -> (@Sendable () -> Void)? {
        guard granted else { return nil }
        mutex.withLock { expiry = onExpiry }
        return { [self] in
            let locked = lockDirectory.map(Fixture.isLocked) ?? false
            mutex.withLock {
                expiry = nil
                _lockedAtEnd.append(locked)
            }
        }
    }

    /// Calls the expiry handler on another thread, as iOS does. The process is
    /// suspended once it returns.
    func expire() async {
        let handler = mutex.withLock { expiry }
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                handler?()
                continuation.resume()
            }
        }
    }
}

enum Fixture {
    static let clientId = "client_TEST"

    static func tempDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "teak-tests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private static let probe = NSLock()

    /// Checks by taking the lock for a moment, so two checks at once would see each
    /// other: a test's own check races the one `ScriptedActivity` makes as it ends.
    static func isLocked(_ directory: URL) -> Bool {
        probe.withLock {
            let path = directory.appending(path: "workos-session.test.lock").path
            let descriptor = open(path, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
            defer { close(descriptor) }
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { return true }
            flock(descriptor, LOCK_UN)
            return false
        }
    }

    static func token(sub: String = "user_ONE", sid: String = "session_ONE", expiry: Date, issued: Date? = nil) -> String {
        var claims: [String: Any] = [
            "iss": "https://api.workos.com/user_management/\(clientId)",
            "sub": sub, "sid": sid, "exp": Int(expiry.timeIntervalSince1970),
        ]
        if let issued { claims["iat"] = Int(issued.timeIntervalSince1970) }
        let json = (try? JSONSerialization.data(withJSONObject: claims)) ?? Data()
        let payload = json.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "header.\(payload).signature-\(UUID().uuidString.prefix(6))"
    }

    static func response(refresh: String = "refresh-1", expiry: Date = Date().addingTimeInterval(120),
                         issued: Date? = nil, sub: String = "user_ONE", sid: String = "session_ONE",
                         vault: String? = "permanent-vault") -> [String: Any] {
        [
            "access_token": token(sub: sub, sid: sid, expiry: expiry, issued: issued),
            "refresh_token": refresh,
            "user": [
                "id": sub, "email": "hello@example.com", "email_verified": true,
                "external_id": vault as Any, "first_name": "Praveen", "last_name": "Juge",
            ],
            "oauth_tokens": ["access_token": "unneeded-provider-token"],
        ]
    }

    static func stored(refresh: String = "old", expiry: Date = Date().addingTimeInterval(-1)) -> Data {
        let response = response(refresh: refresh, expiry: expiry)
        let user = response["user"] as? [String: Any] ?? [:]
        let record: [String: Any] = [
            "clientId": clientId,
            "access_token": response["access_token"]!,
            "refresh_token": refresh,
            "user": user.filter { $0.key != "oauth_tokens" },
        ]
        return (try? JSONSerialization.data(withJSONObject: record)) ?? Data()
    }
}
