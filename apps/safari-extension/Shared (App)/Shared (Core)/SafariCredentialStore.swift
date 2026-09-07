import Foundation
import Security

nonisolated protocol SafariCredentialStorage: Sendable {
    func load() throws -> SafariOAuthTokens?
    func save(_ tokens: SafariOAuthTokens) throws
    func clear() throws
}

nonisolated struct SafariCredentialStore: SafariCredentialStorage {
    static let group = "group.com.praveenjuge.teak-safari"
    static let keychainService = "com.praveenjuge.teak-safari.session"
    static let keychainAccount = "oauth-tokens-v1"
    /// Keychain access group, resolved at build time from `TeakKeychainAccessGroup`
    /// (`$(AppIdentifierPrefix)com.praveenjuge.teak-safari` in each target's Info.plist)
    /// so re-signing under another team keeps the entitlement and runtime query in sync.
    /// Falls back to the current team's prefix for installs predating the plist key.
    static var accessGroup: String {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "TeakKeychainAccessGroup") as? String,
           !configured.isEmpty,
           !configured.hasPrefix("$(") {
            return configured
        }
        return "LW385M78LW.com.praveenjuge.teak-safari"
    }
    private let account = Self.keychainAccount

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.keychainService,
            kSecAttrAccessGroup as String: Self.accessGroup,
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
