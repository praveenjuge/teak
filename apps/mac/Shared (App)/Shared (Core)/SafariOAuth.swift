import CryptoKit
import Foundation
import Security

nonisolated final class SafariSignInCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var committing = false

    func cancel() {
        lock.lock()
        defer { lock.unlock() }
        if !committing { cancelled = true }
    }

    // Once replacement starts revoking the old grant, finish it under the
    // process lock. Explicit sign-out then revokes the committed replacement.
    func beginCommit() throws {
        try whileActive { committing = true }
    }

    func whileActive<T>(_ operation: () throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        guard !cancelled else {
            throw SafariServiceError.message("Sign-in was cancelled. Please try again.")
        }
        return try operation()
    }
}

nonisolated struct SafariOAuthRequest: Sendable {
    static let clientID = "teak-safari"
    static let callback = "teak-safari://oauth/callback"
    let verifier: String
    let state: String
    let createdAt: Date
    var discovery: SafariAuthDiscovery?
    var logoutEpoch: String?
    let cancellation = SafariSignInCancellation()

    init(verifier: String? = nil, state: String? = nil, createdAt: Date = Date()) throws {
        self.verifier = try verifier ?? Self.randomString(count: 32)
        self.state = try state ?? Self.randomString(count: 24)
        self.createdAt = createdAt
    }

    func authorizationURL() throws -> URL {
        guard let discovery, var components = URLComponents(url: discovery.authorizationEndpoint, resolvingAgainstBaseURL: false) else {
            throw SafariServiceError.message("Prepare Teak sign-in before opening your browser.")
        }
        components.queryItems = [
            URLQueryItem(name: "client_id", value: discovery.safariClientID),
            URLQueryItem(name: "redirect_uri", value: Self.callback),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "profile email offline_access"),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "code_challenge", value: Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))),
            URLQueryItem(name: "state", value: state),
        ]
        if discovery.primary == "workos" {
            components.queryItems?.append(URLQueryItem(name: "resource", value: discovery.apiResource.absoluteString))
        }
        return components.url!
    }

    func authorizationCode(from url: URL, now: Date = Date()) throws -> String {
        guard now.timeIntervalSince(createdAt) < 600,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "teak-safari", parts.host == "oauth", parts.path == "/callback",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil
        else { throw SafariServiceError.message("Invalid or expired sign-in callback. Please try again.") }
        let items = parts.queryItems ?? []
        func unique(_ name: String) -> String? {
            let values = items.filter { $0.name == name }
            return values.count == 1 ? values[0].value : nil
        }
        guard unique("state") == state else {
            throw SafariServiceError.message("Sign-in could not be verified. Please try again.")
        }
        if unique("error") != nil {
            throw SafariServiceError.message("Sign-in was not approved. Please try again.")
        }
        guard let code = unique("code"), !code.isEmpty, code.count <= 4096 else {
            throw SafariServiceError.message("Teak returned an invalid sign-in code.")
        }
        return code
    }

    static func formBody(_ values: [String: String]) -> Data {
        var components = URLComponents()
        components.queryItems = values.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        // '+' has special meaning in form bodies, unlike URL query strings.
        return Data((components.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
    }

    private static func randomString(count: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw SafariServiceError.message("Unable to prepare sign in.")
        }
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

nonisolated struct SafariOAuthBinding: Codable, Sendable, Equatable {
    let apiOrigin: String
    let primary: String
    let issuer: URL
    let clientID: String
    let revocationEndpoint: URL?
    let ownerID: String?
}

nonisolated struct SafariOAuthTokens: Codable, Sendable {
    var binding: SafariOAuthBinding? = nil
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date

    static func decode(_ data: Data, now: Date = Date()) throws -> Self {
        struct Response: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Double
            let token_type: String
        }
        let response = try JSONDecoder().decode(Response.self, from: data)
        guard !response.access_token.isEmpty, !response.refresh_token.isEmpty,
              response.token_type.lowercased() == "bearer", response.expires_in.isFinite,
              response.expires_in > 0, response.expires_in <= 365 * 24 * 3600 else {
            throw SafariServiceError.message("Teak returned invalid credentials.")
        }
        return Self(accessToken: response.access_token, refreshToken: response.refresh_token,
                    expiresAt: now.addingTimeInterval(response.expires_in))
    }
}

nonisolated enum SafariServiceError: LocalizedError {
    case unauthenticated
    case message(String)

    var errorDescription: String? {
        switch self {
        case .unauthenticated: return "Sign in to Teak to save pages."
        case .message(let message): return message
        }
    }
}
