import Foundation

/// Owns the WorkOS session: sign-in, shared storage and access tokens.
/// Port of `apps/mobile/lib/workos-session.ts`, plus the Mac app's
/// cross-process lock so the app and its extensions never replay a rotated
/// refresh token.
public actor TeakSession {
    public enum State: Equatable, Sendable {
        case loading
        case signedOut
        case signedIn(SessionUser)

        public var user: SessionUser? {
            if case let .signedIn(user) = self { return user }
            return nil
        }
    }

    public typealias Bootstrap = @Sendable (_ accessToken: String) async throws -> Void

    /// Access tokens are refreshed when they expire within this margin.
    public static let refreshMargin: TimeInterval = 30

    private let endpoint: URL
    private let storage: any SessionStorage
    private let lock: any CredentialLock
    private let transport: any HTTPTransport
    private let timeout: TimeInterval
    private let now: @Sendable () -> Date
    private let bootstrap: Bootstrap?

    private var session: WorkOSSession?
    private var generation = 0
    private var signInAttempt = 0
    private var refresh: (id: UUID, task: Task<String?, any Error>)?
    private var observers: [UUID: AsyncStream<State>.Continuation] = [:]
    private var tokenListener: (@Sendable (String?) -> Void)?
    public private(set) var state: State = .loading

    public init(storage: any SessionStorage, lock: any CredentialLock, workosURL: URL = TeakConfig.hostedWorkOS,
                transport: any HTTPTransport = URLSessionTransport(), timeout: TimeInterval = 10,
                now: @escaping @Sendable () -> Date = Date.init, bootstrap: Bootstrap? = nil) {
        endpoint = workosURL.appending(path: "user_management/authenticate")
        self.storage = storage
        self.lock = lock
        self.transport = transport
        self.timeout = timeout
        self.now = now
        self.bootstrap = bootstrap
    }

    // MARK: Observing

    /// The current state, then every change.
    public func states() -> AsyncStream<State> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<State>.makeStream(bufferingPolicy: .bufferingNewest(1))
        continuation.yield(state)
        observers[id] = continuation
        continuation.onTermination = { _ in Task { await self.removeObserver(id) } }
        return stream
    }

    private func removeObserver(_ id: UUID) { observers[id] = nil }

    /// Hears every new access token, and nil when the session ends. Convex listens to stay signed in.
    public func setTokenListener(_ listener: (@Sendable (String?) -> Void)?) {
        tokenListener = listener
    }

    private func publish(token: String?? = nil) {
        state = session.map { .signedIn($0.user) } ?? .signedOut
        for continuation in observers.values { continuation.yield(state) }
        if let token { tokenListener?(token) }
    }

    public var user: SessionUser? { session?.user }
    public var clientId: String? { session?.clientId }
    public var sessionId: String? { session?.sessionId }
    public var expiresAt: Date? { session?.expiresAt }

    // MARK: Restoring

    /// Loads the stored session. Throws when the keychain can't be read (for
    /// example before the first unlock); the stored session is kept for a retry.
    @discardableResult
    public func restore() throws -> SessionUser? {
        let data = try storage.load()
        do {
            guard let data else {
                session = nil
                publish()
                return nil
            }
            let stored = try JSONDecoder().decode(StoredSession.self, from: data)
            session = try SessionParser.parse(stored, clientId: stored.clientId)
        } catch {
            // A corrupt or foreign record can never become valid; forget it.
            session = nil
            try? storage.clear()
        }
        publish()
        return session?.user
    }

    // MARK: Signing in

    public func beginSignIn() -> Int {
        signInAttempt += 1
        return signInAttempt
    }

    /// Exchanges the redirect's code. The account is linked with `ensureUser`
    /// before anything is saved, so a failed bootstrap leaves the app signed out.
    /// Returns false when a newer attempt or a sign-out superseded this one.
    public func exchangeCode(_ code: String, request: AuthKitRequest, attempt: Int) async throws -> Bool {
        guard !code.isEmpty, request.verifier.wholeMatch(of: /[A-Za-z0-9._~-]{43,128}/) != nil else {
            throw TeakError(message: "Invalid sign-in callback")
        }
        let epoch = lock.epoch()
        guard attempt == signInAttempt else { return false }
        let data = try await authenticate(clientId: request.clientId, [
            "grant_type": "authorization_code", "code": code, "code_verifier": request.verifier,
        ])
        let next = try SessionParser.parseResponse(data, clientId: request.clientId)
        guard next.expiresAt > now() else { throw TeakError(message: "Expired session token") }
        guard attempt == signInAttempt else { return false }
        try await bootstrap?(next.accessToken)
        guard attempt == signInAttempt else { return false }

        let record = try JSONEncoder().encode(next.record)
        let saved = try await lock.withLock { [storage, lock] in
            // A sign-out that started meanwhile wins.
            guard lock.epoch() == epoch else { return false }
            try storage.save(record)
            // Supersedes refreshes of an older session in every process.
            lock.advanceEpoch()
            return true
        }
        guard saved, attempt == signInAttempt else { return false }
        generation += 1
        refresh = nil
        session = next
        publish(token: .some(next.accessToken))
        return true
    }

    #if DEBUG
    /// UI tests sign in with a session they created against the WorkOS emulator.
    public func adoptForTesting(_ response: Data, clientId: String) async throws {
        let next = try SessionParser.parseResponse(response, clientId: clientId)
        try await bootstrap?(next.accessToken)
        try storage.save(JSONEncoder().encode(next.record))
        generation += 1
        session = next
        publish(token: .some(next.accessToken))
    }
    #endif

    // MARK: Tokens

    private enum RefreshOutcome: Sendable {
        case current(WorkOSSession)
        case signedOut
        case superseded
    }

    /// A valid access token, refreshed first when it expires within 30 seconds
    /// or `forceRefresh` is set. Nil when signed out. Throws on a transport
    /// failure, keeping the session for a retry.
    public func accessToken(forceRefresh: Bool = false) async throws -> String? {
        guard let current = session else { return nil }
        if !forceRefresh, current.expiresAt.timeIntervalSince(now()) > Self.refreshMargin {
            return current.accessToken
        }
        if let refresh { return try await refresh.task.value }
        let id = UUID()
        let task = Task { try await self.performRefresh(from: current) }
        refresh = (id, task)
        defer { if refresh?.id == id { refresh = nil } }
        return try await task.value
    }

    private func performRefresh(from current: WorkOSSession) async throws -> String? {
        let startGeneration = generation
        let epoch = lock.epoch()
        let margin = Self.refreshMargin
        let outcome: RefreshOutcome = try await lock.withLock { [storage, lock, now] in
            guard lock.epoch() == epoch else { return .superseded }
            // Another process may have refreshed, or signed out, while this one waited.
            guard let data = try storage.load(),
                  let stored = try? JSONDecoder().decode(StoredSession.self, from: data),
                  let latest = try? SessionParser.parse(stored, clientId: stored.clientId)
            else { return .signedOut }
            if latest.refreshToken != current.refreshToken,
               latest.expiresAt.timeIntervalSince(now()) > margin {
                return .current(latest)
            }
            let response: Data
            do {
                response = try await self.authenticate(clientId: latest.clientId, [
                    "grant_type": "refresh_token", "refresh_token": latest.refreshToken,
                ])
            } catch is InvalidRefreshToken {
                try? storage.clear()
                return .signedOut
            }
            let next = try SessionParser.parseResponse(response, clientId: latest.clientId)
            // A refresh must never switch accounts underneath the open vault.
            guard next.user.id == latest.user.id, next.sessionId == latest.sessionId,
                  latest.user.teakUserId == nil || next.user.teakUserId == latest.user.teakUserId
            else {
                try? storage.clear()
                return .signedOut
            }
            guard lock.epoch() == epoch else { return .superseded }
            try storage.save(JSONEncoder().encode(next.record))
            return .current(next)
        }
        guard startGeneration == generation else { return nil }
        switch outcome {
        case let .current(next):
            session = next
            publish(token: .some(next.accessToken))
            return next.accessToken
        case .signedOut:
            generation += 1
            session = nil
            publish(token: .some(nil))
            return nil
        case .superseded:
            return nil
        }
    }

    // MARK: Signing out

    /// Forgets the session on this device. Returns the real AuthKit session ID
    /// for server revocation, which the caller does first.
    @discardableResult
    public func clear() async -> String? {
        generation += 1
        signInAttempt += 1
        refresh = nil
        let sessionId = session?.sessionId
        session = nil
        publish(token: .some(nil))
        // Stop in-flight refreshes in every process from saving, and sign out
        // now rather than waiting for one to finish.
        lock.advanceEpoch()
        let epoch = lock.epoch()
        try? storage.clear()
        // A refresh that passed its epoch check just before this may still be
        // writing; delete again once it lets go of the lock. A newer sign-in
        // changes the epoch, so this never removes it.
        Task.detached { [storage, lock] in
            try? await lock.withLock {
                if lock.epoch() == epoch { try storage.clear() }
            }
        }
        return sessionId
    }

    /// Drops the in-memory session when another process signed out.
    public func reloadIfChanged() async {
        guard let data = try? storage.load() else {
            if session != nil {
                generation += 1
                session = nil
                publish(token: .some(nil))
            }
            return
        }
        guard let stored = try? JSONDecoder().decode(StoredSession.self, from: data),
              let latest = try? SessionParser.parse(stored, clientId: stored.clientId),
              latest.refreshToken != session?.refreshToken
        else { return }
        if session?.user.id != latest.user.id { generation += 1 }
        session = latest
        publish(token: .some(latest.accessToken))
    }

    // MARK: WorkOS

    struct InvalidRefreshToken: Error {}

    private nonisolated func authenticate(clientId: String, _ body: [String: String]) async throws -> Data {
        var request = URLRequest(url: endpoint, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpShouldHandleCookies = false
        var payload = body
        payload["client_id"] = clientId
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await transport.data(for: request)
        guard data.count <= SessionParser.maxLength else { throw SessionParser.invalid() }
        guard (200..<300).contains(response.statusCode) else {
            let failure = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let code = (failure?["code"] ?? failure?["error"]) as? String
            if body["grant_type"] == "refresh_token",
               response.statusCode == 401 || code == "invalid_grant" || code == "invalid_refresh_token" {
                throw InvalidRefreshToken()
            }
            throw TeakError(message: "Unable to complete sign-in")
        }
        return data
    }
}
