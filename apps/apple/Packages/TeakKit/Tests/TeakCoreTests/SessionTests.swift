import Foundation
import Testing
@testable import TeakCore

// Ported from apps/mobile/__tests__/lib/workos-session.test.ts, plus the
// cross-process cases the app and its extensions add.

private func makeSession(_ storage: MemoryStorage, _ transport: ScriptedTransport, directory: URL = Fixture.tempDirectory(),
                         bootstrap: TeakSession.Bootstrap? = nil) -> TeakSession {
    TeakSession(storage: storage, lock: FileCredentialLock(directory: directory, environment: "test"),
                transport: transport, bootstrap: bootstrap)
}

private let verifier = String(repeating: "v", count: 43)
private func request() -> AuthKitRequest {
    AuthKitRequest(clientId: Fixture.clientId, method: .google, state: "state-1", verifier: verifier)
}

@Suite struct AuthKitTests {
    @Test func buildsAPublicPKCERequest() throws {
        let url = request().url
        let items = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!
            .queryItems!.map { ($0.name, $0.value!) })
        #expect(url.host() == "api.workos.com")
        #expect(items["client_id"] == Fixture.clientId)
        #expect(items["redirect_uri"] == "teak://auth/callback")
        #expect(items["provider"] == "GoogleOAuth")
        #expect(items["code_challenge_method"] == "S256")
        // openssl dgst -sha256 -binary | base64url of the verifier.
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

@Suite struct SessionTests {
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
        #expect(try await session.exchangeCode("code-1", request: request(), attempt: attempt))
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
        // The extension still holds "old"; replaying it would revoke the session.
        let token = try await shareExtension.accessToken()
        #expect(token != nil)
        #expect(extensionTransport.count == 0)
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

    @Test func signingOutCancelsAPendingSignIn() async throws {
        let storage = MemoryStorage()
        let transport = ScriptedTransport { _, _ in (200, Fixture.response()) }
        let session = makeSession(storage, transport)
        let attempt = await session.beginSignIn()
        await session.clear()
        #expect(try await session.exchangeCode("code-1", request: request(), attempt: attempt) == false)
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

private final class TokenLog: @unchecked Sendable {
    private let lock = NSLock()
    private var _values: [String?] = []
    func append(_ value: String?) { lock.withLock { _values.append(value) } }
    var values: [String?] { lock.withLock { _values } }
}

@Suite struct BootstrapTests {
    @Test func waitsForAPendingProfile() async throws {
        let calls = Counter()
        let transport = ScriptedTransport { request, body in
            #expect(request.url?.path() == "/api/mutation")
            #expect(body["path"] as? String == "workosBootstrap:ensureUser")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token")
            let call = calls.next()
            let value: [String: Any] = call < 2 ? ["status": "quarantined", "reason": "profile_pending"] : ["status": "ok", "teakUserId": "v"]
            return (200, ["status": "success", "value": value])
        }
        try await UserBootstrap(convexURL: URL(string: "https://x.convex.cloud")!, transport: transport, delay: .zero)
            .ensureUser(accessToken: "token")
        #expect(transport.count == 3)
    }

    @Test(arguments: [("verify_email", TeakMessages.verifyEmail), ("frozen", TeakMessages.signupsPaused),
                      ("quarantined", TeakMessages.vaultUnavailable)])
    func explainsWhyAVaultWontOpen(status: String, message: String) async throws {
        let transport = ScriptedTransport { _, _ in (200, ["status": "success", "value": ["status": status, "reason": "x"]]) }
        await #expect(throws: TeakError(message: message)) {
            try await UserBootstrap(convexURL: URL(string: "https://x.convex.cloud")!, transport: transport, delay: .zero)
                .ensureUser(accessToken: "token")
        }
    }
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func next() -> Int { lock.withLock { defer { value += 1 }; return value } }
}
