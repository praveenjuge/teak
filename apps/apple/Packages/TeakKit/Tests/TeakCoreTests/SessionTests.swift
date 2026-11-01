import Foundation
import Testing
@testable import TeakCore

private func makeSession(_ storage: MemoryStorage, _ transport: ScriptedTransport, directory: URL = Fixture.tempDirectory(),
                         activity: any BackgroundActivity = SystemActivity(),
                         bootstrap: TeakSession.Bootstrap? = nil) -> TeakSession {
    TeakSession(storage: storage, lock: FileCredentialLock(directory: directory, environment: "test", activity: activity),
                transport: transport, bootstrap: bootstrap)
}

private let verifier = String(repeating: "v", count: 43)
private func request() -> AuthKitRequest {
    AuthKitRequest(clientId: Fixture.clientId, method: .google, state: "state-1", verifier: verifier)
}

@Suite(.english) struct AuthKitTests {
    @Test func buildsAPublicPKCERequest() throws {
        let url = request().url
        let items = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!
            .queryItems!.map { ($0.name, $0.value!) })
        #expect(url.host() == "api.workos.com")
        #expect(items["client_id"] == Fixture.clientId)
        #expect(items["redirect_uri"] == "teak://auth/callback")
        #expect(items["provider"] == "GoogleOAuth")
        #expect(items["code_challenge_method"] == "S256")
        #expect(items["code_challenge"] == "7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM")
        #expect(items["client_secret"] == nil)
        let email = AuthKitRequest(clientId: Fixture.clientId, method: .emailSignUp).url.absoluteString
        #expect(email.contains("provider=authkit") && email.contains("screen_hint=sign-up"))
    }

    @Test func acceptsOnlyThisAttemptsCallback() throws {
        let attempt = request()
        #expect(try attempt.callback(from: URL(string: "teak://auth/callback?code=abc&state=state-1")!) == .code("abc"))
        #expect(try attempt.callback(from: URL(string: "teak://auth/callback?error=access_denied")!) == .cancelled)
        #expect(throws: TeakError.self) { try attempt.callback(from: URL(string: "teak://auth/callback?code=abc&state=other")!) }
        #expect(throws: TeakError.self) { try attempt.callback(from: URL(string: "teak://auth/callback?error=server_error")!) }
        #expect(throws: TeakError.self) { try attempt.callback(from: URL(string: "evil://auth/callback?code=abc&state=state-1")!) }
    }

    @Test func onlyApplesSignInSharesBrowserCookies() {
        #expect(!SignInMethod.apple.prefersEphemeralSession)
        #expect(SignInMethod.google.prefersEphemeralSession)
        #expect(SignInMethod.emailSignIn.prefersEphemeralSession)
    }
}

@Suite(.english) struct SessionTests {
    @Test func exchangesPKCEStoresMinimalCredentialsAndRestores() async throws {
        let storage = MemoryStorage()
        let transport = ScriptedTransport { _, body in
            #expect(body["grant_type"] as? String == "authorization_code")
            #expect(body["code_verifier"] as? String == verifier)
            #expect(body["client_secret"] == nil)
            return (200, Fixture.response())
        }
        let session = makeSession(storage, transport)
        let attempt = await session.beginSignIn()
        #expect(try await session.exchangeCode("code-1", request: request(), attempt: attempt) == .signedIn)
        #expect(storage.json?["clientId"] as? String == Fixture.clientId)
        #expect(storage.json?["oauth_tokens"] == nil)
        #expect((storage.json?["user"] as? [String: Any])?["external_id"] as? String == "permanent-vault")

        let restored = makeSession(storage, transport)
        let user = try await restored.restore()
        #expect(user?.teakUserId == "permanent-vault")
        #expect(user?.name == "Praveen Juge")
    }

    @Test func aKeychainReadFailureKeepsTheCredentialForARetry() async throws {
        let storage = MemoryStorage(Fixture.stored(expiry: Date().addingTimeInterval(120)))
        storage.failReads = true
        let session = makeSession(storage, ScriptedTransport { _, _ in (500, [:]) })
        await #expect(throws: KeychainError.self) { try await session.restore() }
        storage.failReads = false
        #expect(try await session.restore() != nil)
    }

