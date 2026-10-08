import Foundation

enum SafariDiscoveryFixtures {
    static let api = URL(string: "https://test.teak.invalid")!
    static var primary = "workos"
    /// The AuthKit tenant behind discovery. Tests switch it to model a new WorkOS
    /// environment, which changes both the issuer and the registered clients.
    static var tenant = "workos"
    static var invalidEndpoint: String?
    static var unavailable = false
    static var issuer: String { "https://auth.teak.invalid/\(tenant)" }
    static var clientID: String { client("safari") }

    static func client(_ surface: String) -> String {
        "client_01J\(tenant.uppercased())\(surface.uppercased())"
    }

    static func metadata(_ request: URLRequest) throws -> (Int, String)? {
        guard let path = request.url?.path,
              path == "/.well-known/oauth-protected-resource/mcp"
                || path == "/.well-known/teak-oauth-clients.json"
                || path == "/.well-known/oauth-authorization-server/\(tenant)" else { return nil }
        if unavailable { return (503, "{}") }
        let document: [String: Any]
        switch path {
        case "/.well-known/oauth-protected-resource/mcp":
            // Production advertises the fixed WorkOS audience from every deployment.
            document = ["resource": "https://teakvault.com/mcp", "authorization_servers": [issuer]]
        case "/.well-known/teak-oauth-clients.json":
            document = ["primary": primary, "issuer": issuer, "clients": Dictionary(uniqueKeysWithValues:
                ["cli", "raycast", "chrome", "firefox", "safari"].map { ($0, client($0)) })]
        default:
            document = ["issuer": issuer, "authorization_endpoint": "\(issuer)/authorize",
                        "token_endpoint": invalidEndpoint ?? "https://auth.teak.invalid/oauth2/token",
                        "code_challenge_methods_supported": ["S256"]]
        }
        return (200, String(data: try JSONSerialization.data(withJSONObject: document), encoding: .utf8)!)
    }
}
