import Foundation

/// Build-time facts each target's Info.plist supplies: which Convex deployment
/// to use, where the web app lives, and the shared containers.
public struct TeakConfig: Sendable {
    public let convexURL: URL
    public let webURL: URL
    /// WorkOS's API: hosted AuthKit, or the E2E stack's emulator in debug builds.
    public let workosURL: URL
    public let appGroup: String
    public let keychainAccessGroup: String?
    public let sentryDSN: String?
    public let environment: String
    public let version: String
    public let build: String

    public init(convexURL: URL, webURL: URL, workosURL: URL = TeakConfig.hostedWorkOS, appGroup: String,
                keychainAccessGroup: String?, sentryDSN: String?, environment: String, version: String = "0",
                build: String = "0") {
        self.convexURL = convexURL
        self.webURL = webURL
        self.workosURL = workosURL
        self.appGroup = appGroup
        self.keychainAccessGroup = keychainAccessGroup
        self.sentryDSN = sentryDSN
        self.environment = environment
        self.version = version
        self.build = build
    }

    public static let current = TeakConfig(bundle: .main)
    public static let hostedWorkOS = URL(string: "https://api.workos.com")!

    public init(bundle: Bundle, environment overrides: [String: String] = ProcessInfo.processInfo.environment) {
        func value(_ key: String) -> String? {
            #if DEBUG
            // The E2E stack points debug builds at its local backend and WorkOS emulator.
            if let override = overrides[key], !override.isEmpty { return override }
            #endif
            guard let raw = bundle.object(forInfoDictionaryKey: key) as? String,
                  !raw.isEmpty, !raw.hasPrefix("$(") else { return nil }
            return raw
        }
        guard let convex = value("TeakConvexURL").flatMap(Self.trustedConvexOrigin) else {
            fatalError("TeakConvexURL is missing or not a trusted Convex origin")
        }
        convexURL = convex
        webURL = value("TeakWebURL").flatMap(URL.init(string:)) ?? URL(string: "https://app.teakvault.com")!
        workosURL = value("TeakWorkOSURL").flatMap(Self.trustedWorkOSOrigin) ?? Self.hostedWorkOS
        appGroup = value("TeakAppGroup") ?? "group.com.praveenjuge.teak"
        keychainAccessGroup = value("TeakKeychainAccessGroup")
        sentryDSN = value("TeakSentryDSN")
        environment = value("TeakEnvironment") ?? "production"
        version = value("CFBundleShortVersionString") ?? "0"
        build = value("CFBundleVersion") ?? "0"
    }

    public var isProduction: Bool { environment == "production" }

    /// The shared container the app and its extensions use.
    public var sharedContainer: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    /// Hosted WorkOS, or a local emulator in development builds.
    static func trustedWorkOSOrigin(_ value: String) -> URL? {
        guard let url = URL(string: value), let host = url.host()?.lowercased() else { return nil }
        if url.scheme == "https", host == "api.workos.com" { return hostedWorkOS }
        #if DEBUG
        if ["http", "https"].contains(url.scheme ?? ""), ["localhost", "127.0.0.1"].contains(host) { return url }
        #endif
        return nil
    }

    /// Port of `readConvexOrigin`: hosted deployments over HTTPS, or a local
    /// backend in development builds.
    static func trustedConvexOrigin(_ value: String) -> URL? {
        guard let components = URLComponents(string: value), let host = components.host?.lowercased(),
              let scheme = components.scheme?.lowercased(),
              components.user == nil, components.password == nil, components.query == nil,
              components.fragment == nil, ["", "/"].contains(components.path)
        else { return nil }
        let origin = "\(scheme)://\(host)\(components.port.map { ":\($0)" } ?? "")"
        if scheme == "https", components.port == nil, host.wholeMatch(of: /[a-z0-9][a-z0-9-]*\.convex\.cloud/) != nil {
            return URL(string: origin)
        }
        #if DEBUG
        if ["http", "https"].contains(scheme), ["localhost", "127.0.0.1", "[::1]"].contains(host) {
            return URL(string: origin)
        }
        #endif
        return nil
    }
}