    @Test func forgetsACorruptOrForeignRecord() async throws {
        let storage = MemoryStorage(Data("{\"clientId\":\"client_OTHER\"}".utf8))
        let session = makeSession(storage, ScriptedTransport { _, _ in (500, [:]) })
        #expect(try await session.restore() == nil)
        #expect(storage.json == nil)
        #expect(await session.state == .signedOut)
    }

    @Test func concurrentRefreshesRotateOnceAndPersist() async throws {
        let storage = MemoryStorage(Fixture.stored(refresh: "old"))
        let gate = Gate()
        let transport = ScriptedTransport { _, body in
            #expect(body["refresh_token"] as? String == "old")
            await gate.wait()
            return (200, Fixture.response(refresh: "rotated"))
        }
        let session = makeSession(storage, transport)
        try await session.restore()
        async let first = session.accessToken()
        async let second = session.accessToken(forceRefresh: true)
        await gate.arrived()
        await gate.release()
        let (a, b) = try await (first, second)
        #expect(a != nil && a == b)
        #expect(transport.count == 1)
        #expect(storage.json?["refresh_token"] as? String == "rotated")
    }

    @Test func aFastDeviceClockDoesNotRefreshWithoutEnd() async throws {
        let storage = MemoryStorage(Fixture.stored(refresh: "old"))
        let transport = ScriptedTransport { _, _ in
            (200, Fixture.response(refresh: "rotated-\(UUID().uuidString)", expiry: Date().addingTimeInterval(300),
                                   issued: Date()))
        }
        let lock = FileCredentialLock(directory: Fixture.tempDirectory(), environment: "test", activity: SystemActivity())
        let session = TeakSession(storage: storage, lock: lock, transport: transport, now: { Date().addingTimeInterval(3600) })
        try await session.restore()
        let first = try await session.accessToken()
        let second = try await session.accessToken()
        #expect(first != nil && first == second)
        #expect(transport.count == 1)
        let expiresIn = try #require(await session.expiresAt).timeIntervalSince(Date().addingTimeInterval(3600))
        #expect(expiresIn > 250 && expiresIn <= 301)
    }

    @Test func anOfflineRefreshNeverReturnsAnExpiredTokenAndRetries() async throws {
        let initial = Fixture.stored(refresh: "old")
        let storage = MemoryStorage(initial)
        let transport = ScriptedTransport { _, _ in throw URLError(.notConnectedToInternet) }
        let session = makeSession(storage, transport)
        try await session.restore()
        await #expect(throws: URLError.self) { try await session.accessToken() }
        #expect(storage.json?["refresh_token"] as? String == "old")
        #expect(await session.user != nil)
        transport.respond { _, _ in (200, Fixture.response(refresh: "rotated")) }
        #expect(try await session.accessToken() != nil)
        #expect(storage.json?["refresh_token"] as? String == "rotated")
    }

    @Test(arguments: [(400, "code"), (400, "error"), (401, "code")])
    func aRevokedRefreshSignsOut(status: Int, field: String) async throws {
        let storage = MemoryStorage(Fixture.stored())
        let session = makeSession(storage, ScriptedTransport { _, _ in (status, [field: "invalid_grant"]) })
        try await session.restore()
        #expect(try await session.accessToken() == nil)
        #expect(await session.state == .signedOut)
        #expect(storage.json == nil)
    }

    @Test func aRefreshCannotSwitchTheVault() async throws {
        let storage = MemoryStorage(Fixture.stored())
        let session = makeSession(storage, ScriptedTransport { _, _ in (200, Fixture.response(vault: "other-vault")) })
        try await session.restore()
        #expect(try await session.accessToken() == nil)
        #expect(await session.state == .signedOut)
        #expect(storage.json == nil)
    }

