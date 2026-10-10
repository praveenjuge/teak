import Foundation

/// Builds the pieces the app and its extensions share, from one config.
public enum TeakServices {
    /// The WorkOS session in the shared keychain, with the cross-process refresh lock.
    public static func session(config: TeakConfig = .current) -> TeakSession {
        let storage = KeychainSessionStorage(environment: config.environment, accessGroup: config.keychainAccessGroup)
        let directory = config.sharedContainer ?? FileManager.default.temporaryDirectory
        let bootstrap = UserBootstrap(convexURL: config.convexURL)
        return TeakSession(storage: storage, lock: FileCredentialLock(directory: directory, environment: config.environment),
                           bootstrap: { try await bootstrap.ensureUser(accessToken: $0) })
    }

    /// Convex over HTTPS, signed in with the session's token. For the extensions.
    public static func http(config: TeakConfig = .current, session: TeakSession) -> ConvexHTTP {
        ConvexHTTP(baseURL: config.convexURL) { try await session.accessToken() }
    }

    /// Settings shared with the extensions.
    public static func sharedDefaults(config: TeakConfig = .current) -> UserDefaults {
        UserDefaults(suiteName: config.appGroup) ?? .standard
    }
}
