import Foundation
import PostHog
import TeakCore

@MainActor
enum PostHogReporting {
    private static var started = false

    static func start(config: TeakConfig = .current) {
        guard !started, let token = config.posthogToken else { return }
        let options = PostHogConfig(projectToken: token, host: "https://us.i.posthog.com")
        options.captureApplicationLifecycleEvents = true
        options.captureScreenViews = false
        options.preloadFeatureFlags = false
        options.personProfiles = .identifiedOnly
        options.flushAt = 20
        options.flushIntervalSeconds = 30
        #if os(iOS)
        options.sessionReplay = false
        // Shows the feedback survey PostHog targets at the app, such as the one after a finished Revisit.
        options.surveys = true
        #endif
        options.errorTrackingConfig.autoCapture = true
        PostHogSDK.shared.setup(options)
        started = true
    }

    static func identify(teakUserId: String, email: String) {
        guard started else { return }
        PostHogSDK.shared.identify(teakUserId, userProperties: ["email": email])
    }

    static func reset() {
        guard started else { return }
        PostHogSDK.shared.reset()
    }

    /// Sends an event from `ClientEventCatalog` (`packages/convex/shared/analytics.ts`), by the same name and properties.
    static func capture(event: String, _ properties: [String: Any] = [:]) {
        guard started else { return }
        PostHogSDK.shared.capture(event, properties: properties)
    }

    static func capture(_ error: any Error) {
        guard started, !(error is TeakError) else { return }
        PostHogSDK.shared.captureException(error)
    }
}