    @Test func adoptsATokenAnotherProcessAlreadyRotated() async throws {
        let directory = Fixture.tempDirectory()
        let storage = MemoryStorage(Fixture.stored(refresh: "old"))
        let appTransport = ScriptedTransport { _, _ in (200, Fixture.response(refresh: "rotated-by-app")) }
        let extensionTransport = ScriptedTransport { _, _ in (400, ["error": "invalid_grant"]) }
        let app = makeSession(storage, appTransport, directory: directory)
        let shareExtension = makeSession(storage, extensionTransport, directory: directory)
        try await app.restore()
        try await shareExtension.restore()

        #expect(try await app.accessToken() != nil)
        let token = try await shareExtension.accessToken()
        #expect(token != nil)
        #expect(extensionTransport.count == 0, "replaying the extension's old refresh token would revoke the session")
        #expect(storage.json?["refresh_token"] as? String == "rotated-by-app")
    }

    @Test func aLateRefreshCannotRestoreASignedOutSession() async throws {
        let storage = MemoryStorage(Fixture.stored())
        let gate = Gate()
        let session = makeSession(storage, ScriptedTransport { _, _ in
            await gate.wait()
            return (200, Fixture.response(refresh: "late"))
        })
        try await session.restore()
        async let token = session.accessToken()
        await gate.arrived()
        let sessionId = await session.clear()
        #expect(sessionId == "session_ONE")
        await gate.release()
        #expect(try await token == nil)
        #expect(storage.json == nil)
        #expect(await session.state == .signedOut)
    }

    @Test func runningOutOfBackgroundTimeMidRefreshGivesBackTheLockAndKeepsTheSession() async throws {
        let directory = Fixture.tempDirectory()
        let storage = MemoryStorage(Fixture.stored(refresh: "old"))
        let activity = ScriptedActivity(watching: directory)
        let requested = Gate()
        let transport = ScriptedTransport { _, _ in
            await requested.arrive()
            try await Task.sleep(for: .seconds(60))
            return (200, Fixture.response(refresh: "too-late"))
        }
        let session = makeSession(storage, transport, directory: directory, activity: activity)
        try await session.restore()
        let refresh = Task { try await session.accessToken() }
        await requested.arrived()
        #expect(Fixture.isLocked(directory))

        await activity.expire()
        #expect(!Fixture.isLocked(directory))
        await #expect(throws: (any Error).self) { try await refresh.value }
        #expect(activity.lockedAtEnd == [false])
        #expect(storage.json?["refresh_token"] as? String == "old")
        #expect(await session.user != nil)

        transport.respond { _, _ in (200, Fixture.response(refresh: "rotated")) }
        #expect(try await session.accessToken() != nil)
        #expect(storage.json?["refresh_token"] as? String == "rotated")
    }

    @Test func aRefreshWithNoBackgroundTimeLeftNeverStarts() async throws {
        let storage = MemoryStorage(Fixture.stored(refresh: "old"))
        let transport = ScriptedTransport { _, _ in (200, Fixture.response(refresh: "rotated")) }
        let session = makeSession(storage, transport, activity: ScriptedActivity(granted: false))
        try await session.restore()
        await #expect(throws: TeakError.self) { try await session.accessToken() }
        #expect(transport.count == 0)
        #expect(storage.json?["refresh_token"] as? String == "old")
        #expect(await session.user != nil)
    }

    @Test func signingOutCancelsAPendingSignIn() async throws {
        let storage = MemoryStorage()
        let transport = ScriptedTransport { _, _ in (200, Fixture.response()) }
        let session = makeSession(storage, transport)
        let attempt = await session.beginSignIn()
        await session.clear()
        #expect(try await session.exchangeCode("code-1", request: request(), attempt: attempt) == .superseded)
        #expect(transport.count == 0)
        #expect(storage.json == nil)
    }

