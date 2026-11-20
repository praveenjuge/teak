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

    /// Links or creates the account. `authMethod` is WorkOS's `authentication_method` from the code exchange,
    /// for a new account's `user_signed_up`. A backend deployed before `ensureUserWithSignup` doesn't have it,
    /// so the sign-in carries on through `ensureUser`, as on the web.
    public func ensureUser(accessToken: String, authMethod: String? = nil) async throws {
        let convex = ConvexHTTP(baseURL: convexURL, transport: transport, timeout: 10) { accessToken }
        var signup: ConvexArgs = ["platform": "apple"]
        if let authMethod { signup["authMethod"] = .string(authMethod) }
        let result: Result
        do {
            result = try await convex.mutation(ConvexFunctions.ensureUserWithSignup, signup)
        } catch let error as TeakError where error.code == TeakError.missingFunctionCode {
            result = try await convex.mutation(ConvexFunctions.ensureUser)
        }
        switch result.status {
        case "ok": return
        case "verify_email": throw TeakError(message: TeakMessages.verifyEmail)
        case "frozen": throw TeakError(message: TeakMessages.signupsPaused)
        default: throw TeakError(message: TeakMessages.vaultUnavailable)
        }
    }
}
