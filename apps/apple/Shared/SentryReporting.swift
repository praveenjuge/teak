import Foundation
import Sentry
import TeakCore

/// Crash and error reporting. Off when the build has no DSN.
enum SentryReporting {
    static func start(config: TeakConfig = .current, extensionName: String? = nil) {
        guard let dsn = config.sentryDSN else { return }
        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = config.environment
            options.releaseName = "teak-apple@\(config.version)+\(config.build)"
            options.sendDefaultPii = false
            options.enableAppHangTracking = true
            options.tracesSampleRate = NSNumber(value: config.isProduction ? 0.1 : 1)
            if let extensionName { options.initialScope = { scope in scope.setTag(value: extensionName, key: "extension"); return scope } }
        }
    }

    /// Ties reports to the permanent vault ID, never an email.
    static func setUser(_ teakUserId: String?) {
        guard SentrySDK.isEnabled else { return }
        SentrySDK.setUser(teakUserId.map { User(userId: $0) })
    }

    static func capture(_ error: any Error) {
        guard SentrySDK.isEnabled, !(error is TeakError) else { return }
        SentrySDK.capture(error: error)
    }
}
