import Foundation

/// Validated discovery only; fetching, cache lifetime, and credential storage live in the service.
nonisolated struct SafariAuthDiscovery: Codable, Sendable, Equatable {
    let primary: String
    let issuer: URL
    let authorizationEndpoint: URL
    let tokenEndpoint: URL
    let revocationEndpoint: URL?
    let safariClientID: String
    let resource: URL

    var apiResource: URL {
        resource.deletingLastPathComponent().appendingPathComponent("api")
    }

    private struct ResourceDocument: Decodable {
        let resource: String
        let authorization_servers: [String]
    }

    private struct ClientDocument: Decodable {
        let primary: String
        let issuer: String
        let clients: [String: String]
    }

    private struct ServerDocument: Decodable {
        let issuer: String
        let authorization_endpoint: String
        let token_endpoint: String
        let revocation_endpoint: String?
        let code_challenge_methods_supported: [String]
    }

    static func parse(
        resourceData: Data,
        clientData: Data,
        serverData: Data,
        apiURL: URL,
        localIssuer: URL? = nil,
        trustedOrigins: Set<String>? = nil
    ) throws -> Self {
        let allowed = try loopbackOrigins(apiURL: apiURL, localIssuer: localIssuer)
        let trusted = try trustedOrigins ?? self.trustedOrigins(apiURL: apiURL, localIssuer: localIssuer)
        let api = try validateURL(apiURL.absoluteString, allowedLoopbackOrigins: allowed)
        let decoder = JSONDecoder()
        let resource = try decode(ResourceDocument.self, data: resourceData, decoder: decoder)
        let clients = try decode(ClientDocument.self, data: clientData, decoder: decoder)
        let server = try decode(ServerDocument.self, data: serverData, decoder: decoder)
        guard clients.primary == "betterauth" || clients.primary == "workos" else {
            throw invalid("Unknown OAuth provider.")
        }
        guard resource.authorization_servers.count == 1,
              let issuerString = resource.authorization_servers.first,
              clients.issuer == issuerString,
              server.issuer == issuerString,
              server.code_challenge_methods_supported.contains("S256") else {
            throw invalid("OAuth provider configuration changed. Please try again.")
        }
        let issuer = try self.issuer(resourceData: resourceData, clientData: clientData, apiURL: apiURL, localIssuer: localIssuer, trustedOrigins: trusted)
        guard URLComponents(url: issuer, resolvingAgainstBaseURL: false)?.query == nil else {
            throw invalid("Invalid OAuth issuer.")
        }
        for surface in ["cli", "raycast", "chrome", "firefox", "safari"] {
            guard let client = clients.clients[surface],
                  !client.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !hasControls(client), client.utf8.count <= 4096 else {
                throw invalid("Missing OAuth client registration.")
            }
        }
        let expectedResource = try self.expectedResource(primary: clients.primary, api: api)
        guard resource.resource == expectedResource.absoluteString else {
            throw invalid("OAuth resource mismatch.")
        }
        return Self(
            primary: clients.primary,
            issuer: issuer,
            authorizationEndpoint: try validateTrustedURL(server.authorization_endpoint, trustedOrigins: trusted, allowedLoopbackOrigins: allowed),
            tokenEndpoint: try validateTrustedURL(server.token_endpoint, trustedOrigins: trusted, allowedLoopbackOrigins: allowed),
            revocationEndpoint: try server.revocation_endpoint.map {
                try validateTrustedURL($0, trustedOrigins: trusted, allowedLoopbackOrigins: allowed)
            },
            safariClientID: clients.clients["safari"]!,
            resource: expectedResource
        )
    }

    /// Validates the two deployment documents before contacting their issuer.
    static func issuer(resourceData: Data, clientData: Data, apiURL: URL, localIssuer: URL? = nil, trustedOrigins: Set<String>? = nil) throws -> URL {
        let allowed = try loopbackOrigins(apiURL: apiURL, localIssuer: localIssuer)
        let trusted = try trustedOrigins ?? self.trustedOrigins(apiURL: apiURL, localIssuer: localIssuer)
        let api = try validateURL(apiURL.absoluteString, allowedLoopbackOrigins: allowed)
        let resource = try decode(ResourceDocument.self, data: resourceData, decoder: JSONDecoder())
        let clients = try decode(ClientDocument.self, data: clientData, decoder: JSONDecoder())
        guard resource.authorization_servers.count == 1,
              let raw = resource.authorization_servers.first,
              clients.issuer == raw,
              clients.primary == "betterauth" || clients.primary == "workos",
              resource.resource == (try expectedResource(primary: clients.primary, api: api)).absoluteString else {
            throw invalid("OAuth provider configuration changed. Please try again.")
        }
        let url = try validateTrustedURL(raw, trustedOrigins: trusted, allowedLoopbackOrigins: allowed)
        guard URLComponents(url: url, resolvingAgainstBaseURL: false)?.query == nil else {
            throw invalid("Invalid OAuth issuer.")
        }
        return url
    }

    /// WorkOS resources name token audiences, independently of deployment URLs,
    /// matching `WORKOS_RESOURCES.mcp` in `packages/convex/shared/workosResources.ts`.
    private static let workosMCPResource = URL(string: "https://teakvault.com/mcp")!

    private static func expectedResource(primary: String, api: URL) throws -> URL {
        primary == "workos" ? workosMCPResource : try origin(api).appendingPathComponent("mcp")
    }

    /// Deployment configuration establishes trust, never remote metadata or a DNS preflight.
    static func validateTrustedURL(
        _ raw: String,
        trustedOrigins: Set<String>,
        allowedLoopbackOrigins: Set<String> = []
    ) throws -> URL {
        let url = try validateURL(raw, allowedLoopbackOrigins: allowedLoopbackOrigins)
        guard trustedOrigins.contains(try origin(url).absoluteString) else {
            throw invalid("Untrusted OAuth destination.")
        }
        return url
    }

    static func trustedOrigins(apiURL: URL, localIssuer: URL? = nil) throws -> Set<String> {
        let allowed = try loopbackOrigins(apiURL: apiURL, localIssuer: localIssuer)
        let api = try validateURL(apiURL.absoluteString, allowedLoopbackOrigins: allowed)
        let apiOrigin = try origin(api).absoluteString
        var trusted: Set<String> = [apiOrigin]
        if apiOrigin == "https://teakvault.com" || apiOrigin == "https://uncommon-ladybug-882.convex.site" {
            // Phase 4 must provision and verify this owned AuthKit domain before cutover.
            trusted.formUnion(["https://teakvault.com", "https://app.teakvault.com",
                               "https://uncommon-ladybug-882.convex.site", "https://auth.teakvault.com"])
        }
        #if DEBUG
        trusted.formUnion(allowed)
        if apiOrigin == "https://reminiscent-kangaroo-59.convex.site" || allowed.contains(apiOrigin) {
            trusted.insert("https://optimistic-metaphor-12-reminiscent-kangaroo-59.authkit.app")
        }
        #endif
        return trusted
    }

    /// RFC 8414 inserts the well-known path before an issuer's path suffix.
    static func metadataURL(issuer: URL, allowedLoopbackOrigins: Set<String> = []) throws -> URL {
        let validated = try validateURL(issuer.absoluteString, allowedLoopbackOrigins: allowedLoopbackOrigins)
        guard var parts = URLComponents(url: validated, resolvingAgainstBaseURL: false), parts.query == nil else {
            throw invalid("Invalid OAuth issuer.")
        }
        var suffix = parts.percentEncodedPath
        if suffix.hasSuffix("/") { suffix.removeLast() }
        parts.percentEncodedPath = "/.well-known/oauth-authorization-server" + suffix
        guard let url = parts.url else { throw invalid("Invalid OAuth metadata URL.") }
        return url
    }

    /// Permits only explicitly selected development loopback origins in DEBUG builds.
    static func validateURL(_ raw: String, allowedLoopbackOrigins: Set<String> = []) throws -> URL {
        guard raw.utf8.count <= 8192, !raw.isEmpty, !hasControls(raw),
              raw == raw.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.contains("\\"),
              raw.range(of: "%0[0-9a-f]|%1[0-9a-f]|%7f", options: [.regularExpression, .caseInsensitive]) == nil,
              let parts = URLComponents(string: raw),
              let scheme = parts.scheme?.lowercased(),
              let rawHost = parts.host, !rawHost.isEmpty,
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              parts.port.map({ (1...65535).contains($0) }) ?? true,
              let url = parts.url else {
            throw invalid("Unsafe OAuth URL.")
        }
        let host = rawHost.lowercased()
        let local = isLoopback(host)
        var permittedLocal = false
        #if DEBUG
        if local { permittedLocal = allowedLoopbackOrigins.contains(try origin(url).absoluteString) }
        #endif
        guard scheme == "https" || (scheme == "http" && permittedLocal),
              !local || permittedLocal,
              permittedLocal || !isPrivateOrMalformedHost(host) else {
            throw invalid("Unsafe OAuth URL.")
        }
        return url
    }

    static func loopbackOrigins(apiURL: URL, localIssuer: URL? = nil) throws -> Set<String> {
        var allowed = Set<String>()
        #if DEBUG
        if let host = apiURL.host, isLoopback(host.lowercased()) {
            allowed.insert(try origin(apiURL).absoluteString)
        }
        if let issuer = localIssuer {
            guard let host = issuer.host, isLoopback(host.lowercased()) else {
                throw invalid("Development issuer must use loopback.")
            }
            allowed.insert(try origin(issuer).absoluteString)
            _ = try validateURL(issuer.absoluteString, allowedLoopbackOrigins: allowed)
        }
        #else
        if localIssuer != nil { throw invalid("Development issuer is unavailable in release builds.") }
        #endif
        return allowed
    }

    static func origin(_ url: URL) throws -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme != nil, parts.host != nil else { throw invalid("Invalid OAuth origin.") }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        guard let origin = parts.url else { throw invalid("Invalid OAuth origin.") }
        return origin
    }

    private static func decode<T: Decodable>(_ type: T.Type, data: Data, decoder: JSONDecoder) throws -> T {
        guard data.count <= 64 * 1024 else { throw invalid("OAuth discovery document is too large.") }
        do { return try decoder.decode(type, from: data) }
        catch { throw invalid("Invalid OAuth discovery document.") }
    }

    private static func hasControls(_ value: String) -> Bool {
        value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

    private static func isLoopback(_ host: String) -> Bool {
        host == "localhost" || host.hasSuffix(".localhost") || host == "127.0.0.1"
            || host == "::1" || host == "[::1]"
    }

    private static func isPrivateOrMalformedHost(_ host: String) -> Bool {
        // IPv6 (including mapped IPv4), numeric aliases, and internal names never
        // qualify as a public discovery destination. Canonical public IPv4 does.
        let privateSuffixes = ["local", "internal", "lan", "home", "home.arpa", "corp", "intranet", "private", "onion"]
        if host.contains(":") || host.contains("[") || host.hasSuffix(".")
            || privateSuffixes.contains(where: { host == $0 || host.hasSuffix("." + $0) })
            || !host.contains(".") { return true }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        if labels.contains(where: { $0.isEmpty }) { return true }
        let looksNumeric = labels.last.map {
            $0.allSatisfy(\.isNumber) || $0.lowercased().hasPrefix("0x")
        } ?? false
        if looksNumeric {
            guard labels.count == 4 else { return true }
            var octets: [Int] = []
            for label in labels {
                guard label.allSatisfy({ $0.isASCII && $0.isNumber }),
                      let octet = Int(label), (0...255).contains(octet),
                      String(octet) == String(label) else { return true }
                octets.append(octet)
            }
            return octets[0] == 0 || octets[0] == 10 || octets[0] == 127
                || octets[0] >= 224
                || (octets[0] == 100 && (64...127).contains(octets[1]))
                || (octets[0] == 169 && octets[1] == 254)
                || (octets[0] == 172 && (16...31).contains(octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
        }
        return labels.contains { label in
            label.hasPrefix("-") || label.hasSuffix("-")
                || label.contains { !($0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-")) }
        }
    }

    private static func invalid(_ message: String) -> SafariServiceError { .message(message) }
}
