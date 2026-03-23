import Foundation
import Security

actor SessionStore {
    private let service = Bundle.main.bundleIdentifier ?? "com.praveenjuge.teak"
    private let sessionAccount = "better-auth.session-token"
    private let defaults = UserDefaults.standard
    private let deviceIDKey = "teak.auth.device-id"

    func loadSessionToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: sessionAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            return nil
        }

        guard let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    func saveSessionToken(_ token: String) throws {
        guard let data = token.data(using: .utf8) else {
            throw SessionStoreError.encodingFailed
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: sessionAccount,
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data,
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }

        if updateStatus != errSecItemNotFound {
            throw SessionStoreError.unexpectedKeychainStatus(updateStatus)
        }

        var insertQuery = query
        insertQuery[kSecValueData as String] = data
        let addStatus = SecItemAdd(insertQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw SessionStoreError.unexpectedKeychainStatus(addStatus)
        }
    }

    func clearSessionToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: sessionAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }

    func loadOrCreateDeviceID() -> String {
        if let deviceID = defaults.string(forKey: deviceIDKey), !deviceID.isEmpty {
            return deviceID
        }

        let deviceID = UUID().uuidString
        defaults.set(deviceID, forKey: deviceIDKey)
        return deviceID
    }
}

enum SessionStoreError: LocalizedError {
    case encodingFailed
    case unexpectedKeychainStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .encodingFailed:
            return "Failed to encode the session token."
        case .unexpectedKeychainStatus(let status):
            return "Keychain operation failed (\(status))."
        }
    }
}
