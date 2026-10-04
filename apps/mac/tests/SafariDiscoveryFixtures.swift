import Foundation

enum SafariDiscoveryFixtures {
    static let api = URL(string: "https://test.teak.invalid")!
    static var primary = "betterauth"
    static var invalidEndpoint: String?
    static var unavailable = false
    static var issuer: String { "https://auth.teak.invalid/\(primary)" }
    static var clientID: String { primary == "betterauth" ? "teak-safari" : "client-safari" }

    static func metadata(_ request: URLRequest) throws -> (Int, String)? {
        guard let path = request.url?.path,
              path == "/.well-known/oauth-protected-resource/mcp"
                || path == "/.well-known/teak-oauth-clients.json"
                || path == "/.well-known/oauth-authorization-server/\(primary)" else { return nil }
        if unavailable { return (503, "{}") }
        let document: [String: Any]
        switch path {
        case "/.well-known/oauth-protected-resource/mcp":
            document = ["resource": "https://test.teak.invalid/mcp", "authorization_servers": [issuer]]
        case "/.well-known/teak-oauth-clients.json":
            document = ["primary": primary, "issuer": issuer, "clients": Dictionary(uniqueKeysWithValues:
                ["cli", "raycast", "chrome", "firefox", "safari"].map { ($0, primary == "betterauth" ? "teak-\($0)" : "client-\($0)") })]
        default:
            document = ["issuer": issuer, "authorization_endpoint": "\(issuer)/authorize",
                        "token_endpoint": invalidEndpoint ?? "https://test.teak.invalid/api/auth/mcp/token",
                        "revocation_endpoint": "https://test.teak.invalid/api/oauth/revoke",
                        "code_challenge_methods_supported": ["S256"]]
        }
        return (200, String(data: try JSONSerialization.data(withJSONObject: document), encoding: .utf8)!)
    }
}
