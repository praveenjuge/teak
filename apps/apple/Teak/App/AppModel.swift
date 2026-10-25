import AuthenticationServices
import Foundation
import Network
import Observation
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

    private(set) var authMode: AuthMode?
    private(set) var user: SessionUser?
    private(set) var sessionLoaded = false
    private(set) var isOnline = true
    private(set) var isConnected = false
    private(set) var isConvexAuthenticated = false
    private(set) var configurationError: String?
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
            if previous != nil, state.user == nil {
                authenticateTask?.cancel()
                tokenTask?.cancel()
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

    func signOut() async throws {
        guard try await session.accessToken() != nil else {
            await session.clear()
            return
        }
        guard let sessionId = await session.sessionId else { throw TeakError.signedOut }
        let _: ConvexVoid = try await backend.action(ConvexFunctions.revokeAuthkitSession,
                                                     ["sessionId": .string(sessionId)])
        await session.clear()
    }

    func deleteAccount() async throws {
        let _: ConvexVoid = try await backend.mutation(ConvexFunctions.deleteMyAccount)
        await session.clear()
    }
}
