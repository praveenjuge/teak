import Darwin
import Foundation

actor TeakSafariService {
    static let shared = TeakSafariService()
    #if DEBUG
    static let appBaseURL = URL(string: "http://app.teak.localhost:1355")!
    private static let siteURL = URL(string: "https://reminiscent-kangaroo-59.convex.site")!
    #else
    static let appBaseURL = URL(string: "https://app.teakvault.com")!
    private static let siteURL = URL(string: "https://uncommon-ladybug-882.convex.site")!
    #endif

    private let session: URLSession
    private let credentials: any SafariCredentialStorage
    private let apiURL: URL
    private let lockURL: URL?

    init(session: URLSession = URLSession(configuration: .ephemeral),
         credentials: any SafariCredentialStorage = SafariCredentialStore(),
         apiURL: URL = TeakSafariService.siteURL,
         lockURL: URL? = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SafariCredentialStore.group)?.appendingPathComponent("oauth-credentials.lock")) {
        self.session = session
        self.credentials = credentials
        self.apiURL = apiURL
        self.lockURL = lockURL
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
                return ["authenticated": false, "message": "Connect Teak Safari to save pages."]
            }
            // The shared lock guards refresh-token rotation inside accessToken();
            // the session verification request runs outside it so a slow network
            // cannot starve the other process past its lock wait budget.
            let token = try await self.accessToken()
            var request = URLRequest(url: self.apiURL.appendingPathComponent("api/auth/mcp/get-session"))
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await self.send(request)
            guard response.statusCode == 200 || response.statusCode == 401 else {
                throw SafariServiceError.message("Unable to verify your Teak connection. Please try again.")
            }
            let body = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
            if response.statusCode == 401 || body is NSNull {
                try await withCredentials { try self.credentials.clear() }
                throw SafariServiceError.unauthenticated
            }
            guard let account = body as? [String: Any], account["userId"] is String,
                  account["clientId"] as? String == SafariOAuthRequest.clientID else {
                throw SafariServiceError.message("Teak returned an invalid connection response.")
            }
            return ["authenticated": true]
        } catch SafariServiceError.unauthenticated {
            return ["authenticated": false]
        } catch {
            return errorResponse(error)
        }
    }

    func completeSignIn(_ pending: SafariOAuthRequest, callback: URL) async -> [String: Any] {
        do {
            let code = try pending.authorizationCode(from: callback)
            return try await withCredentials {
                let tokens = try await self.exchange([
                    "grant_type": "authorization_code", "code": code,
                    "code_verifier": pending.verifier, "redirect_uri": SafariOAuthRequest.callback,
                ])
                try self.credentials.save(tokens)
                return ["authenticated": true, "status": "connected"]
            }
        } catch { return errorResponse(error) }
    }

    func signOut() async -> [String: Any] {
        do {
            return try await withCredentials {
                if let tokens = try self.credentials.load() {
                    // Keep the credential on transient failures so sign-out can
                    // be retried and we do not strand an active connection.
                    var request = URLRequest(url: self.apiURL.appendingPathComponent("api/oauth/revoke"))
                    request.httpMethod = "POST"
                    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                    request.httpBody = SafariOAuthRequest.formBody([
                        "client_id": SafariOAuthRequest.clientID, "token": tokens.refreshToken,
                        "token_type_hint": "refresh_token",
                    ])
                    let (_, response) = try await self.send(request)
                    guard response.statusCode == 200 else {
                        throw SafariServiceError.message("Could not disconnect Teak. Please try again.")
                    }
                }
                try self.credentials.clear()
                return ["status": "signed-out", "authenticated": false]
            }
        } catch { return errorResponse(error) }
    }

    func saveCurrentPage(url rawURL: String?) async -> [String: Any] {
        guard let rawURL, let pageURL = URL(string: rawURL),
              ["http", "https"].contains(pageURL.scheme?.lowercased()), pageURL.host != nil else {
            return ["status": "invalid-url", "message": "This page cannot be saved to Teak."]
        }
        do {
            // Only the token read/refresh holds the shared lock (inside
            // accessToken()); the duplicate lookup and card creation run outside
            // it so a slow save cannot starve the other process past its lock
            // wait budget. The Idempotency-Key keeps a retried create safe.
            let token = try await self.accessToken()
            var lookup = URLComponents(url: self.apiURL.appendingPathComponent("v1/cards/duplicate"), resolvingAgainstBaseURL: false)!
            lookup.queryItems = [URLQueryItem(name: "url", value: pageURL.absoluteString)]
            let duplicate = try await self.apiRequest(URLRequest(url: lookup.url!), token: token)
            if duplicate["cardId"] is String { return ["status": "duplicate"] }
            var request = URLRequest(url: self.apiURL.appendingPathComponent("v1/cards"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["url": pageURL.absoluteString])
            let result = try await self.apiRequest(request, token: token)
            guard let cardID = result["cardId"] as? String else {
                throw SafariServiceError.message("Teak returned an invalid save response.")
            }
            return ["status": "saved", "cardId": cardID]
        } catch SafariServiceError.unauthenticated {
            return ["status": "unauthenticated", "message": "Sign in to Teak to save pages."]
        } catch { return errorResponse(error) }
    }

    private func accessToken() async throws -> String {
        try await withCredentials {
            guard let tokens = try credentials.load() else { throw SafariServiceError.unauthenticated }
            if tokens.expiresAt.timeIntervalSinceNow > 60 { return tokens.accessToken }
            do {
                let refreshed = try await exchange(["grant_type": "refresh_token", "refresh_token": tokens.refreshToken])
                try credentials.save(refreshed)
                return refreshed.accessToken
            } catch SafariServiceError.unauthenticated {
                try credentials.clear()
                throw SafariServiceError.unauthenticated
            }
        }
    }

    private func exchange(_ values: [String: String]) async throws -> SafariOAuthTokens {
        var request = URLRequest(url: apiURL.appendingPathComponent("api/auth/mcp/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = SafariOAuthRequest.formBody(values.merging(["client_id": SafariOAuthRequest.clientID]) { _, new in new })
        let (data, response) = try await send(request)
        if response.statusCode == 400 || response.statusCode == 401 {
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            if body?["error"] as? String == "invalid_grant" { throw SafariServiceError.unauthenticated }
        }
        guard response.statusCode == 200 else {
            throw SafariServiceError.message("Unable to connect to Teak. Please try again.")
        }
        return try SafariOAuthTokens.decode(data)
    }

    private func apiRequest(_ original: URLRequest, token: String) async throws -> [String: Any] {
        var request = original
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await send(request)
        if response.statusCode == 401 {
            try credentials.clear()
            throw SafariServiceError.unauthenticated
        }
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (200..<300).contains(response.statusCode), let body else {
            throw SafariServiceError.message(body?["error"] as? String ?? "Unable to save this page. Please try again.")
        }
        return body
    }

    private func send(_ original: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = original
        request.timeoutInterval = 15
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SafariServiceError.message("Unable to reach Teak.")
        }
        return (data, http)
    }

    private func errorResponse(_ error: Error) -> [String: Any] {
        ["status": "error", "authenticated": (try? credentials.load()) != nil, "message": error.localizedDescription]
    }
}
