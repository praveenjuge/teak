import Foundation

/// Links a new WorkOS sign-in to its Teak vault (`workosBootstrap:ensureUser`)
/// before the session is saved.
public struct UserBootstrap: Sendable {
    struct Result: Decodable, Sendable {
        let status: String
        let reason: String?
    }

    let convexURL: URL
    let transport: any HTTPTransport
    let retries: Int
    let delay: Duration

    public init(convexURL: URL, transport: any HTTPTransport = URLSessionTransport(), retries: Int = 8,
                delay: Duration = .milliseconds(1500)) {
        self.convexURL = convexURL
        self.transport = transport
        self.retries = retries
        self.delay = delay
    }

    public func ensureUser(accessToken: String) async throws {
        let convex = ConvexHTTP(baseURL: convexURL, transport: transport, timeout: 10) { accessToken }
        var result: Result = try await convex.mutation("workosBootstrap:ensureUser", [:])
        // A brand-new user's profile arrives by WorkOS webhook, which can land a
        // moment after the code exchange. Wait briefly for it.
        var attempt = 0
        while attempt < retries, result.status == "quarantined", result.reason == "profile_pending" {
            try await Task.sleep(for: delay)
            result = try await convex.mutation("workosBootstrap:ensureUser", [:])
            attempt += 1
        }
        switch result.status {
        case "ok": return
        case "verify_email": throw TeakError(message: TeakMessages.verifyEmail)
        case "frozen": throw TeakError(message: TeakMessages.signupsPaused)
        default: throw TeakError(message: TeakMessages.vaultUnavailable)
        }
    }
}
