import Foundation
import Security

nonisolated protocol SafariCredentialStorage: Sendable {
    func load() throws -> SafariOAuthTokens?
    func save(_ tokens: SafariOAuthTokens) throws
    func clear() throws
}

nonisolated struct SafariCredentialStore: SafariCredentialStorage {
    static let group = "group.com.praveenjuge.teak-safari"
    private let account = "oauth-tokens-v1"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.praveenjuge.teak-safari.session",
            kSecAttrAccessGroup as String: "LW385M78LW.com.praveenjuge.teak-safari",
            kSecUseDataProtectionKeychain as String: true,
            kSecAttrAccount as String: account,
        ]
    }

    func load() throws -> SafariOAuthTokens? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw SafariServiceError.message("Unable to read your Teak connection. Please try again.")
        }
        return try JSONDecoder().decode(SafariOAuthTokens.self, from: data)
    }

    func save(_ tokens: SafariOAuthTokens) throws {
        let data = try JSONEncoder().encode(tokens)
        let attributes = [kSecValueData as String: data]
        let result = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if result == errSecSuccess { return }
        guard result == errSecItemNotFound else {
            throw SafariServiceError.message("Unable to store your Teak connection.")
        }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw SafariServiceError.message("Unable to store your Teak connection.")
        }
    }

    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SafariServiceError.message("Unable to clear your Teak connection.")
        }
    }
}
