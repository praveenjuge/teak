import Foundation

private final class RefusingSafariCredentials: SafariCredentialStorage, @unchecked Sendable {
    let underlying: MemoryCredentials
    let refuseClear: Bool
    init(_ underlying: MemoryCredentials, refuseClear: Bool = false) {
        self.underlying = underlying
        self.refuseClear = refuseClear
    }
    func load() throws -> SafariOAuthTokens? { try underlying.load() }
    func clear() throws {
        if refuseClear { throw SafariServiceError.message("Test storage clear unavailable") }
        try underlying.clear()
    }
    func save(_ tokens: SafariOAuthTokens) throws { throw SafariServiceError.message("Test storage unavailable") }
}

// Failure boundaries: wrong provider/client/resource, missing or rejected identity,
// stale browser callbacks after logout/expiry/provider changes, rotated credentials
// lost on metadata failure, unsafe endpoints receiving secrets, failed revocation
// clearing credentials, and concurrent app/extension refresh replaying one token.
extension SafariOAuthTests {
    static func discoveryReset(_ primary: String = "betterauth") {
        SafariDiscoveryFixtures.primary = primary
        SafariDiscoveryFixtures.invalidEndpoint = nil
        SafariDiscoveryFixtures.unavailable = false
        MockHTTP.hold = nil
        MockHTTP.responseHeaders = ["Content-Type": "application/json"]
    }

