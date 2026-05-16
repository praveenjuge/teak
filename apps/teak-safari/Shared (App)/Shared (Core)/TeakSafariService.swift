import CryptoKit
import Foundation
import Security

final class TeakSafariService {
    static let shared = TeakSafariService()

    #if DEBUG
    private let appBaseURL = URL(string: "http://app.teak.localhost:1355")!
    private let convexSiteURL = URL(string: "https://reminiscent-kangaroo-59.convex.site")!
    private let convexDeploymentURL = URL(string: "https://reminiscent-kangaroo-59.convex.cloud")!
    #else
    private let appBaseURL = URL(string: "https://app.teakvault.com")!
    private let convexSiteURL = URL(string: "https://uncommon-ladybug-882.convex.site")!
    private let convexDeploymentURL = URL(string: "https://uncommon-ladybug-882.convex.cloud")!
    #endif
    private let appGroupIdentifier = "group.com.praveenjuge.teak-safari"
    private let keychainAccessGroup = "LW385M78LW.com.praveenjuge.teak-safari"
    private let keychainService = "com.praveenjuge.teak-safari.session"
    private let sessionAccount = "better-auth-session-token"
    private let pendingAuthKey = "teak.pendingNativeAuth"
    private let session = URLSession(configuration: .ephemeral)

    private init() {}

    func authState() async -> [String: Any] {
        if let token = loadSessionToken(), !token.isEmpty {
            return ["authenticated": true]
        }

        if await pollPendingAuth() {
            return ["authenticated": true]
        }

        return ["authenticated": false]
    }

    func startSignIn() async -> [String: Any] {
        do {
            let pending = try PendingNativeAuth(
                deviceId: UUID().uuidString,
                codeVerifier: Self.randomBase64URL(byteCount: 32),
                state: Self.randomBase64URL(byteCount: 24),
                surface: Self.currentSurface,
                createdAt: Date().timeIntervalSince1970
            )
            try savePendingAuth(pending)

            var components = URLComponents(
                url: appBaseURL.appendingPathComponent("/native/auth/start"),
                resolvingAgainstBaseURL: false
            )!
            components.queryItems = [
                URLQueryItem(name: "device_id", value: pending.deviceId),
                URLQueryItem(name: "code_challenge", value: try Self.codeChallenge(for: pending.codeVerifier)),
                URLQueryItem(name: "state", value: pending.state),
                URLQueryItem(name: "surface", value: pending.surface),
                URLQueryItem(
                    name: "redirect_uri",
                    value: appBaseURL.appendingPathComponent("/native/auth/complete").absoluteString
                ),
            ]

            return [
                "status": "auth-url",
                "authenticated": false,
                "authUrl": components.url!.absoluteString,
            ]
        } catch {
            return errorResponse(error)
        }
    }

