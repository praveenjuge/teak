import Foundation

public struct UserBootstrap: Sendable {
    struct Result: Decodable, Sendable {
        let status: String
    }

    let convexURL: URL
    let transport: any HTTPTransport

    public init(convexURL: URL, transport: any HTTPTransport = URLSessionTransport()) {
        self.convexURL = convexURL
        self.transport = transport
    }

    public func ensureUser(accessToken: String) async throws {
        let convex = ConvexHTTP(baseURL: convexURL, transport: transport, timeout: 10) { accessToken }
        let result = try await convex.mutation(ConvexFunctions.ensureUser)
        switch result.status {
        case "ok": return
        case "verify_email": throw TeakError(message: TeakMessages.verifyEmail)
        case "frozen": throw TeakError(message: TeakMessages.signupsPaused)
        default: throw TeakError(message: TeakMessages.vaultUnavailable)
        }
    }
}
