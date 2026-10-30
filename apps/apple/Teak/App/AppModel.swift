import AuthenticationServices
import Foundation
import Network
import Observation
import Security
import SwiftUI
import TeakCore
import TeakSync

enum AppPhase: Equatable {
    case loading
    case offline
    case failed(String)
    case signedOut
    case signedIn
}

@MainActor @Observable
final class AppModel {
    let config: TeakConfig
    let session: TeakSession
    let backend: TeakBackend
    let spotlight: SpotlightIndexer

    private(set) var authMode: AuthMode?
    private(set) var user: SessionUser?
    private(set) var sessionLoaded = false
    private(set) var isOnline = true
    private(set) var isConnected = false
    private(set) var isConvexAuthenticated = false
    private(set) var configurationError: String?
    private(set) var keychainUnavailable = false
    /// The keychain failed for a reason other than the device being locked, which waiting won't fix.
    private(set) var keychainFailed = false

    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var authenticateTask: Task<Void, Never>?
    @ObservationIgnored private var tokenTask: Task<Void, Never>?
    @ObservationIgnored private let pathMonitor = NWPathMonitor()
    @ObservationIgnored private let defaults: UserDefaults
    /// Puts the app's screens back to a fresh start when the user signs out.
    @ObservationIgnored var onSignedOut: (() -> Void)?

    init(config: TeakConfig = .current) {
        self.config = config
        session = TeakServices.session(config: config)
        backend = TeakBackend(convexURL: config.convexURL, session: session)
        spotlight = SpotlightIndexer(session: session)
        defaults = TeakServices.sharedDefaults(config: config)
    }

    var phase: AppPhase {
        if keychainFailed, user == nil { return .failed(tr("native.errors.generic")) }
        if !sessionLoaded || (keychainUnavailable && user == nil) { return .loading }
        // Signed in, the library stays up offline (sheets and drafts with it)
        // and shows a banner instead.
        if user != nil { return .signedIn }
        if !isOnline { return .offline }
        if let configurationError, authMode == nil { return .failed(configurationError) }
        return authMode == nil ? .loading : .signedOut
    }

