import Darwin
import Foundation

enum SafariAccountStatus: String {
    case connected
    case signedOut = "signed-out"
    case waiting
}

nonisolated struct SafariAccountSummary: Decodable, Sendable {
    let email: String?
    let cardCount: Int
}

private final class SafariRedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor TeakSafariService {
    static let shared = TeakSafariService()
    #if DEBUG
    static let appBaseURL = URL(string: "http://localhost:3000")!
    private static let siteURL = URL(string: "https://reminiscent-kangaroo-59.convex.site")!
    #else
    static let appBaseURL = URL(string: "https://app.teakvault.com")!
    private static let siteURL = URL(string: "https://uncommon-ladybug-882.convex.site")!
    #endif

    private static var defaultLockURL: URL? {
        #if DEBUG
        let filename = "oauth-credentials-development.lock"
        #else
        let filename = "oauth-credentials.lock"
        #endif
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SafariCredentialStore.group)?.appendingPathComponent(filename)
    }

    private let session: URLSession
    private let credentials: any SafariCredentialStorage
    private let apiURL: URL
    private let discoveryURL: URL
    private let lockURL: URL?
    private let localIssuer: URL?
    private let trustedOrigins: Set<String>?
    private var authCache: (SafariAuthDiscovery, Date)?
    private let redirectGuard = SafariRedirectGuard()

    init(session: URLSession = URLSession(configuration: .ephemeral),
         credentials: any SafariCredentialStorage = SafariCredentialStore(),
         apiURL: URL = TeakSafariService.siteURL,
         discoveryURL: URL? = nil,
         localIssuer: URL? = nil,
         trustedOrigins: Set<String>? = nil,
         lockURL: URL? = TeakSafariService.defaultLockURL) {
        self.session = session
        self.credentials = credentials
        self.apiURL = apiURL
        // Production discovery belongs to the public API origin; transport
        // remains on Convex. Development advertises its own deployment origin.
        let productionAPI = URL(string: "https://uncommon-ladybug-882.convex.site")!
        self.discoveryURL = discoveryURL ?? (apiURL == productionAPI
            ? URL(string: "https://teakvault.com")! : apiURL)
        self.lockURL = lockURL
        self.trustedOrigins = trustedOrigins
        #if DEBUG
        self.localIssuer = localIssuer ?? Self.appBaseURL
        #else
        self.localIssuer = nil
        #endif
    }

    // Both the app and extension can refresh. Hold a process-shared lock across
    // read/refresh/write so rotating a refresh token can never be replayed.
    private func withCredentials<T>(_ operation: () async throws -> T) async throws -> T {
        guard let lockURL else { throw SafariServiceError.message("Unable to access Teak's shared storage.") }
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw SafariServiceError.message("Unable to access Teak's shared storage.") }
        defer { close(descriptor) }
        let deadline = Date().addingTimeInterval(35)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK, Date() < deadline else {
                throw SafariServiceError.message("Teak is busy. Please try again.")
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        defer { flock(descriptor, LOCK_UN) }
        return try await operation()
    }

    func authState() async -> [String: Any] {
        do {
            guard (try? self.credentials.load()) != nil else {
                return [
                    "authenticated": false,
                    "status": SafariAccountStatus.signedOut.rawValue,
                    "message": "Connect Teak for Mac to save pages.",
                ]
            }
            // The shared lock guards refresh-token rotation inside accessToken();
            // the session verification request runs outside it so a slow network
            // cannot starve the other process past its lock wait budget.
            let token = try await self.accessToken()
            do {
                let owner = try await self.identity(token)
                if let expected = try credentials.load()?.binding?.ownerID, expected != owner {
                    throw SafariServiceError.message("Teak returned a different account. Please reconnect.")
                }
            } catch SafariServiceError.unauthenticated {
                try? await clearIfStale(token)
                throw SafariServiceError.unauthenticated
            }
            return ["authenticated": true]
        } catch SafariServiceError.unauthenticated {
            return [
                "authenticated": false,
                "status": SafariAccountStatus.signedOut.rawValue,
            ]
        } catch {
            return errorResponse(error)
        }
    }

    func accountSummary() async throws -> SafariAccountSummary {
        let token = try await accessToken()
        var request = URLRequest(url: apiURL.appendingPathComponent("api/safari/account-summary"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await send(request)
        if response.statusCode == 401 {
            try? await clearIfStale(token)
            throw SafariServiceError.unauthenticated
        }
        guard response.statusCode == 200,
              let summary = try? JSONDecoder().decode(SafariAccountSummary.self, from: data),
              summary.cardCount >= 0 else {
            throw SafariServiceError.message("Unable to load account details. Please try again.")
        }
        return summary
    }

    private func logoutEpoch() throws -> String {
        guard let lockURL else { throw SafariServiceError.message("Unable to access Teak's shared storage.") }
        let file = lockURL.appendingPathExtension("epoch")
        guard FileManager.default.fileExists(atPath: file.path) else { return "" }
        return try String(contentsOf: file, encoding: .utf8)
    }

    func prepareSignIn() async throws -> SafariOAuthRequest {
        var pending = try SafariOAuthRequest()
        pending.logoutEpoch = try logoutEpoch()
        pending.discovery = try await discover(force: true)
        if let auth = pending.discovery, auth.primary == "workos", let saved = try credentials.load(),
           try matches(saved, auth), saved.binding?.ownerID == nil {
            throw SafariServiceError.message("Sign out before reconnecting, then wait five minutes for disconnect to finish.")
        }
        guard pending.logoutEpoch == (try logoutEpoch()) else { throw SafariServiceError.unauthenticated }
        return pending
    }

    func completeSignIn(_ pending: SafariOAuthRequest, callback: URL) async -> [String: Any] {
        do {
            let code = try pending.authorizationCode(from: callback)
            return try await withCredentials {
                let auth = try await self.discover(force: true)
                guard let prepared = pending.discovery, self.sameProvider(prepared, auth),
                      pending.logoutEpoch == (try self.logoutEpoch()) else {
                    throw SafariServiceError.message("Sign-in changed or was cancelled. Please try again.")
                }
                try pending.cancellation.whileActive {}
                var tokens = try await self.exchange([
                    "grant_type": "authorization_code", "code": code,
                    "code_verifier": pending.verifier, "redirect_uri": SafariOAuthRequest.callback,
                ], auth: auth)
                var committed = false
                var previousRevoked = false
                do {
                    let owner = try await self.identity(tokens.accessToken)
                    let latest = try await self.discover(force: true)
                    guard self.sameProvider(auth, latest), pending.logoutEpoch == (try self.logoutEpoch()) else {
                        throw SafariServiceError.unauthenticated
                    }
                    tokens.binding = try self.binding(auth, ownerID: owner)
                    try pending.cancellation.beginCommit()
                    if let previous = try self.credentials.load() {
                        let matchesProvider = try self.matches(previous, auth)
                        let sameOwner = auth.primary == "workos" && matchesProvider && previous.binding?.ownerID == owner
                        if !sameOwner {
                            guard auth.primary != "workos" || !matchesProvider || previous.binding?.ownerID != nil else {
                                throw SafariServiceError.message("Sign out before reconnecting.")
                            }
                            try await self.revoke(previous, refreshDiscovery: false)
                            previousRevoked = true
                        }
                    }
                    try pending.cancellation.whileActive {
                        try self.credentials.save(tokens)
                        committed = true
                    }
                    return ["authenticated": true, "status": SafariAccountStatus.connected.rawValue]
                } catch {
                    if !committed {
                        if previousRevoked { try? self.credentials.clear() }
                        // A failed Connect login must not disconnect other
                        // installations of this application.
                        if auth.primary != "workos" { try? await self.revoke(tokens, refreshDiscovery: false) }
                    }
                    if previousRevoked { throw SafariServiceError.unauthenticated }
                    throw error
                }
            }
        } catch {
            _ = try? await discover(force: true)
            return errorResponse(error)
        }
    }

    func signOut() async -> [String: Any] {
        do {
            guard let lockURL else { throw SafariServiceError.message("Unable to access Teak's shared storage.") }
            // Invalidate callbacks immediately, even if their network request
            // holds the credential lock longer than logout's wait budget.
            try Data(UUID().uuidString.utf8).write(to: lockURL.appendingPathExtension("epoch"), options: .atomic)
            return try await withCredentials {
                var localOnly = false
                if let tokens = try self.credentials.load() {
                    do { try await self.revoke(tokens) }
                    catch SafariServiceError.invalidRefreshCredential { localOnly = true }
                }
                try self.credentials.clear()
                var result: [String: Any] = ["status": SafariAccountStatus.signedOut.rawValue, "authenticated": false]
                if localOnly { result["localOnly"] = true; result["message"] = "Signed out on this device. To disconnect other installations, use Settings → Connected apps." }
                return result
            }
        } catch { return errorResponse(error) }
    }

    func saveCurrentPage(url rawURL: String?) async -> [String: Any] {
        guard let rawURL, let pageURL = URL(string: rawURL),
              ["http", "https"].contains(pageURL.scheme?.lowercased()), pageURL.host != nil else {
            return ["status": "invalid-url", "message": "This page cannot be saved to Teak."]
        }
        do {
            let duplicateData = try await libraryRequest(method: "GET", path: "v1/cards/duplicate",
                queryItems: [URLQueryItem(name: "url", value: pageURL.absoluteString)])
            let duplicate = try JSONSerialization.jsonObject(with: duplicateData) as? [String: Any]
            if let cardID = duplicate?["cardId"] as? String {
                return ["status": "duplicate", "cardId": cardID]
            }
            let body = try JSONSerialization.data(withJSONObject: ["url": pageURL.absoluteString])
            let data = try await libraryRequest(method: "POST", path: "v1/cards", body: body)
            let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let cardID = result?["cardId"] as? String else {
                throw SafariServiceError.message("Teak returned an invalid save response.")
            }
            return ["status": "saved", "cardId": cardID]
        } catch SafariServiceError.unauthenticated {
            return ["status": "unauthenticated", "message": "Sign in to Teak to save pages."]
        } catch { return errorResponse(error) }
    }

    /// The containing app uses the same OAuth credential and refresh lock as
    /// Safari. Only API-relative paths are accepted, so a token cannot be sent
    /// to a URL supplied by card content.
    func libraryGET(path: String, queryItems: [URLQueryItem] = []) async throws -> Data {
        try await libraryRequest(method: "GET", path: path, queryItems: queryItems)
    }

    nonisolated static func isValidCardID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 128 && id.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 95 || $0 == 45
        }
    }

    nonisolated static func libraryURL(baseURL: URL, method: String, path: String,
                                      queryItems: [URLQueryItem] = []) throws -> URL {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let cardRoute = parts.count >= 2 && parts[0] == "v1" && parts[1] == "cards"
        let validRoute = (cardRoute && parts.count == 2 && ["GET", "POST"].contains(method))
            || (cardRoute && parts.count == 3 && Self.isValidCardID(parts[2])
                && ["GET", "PATCH", "DELETE"].contains(method))
            || (cardRoute && parts.count == 4 && Self.isValidCardID(parts[2])
                && parts[3] == "favorite" && method == "PATCH")
            || (cardRoute && parts.count == 4 && Self.isValidCardID(parts[2])
                && parts[3] == "restore" && method == "POST")
            || (path == "v1/uploads" && method == "POST")
        guard validRoute else { throw SafariServiceError.message("Invalid library request.") }
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else { throw SafariServiceError.message("Invalid library request.") }
        return url
    }

    func libraryRequest(method: String, path: String, queryItems: [URLQueryItem] = [],
                        body: Data? = nil, idempotencyKey: String? = nil) async throws -> Data {
        let url = try Self.libraryURL(baseURL: apiURL, method: method, path: path, queryItems: queryItems)
        var request = URLRequest(url: url)
        request.httpMethod = method
        if method == "GET" { request.cachePolicy = .reloadIgnoringLocalCacheData }
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if method == "POST" {
            request.setValue(idempotencyKey ?? UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
        }
        return try await apiRequest(request, token: accessToken())
    }

    /// Upload requests carry only the signed URL, never the OAuth bearer.
    func uploadFile(to url: URL, from file: URL, mimeType: String, size: Int) async throws -> String? {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else {
            throw SafariServiceError.message("Invalid upload URL.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 120
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(String(size), forHTTPHeaderField: "Content-Length")
        let (data, response) = try await session.upload(for: request, fromFile: file)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw SafariServiceError.message(body?["error"] as? String ?? "Upload failed. Please try again.")
        }
        return http.value(forHTTPHeaderField: "ETag")
    }

    private func accessToken() async throws -> String {
        try await withCredentials {
            guard let tokens = try credentials.load() else { throw SafariServiceError.unauthenticated }
            let auth = try await discover()
            guard try matches(tokens, auth) else { throw SafariServiceError.unauthenticated }
            if tokens.expiresAt.timeIntervalSinceNow > 60 { return tokens.accessToken }
            do {
                let refreshed = try await exchange(["grant_type": "refresh_token", "refresh_token": tokens.refreshToken], auth: auth,
                                                   ownerID: tokens.binding?.ownerID)
                try credentials.save(refreshed)
                let latest = try await discover(force: true)
                guard sameProvider(auth, latest) else { throw SafariServiceError.unauthenticated }
                return refreshed.accessToken
            } catch {
                if case SafariServiceError.invalidRefreshCredential = error {
                    // Clear only the rejected pair; post-exchange failures must keep its rotation.
                    if try credentials.load()?.refreshToken == tokens.refreshToken { try credentials.clear() }
                    throw SafariServiceError.unauthenticated
                }
                _ = try? await discover(force: true)
                throw error
            }
        }
    }

    private func exchange(_ values: [String: String], auth: SafariAuthDiscovery, ownerID: String? = nil) async throws -> SafariOAuthTokens {
        var request = URLRequest(url: auth.tokenEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = values
        body["client_id"] = auth.safariClientID
        if auth.primary == "workos" { body["resource"] = auth.apiResource.absoluteString }
        request.httpBody = SafariOAuthRequest.formBody(body)
        let (data, response) = try await send(request)
        if response.statusCode == 400 || response.statusCode == 401 {
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            if values["grant_type"] == "refresh_token",
               body?["error"] as? String == "invalid_grant" || body?["error"] as? String == "invalid_refresh_token" || body?["code"] as? String == "invalid_refresh_token" {
                throw SafariServiceError.invalidRefreshCredential
            }
        }
        guard response.statusCode == 200 else { throw SafariServiceError.message("Unable to connect to Teak. Please try again.") }
        var tokens = try SafariOAuthTokens.decode(data)
        tokens.binding = try binding(auth, ownerID: ownerID)
        return tokens
    }

    private func sameProvider(_ a: SafariAuthDiscovery, _ b: SafariAuthDiscovery) -> Bool {
        a.primary == b.primary && a.issuer == b.issuer && a.safariClientID == b.safariClientID && a.resource == b.resource
    }

    private func binding(_ auth: SafariAuthDiscovery, ownerID: String?) throws -> SafariOAuthBinding {
        SafariOAuthBinding(apiOrigin: try SafariAuthDiscovery.origin(apiURL).absoluteString, primary: auth.primary,
                           issuer: auth.issuer, clientID: auth.safariClientID, revocationEndpoint: auth.revocationEndpoint, ownerID: ownerID)
    }

    private func matches(_ tokens: SafariOAuthTokens, _ auth: SafariAuthDiscovery) throws -> Bool {
        guard let saved = tokens.binding else { return auth.primary == "betterauth" && auth.safariClientID == SafariOAuthRequest.clientID }
        let current = try binding(auth, ownerID: saved.ownerID)
        return saved.apiOrigin == current.apiOrigin && saved.primary == current.primary && saved.issuer == current.issuer && saved.clientID == current.clientID
    }

    private func revoke(_ tokens: SafariOAuthTokens, refreshDiscovery: Bool = true) async throws {
        let auth = refreshDiscovery ? try await discover(force: true) : nil
        if let saved = tokens.binding, saved.primary == "workos" {
            guard saved.apiOrigin == (try SafariAuthDiscovery.origin(apiURL).absoluteString) else {
                throw SafariServiceError.message("Your connection belongs to another Teak environment.")
            }
            var request = URLRequest(url: apiURL.appendingPathComponent("v1/oauth/disconnect"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
            var (_, response) = try await send(request)
            // Completed receipts accept the saved proof without refreshing a
            // provider grant that has already been disconnected.
            if response.statusCode == 401, let auth, try matches(tokens, auth) {
                let renewed = try await exchange(["grant_type": "refresh_token", "refresh_token": tokens.refreshToken],
                                                 auth: auth, ownerID: saved.ownerID)
                // Callers hold the shared app/extension credential lock. Store
                // rotation before retrying so network failures cannot lose it.
                try credentials.save(renewed)
                request.setValue("Bearer \(renewed.accessToken)", forHTTPHeaderField: "Authorization")
                (_, response) = try await send(request)
            }
            guard response.statusCode == 204 else {
                throw SafariServiceError.message("Could not disconnect Teak. Please try again.")
            }
            return
        }
        let endpoint: URL?
        let clientID: String
        if let auth, try matches(tokens, auth) {
            endpoint = auth.revocationEndpoint
            clientID = auth.safariClientID
        } else {
            endpoint = tokens.binding?.revocationEndpoint
            clientID = tokens.binding?.clientID ?? SafariOAuthRequest.clientID
        }
        guard let target = endpoint ?? (tokens.binding == nil ? apiURL.appendingPathComponent("api/oauth/revoke") : nil) else {
            throw SafariServiceError.message("Revocation is unavailable. Your connection is still saved.")
        }
        let allowed = try SafariAuthDiscovery.loopbackOrigins(apiURL: apiURL, localIssuer: localIssuer)
        let url = try SafariAuthDiscovery.validateTrustedURL(target.absoluteString, trustedOrigins: trustedAuthOrigins(), allowedLoopbackOrigins: allowed)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = SafariOAuthRequest.formBody(["client_id": clientID, "token": tokens.refreshToken, "token_type_hint": "refresh_token"])
        let (_, response) = try await send(request)
        guard (200..<300).contains(response.statusCode) else { throw SafariServiceError.message("Could not disconnect Teak. Please try again.") }
    }

    private func identity(_ token: String) async throws -> String {
        var request = URLRequest(url: apiURL.appendingPathComponent("v1/me"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await send(request)
        if response.statusCode == 401 { throw SafariServiceError.unauthenticated }
        guard response.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let account = object["data"] as? [String: Any], let id = account["id"] as? String,
              Self.isValidCardID(id), let email = account["email"] as? String, !email.isEmpty else {
            throw SafariServiceError.message("Unable to verify your Teak connection. Please try again.")
        }
        return id
    }

    private func trustedAuthOrigins() throws -> Set<String> {
        try trustedOrigins ?? SafariAuthDiscovery.trustedOrigins(apiURL: discoveryURL, localIssuer: localIssuer)
    }

    private func discover(force: Bool = false) async throws -> SafariAuthDiscovery {
        if !force, let (auth, expiry) = authCache, expiry > Date() { return auth }
        let origin = try SafariAuthDiscovery.origin(discoveryURL)
        let allowed = try SafariAuthDiscovery.loopbackOrigins(apiURL: apiURL, localIssuer: localIssuer)
        _ = try SafariAuthDiscovery.validateURL(apiURL.absoluteString, allowedLoopbackOrigins: allowed)
        _ = try SafariAuthDiscovery.validateURL(discoveryURL.absoluteString, allowedLoopbackOrigins: allowed)
        do {
            let resource = try await metadata(origin.appendingPathComponent(".well-known/oauth-protected-resource/mcp"))
            let clients = try await metadata(origin.appendingPathComponent(".well-known/teak-oauth-clients.json"))
            let issuer = try SafariAuthDiscovery.issuer(resourceData: resource, clientData: clients, apiURL: discoveryURL, localIssuer: localIssuer, trustedOrigins: trustedAuthOrigins())
            let server = try await metadata(SafariAuthDiscovery.metadataURL(issuer: issuer, allowedLoopbackOrigins: allowed))
            let auth = try SafariAuthDiscovery.parse(resourceData: resource, clientData: clients, serverData: server, apiURL: discoveryURL, localIssuer: localIssuer, trustedOrigins: trustedAuthOrigins())
            authCache = (auth, Date().addingTimeInterval(60))
            return auth
        } catch { authCache = nil; throw error }
    }

    private func metadata(_ url: URL) async throws -> Data {
        let allowed = try SafariAuthDiscovery.loopbackOrigins(apiURL: apiURL, localIssuer: localIssuer)
        _ = try SafariAuthDiscovery.validateTrustedURL(url.absoluteString, trustedOrigins: trustedAuthOrigins(), allowedLoopbackOrigins: allowed)
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request, delegate: redirectGuard)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            throw SafariServiceError.message("Unable to discover Teak sign-in. Please try again.")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 64 * 1024 else { throw SafariServiceError.message("Teak sign-in metadata is too large.") }
            data.append(byte)
        }
        return data
    }

    /// Clears stored credentials only if they still match the token that just
    /// failed. Requests run outside the shared lock, so the other process can
    /// rotate and store a fresh pair while our request is in flight; an
    /// unconditional clear would wipe those valid credentials. The
    /// check-and-clear runs under the lock so it cannot interleave with a
    /// concurrent rotation.
    private func clearIfStale(_ token: String) async throws {
        try await withCredentials {
            let auth = try await discover(force: true)
            if let saved = try credentials.load(), saved.accessToken == token, try matches(saved, auth) {
                do { try credentials.clear() } catch { throw SafariServiceError.unauthenticated }
            }
        }
    }

    private func apiRequest(_ original: URLRequest, token: String) async throws -> Data {
        var request = original
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await send(request)
        if response.statusCode == 401 {
            try? await clearIfStale(token)
            throw SafariServiceError.unauthenticated
        }
        guard (200..<300).contains(response.statusCode) else {
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw SafariServiceError.message(body?["error"] as? String ?? "Unable to update your library. Please try again.")
        }
        return data
    }

    private func send(_ original: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let allowed = try SafariAuthDiscovery.loopbackOrigins(apiURL: apiURL, localIssuer: localIssuer)
        guard let url = original.url else { throw SafariServiceError.unauthenticated }
        _ = try SafariAuthDiscovery.validateTrustedURL(url.absoluteString, trustedOrigins: trustedAuthOrigins(), allowedLoopbackOrigins: allowed)
        var request = original
        request.timeoutInterval = 15
        request.httpShouldHandleCookies = false
        let (data, response) = try await session.data(for: request, delegate: redirectGuard)
        guard let http = response as? HTTPURLResponse else {
            throw SafariServiceError.message("Unable to reach Teak.")
        }
        return (data, http)
    }

    private func errorResponse(_ error: Error) -> [String: Any] {
        let rejected: Bool
        if case SafariServiceError.unauthenticated = error { rejected = true } else { rejected = false }
        return ["status": "error", "authenticated": !rejected && (try? credentials.load()) != nil,
                "message": error.localizedDescription]
    }
}
