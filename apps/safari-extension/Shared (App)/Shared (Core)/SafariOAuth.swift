import CryptoKit
import Foundation
import Security

nonisolated struct SafariOAuthRequest: Sendable {
    static let clientID = "teak-safari"
    static let callback = "teak-safari://oauth/callback"
    let verifier: String
    let state: String
    let createdAt: Date

    init(verifier: String? = nil, state: String? = nil, createdAt: Date = Date()) throws {
        self.verifier = try verifier ?? Self.randomString(count: 32)
        self.state = try state ?? Self.randomString(count: 24)
        self.createdAt = createdAt
    }

    func authorizationURL(baseURL: URL) -> URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/auth/mcp/authorize"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: Self.clientID),
            URLQueryItem(name: "redirect_uri", value: Self.callback),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "profile email offline_access"),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "code_challenge", value: Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))),
            URLQueryItem(name: "state", value: state),
        ]
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

nonisolated struct SafariOAuthTokens: Codable, Sendable {
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
              response.expires_in > 0 else {
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
