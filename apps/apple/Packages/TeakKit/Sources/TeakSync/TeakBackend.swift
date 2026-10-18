import Combine
import ConvexMobile
import Foundation
import TeakCore

public enum ConvexAuthOutcome: Sendable {
    case authenticated
    case noSession
}

public final class TeakBackend: ConvexCaller, @unchecked Sendable {
    let client: ConvexClientWithAuth<String>
    let session: TeakSession
    private let provider: WorkOSAuthProvider

    public init(convexURL: URL, session: TeakSession) {
        self.session = session
        provider = WorkOSAuthProvider(session: session)
        client = ConvexClientWithAuth(deploymentUrl: convexURL.absoluteString, authProvider: provider)
    }

    @discardableResult
    public func authenticate() async throws -> ConvexAuthOutcome {
        switch await client.loginFromCache() {
        case .success: return .authenticated
        case let .failure(error):
            if let error = error as? TeakError, error.code == TeakError.unauthenticatedCode { return .noSession }
            throw error
        }
    }

    public func logout() async {
        await client.logout()
    }

    public func authStates() -> AsyncStream<Bool> {
        stream(client.authState.map { state in
            if case .authenticated = state { return true }
            return false
        }.removeDuplicates().eraseToAnyPublisher())
    }

    public func connectionStates() -> AsyncStream<Bool> {
        stream(client.watchWebSocketState().map { $0 == .connected }.removeDuplicates().eraseToAnyPublisher())
    }

    public func keepTokenFresh() async {
        var backoff: Duration = .seconds(1)
        while !Task.isCancelled {
            guard let expiresAt = await session.expiresAt else { return }
            let wait = max(0, expiresAt.timeIntervalSinceNow - TeakSession.refreshMargin + 5)
            try? await Task.sleep(for: .seconds(wait))
            if Task.isCancelled { return }
            do {
                guard try await session.accessToken() != nil else { return }
                backoff = .seconds(1)
            } catch {
                try? await Task.sleep(for: backoff)
                backoff = min(backoff * 2, .seconds(60))
            }
        }
    }

    /// A live query: the current result, then every change. Errors end the stream.
    public func subscribe<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs = [:],
                                                   as type: T.Type = T.self) -> AsyncThrowingStream<T, any Error> {
        let publisher: AnyPublisher<T, ClientError> = client.subscribe(to: name, with: args.convexArgs, yielding: T.self)
        return AsyncThrowingStream { continuation in
            let cancellable = publisher.sink(
                receiveCompletion: { completion in
                    if case let .failure(error) = completion {
                        continuation.finish(throwing: Self.teakError(error))
                    } else {
                        continuation.finish()
                    }
                },
                receiveValue: { continuation.yield($0) })
            let box = CancellableBox(cancellable)
            continuation.onTermination = { _ in box.cancel() }
        }
    }

    public func subscribe<T: Decodable & Sendable>(_ function: ConvexFunction<T>, _ args: ConvexArgs = [:]) -> AsyncThrowingStream<T, any Error> {
        subscribe(function.name, args, as: T.self)
    }

    public func query<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs) async throws -> T {
        for try await value in subscribe(name, args, as: T.self) { return value }
        throw TeakError(message: TeakMessages.genericFailure)
    }

    public func mutation<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs) async throws -> T {
        do {
            return try await client.mutation(name, with: args.convexArgs)
        } catch {
            throw Self.teakError(error)
        }
    }

    public func action<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs) async throws -> T {
        do {
            return try await client.action(name, with: args.convexArgs)
        } catch {
            throw Self.teakError(error)
        }
    }

    static func teakError(_ error: any Error) -> any Error {
        guard let error = error as? ClientError else { return error }
        switch error {
        case let .ConvexError(data):
            let object = (try? JSONSerialization.jsonObject(with: Data(data.utf8), options: [.fragmentsAllowed]))
            if let object = object as? [String: Any] {
                return TeakError.card(code: object["code"] as? String, message: object["message"] as? String)
            }
            return TeakError(message: (object as? String) ?? TeakMessages.genericFailure)
        case let .ServerError(message):
            return TeakError.server(message: message)
        case .InternalError:
            return TeakError(message: TeakMessages.genericFailure)
        }
    }

    private func stream<Value: Sendable>(_ publisher: AnyPublisher<Value, Never>) -> AsyncStream<Value> {
        AsyncStream { continuation in
            let box = CancellableBox(publisher.sink { continuation.yield($0) })
            continuation.onTermination = { _ in box.cancel() }
        }
    }
}

private final class CancellableBox: @unchecked Sendable {
    private let cancellable: AnyCancellable
    init(_ cancellable: AnyCancellable) { self.cancellable = cancellable }
    func cancel() { cancellable.cancel() }
}

final class WorkOSAuthProvider: AuthProvider, @unchecked Sendable {
    typealias T = String

    private let session: TeakSession
    static let minForcedRefreshInterval: TimeInterval = 10

    private let lock = NSLock()
    private var lastForcedRefresh = Date.distantPast
    private var hasLoggedIn = false

    init(session: TeakSession) {
        self.session = session
    }

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        try await loginFromCache(onIdToken: onIdToken)
    }

    /// The client calls this once to sign in, then again whenever Convex asks
    /// for a fresh token, so later calls refresh (at most once per `minForcedRefreshInterval`).
    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        await session.setTokenListener(onIdToken)
        let force = lock.withLock { () -> Bool in
            defer { hasLoggedIn = true }
            guard hasLoggedIn, Date().timeIntervalSince(lastForcedRefresh) > Self.minForcedRefreshInterval else { return false }
            lastForcedRefresh = Date()
            return true
        }
        guard let token = try await session.accessToken(forceRefresh: force) else { throw TeakError.signedOut }
        return token
    }

    func logout() async throws {
        lock.withLock { hasLoggedIn = false }
        await session.setTokenListener(nil)
    }

    func extractIdToken(from authResult: String) -> String { authResult }
}
