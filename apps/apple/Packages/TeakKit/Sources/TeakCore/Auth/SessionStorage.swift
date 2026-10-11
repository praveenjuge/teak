import Foundation
import Security

/// Who is signed in, as WorkOS describes them.
public struct SessionUser: Codable, Hashable, Sendable {
    public let id: String
    public let email: String
    public let emailVerified: Bool
    public let teakUserId: String?
    public let name: String
}

/// A validated WorkOS session.
public struct WorkOSSession: Hashable, Sendable {
    public let clientId: String
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public let sessionId: String
    public let user: SessionUser
    /// The authenticate response's fields, as stored.
    let record: StoredSession
}

/// What the keychain holds: the parts of WorkOS's authenticate response the
/// session needs, re-validated on every load.
struct StoredSession: Codable, Hashable, Sendable {
    struct User: Codable, Hashable, Sendable {
        let id: String
        let email: String
        let email_verified: Bool
        let external_id: String?
        let first_name: String?
        let last_name: String?
    }

    let clientId: String
    let access_token: String
    let refresh_token: String
    let user: User
}

enum SessionParser {
    static let maxLength = 64 * 1024

    static func invalid() -> TeakError { TeakError(message: "Invalid sign-in response") }

    /// Parses WorkOS's authenticate response.
    static func parseResponse(_ data: Data, clientId: String) throws -> WorkOSSession {
        guard data.count <= maxLength,
              let response = try? JSONDecoder().decode(AuthenticateResponse.self, from: data)
        else { throw invalid() }
        return try parse(StoredSession(clientId: clientId, access_token: response.access_token,
                                       refresh_token: response.refresh_token, user: response.user),
                         clientId: clientId)
    }

    private struct AuthenticateResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let user: StoredSession.User
    }

    /// These claims describe the client cache, not authorization. Convex verifies the
    /// signed token, the live session, verified email and the vault mapping.
    static func parse(_ stored: StoredSession, clientId: String) throws -> WorkOSSession {
        guard stored.clientId == clientId, !stored.access_token.isEmpty, !stored.refresh_token.isEmpty,
              stored.access_token.count <= maxLength, stored.refresh_token.count <= maxLength,
              !stored.user.id.isEmpty, !stored.user.email.isEmpty
        else { throw invalid() }
        let parts = stored.access_token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let payload = base64URLDecode(String(parts[1])),
              let claims = try? JSONSerialization.jsonObject(with: payload) as? [String: Any]
        else { throw TeakError(message: "Invalid session token") }
        guard claims["iss"] as? String == "https://api.workos.com/user_management/\(clientId)",
              claims["sub"] as? String == stored.user.id,
              let sid = claims["sid"] as? String, sid.hasPrefix("session_"),
              let exp = claims["exp"] as? NSNumber, CFNumberIsFloatType(exp) == false,
              exp.int64Value > 0, exp.int64Value <= 9_007_199_254_740
        else { throw TeakError(message: "Invalid session token") }
        let name = [stored.user.first_name, stored.user.last_name].compactMap { $0 }.joined(separator: " ")
        return WorkOSSession(
            clientId: clientId,
            accessToken: stored.access_token,
            refreshToken: stored.refresh_token,
            expiresAt: Date(timeIntervalSince1970: TimeInterval(exp.int64Value)),
            sessionId: sid,
            user: SessionUser(id: stored.user.id, email: stored.user.email,
                              emailVerified: stored.user.email_verified, teakUserId: stored.user.external_id,
                              name: name),
            record: stored
        )
    }

    static func base64URLDecode(_ value: String) -> Data? {
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}

/// Where the session lives. The app and its extensions share one keychain item.
public protocol SessionStorage: Sendable {
    func load() throws -> Data?
    func save(_ data: Data) throws
    func clear() throws
}

/// The shared keychain item. Readable after first unlock so the share
/// extension works while the phone is locked; never synced or backed up.
public struct KeychainSessionStorage: SessionStorage {
    let service = "com.praveenjuge.teak.session"
    let account: String
    let accessGroup: String?

    public init(environment: String, accessGroup: String?) {
        account = "workos-session.\(environment)"
        self.accessGroup = accessGroup
    }

    private var query: [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: true,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    public func load() throws -> Data? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw KeychainError(status: status) }
        return data
    }

    public func save(_ data: Data) throws {
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw KeychainError(status: status) }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { throw KeychainError(status: added) }
    }

    public func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

public struct KeychainError: Error, Sendable {
    public let status: OSStatus
}
