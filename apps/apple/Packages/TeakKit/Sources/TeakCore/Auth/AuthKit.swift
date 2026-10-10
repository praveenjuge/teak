import CryptoKit
import Foundation

/// How someone chose to sign in on the welcome screen.
public enum SignInMethod: String, Sendable, CaseIterable {
    case apple, google, emailSignUp, emailSignIn

    var provider: String {
        switch self {
        case .apple: "AppleOAuth"
        case .google: "GoogleOAuth"
        case .emailSignUp, .emailSignIn: "authkit"
        }
    }

    var screenHint: String? {
        switch self {
        case .emailSignUp: "sign-up"
        case .emailSignIn: "sign-in"
        default: nil
        }
    }

    /// Apple returns to WorkOS with a cross-site form POST, which App Review saw
    /// fail in a private session, and it never sets AuthKit's cookie. Every other
    /// provider uses a private session, so Log Out needs no browser logout.
    public var prefersEphemeralSession: Bool { self != .apple }

    /// "Apple", "Google" or "Email", for alerts.
    public var label: String {
        switch self {
        case .apple: "Apple"
        case .google: "Google"
        case .emailSignUp, .emailSignIn: "Email"
        }
    }
}

/// One AuthKit sign-in attempt: the authorize URL plus the PKCE verifier and state to check the redirect.
public struct AuthKitRequest: Sendable {
    public static let redirectURI = "teak://auth/callback"
    public static let callbackScheme = "teak"

    public let clientId: String
    public let state: String
    public let verifier: String
    public let url: URL

    public init(clientId: String, method: SignInMethod, workosURL: URL = TeakConfig.hostedWorkOS,
                state: String = AuthKitRequest.randomToken(), verifier: String = AuthKitRequest.randomToken()) {
        self.clientId = clientId
        self.state = state
        self.verifier = verifier
        var components = URLComponents(url: workosURL.appending(path: "user_management/authorize"),
                                       resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: Self.challenge(for: verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "provider", value: method.provider),
        ]
        if let hint = method.screenHint { items.append(URLQueryItem(name: "screen_hint", value: hint)) }
        components.queryItems = items
        url = components.url!
    }

    /// 43 URL-safe characters from 32 random bytes.
    public static func randomToken() -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return base64URL(Data(bytes))
    }

    public static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public enum Callback: Equatable, Sendable {
        case code(String)
        case cancelled
    }

    /// Reads `teak://auth/callback?code=…&state=…`. A denied consent is a cancel;
    /// anything else that isn't this attempt's code is a failure.
    public func callback(from url: URL) throws -> Callback {
        guard url.scheme == Self.callbackScheme, url.host() == "auth", url.path() == "/callback",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        else { throw TeakError(message: "Unable to complete sign-in. Please try again.") }
        func item(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if item("error") == "access_denied" { return .cancelled }
        guard item("error") == nil, item("state") == state, let code = item("code"), !code.isEmpty else {
            throw TeakError(message: "Unable to complete sign-in. Please try again.")
        }
        return .code(code)
    }
}