    static func discoveryForm(_ request: URLRequest) throws -> [String: String] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                data.append(buffer, count: count)
            }
        }
        let raw = String(data: data, encoding: .utf8) ?? ""
        let items = URLComponents(string: "https://form.invalid/?\(raw)")?.queryItems ?? []
        return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    }

    static func discoveryDisconnectProof(_ request: URLRequest) throws -> String {
        try check(request.url?.path == "/v1/oauth/disconnect", "exact consent disconnect route")
        try check(try discoveryForm(request).isEmpty, "disconnect never sends a refresh secret")
        guard let header = request.value(forHTTPHeaderField: "Authorization"), header.hasPrefix("Bearer ") else {
            throw SafariServiceError.message("Missing disconnect proof")
        }
        return String(header.dropFirst(7))
    }

    static func discoveryCallback(_ pending: SafariOAuthRequest) -> URL {
        URL(string: "\(SafariOAuthRequest.callback)?code=discovery-code&state=\(pending.state)")!
    }

    static func discoveryExpire(_ store: MemoryCredentials) throws {
        guard let saved = try store.load() else { throw SafariServiceError.message("Missing test credential") }
        var expired = SafariOAuthTokens(accessToken: saved.accessToken, refreshToken: saved.refreshToken,
                                        expiresAt: Date().addingTimeInterval(-1))
        expired.binding = saved.binding
        try store.save(expired)
    }

    static func discoveryLogin(_ service: TeakSafariService) async throws {
        let pending = try await service.prepareSignIn()
        let result = await service.completeSignIn(pending, callback: discoveryCallback(pending))
        try check(result["status"] as? String == "connected", "discovered login connects")
    }

    static func discoveryModeJourney(_ primary: String) async throws {
        discoveryReset(primary)
        let store = MemoryCredentials()
        let service = fixture(store)
        var grants: [[String: String]] = []
        var identities = 0
        MockHTTP.respond = { request in
            switch request.url?.path {
            case "/api/auth/mcp/token":
                grants.append(try discoveryForm(request))
                return (200, tokenResponse)
            case "/v1/me":
                identities += 1
                try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access", "identity uses issued bearer")
                return (200, validSession)
            case "/v1/cards":
                try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access", "restarted client uses stored bearer")
                return (200, #"{"data":[]}"#)
            case "/v1/oauth/disconnect":
                try check(primary == "workos" && request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access", "WorkOS logout uses signed access proof")
                try check(try discoveryForm(request).isEmpty, "WorkOS logout never exposes refresh secret")
                return (204, "")
            case "/api/oauth/revoke":
                let form = try discoveryForm(request)
                try check(form["client_id"] == SafariDiscoveryFixtures.clientID && form["token"] == "new-refresh", "logout revokes bound refresh token")
                return (200, "{}")
            default: throw SafariServiceError.message("Unexpected journey request")
            }
        }
        let pending = try await service.prepareSignIn()
        let authorization = try pending.authorizationURL()
        let query = URLComponents(url: authorization, resolvingAgainstBaseURL: false)!.queryItems!
        try check(authorization.absoluteString.hasPrefix(SafariDiscoveryFixtures.issuer + "/authorize?"), "authorization uses discovered issuer")
        try check(query.contains { $0.name == "client_id" && $0.value == SafariDiscoveryFixtures.clientID }, "authorization uses surface client")
        try check(query.contains { $0.name == "code_challenge_method" && $0.value == "S256" }, "authorization retains PKCE")
        try check(query.contains { $0.name == "resource" && $0.value == "https://test.teak.invalid/api" } == (primary == "workos"), "authorization resource follows provider")
        let login = await service.completeSignIn(pending, callback: discoveryCallback(pending))
        try check(login["authenticated"] as? Bool == true, "identity-verified login succeeds")
        try check(grants[0]["code_verifier"] == pending.verifier && grants[0]["code"] == "discovery-code", "code exchange binds browser PKCE")
        try check(try store.load()?.binding?.ownerID == "user", "permanent owner persisted")
        try check(try store.load()?.binding?.primary == primary, "provider binding persisted")
        let restarted = fixture(store)
        _ = try await restarted.libraryGET(path: "v1/cards")
        try discoveryExpire(store)
        _ = try await restarted.libraryGET(path: "v1/cards")
        try check(grants.count == 2 && grants[1]["grant_type"] == "refresh_token", "expired restarted client refreshes")
        for grant in grants {
            try check(grant["client_id"] == SafariDiscoveryFixtures.clientID, "grant carries discovered client")
            try check((grant["resource"] == "https://test.teak.invalid/api") == (primary == "workos"), "grant resource follows provider")
        }
        let state = await restarted.authState()
        try check(state["authenticated"] as? Bool == true && identities == 2, "restart verifies identity via v1/me")
        let logout = await restarted.signOut()
        try check(logout["status"] as? String == "signed-out" && (try store.load()) == nil, "successful logout clears credential")
    }

    static func discoveryProviderFlip() async throws {
        discoveryReset()
        let store = MemoryCredentials()
        var exchanges = 0
        var revocations: [[String: String]] = []
        MockHTTP.respond = { request in
            switch request.url?.path {
            case "/api/auth/mcp/token": exchanges += 1; return (200, tokenResponse)
            case "/v1/me": return (200, validSession)
            case "/api/oauth/revoke": revocations.append(try discoveryForm(request)); return (200, "{}")
            default: throw SafariServiceError.message("Provider flip leaked bearer to API")
            }
        }
        let before = fixture(store)
        try await discoveryLogin(before)
        let pending = try await before.prepareSignIn()
        SafariDiscoveryFixtures.primary = "workos"
        let changed = fixture(store)
        try await rejectsAsync("provider flip rejects stored credential") { _ = try await changed.libraryGET(path: "v1/cards") }
        let callback = await changed.completeSignIn(pending, callback: discoveryCallback(pending))
        try check(callback["status"] as? String == "error" && exchanges == 1, "provider flip refuses old code before exchange")
        try check(try store.load()?.refreshToken == "new-refresh", "provider flip retains old credential for revocation")
        let logout = await changed.signOut()
        try check(logout["status"] as? String == "signed-out", "old provider credential remains revocable")
        try check(revocations.count == 1 && revocations[0]["client_id"] == "teak-safari", "logout uses saved old client binding")
    }

    static func discoveryCancelledAndRefused() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        let lock = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let browser = fixture(store, lock: lock)
        let otherProcess = fixture(store, lock: lock)
        var exchanges = 0
        var revoked = 0
        MockHTTP.respond = { request in
            switch request.url?.path {
            case "/api/auth/mcp/token": exchanges += 1; return (200, tokenResponse)
            case "/v1/me": return (401, "{}")
            case "/v1/oauth/disconnect": revoked += 1; return (204, "")
            default: throw SafariServiceError.message("Unexpected cancellation request")
            }
        }
        let pending = try await browser.prepareSignIn()
        _ = await otherProcess.signOut()
        let cancelled = await browser.completeSignIn(pending, callback: discoveryCallback(pending))
        try check(cancelled["status"] as? String == "error" && exchanges == 0, "cross-client logout cancels pending browser login")
        var expired = try SafariOAuthRequest(createdAt: Date().addingTimeInterval(-601))
        expired.discovery = pending.discovery
        expired.logoutEpoch = pending.logoutEpoch
        let stale = await browser.completeSignIn(expired, callback: discoveryCallback(expired))
        try check(stale["status"] as? String == "error" && exchanges == 0, "expired login never exchanges code")
        let fresh = try await browser.prepareSignIn()
        let refused = await browser.completeSignIn(fresh, callback: discoveryCallback(fresh))
        try check(refused["status"] as? String == "error" && revoked == 0, "refused identity cannot disconnect the application on other installations")
        try check(try store.load() == nil, "refused identity is never stored")
        MockHTTP.respond = { request in
            if request.url?.path == "/v1/me" { return (200, #"{"data":{"id":"user"}}"#) }
            if request.url?.path == "/v1/oauth/disconnect" { revoked += 1; return (204, "") }
            return (200, tokenResponse)
        }
        let malformed = try await browser.prepareSignIn()
        let malformedResult = await browser.completeSignIn(malformed, callback: discoveryCallback(malformed))
        try check(malformedResult["status"] as? String == "error" && revoked == 0 && (try store.load()) == nil, "missing identity email rejects without global disconnect")
    }

    static func discoveryRotationFailures() async throws {
        for failure in ["outage", "flip"] {
            discoveryReset("workos")
            let store = MemoryCredentials()
            MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
            try await discoveryLogin(fixture(store))
            try discoveryExpire(store)
            var apiRequests = 0
            MockHTTP.respond = { request in
                if request.url?.path == "/api/auth/mcp/token" {
                    if failure == "outage" { SafariDiscoveryFixtures.unavailable = true }
                    else { SafariDiscoveryFixtures.primary = "betterauth" }
                    return (200, #"{"access_token":"rotated-access","refresh_token":"rotated-refresh","expires_in":3600,"token_type":"Bearer"}"#)
                }
                apiRequests += 1
                return (200, "{}")
            }
            try await rejectsAsync("post-rotation metadata failure rejects API use") { _ = try await fixture(store).libraryGET(path: "v1/cards") }
            try check(try store.load()?.refreshToken == "rotated-refresh" && apiRequests == 0, "post-rotation failure retains rotated pair without sending bearer")
        }
    }

    static func discoveryUnsafeAndLogoutFailure() async throws {
        discoveryReset("workos")
        SafariDiscoveryFixtures.invalidEndpoint = "http://169.254.169.254/latest/meta-data"
        var transmitted = 0
        MockHTTP.respond = { _ in transmitted += 1; return (200, tokenResponse) }
        try await rejectsAsync("unsafe discovery endpoint rejected") { _ = try await fixture(MemoryCredentials()).prepareSignIn() }
        try check(transmitted == 0, "unsafe endpoint receives no grant")
        discoveryReset("workos")
        let store = MemoryCredentials()
        MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
        try await discoveryLogin(fixture(store))
        MockHTTP.respond = { _ in (200, #"{"data":{"id":"other-owner","email":"other@example.com"}}"#) }
        let mismatched = await fixture(store).authState()
        try check(mismatched["status"] as? String == "error" && (try store.load()?.binding?.ownerID) == "user", "identity mismatch rejects account without rewriting permanent owner")
        MockHTTP.respond = { _ in (503, "{}") }
        let failed = await fixture(store).signOut()
        try check(failed["status"] as? String == "error" && (try store.load()?.refreshToken) == "new-refresh", "failed revocation retains credential")
        SafariDiscoveryFixtures.unavailable = true
        transmitted = 0
        MockHTTP.respond = { _ in transmitted += 1; return (200, "{}") }
        let unavailable = await fixture(store).signOut()
        try check(unavailable["status"] as? String == "error" && transmitted == 0 && (try store.load()) != nil, "metadata outage preserves credential without revocation fallback")
    }

    static func discoveryConcurrentRefresh() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
        try await discoveryLogin(fixture(store))
        try discoveryExpire(store)
        let lock = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let app = fixture(store, lock: lock)
        let safari = fixture(store, lock: lock)
        var refreshes = 0
        MockHTTP.respond = { request in
            if request.url?.path == "/api/auth/mcp/token" {
                refreshes += 1
                try check(try discoveryForm(request)["refresh_token"] == "new-refresh", "rotation spends current refresh token")
                return (200, #"{"access_token":"concurrent-access","refresh_token":"concurrent-refresh","expires_in":3600,"token_type":"Bearer"}"#)
            }
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer concurrent-access", "both clients use rotated bearer")
            return (200, "{}")
        }
        async let first = app.libraryGET(path: "v1/cards")
        async let second = safari.libraryGET(path: "v1/cards")
        _ = try await (first, second)
        try check(refreshes == 1 && (try store.load()?.refreshToken) == "concurrent-refresh", "app and extension serialize rotating refresh")
    }

    static func discoveryProductionTransport() async throws {
        discoveryReset("workos")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        let store = MemoryCredentials()
        let service = TeakSafariService(session: URLSession(configuration: configuration), credentials: store,
            apiURL: URL(string: "https://uncommon-ladybug-882.convex.site")!,
            trustedOrigins: ["https://teakvault.com", "https://uncommon-ladybug-882.convex.site", "https://test.teak.invalid", "https://auth.teak.invalid"],
            lockURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        var deploymentDocuments = 0
        var discoveryHosts: [String] = []
        MockHTTP.hold = { protocolRequest in
            let request = protocolRequest.request
            guard request.url?.path.contains(".well-known") == true else { return false }
            if request.url?.path == "/.well-known/oauth-protected-resource/mcp" {
                discoveryHosts.append(request.url?.host ?? "")
                deploymentDocuments += 1
                protocolRequest.complete(status: 200, body: #"{"resource":"https://teakvault.com/mcp","authorization_servers":["https://auth.teak.invalid/workos"]}"#)
                return true
            }
            if request.url?.path == "/.well-known/teak-oauth-clients.json" {
                discoveryHosts.append(request.url?.host ?? "")
                deploymentDocuments += 1
            }
            return false
        }
        MockHTTP.respond = { request in
            if request.url?.path == "/api/auth/mcp/token" {
                try check(try discoveryForm(request)["resource"] == "https://teakvault.com/api", "production token targets public API audience")
                return (200, tokenResponse)
            }
            try check(request.url?.host == "uncommon-ladybug-882.convex.site" && request.url?.path == "/v1/me", "production identity uses canonical Convex transport")
            return (200, validSession)
        }
        do { try await discoveryLogin(service) }
        catch {
            try check(discoveryHosts.allSatisfy { $0 == "teakvault.com" }, "production resource discovery uses public origin")
            throw error
        }
        try check(discoveryHosts.allSatisfy { $0 == "teakvault.com" }, "production resource discovery uses public origin")
        try check(deploymentDocuments >= 2, "production login fetches public deployment metadata")
        try check(try store.load()?.binding?.apiOrigin == "https://uncommon-ladybug-882.convex.site", "credential retains transport binding independently of public resource")
        MockHTTP.hold = nil
    }

    static func discoveryCancelledExchange() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        let service = fixture(store)
        let pending = try await service.prepareSignIn()
        var held: MockHTTP?
        var completion: Task<[String: Any], Never>?
        var revoked = 0
        MockHTTP.respond = { request in
            if request.url?.path == "/v1/oauth/disconnect" {
                revoked += 1
                try check(try discoveryDisconnectProof(request) == "new-access", "cancelled exchange revokes newly issued grant")
                return (204, "")
            }
            return (200, validSession)
        }
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { protocolRequest in
                guard protocolRequest.request.url?.path == "/api/auth/mcp/token", held == nil else { return false }
                held = protocolRequest
                started.resume()
                return true
            }
            completion = Task { await service.completeSignIn(pending, callback: discoveryCallback(pending)) }
        }
        pending.cancellation.cancel()
        MockHTTP.hold = nil
        held!.complete(status: 200, body: tokenResponse)
        let result = await completion!.value
        try check(result["status"] as? String == "error" && revoked == 0, "cancellation discards local tokens without global disconnect")
        try check(try store.load() == nil, "cancelled exchange never commits credentials")
    }

    static func discoveryReplacementCommit() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
        let service = fixture(store)
        try await discoveryLogin(service)
        let pending = try await service.prepareSignIn()
        var revoked: [String] = []
        var applicationRevoked = false
        MockHTTP.respond = { request in
            if request.url?.path == "/api/auth/mcp/token" {
                return (200, #"{"access_token":"replacement-access","refresh_token":"replacement-refresh","expires_in":3600,"token_type":"Bearer"}"#)
            }
            if request.url?.path == "/v1/oauth/disconnect" {
                revoked.append(try discoveryDisconnectProof(request))
                applicationRevoked = true
                return (204, "")
            }
            if applicationRevoked { return (401, "{}") }
            if request.url?.path == "/v1/cards" { return (200, #"{"data":[]}"#) }
            return (200, validSession)
        }
        let committed = await service.completeSignIn(pending, callback: discoveryCallback(pending))
        try check(committed["status"] as? String == "connected" && (try store.load()?.refreshToken) == "replacement-refresh", "verified same-owner replacement commits")
        let state = await service.authState()
        try check(state["authenticated"] as? Bool == true && revoked.isEmpty, "replacement bearer remains usable without global disconnect")
        let logout = await service.signOut()
        try check(logout["status"] as? String == "signed-out" && (try store.load()) == nil, "explicit logout clears committed replacement")
        try check(revoked == ["replacement-access"], "explicit logout owns application-wide disconnect")
    }

    static func discoveryReplacementStorageFailure() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
        try await discoveryLogin(fixture(store))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        let service = TeakSafariService(session: URLSession(configuration: configuration),
            credentials: RefusingSafariCredentials(store), apiURL: SafariDiscoveryFixtures.api,
            trustedOrigins: ["https://test.teak.invalid", "https://auth.teak.invalid"],
            lockURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        var revoked: [String] = []
        MockHTTP.respond = { request in
            if request.url?.path == "/api/auth/mcp/token" {
                return (200, #"{"access_token":"replacement-access","refresh_token":"replacement-refresh","expires_in":3600,"token_type":"Bearer"}"#)
            }
            if request.url?.path == "/v1/oauth/disconnect" {
                revoked.append(try discoveryDisconnectProof(request))
                return (204, "")
            }
            return (200, validSession)
        }
        let pending = try await service.prepareSignIn()
        let result = await service.completeSignIn(pending, callback: discoveryCallback(pending))
        try check(result["status"] as? String == "error" && (try store.load()?.refreshToken) == "new-refresh", "failed replacement storage preserves previous credential")
        try check(revoked.isEmpty, "failed replacement never disconnects existing application grants")
    }

    static func discoveryFixedAuthorizationQuery() async throws {
        for mode in ["betterauth", "workos"] {
            discoveryReset(mode)
            var pending = try await fixture(MemoryCredentials()).prepareSignIn()
            let auth = pending.discovery!
            pending.discovery = SafariAuthDiscovery(primary: auth.primary, issuer: auth.issuer,
                authorizationEndpoint: URL(string: auth.authorizationEndpoint.absoluteString + "?organization=org_one&prompt=login&state=stale&state=duplicate&client_id=wrong&resource=wrong&code_challenge=wrong&scope=wrong")!,
                tokenEndpoint: auth.tokenEndpoint, revocationEndpoint: auth.revocationEndpoint,
                safariClientID: auth.safariClientID, resource: auth.resource)
            let items = URLComponents(url: try pending.authorizationURL(), resolvingAgainstBaseURL: false)!.queryItems!
            try check(items.contains { $0.name == "organization" && $0.value == "org_one" }
                && items.contains { $0.name == "prompt" && $0.value == "login" }, "authorization preserves provider fixed query")
            for name in ["state", "client_id", "code_challenge", "scope"] {
                try check(items.filter { $0.name == name }.count == 1, "authorization replaces reserved OAuth query without duplicates")
            }
            try check(items.first { $0.name == "state" }?.value == pending.state, "authorization replaces stale state")
            try check(items.filter { $0.name == "resource" }.count == (mode == "workos" ? 1 : 0), "authorization replaces or removes stale resource")
        }
    }

    static func discoveryExactFixtureRoutes() throws {
        discoveryReset()
        for path in ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/workos", "/wrong/.well-known/metadata"] {
            let response = try SafariDiscoveryFixtures.metadata(URLRequest(url: SafariDiscoveryFixtures.api.appendingPathComponent(path)))
            try check(response == nil, "fixture refuses unexpected metadata route")
        }
        let expected = try SafariDiscoveryFixtures.metadata(URLRequest(url: URL(string: "https://auth.teak.invalid/.well-known/oauth-authorization-server/betterauth")!))
        try check(expected?.0 == 200, "fixture accepts exact RFC8414 issuer suffix")
    }

    static func discoveryRevokedClearFailure() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
        try await discoveryLogin(fixture(store))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        let service = TeakSafariService(session: URLSession(configuration: configuration), credentials: RefusingSafariCredentials(store, refuseClear: true),
            apiURL: SafariDiscoveryFixtures.api, trustedOrigins: ["https://test.teak.invalid", "https://auth.teak.invalid"],
            lockURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        var revocations = 0
        MockHTTP.respond = { request in
            if request.url?.path == "/v1/oauth/disconnect" { revocations += 1; return (204, "") }
            return request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse)
        }
        let pending = try await service.prepareSignIn()
        let result = await service.completeSignIn(pending, callback: discoveryCallback(pending))
        try check(revocations == 0 && (try store.load()) != nil, "replacement storage failure preserves existing grants")
        try check(result["status"] as? String == "error", "replacement storage failure reports an error")
    }

    static func discoveryLogoutDuringCallback() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        let lock = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let service = fixture(store, lock: lock)
        let other = fixture(store, lock: lock)
        let pending = try await service.prepareSignIn()
        var held: MockHTTP?
        var callback: Task<[String: Any], Never>?
        MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (204, "") }
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { protocolRequest in
                guard protocolRequest.request.url?.path == "/api/auth/mcp/token", held == nil else { return false }
                held = protocolRequest
                started.resume()
                return true
            }
            callback = Task { await service.completeSignIn(pending, callback: discoveryCallback(pending)) }
        }
        let logout = Task { await other.signOut() }
        let epoch = lock.appendingPathExtension("epoch")
        let deadline = Date().addingTimeInterval(1)
        while !FileManager.default.fileExists(atPath: epoch.path), Date() < deadline {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        let advancedBeforeRelease = FileManager.default.fileExists(atPath: epoch.path)
        MockHTTP.hold = nil
        held!.complete(status: 200, body: tokenResponse)
        let completed = await callback!.value
        let signedOut = await logout.value
        try check(advancedBeforeRelease, "cross-service logout advances epoch before callback releases credential lock")
        try check(completed["status"] as? String == "error" && signedOut["authenticated"] as? Bool == false && (try store.load()) == nil, "logout during callback prevents credential commit")
    }

    static func discoveryUntrustedDestinations() async throws {
        for field in ["issuer", "authorization_endpoint", "token_endpoint", "revocation_endpoint"] {
            discoveryReset("workos")
            var leakedRequests = 0
            MockHTTP.hold = { intercepted in
                let request = intercepted.request
                if request.url?.host == "other-tenant.authkit.app" { leakedRequests += 1 }
                guard let path = request.url?.path, path.contains(".well-known") else { return false }
                do {
                    guard let response = try SafariDiscoveryFixtures.metadata(request),
                          var document = try JSONSerialization.jsonObject(with: Data(response.1.utf8)) as? [String: Any] else { return false }
                    if field == "issuer" {
                        if document["authorization_servers"] != nil { document["authorization_servers"] = ["https://other-tenant.authkit.app"] }
                        if document["issuer"] != nil { document["issuer"] = "https://other-tenant.authkit.app" }
                    } else if path == "/.well-known/oauth-authorization-server/workos" {
                        document[field] = "https://other-tenant.authkit.app/endpoint"
                    }
                    intercepted.complete(status: 200, body: String(data: try JSONSerialization.data(withJSONObject: document), encoding: .utf8)!)
                } catch { intercepted.client?.urlProtocol(intercepted, didFailWithError: error) }
                return true
            }
            MockHTTP.respond = { _ in leakedRequests += 1; return (500, "{}") }
            try await rejectsAsync("unpinned issuer or endpoint rejects discovery") { _ = try await fixture(MemoryCredentials()).prepareSignIn() }
            try check(leakedRequests == 0, "unpinned public-looking tenant receives no metadata or credential request")
        }
        discoveryReset()
    }

    static func discoveryDeploymentPins() throws {
        let prod = try SafariAuthDiscovery.trustedOrigins(apiURL: URL(string: "https://teakvault.com")!)
        _ = try SafariAuthDiscovery.validateTrustedURL("https://auth.teakvault.com/oauth/token", trustedOrigins: prod)
        try rejects("production pins reject other WorkOS tenants") {
            _ = try SafariAuthDiscovery.validateTrustedURL("https://other-tenant.authkit.app/oauth/token", trustedOrigins: prod)
        }
        let devURL = URL(string: "https://reminiscent-kangaroo-59.convex.site")!
        let dev = try SafariAuthDiscovery.trustedOrigins(apiURL: devURL)
        let devIssuer = "https://optimistic-metaphor-12-reminiscent-kangaroo-59.authkit.app/oauth/token"
        #if DEBUG
        _ = try SafariAuthDiscovery.validateTrustedURL(devIssuer, trustedOrigins: dev)
        let localhost = URL(string: "http://localhost:3000")!
        let local = try SafariAuthDiscovery.trustedOrigins(apiURL: devURL, localIssuer: localhost)
        _ = try SafariAuthDiscovery.validateTrustedURL("http://localhost:3000/token", trustedOrigins: local,
            allowedLoopbackOrigins: SafariAuthDiscovery.loopbackOrigins(apiURL: devURL, localIssuer: localhost))
        #else
        try rejects("release excludes development WorkOS tenant") { _ = try SafariAuthDiscovery.validateTrustedURL(devIssuer, trustedOrigins: dev) }
        try rejects("release excludes configured local issuer") { _ = try SafariAuthDiscovery.trustedOrigins(apiURL: devURL, localIssuer: URL(string: "http://localhost:3000")!) }
        #endif
        try rejects("development pins reject other WorkOS tenants") { _ = try SafariAuthDiscovery.validateTrustedURL("https://other-tenant.authkit.app/token", trustedOrigins: dev) }
        for suffix in ["internal", "lan", "local", "home", "corp", "intranet", "private", "home.arpa", "onion"] {
            let origin = "https://auth.\(suffix)"
            try rejects("private suffix remains rejected despite explicit pin") {
                _ = try SafariAuthDiscovery.validateTrustedURL(origin + "/token", trustedOrigins: [origin])
            }
        }
    }

    static func discoveryUnauthorizedDuringMetadataOutage() async throws {
        discoveryReset("workos")
        let store = MemoryCredentials()
        MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
        try await discoveryLogin(fixture(store))
        MockHTTP.respond = { _ in
            SafariDiscoveryFixtures.unavailable = true
            return (401, "{}")
        }
        let state = await fixture(store).authState()
        try check(state["authenticated"] as? Bool == false, "identity 401 stays unauthenticated when cleanup metadata fails")
        try check(try store.load()?.refreshToken == "new-refresh", "metadata outage retains rejected credential for safe cleanup retry")
        discoveryReset()
    }

    static func discoveryMissingSharedStorage() async throws {
        discoveryReset()
        let store = MemoryCredentials(tokens())
        let service = TeakSafariService(credentials: store,
            apiURL: SafariDiscoveryFixtures.api, lockURL: nil)
        let result = await service.signOut()
        try check(result["status"] as? String == "error", "missing shared storage prevents logout")
        try check(result["authenticated"] as? Bool == true && (try store.load()) != nil,
                  "storage failure retains stored authentication and retry")
    }

    static func discoveryExpiredDisconnect() async throws {
        for status in [204, 401, 503, 200] {
            discoveryReset("workos")
            let store = MemoryCredentials()
            MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
            try await discoveryLogin(fixture(store))
            try discoveryExpire(store)
            SafariDiscoveryFixtures.primary = "betterauth"
            var disconnects = 0
            MockHTTP.respond = { request in
                try check(try discoveryDisconnectProof(request) == "new-access", "expired historical JWT is revocation proof")
                disconnects += 1
                return (status, "")
            }
            let result = await fixture(store).signOut()
            try check(disconnects == 1, "logout sends only one disconnect, no token refresh")
            try check((result["status"] as? String == "signed-out") == (status == 204), "only exact204 confirms disconnect")
            try check((try store.load() == nil) == (status == 204), "unconfirmed disconnect retains stored credentials")
        }
    }

    static func discoveryFreshDisconnect() async throws {
        for status in [204, 503] {
            discoveryReset("workos")
            let store = MemoryCredentials()
            MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
            try await discoveryLogin(fixture(store))
            try discoveryExpire(store)
            var disconnects = 0
            var refreshes = 0
            MockHTTP.respond = { request in
                if request.url?.path == "/api/auth/mcp/token" {
                    refreshes += 1
                    let form = try discoveryForm(request)
                    try check(form["grant_type"] == "refresh_token" && form["refresh_token"] == "new-refresh", "logout refresh spends stored token")
                    try check(form["client_id"] == "client-safari" && form["resource"] == "https://test.teak.invalid/api", "logout refresh preserves client and resource namespace")
                    return (200, #"{"access_token":"logout-access","refresh_token":"logout-refresh","expires_in":300,"token_type":"Bearer"}"#)
                }
                let proof = try discoveryDisconnectProof(request)
                disconnects += 1
                if proof == "new-access" { return (401, "") }
                try check(proof == "logout-access", "logout retries using fresh signed proof")
                return (status, "")
            }
            let result = await fixture(store).signOut()
            try check(disconnects == 2 && refreshes == 1, "expired first logout refreshes and retries exactly once")
            try check((result["status"] as? String == "signed-out") == (status == 204), "fresh disconnect still requires exact204")
            if status == 204 { try check(try store.load() == nil, "confirmed disconnect clears rotation") }
            else { try check(try store.load()?.refreshToken == "logout-refresh", "unconfirmed disconnect retains rotated credential") }
        }
    }

    static func discoveryDeadDisconnect() async throws {
        for (status, body, clear) in [(400, #"{"error":"invalid_grant"}"#, true),
                                      (401, #"{"error":"invalid_refresh_token"}"#, true),
                                      (401, #"{"error":"invalid_client"}"#, false),
                                      (401, "", false), (400, "not-json", false),
                                      (503, #"{"error":"invalid_grant"}"#, false), (0, "network", false)] {
            discoveryReset("workos")
            let store = MemoryCredentials()
            MockHTTP.respond = { request in request.url?.path == "/v1/me" ? (200, validSession) : (200, tokenResponse) }
            try await discoveryLogin(fixture(store))
            try discoveryExpire(store)
            var disconnects = 0
            MockHTTP.respond = { request in
                if request.url?.path == "/api/auth/mcp/token" {
                    if status == 0 { throw SafariServiceError.message("Network failed") }
                    return (status, body)
                }
                _ = try discoveryDisconnectProof(request)
                disconnects += 1
                return (401, "")
            }
            let result = await fixture(store).signOut()
            try check((try store.load() == nil) == clear, "only proven rejected refresh clears local credentials")
            try check((result["status"] as? String == "signed-out") == clear, "local signout is available after invalid grant")
            try check(disconnects == 1, "local forget never claims a new remote disconnect")
            if clear { try check((result["message"] as? String)?.contains("other installations") == true, "local signout explains other installations remain") }
        }
    }

    static func discoveryJourneys() async throws {
        defer { discoveryReset() }
        try await discoveryModeJourney("betterauth")
        try await discoveryModeJourney("workos")
        try await discoveryExpiredDisconnect()
        try await discoveryFreshDisconnect()
        try await discoveryDeadDisconnect()
        try await discoveryProviderFlip()
        try await discoveryCancelledAndRefused()
        try await discoveryRotationFailures()
        try await discoveryUnsafeAndLogoutFailure()
        try await discoveryConcurrentRefresh()
        try await discoveryProductionTransport()
        try await discoveryCancelledExchange()
        try await discoveryReplacementCommit()
        try await discoveryReplacementStorageFailure()
        try await discoveryFixedAuthorizationQuery()
        try discoveryExactFixtureRoutes()
        try await discoveryRevokedClearFailure()
        try await discoveryLogoutDuringCallback()
        try await discoveryUntrustedDestinations()
        try discoveryDeploymentPins()
        try await discoveryUnauthorizedDuringMetadataOutage()
        try await discoveryMissingSharedStorage()
        print("PASS: Safari discovery login, restart, resource grants, provider flip, cancellation, identity cleanup, rotation recovery, safe logout, concurrent refresh")
    }
}