    func start() {
        guard tasks.isEmpty else { return }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.isOnline = path.status == .satisfied }
        }
        pathMonitor.start(queue: .main)
        authMode = cachedAuthMode()
        tasks.append(Task { await self.watchSession() })
        tasks.append(Task { await self.watchAuthMode() })
        tasks.append(Task { for await connected in self.backend.connectionStates() { self.isConnected = connected } })
        tasks.append(Task {
            for await authed in self.backend.authStates() {
                self.isConvexAuthenticated = authed
                if authed { self.refreshSpotlight() }
            }
        })
        tasks.append(Task { await self.timeOutConfiguration() })
        restoreSession()
    }

    /// Reads the stored session. The keychain can be unavailable while the
    /// device is locked; the session is kept and read again on foreground.
    func restoreSession() {
        Task {
            #if DEBUG
            await prepareForUITests()
            #endif
            do {
                let user = try await session.restore()
                keychainUnavailable = false
                keychainFailed = false
                sessionLoaded = true
                if user != nil { authenticateConvex() }
            } catch {
                // Locked before the first unlock: read again on foreground. Anything else shows an error to retry.
                let locked = (error as? KeychainError)?.status == errSecInteractionNotAllowed
                keychainUnavailable = locked
                keychainFailed = !locked
                sessionLoaded = true
            }
        }
    }

    #if DEBUG
    private func prepareForUITests() async {
        let environment = ProcessInfo.processInfo.environment
        if environment["TEAK_UI_TEST_RESET"] == "1" { await session.clear() }
        if let encoded = environment["TEAK_UI_TEST_SESSION"],
           let workosAuthenticateResponse = Data(base64Encoded: encoded),
           let clientId = environment["TEAK_UI_TEST_CLIENT_ID"] {
            try? await session.adoptForTesting(workosAuthenticateResponse, clientId: clientId)
        }
    }
    #endif

    func becameActive() {
        if keychainUnavailable { restoreSession() }
        Task { await session.reloadIfChanged() }
        if isConvexAuthenticated { refreshSpotlight() }
    }

    private func refreshSpotlight() {
        Task { [spotlight, backend] in await spotlight.refresh(backend) }
    }

    private func watchSession() async {
        for await state in await session.states() {
            let previous = user
            user = state.user
            if let old = previous?.teakUserId, old != state.user?.teakUserId {
                PostHogReporting.reset()
            }
            if let next = state.user, let teakUserId = next.teakUserId,
               teakUserId != previous?.teakUserId || next.email != previous?.email {
                PostHogReporting.identify(teakUserId: teakUserId, email: next.email)
            }
            // Signing out, deleting the account or a session ending empties Spotlight.
            if state == .signedOut { await spotlight.removeAll() }
            if previous != nil, state.user == nil {
                authenticateTask?.cancel()
                tokenTask?.cancel()
                onSignedOut?()
                await backend.logout()
            }
        }
    }

    private var modeCacheKey: String { "teak.auth-mode.\(config.convexURL.absoluteString)" }

    private func cachedAuthMode() -> AuthMode? {
        guard let data = defaults.data(forKey: modeCacheKey), data.count <= 4096 else { return nil }
        return try? AuthMode.parse(data)
    }

    private func watchAuthMode() async {
        while !Task.isCancelled {
            do {
                for try await mode in backend.subscribe(ConvexFunctions.getAuthMode) {
                    try await accept(JSONEncoder().encode(mode))
                }
            } catch {
                configurationError = tr("native.errors.signInConfig")
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }

    private func accept(_ data: Data) async {
        guard let next = try? AuthMode.parse(data) else {
            configurationError = tr("native.errors.signInConfig")
            return
        }
        if let current = await session.clientId, current != next.authKitClientId {
            await session.clear()
        }
        authMode = next
        configurationError = nil
        defaults.set(data, forKey: modeCacheKey)
    }

    private func timeOutConfiguration() async {
        try? await Task.sleep(for: .seconds(10))
        if authMode == nil, isOnline { configurationError = tr("native.errors.connectFailed") }
    }

    func retryConfiguration() {
        if keychainFailed {
            keychainFailed = false
            sessionLoaded = false
            restoreSession()
        }
        configurationError = nil
        tasks.append(Task { await self.timeOutConfiguration() })
    }

    func retryConnection() {
        isOnline = pathMonitor.currentPath.status == .satisfied
    }

    private func authenticateConvex() {
        authenticateTask?.cancel()
        authenticateTask = Task {
            var delay: Duration = .seconds(1)
            while !Task.isCancelled {
                do {
                    try await backend.authenticate()
                    break
                } catch {
                    try? await Task.sleep(for: delay)
                    delay = min(delay * 2, .seconds(60))
                }
            }
        }
        tokenTask?.cancel()
        tokenTask = Task { await backend.keepTokenFresh() }
    }

    func signIn(_ method: SignInMethod, using webAuthentication: WebAuthenticationSession) async throws {
        guard let clientId = authMode?.authKitClientId else {
            throw TeakError(message: tr("native.errors.signInConfig"))
        }
        let attempt = await session.beginSignIn()
        let request = AuthKitRequest(clientId: clientId, method: method, workosURL: config.workosURL)
        let callback: URL
        do {
            callback = try await webAuthentication.authenticate(
                using: request.url,
                callback: .customScheme(AuthKitRequest.callbackScheme),
                preferredBrowserSession: method.prefersEphemeralSession ? .ephemeral : .shared,
                additionalHeaderFields: [:])
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        }
        guard case let .code(code) = try request.callback(from: callback),
              try await session.exchangeCode(code, request: request, attempt: attempt) == .signedIn
        else { return }
        authenticateConvex()
    }

    /// Signs out on this device, offline too. Ending the session on the
    /// server is best-effort, with a token taken (refreshed if it must be,
    /// for up to a few seconds) before the session is cleared.
    func signOut() async throws {
        let token = await firstOrNil(within: .seconds(4)) { [session] in try? await session.accessToken() }
        guard let sessionId = await session.clear(), let token else { return }
        let convex = ConvexHTTP(baseURL: config.convexURL, timeout: 10) { token }
        Task.detached {
            let _: ConvexVoid? = try? await convex.action(ConvexFunctions.revokeAuthkitSession,
                                                          ["sessionId": .string(sessionId)])
        }
    }

    /// What `operation` returns, or nil once `limit` passes; a late result is dropped.
    private func firstOrNil<T: Sendable>(within limit: Duration,
                                         _ operation: @escaping @Sendable () async -> T?) async -> T? {
        let (results, continuation) = AsyncStream.makeStream(of: T?.self)
        Task { continuation.yield(await operation()) }
        Task {
            try? await Task.sleep(for: limit)
            continuation.yield(nil)
        }
        var iterator = results.makeAsyncIterator()
        let first = await iterator.next() ?? nil
        continuation.finish()
        return first
    }

    func deleteAccount() async throws {
        let _: ConvexVoid = try await backend.mutation(ConvexFunctions.deleteMyAccount)
        await session.clear()
    }
}
