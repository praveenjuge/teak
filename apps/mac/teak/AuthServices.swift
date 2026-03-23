import CryptoKit
import Foundation
import AppKit
import Combine
import ConvexMobile

struct NativeSession: Sendable {
    let sessionToken: String
    let convexToken: String
}

struct CurrentUser: Decodable, Sendable {
    let name: String
    let username: String?
    let displayUsername: String?

    var preferredDisplayName: String {
        if let displayUsername, !displayUsername.isEmpty {
            return displayUsername
        }
        if let username, !username.isEmpty {
            return username
        }
        return name
    }
}

final class AuthAPIClient {
    private let config: AppConfig

    init(config: AppConfig) {
        self.config = config
    }

    func signOut(sessionToken: String) async {
        let url = config.convexSiteURL.appending(path: "/api/auth/sign-out")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }

    func fetchConvexToken(sessionToken: String) async throws -> String {
        let url = config.convexSiteURL.appending(path: "/api/auth/convex/token")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthServiceError.invalidResponse
        }

        if httpResponse.statusCode == 401 || httpResponse.statusCode == 403 {
            throw AuthServiceError.unauthorized
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw try decodeServiceError(from: data, fallback: "Failed to fetch Convex auth token.")
        }

        let payload = try JSONDecoder().decode(ConvexTokenResponse.self, from: data)
        guard !payload.token.isEmpty else {
            throw AuthServiceError.invalidResponse
        }
        return payload.token
    }

    func fetchCurrentUser(with client: ConvexClientWithAuth<NativeSession>) async throws -> CurrentUser? {
        let stream = client
            .subscribe(to: "auth:getCurrentUser", yielding: CurrentUser?.self)
            .values

        for try await user in stream {
            return user
        }

        return nil
    }

    func makeBrowserAuthRequest(deviceID: String) -> BrowserAuthRequest {
        let codeVerifier = randomBase64URL(byteCount: 48)
        let codeChallenge = codeChallenge(for: codeVerifier)
        let state = randomBase64URL(byteCount: 18)

        let completionURL = config.buildWebURL(path: "/desktop/auth/complete")
        let startURL = config.buildWebURL(
            path: "/desktop/auth/start",
            queryItems: [
                URLQueryItem(name: "device_id", value: deviceID),
                URLQueryItem(name: "code_challenge", value: codeChallenge),
                URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "redirect_uri", value: completionURL.absoluteString),
            ]
        )

        return BrowserAuthRequest(
            startURL: startURL,
            codeVerifier: codeVerifier,
            state: state,
            deviceID: deviceID
        )
    }

    func openBrowser(for request: BrowserAuthRequest) throws {
        let didOpen = NSWorkspace.shared.open(request.startURL)
        if !didOpen {
            throw AuthServiceError.browserOpenFailed
        }
    }

    func pollForBrowserSession(_ request: BrowserAuthRequest) async throws -> String {
        let pollURL = config.convexSiteURL.appending(path: "/api/desktop/auth/poll")
        let deadline = Date().addingTimeInterval(5 * 60)

        while Date() < deadline {
            let response: BrowserPollResult? = try await sendBrowserPoll(
                to: pollURL,
                body: BrowserPollBody(
                    state: request.state,
                    deviceId: request.deviceID,
                    codeVerifier: request.codeVerifier
                )
            )

            if let sessionToken = response?.sessionToken, !sessionToken.isEmpty {
                return sessionToken
            }

            try await Task.sleep(for: .seconds(2))
        }

        throw AuthServiceError.browserFlowTimedOut
    }

    private func sendBrowserPoll(to url: URL, body: BrowserPollBody) async throws -> BrowserPollResult? {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthServiceError.invalidResponse
        }

        if httpResponse.statusCode == 204 {
            return nil
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw try decodeServiceError(from: data, fallback: "Browser sign-in failed.")
        }

        return try JSONDecoder().decode(BrowserPollResult.self, from: data)
    }

    private func sendJSONRequest<Body: Encodable, Response: Decodable>(
        to url: URL,
        method: String,
        body: Body
    ) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthServiceError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw try decodeServiceError(from: data, fallback: "Authentication request failed.")
        }

        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func decodeServiceError(from data: Data, fallback: String) throws -> Error {
        if let apiError = try? JSONDecoder().decode(AuthErrorPayload.self, from: data),
           let message = apiError.message, !message.isEmpty {
            return AuthServiceError.server(message)
        }
        return AuthServiceError.server(fallback)
    }

    private func randomBase64URL(byteCount: Int) -> String {
        let data = Data((0..<byteCount).map { _ in UInt8.random(in: 0...255) })
        return data
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func codeChallenge(for verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

final class TeakAuthProvider: AuthProvider {
    typealias T = NativeSession

    private let sessionStore: SessionStore
    private let apiClient: AuthAPIClient

    init(sessionStore: SessionStore, apiClient: AuthAPIClient) {
        self.sessionStore = sessionStore
        self.apiClient = apiClient
    }

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> NativeSession {
        try await loginFromCache(onIdToken: onIdToken)
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> NativeSession {
        guard let sessionToken = await sessionStore.loadSessionToken(), !sessionToken.isEmpty else {
            onIdToken(nil)
            throw AuthServiceError.missingSession
        }

        do {
            let convexToken = try await apiClient.fetchConvexToken(sessionToken: sessionToken)
            onIdToken(convexToken)
            return NativeSession(sessionToken: sessionToken, convexToken: convexToken)
        } catch {
            await sessionStore.clearSessionToken()
            onIdToken(nil)
            throw error
        }
    }

    func logout() async throws {
        if let sessionToken = await sessionStore.loadSessionToken(), !sessionToken.isEmpty {
            await apiClient.signOut(sessionToken: sessionToken)
        }
        await sessionStore.clearSessionToken()
    }

    func extractIdToken(from authResult: NativeSession) -> String {
        authResult.convexToken
    }
}

struct BrowserAuthRequest: Sendable {
    let startURL: URL
    let codeVerifier: String
    let state: String
    let deviceID: String
}

private struct ConvexTokenResponse: Decodable {
    let token: String
}

private struct BrowserPollBody: Encodable {
    let state: String
    let deviceId: String
    let codeVerifier: String
}

private struct BrowserPollResult: Decodable {
    let sessionToken: String
}

private struct AuthErrorPayload: Decodable {
    let message: String?
}

enum AuthServiceError: LocalizedError {
    case browserFlowTimedOut
    case browserOpenFailed
    case invalidResponse
    case missingSession
    case server(String)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .browserFlowTimedOut:
            return "Timed out waiting for browser sign-in to finish."
        case .browserOpenFailed:
            return "Unable to open the browser."
        case .invalidResponse:
            return "The server returned an invalid response."
        case .missingSession:
            return "No saved session was found."
        case .server(let message):
            return message
        case .unauthorized:
            return "Your session expired. Please sign in again."
        }
    }
}
