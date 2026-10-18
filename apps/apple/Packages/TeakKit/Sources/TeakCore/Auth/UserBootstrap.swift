import Foundation

public struct UserBootstrap: Sendable {
    struct Result: Decodable, Sendable {
        let status: String
        let reason: String?

        var isProfilePending: Bool { status == "quarantined" && reason == "profile_pending" }
    }

    let convexURL: URL
    let transport: any HTTPTransport
    let profilePendingRetries: Int
    let delay: Duration

    public init(convexURL: URL, transport: any HTTPTransport = URLSessionTransport(), profilePendingRetries: Int = 8,
                delay: Duration = .milliseconds(1500)) {
        self.convexURL = convexURL
        self.transport = transport
        self.profilePendingRetries = profilePendingRetries
        self.delay = delay
    }

    public func ensureUser(accessToken: String) async throws {
        let convex = ConvexHTTP(baseURL: convexURL, transport: transport, timeout: 10) { accessToken }
        let result = try await ensureUserWaitingForProfileWebhook(convex)
        switch result.status {
        case "ok": return
        case "verify_email": throw TeakError(message: TeakMessages.verifyEmail)
        case "frozen": throw TeakError(message: TeakMessages.signupsPaused)
        default: throw TeakError(message: TeakMessages.vaultUnavailable)
        }
    }

    private func ensureUserWaitingForProfileWebhook(_ convex: ConvexHTTP) async throws -> Result {
        var result = try await convex.mutation(ConvexFunctions.ensureUser)
        var attempt = 0
        while result.isProfilePending, attempt < profilePendingRetries {
            try await Task.sleep(for: delay)
            result = try await convex.mutation(ConvexFunctions.ensureUser)
            attempt += 1
        }
        return result
    }
}
