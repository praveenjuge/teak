import AuthenticationServices
import Foundation
import Network
import Observation
import SwiftUI
import TeakCore
import TeakSync

/// What the root view shows.
enum AppPhase: Equatable {
    case loading
    case offline
    case failed(String)
    case signedOut
    case signedIn
}

/// Owns the app's connection to Teak: sign-in configuration, the WorkOS
/// session, Convex and connectivity. Port of the iPhone app's
/// `ConvexClientProvider`, `MobileAuthProviders` and `useAuthBootstrap`.
@MainActor @Observable
final class AppModel {
    let config: TeakConfig
    let session: TeakSession
    let backend: TeakBackend

    private(set) var authMode: AuthMode?
    private(set) var user: SessionUser?
    private(set) var sessionLoaded = false
    private(set) var isOnline = true
    private(set) var isConnected = false
    private(set) var isConvexAuthenticated = false
    private(set) var configurationError: String?
    /// Set when the keychain couldn't be read (before the first unlock); retried on foreground.
    private(set) var keychainUnavailable = false

    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var authenticateTask: Task<Void, Never>?
    @ObservationIgnored private var tokenTask: Task<Void, Never>?
    @ObservationIgnored private let pathMonitor = NWPathMonitor()
    @ObservationIgnored private let defaults: UserDefaults

    init(config: TeakConfig = .current) {
        self.config = config
        session = TeakServices.session(config: config)
        backend = TeakBackend(convexURL: config.convexURL, session: session)
        defaults = TeakServices.sharedDefaults(config: config)
    }

    var phase: AppPhase {
        if !sessionLoaded || (keychainUnavailable && user == nil) { return .loading }
        if !isOnline { return .offline }
        if user != nil { return .signedIn }
        if let configurationError, authMode == nil { return .failed(configurationError) }
        return authMode == nil ? .loading : .signedOut
    }

    // MARK: Starting

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
        tasks.append(Task { for await authed in self.backend.authStates() { self.isConvexAuthenticated = authed } })
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
                sessionLoaded = true
                if user != nil { authenticateConvex() }
            } catch {
                keychainUnavailable = true
                sessionLoaded = true
            }
        }
    }

    #if DEBUG
    /// `TEAK_UI_TEST_RESET` signs out first; `TEAK_UI_TEST_SESSION` (a base64
    /// WorkOS authenticate response) signs in without a browser.
    private func prepareForUITests() async {
        let environment = ProcessInfo.processInfo.environment
        if environment["TEAK_UI_TEST_RESET"] == "1" { await session.clear() }
        if let encoded = environment["TEAK_UI_TEST_SESSION"], let data = Data(base64Encoded: encoded),
           let clientId = environment["TEAK_UI_TEST_CLIENT_ID"] {
            try? await session.adoptForTesting(data, clientId: clientId)
        }
    }
    #endif

    func becameActive() {
        if keychainUnavailable { restoreSession() }
        Task { await session.reloadIfChanged() }
    }

    private func watchSession() async {
        for await state in await session.states() {
            let previous = user
            user = state.user
            SentryReporting.setUser(state.user?.teakUserId)
            if previous != nil, state.user == nil {
                authenticateTask?.cancel()
                tokenTask?.cancel()
                await backend.logout()
            }
        }
    }

    // MARK: Sign-in configuration

    private var modeCacheKey: String { "teak.auth-mode.\(config.convexURL.absoluteString)" }

    private func cachedAuthMode() -> AuthMode? {
        guard let data = defaults.data(forKey: modeCacheKey), data.count <= 4096 else { return nil }
        return try? AuthMode.parse(data)
    }

    private func watchAuthMode() async {
        while !Task.isCancelled {
            do {
                for try await raw in backend.subscribe("auth:getAuthMode", [:], as: AuthModeValue.self) {
                    await accept(raw.data)
                }
            } catch {
                configurationError = "Unable to load sign-in configuration"
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }

    private func accept(_ data: Data) async {
        guard let next = try? AuthMode.parse(data) else {
            configurationError = "Unable to load sign-in configuration"
            return
        }
        // A deployment that switched WorkOS clients can't use the old client's session.
        if let current = await session.clientId, current != next.authKitClientId {
            await session.clear()
        }
        authMode = next
        configurationError = nil
        defaults.set(data, forKey: modeCacheKey)
    }

    private func timeOutConfiguration() async {
        try? await Task.sleep(for: .seconds(10))
        if authMode == nil, isOnline { configurationError = "Unable to connect. Please try again." }
    }

    func retryConfiguration() {
        configurationError = nil
        tasks.append(Task { await self.timeOutConfiguration() })
    }

    func retryConnection() {
        isOnline = pathMonitor.currentPath.status == .satisfied
    }

    // MARK: Convex

    /// Hands the session to Convex, retrying transport failures with backoff
    /// without opening another browser.
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

    // MARK: Signing in and out

    /// Returns false when the person cancelled.
    func signIn(_ method: SignInMethod, using webAuthentication: WebAuthenticationSession) async throws -> Bool {
        guard let clientId = authMode?.authKitClientId else {
            throw TeakError(message: "Unable to load sign-in configuration")
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
            return false
        }
        guard case let .code(code) = try request.callback(from: callback) else { return false }
        guard try await session.exchangeCode(code, request: request, attempt: attempt) else { return false }
        authenticateConvex()
        return true
    }

    /// Revokes this device's session on the server first, so signing out ends
    /// the WorkOS session without a browser. Keeps the credentials if that fails.
    func signOut() async throws {
        guard try await session.accessToken() != nil else {
            await session.clear()
            return
        }
        guard let sessionId = await session.sessionId else { throw TeakError.signedOut }
        let _: ConvexVoid = try await backend.action("securitySessions:revokeAuthkitSession",
                                                     ["sessionId": .string(sessionId)])
        await session.clear()
    }

    /// Deletes the account and everything in it. The server ends every session.
    func deleteAccount() async throws {
        if authMode?.accountChangesPaused == true {
            throw TeakError(message: TeakMessages.accountChangesPaused)
        }
        let _: ConvexVoid = try await backend.mutation("accountDeletion:deleteMyAccount", [:])
        await session.clear()
    }
}

/// Keeps `auth:getAuthMode`'s raw JSON so `AuthMode.parse` validates it.
struct AuthModeValue: Decodable, Sendable {
    let data: Data

    init(from decoder: any Decoder) throws {
        let mode = try AuthMode(from: decoder)
        data = try JSONEncoder().encode(mode)
    }
}