    func signOut() async -> [String: Any] {
        let token = loadSessionToken()
        clearSessionToken()
        clearPendingAuth()

        if let token, !token.isEmpty {
            var request = URLRequest(url: convexSiteURL.appendingPathComponent("/api/auth/sign-out"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try? await session.data(for: request)
        }

        return ["status": "signed-out", "authenticated": false]
    }

    func saveCurrentPage(url rawURL: String?) async -> [String: Any] {
        guard let rawURL, let pageURL = Self.validPageURL(rawURL) else {
            return [
                "status": "invalid-url",
                "message": "This page cannot be saved to Teak.",
            ]
        }

        if loadSessionToken() == nil, await pollPendingAuth() == false {
            return [
                "status": "unauthenticated",
                "message": "Sign in to Teak to save pages.",
            ]
        }

        guard let sessionToken = loadSessionToken() else {
            return [
                "status": "unauthenticated",
                "message": "Sign in to Teak to save pages.",
            ]
        }

        do {
            let convexToken = try await fetchConvexToken(sessionToken: sessionToken)
            let normalizedURL = pageURL.absoluteString
            let duplicate = try await callConvex(
                endpoint: "query",
                path: "cards:findDuplicateCard",
                args: ["url": normalizedURL],
                token: convexToken
            )

            if !(duplicate is NSNull) {
                return ["status": "duplicate"]
            }

            let cardId = try await callConvex(
                endpoint: "mutation",
                path: "cards:createCard",
                args: ["content": normalizedURL],
                token: convexToken
            )

            return [
                "status": "saved",
                "cardId": String(describing: cardId),
            ]
        } catch ServiceError.unauthenticated {
            clearSessionToken()
            return [
                "status": "unauthenticated",
                "message": "Sign in to Teak to save pages.",
            ]
        } catch {
            return errorResponse(error)
        }
    }

    private func pollPendingAuth() async -> Bool {
        guard let pending = loadPendingAuth() else {
            return false
        }

        if Date().timeIntervalSince1970 - pending.createdAt > 300 {
            clearPendingAuth()
            return false
        }

        do {
            var request = URLRequest(url: convexSiteURL.appendingPathComponent("/api/native/auth/poll"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode([
                "codeVerifier": pending.codeVerifier,
                "deviceId": pending.deviceId,
                "state": pending.state,
            ])

            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                return false
            }

            if httpResponse.statusCode == 204 {
                return false
            }

            guard httpResponse.statusCode == 200 else {
                return false
            }

            let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let sessionToken = payload?["sessionToken"] as? String, !sessionToken.isEmpty else {
                return false
            }

            try saveSessionToken(sessionToken)
            clearPendingAuth()
            return true
        } catch {
            return false
        }
    }

    private func fetchConvexToken(sessionToken: String) async throws -> String {
        var request = URLRequest(url: convexSiteURL.appendingPathComponent("/api/auth/convex/token"))
        request.httpMethod = "GET"
        request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ServiceError.requestFailed("Unable to reach Teak.")
        }

        if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
            throw ServiceError.unauthenticated
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ServiceError.requestFailed("Unable to authenticate with Teak.")
        }

        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let token = payload?["token"] as? String, !token.isEmpty else {
            throw ServiceError.requestFailed("Teak returned an invalid auth token.")
        }

        return token
    }

    private func callConvex(
        endpoint: String,
        path: String,
        args: [String: Any],
        token: String
    ) async throws -> Any {
        var request = URLRequest(url: convexDeploymentURL.appendingPathComponent("/api/\(endpoint)"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("macos-safari-1.0", forHTTPHeaderField: "Convex-Client")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "path": path,
            "format": "convex_encoded_json",
            "args": [args],
        ])

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ServiceError.requestFailed("Unable to reach Teak.")
        }

        if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
            throw ServiceError.unauthenticated
        }

        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ServiceError.requestFailed("Teak returned an invalid response.")
        }

        if payload["status"] as? String == "success" {
            return payload["value"] ?? NSNull()
        }

        if let message = payload["errorMessage"] as? String {
            throw ServiceError.requestFailed(message)
        }

        if !(200..<300).contains(httpResponse.statusCode) {
            throw ServiceError.requestFailed("Unable to save this page.")
        }

        throw ServiceError.requestFailed("Unable to save this page.")
    }

    private func saveSessionToken(_ token: String) throws {
        guard let data = token.data(using: .utf8) else {
            throw ServiceError.requestFailed("Unable to store session.")
        }

        clearSessionToken()

        let query = keychainQuery().merging([
            kSecAttrAccount as String: sessionAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]) { _, new in new }

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw ServiceError.requestFailed("Unable to store session.")
        }
    }

    private func loadSessionToken() -> String? {
        let query = keychainQuery().merging([
            kSecAttrAccount as String: sessionAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]) { _, new in new }

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    private func clearSessionToken() {
        SecItemDelete(keychainQuery().merging([
            kSecAttrAccount as String: sessionAccount,
        ]) { _, new in new } as CFDictionary)
    }

    private func keychainQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccessGroup as String: keychainAccessGroup,
        ]

        if #available(macOS 10.15, *) {
            query[kSecUseDataProtectionKeychain as String] = true
        }

        return query
    }

    private func savePendingAuth(_ pending: PendingNativeAuth) throws {
        let data = try JSONEncoder().encode(pending)
        defaults.set(data, forKey: pendingAuthKey)
    }

    private func loadPendingAuth() -> PendingNativeAuth? {
        guard let data = defaults.data(forKey: pendingAuthKey) else {
            return nil
        }
        return try? JSONDecoder().decode(PendingNativeAuth.self, from: data)
    }

    private func clearPendingAuth() {
        defaults.removeObject(forKey: pendingAuthKey)
    }

    private var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    private func errorResponse(_ error: Error) -> [String: Any] {
        [
            "status": "error",
            "message": error.localizedDescription,
        ]
    }

    private static var currentSurface: String {
        "safari-macos"
    }

    private static func validPageURL(_ rawURL: String) -> URL? {
        guard let url = URL(string: rawURL), ["http", "https"].contains(url.scheme?.lowercased()) else {
            return nil
        }
        return url
    }

    private static func codeChallenge(for verifier: String) throws -> String {
        guard let data = verifier.data(using: .utf8) else {
            throw ServiceError.requestFailed("Unable to prepare sign in.")
        }
        return base64URL(Data(SHA256.hash(data: data)))
    }

    private static func randomBase64URL(byteCount: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw ServiceError.requestFailed("Unable to prepare sign in.")
        }
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private struct PendingNativeAuth: Codable {
    let deviceId: String
    let codeVerifier: String
    let state: String
    let surface: String
    let createdAt: TimeInterval
}

private enum ServiceError: LocalizedError {
    case requestFailed(String)
    case unauthenticated

    var errorDescription: String? {
        switch self {
        case .requestFailed(let message):
            return message
        case .unauthenticated:
            return "Sign in to Teak to save pages."
        }
    }
}
