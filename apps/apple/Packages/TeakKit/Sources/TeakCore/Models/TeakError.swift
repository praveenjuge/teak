import Foundation

/// A failure with the code and message the server sent, when it sent one.
public struct TeakError: Error, LocalizedError, Sendable, Equatable {
    public let code: String?
    public let message: String

    public init(code: String? = nil, message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }

    public static let cardLimitReached = "CARD_LIMIT_REACHED"
    public static let fileTooLarge = "FILE_TOO_LARGE"
    public static let rateLimited = "RATE_LIMITED"
    public static let unsupportedType = "UNSUPPORTED_TYPE"
    public static let offlineCode = "OFFLINE"
    public static let unauthenticatedCode = "UNAUTHENTICATED"

    public static let offline = TeakError(code: offlineCode, message: TeakMessages.offline)
    public static let signedOut = TeakError(code: unauthenticatedCode, message: "Please sign in again.")

    /// The server's message for a card error code, falling back to `message`.
    public static func card(code: String?, message: String?, fallback: String = TeakMessages.genericFailure) -> TeakError {
        let known = code.flatMap { SharedConstants.shared.cardErrorMessages[$0] }
        return TeakError(code: code, message: message?.nonEmpty ?? known ?? fallback)
    }

    public var isCardLimit: Bool { code == Self.cardLimitReached }
    public var isOffline: Bool { code == Self.offlineCode }
}

public extension Error {
    /// A user-facing message for any error.
    var teakMessage: String {
        if let error = self as? TeakError { return error.message }
        if let error = self as? URLError, error.isConnectivity { return TeakMessages.offline }
        return TeakMessages.genericFailure
    }
}

public extension URLError {
    var isConnectivity: Bool {
        switch code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost,
             .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .secureConnectionFailed:
            true
        default:
            false
        }
    }
}

extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : self
    }
}
