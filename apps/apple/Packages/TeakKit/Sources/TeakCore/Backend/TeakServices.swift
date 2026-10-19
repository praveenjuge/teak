import Foundation

public enum TeakServices {
    public static func session(config: TeakConfig = .current) -> TeakSession {
        let storage = KeychainSessionStorage(environment: config.environment, accessGroup: config.keychainAccessGroup)
        let directory = config.sharedContainer ?? FileManager.default.temporaryDirectory
        let bootstrap = UserBootstrap(convexURL: config.convexURL)
        return TeakSession(storage: storage, lock: FileCredentialLock(directory: directory, environment: config.environment),
                           workosURL: config.workosURL, bootstrap: { try await bootstrap.ensureUser(accessToken: $0) })
    }

    public static func http(config: TeakConfig = .current, session: TeakSession) -> ConvexHTTP {
        ConvexHTTP(baseURL: config.convexURL) {
            guard let token = try await session.accessToken() else { throw TeakError.signedOut }
            return token
        }
    }

    public static func sharedDefaults(config: TeakConfig = .current) -> UserDefaults {
        UserDefaults(suiteName: config.appGroup) ?? .standard
    }
}
