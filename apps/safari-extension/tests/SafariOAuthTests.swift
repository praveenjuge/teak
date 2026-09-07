import Foundation

final class MemoryCredentials: SafariCredentialStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: SafariOAuthTokens?
    init(_ tokens: SafariOAuthTokens? = nil) { self.tokens = tokens }
    func load() throws -> SafariOAuthTokens? { lock.withLock { tokens } }
    func save(_ tokens: SafariOAuthTokens) throws { lock.withLock { self.tokens = tokens } }
    func clear() throws { lock.withLock { tokens = nil } }
}

final class MockHTTP: URLProtocol, @unchecked Sendable {
    static var respond: (URLRequest) throws -> (Int, String) = { _ in (500, "{}") }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.respond(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
                httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main struct SafariOAuthTests {
    static func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !condition() { throw SafariServiceError.message("TEST FAILED: \(message)") }
    }
    static func rejects(_ message: String, _ action: () throws -> Void) throws {
        do { try action() } catch { return }
        throw SafariServiceError.message("TEST FAILED: \(message)")
    }
    static let validSession = #"{"userId":"user","clientId":"teak-safari"}"#
    static let tokenResponse = #"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600,"token_type":"Bearer"}"#
    static func fixture(_ store: MemoryCredentials, lock: URL? = nil) -> TeakSafariService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        return TeakSafariService(session: URLSession(configuration: configuration), credentials: store,
            apiURL: URL(string: "https://test.teak.invalid")!,
            lockURL: lock ?? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    }
    static func tokens(expired: Bool = false) -> SafariOAuthTokens {
        SafariOAuthTokens(accessToken: "access", refreshToken: "refresh", expiresAt: Date().addingTimeInterval(expired ? -1 : 3600))
    }
    static func main() async throws {
        let pending = try SafariOAuthRequest(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: "expected")
        let authorization = URLComponents(url: pending.authorizationURL(baseURL: URL(string: "https://app.teakvault.com")!), resolvingAgainstBaseURL: false)!
        try check(authorization.queryItems?.first { $0.name == "code_challenge" }?.value == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "PKCE uses RFC 7636 S256 vector")
        try check(try pending.authorizationCode(from: URL(string: "teak-safari://oauth/callback?code=valid&state=expected")!) == "valid", "matching callback succeeds")
        for invalid in [
            "teak-safari://oauth/callback?code=valid&state=wrong",
            "teak-safari://oauth/callback?code=valid&state=expected&state=expected",
            "teak-safari://oauth/callback?code=a&code=b&state=expected",
            "teak-safari://wrong/callback?code=valid&state=expected",
            "teak-safari://user@oauth/callback?code=valid&state=expected",
            "teak-safari://oauth/callback?error=access_denied&state=expected",
        ] { try rejects("invalid callback is rejected") { _ = try pending.authorizationCode(from: URL(string: invalid)!) } }
        try rejects("expired login is rejected") {
            _ = try pending.authorizationCode(from: URL(string: "teak-safari://oauth/callback?code=valid&state=expected")!, now: Date().addingTimeInterval(601))
        }
        try check(String(data: SafariOAuthRequest.formBody(["code": "a+b&c=d"]), encoding: .utf8) == "code=a%2Bb%26c%3Dd", "form encoding preserves special characters")
        try rejects("invalid token response rejected") { _ = try SafariOAuthTokens.decode(Data(#"{"access_token":"","refresh_token":"r","expires_in":3600,"token_type":"Bearer"}"#.utf8)) }
        print("PASS: PKCE, callback validation, expiry, consent denial, and form encoding")

        let freshStore = MemoryCredentials()
        let fresh = fixture(freshStore)
        MockHTTP.respond = { _ in throw SafariServiceError.message("Unexpected network request") }
        let signedOut = await fresh.authState()
        try check(signedOut["authenticated"] as? Bool == false, "old sessions do not authenticate OAuth")
        MockHTTP.respond = { request in
            try check(request.url?.path == "/api/auth/mcp/token", "exchanges code at OAuth endpoint")
            return (200, tokenResponse)
        }
        let connected = await fresh.completeSignIn(pending, callback: URL(string: "teak-safari://oauth/callback?code=valid&state=expected")!)
        try check(connected["authenticated"] as? Bool == true, "login stores OAuth credentials")
        try check(try freshStore.load()?.refreshToken == "new-refresh", "refresh token persisted")
        MockHTTP.respond = { _ in (200, validSession) }
        let restarted = fixture(freshStore)
        let restartedState = await restarted.authState()
        try check(restartedState["authenticated"] as? Bool == true, "restart uses persisted credentials")
        print("PASS: reconnect, code exchange, credential persistence, restart")

        let store = MemoryCredentials(tokens())
        let service = fixture(store)
        var creates = 0
        MockHTTP.respond = { request in
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer access", "saves use OAuth bearer")
            if request.url?.path == "/v1/cards/duplicate" { return (200, #"{"cardId":null}"#) }
            creates += 1
            try check(request.httpMethod == "POST", "save creates a card")
            try check(request.value(forHTTPHeaderField: "Idempotency-Key") != nil, "save carries idempotency key")
            return (200, #"{"cardId":"saved-card"}"#)
        }
        let saved = await service.saveCurrentPage(url: "https://example.com/page")
        try check(saved["status"] as? String == "saved" && creates == 1, "page saved once")
        MockHTTP.respond = { request in
            try check(request.url?.path == "/v1/cards/duplicate", "duplicate never creates a card")
            return (200, #"{"cardId":"existing-card"}"#)
        }
        let duplicate = await service.saveCurrentPage(url: "https://example.com/page")
        try check(duplicate["status"] as? String == "duplicate", "existing page reports duplicate")
        let invalid = await service.saveCurrentPage(url: "file:///private/test")
        try check(invalid["status"] as? String == "invalid-url", "invalid page refused")
        print("PASS: authenticated save, duplicate feedback, invalid URLs")

        let rotating = MemoryCredentials(tokens(expired: true))
        let sharedLock = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let first = fixture(rotating, lock: sharedLock), second = fixture(rotating, lock: sharedLock)
        var refreshes = 0
        MockHTTP.respond = { request in
            if request.url?.path == "/api/auth/mcp/token" { refreshes += 1; return (200, tokenResponse) }
            return (200, validSession)
        }
        async let firstState = first.authState()
        async let secondState = second.authState()
        let states = await [firstState, secondState]
        try check(states.allSatisfy { $0["authenticated"] as? Bool == true }, "both processes receive valid auth")
        try check(refreshes == 1, "concurrent clients refresh once")
        try check(try rotating.load()?.refreshToken == "new-refresh", "rotated refresh token persisted")
        print("PASS: silent refresh and cross-client refresh serialization")

        MockHTTP.respond = { _ in throw URLError(.notConnectedToInternet) }
        let offline = await service.authState()
        try check(offline["status"] as? String == "error", "offline is not misreported as sign-out")
        try check(try store.load() != nil, "offline preserves credentials")
        let offlineLogout = await service.signOut()
        try check(offlineLogout["status"] as? String == "error", "offline logout offers retry")
        try check(offlineLogout["authenticated"] as? Bool == true, "failed sign-out keeps retry available")
        try check(try store.load() != nil, "failed revocation remains retryable")
        MockHTTP.respond = { _ in (200, "null") }
        let revoked = await service.authState()
        try check(revoked["authenticated"] as? Bool == false, "remote disconnection detected")
        try check(try store.load() == nil, "revoked credentials cleared")
        print("PASS: offline recovery and remote revocation")

        let expired = MemoryCredentials(tokens(expired: true))
        MockHTTP.respond = { _ in (401, #"{"error":"invalid_grant"}"#) }
        let expiredState = await fixture(expired).authState()
        try check(expiredState["authenticated"] as? Bool == false, "invalid refresh requires reconnect")
        try check(try expired.load() == nil, "invalid refresh cleared")
        try store.save(tokens())
        MockHTTP.respond = { _ in (401, #"{"error":"Unauthorized"}"#) }
        let refused = await service.saveCurrentPage(url: "https://example.com/page")
        try check(refused["status"] as? String == "unauthenticated", "revoked access cannot save")
        try store.save(tokens())
        MockHTTP.respond = { _ in (401, "") }
        let emptyDenied = await service.authState()
        try check(emptyDenied["authenticated"] as? Bool == false, "empty 401 requires reconnect")
        try check(try store.load() == nil, "empty 401 clears credentials")
        try store.save(tokens())
        MockHTTP.respond = { _ in (200, "") }
        let emptySave = await service.saveCurrentPage(url: "https://example.com/page")
        try check(emptySave["status"] as? String == "error", "empty save response surfaces error")
        try store.save(tokens())
        MockHTTP.respond = { request in
            try check(request.url?.path == "/api/oauth/revoke", "logout calls revocation")
            return (200, "")
        }
        let logout = await service.signOut()
        try check(logout["status"] as? String == "signed-out", "logout succeeds after revocation")
        try check(try store.load() == nil, "logout clears credentials")
        print("PASS: expired refresh, revoked save, local sign-out")
    }
}