    @Test func aFailedBootstrapLeavesTheAppSignedOut() async throws {
        let storage = MemoryStorage()
        let session = makeSession(storage, ScriptedTransport { _, _ in (200, Fixture.response()) }) { _ in
            throw TeakError(message: TeakMessages.verifyEmail)
        }
        let attempt = await session.beginSignIn()
        await #expect(throws: TeakError(message: TeakMessages.verifyEmail)) {
            try await session.exchangeCode("code-1", request: request(), attempt: attempt)
        }
        #expect(storage.json == nil)
        #expect(await session.user == nil)
    }

    @Test func publishesEveryNewTokenToConvex() async throws {
        let storage = MemoryStorage(Fixture.stored())
        let session = makeSession(storage, ScriptedTransport { _, _ in (200, Fixture.response(refresh: "rotated")) })
        try await session.restore()
        let heard = TokenLog()
        await session.setTokenListener { token in heard.append(token) }
        let token = try await session.accessToken()
        await session.clear()
        #expect(heard.values == [token, nil])
    }
}

@Suite(.english) struct CredentialLockTests {
    @Test func runningOutOfTimeTakesTheLockFromAnOperationThatWontStop() async throws {
        let directory = Fixture.tempDirectory()
        let activity = ScriptedActivity()
        let lock = FileCredentialLock(directory: directory, environment: "test", activity: activity)
        let stuck = Gate()
        let operation = Task { try await lock.withLock { await stuck.wait() } }
        await stuck.arrived()
        #expect(Fixture.isLocked(directory))

        await activity.expire()
        #expect(!Fixture.isLocked(directory))
        await stuck.release()
        try await operation.value
    }
}

private final class TokenLog: @unchecked Sendable {
    private let lock = NSLock()
    private var _values: [String?] = []
    func append(_ value: String?) { lock.withLock { _values.append(value) } }
    var values: [String?] { lock.withLock { _values } }
}

@Suite(.english) struct BootstrapTests {
    @Test func opensTheVaultWithOneCall() async throws {
        let transport = ScriptedTransport { request, body in
            #expect(request.url?.path() == "/api/mutation")
            #expect(body["path"] as? String == "workosBootstrap:ensureUser")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token")
            return (200, ["status": "success", "value": ["status": "ok", "teakUserId": "v"]])
        }
        try await UserBootstrap(convexURL: URL(string: "https://x.convex.cloud")!, transport: transport)
            .ensureUser(accessToken: "token")
        #expect(transport.count == 1)
    }

    // The messages are closures: arguments are evaluated before `.english` applies.
    @Test(arguments: [("verify_email", { @Sendable in TeakMessages.verifyEmail }),
                      ("frozen", { @Sendable in TeakMessages.signupsPaused }),
                      ("quarantined", { @Sendable in TeakMessages.vaultUnavailable })])
    func explainsWhyAVaultWontOpen(status: String, message: @Sendable () -> String) async throws {
        let transport = ScriptedTransport { _, _ in (200, ["status": "success", "value": ["status": status, "reason": "x"]]) }
        await #expect(throws: TeakError(message: message())) {
            try await UserBootstrap(convexURL: URL(string: "https://x.convex.cloud")!, transport: transport)
                .ensureUser(accessToken: "token")
        }
        #expect(transport.count == 1)
    }
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func next() -> Int { lock.withLock { defer { value += 1 }; return value } }
}

@Suite(.english) struct ServicesTests {
    @Test func aSignedOutSessionFailsBeforeAnyRequest() async throws {
        let transport = ScriptedTransport { _, _ in
            Issue.record("a signed-out session made a request")
            return (500, [String: Any]())
        }
        let session = makeSession(MemoryStorage(), transport)
        let config = TeakConfig(convexURL: URL(string: "https://convex.invalid")!, webURL: URL(string: "https://web.invalid")!,
                                appGroup: "group.test", keychainAccessGroup: nil, posthogToken: nil, environment: "test")
        let http = TeakServices.http(config: config, session: session)
        await #expect(throws: TeakError.signedOut) {
            let _: ConvexVoid = try await http.query("cards:get")
        }
    }

    @Test func aServerCursorErrorIsTypedSoPagingCanRestart() {
        #expect(TeakError.server(message: "Uncaught Error: InvalidCursor: stale cursor").isInvalidCursor)
        #expect(!TeakError.server(message: "Uncaught Error: Something else").isInvalidCursor)
    }
}
