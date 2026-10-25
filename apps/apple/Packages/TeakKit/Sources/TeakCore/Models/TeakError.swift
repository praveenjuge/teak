import Foundation

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
    public static let invalidCursorCode = "INVALID_CURSOR"

    public static var offline: TeakError { TeakError(code: offlineCode, message: TeakMessages.offline) }
    public static var signedOut: TeakError { TeakError(code: unauthenticatedCode, message: tr("native.errors.signInAgain")) }

    /// A server error in the app's language: the catalog's text for its code, else the server's message.
    public static func card(code: String?, message: String?, fallback: String = TeakMessages.genericFailure) -> TeakError {
        let known = code.flatMap(localizedMessage)
        let tooFast = code == rateLimited ? tr("errors.cards.RATE_LIMITED") : nil
        return TeakError(code: code, message: known ?? message?.nonEmpty ?? tooFast ?? fallback)
    }

    /// The web's text for a code the backend throws (`errors.<group>.<CODE>`). Codes more than one group
    /// throws with different words (`NOT_FOUND`, `RATE_LIMITED`, `EMPTY_NAME`, `NAME_TOO_LONG`), and ones
    /// whose limit the app doesn't know, keep the server's message.
    static func localizedMessage(_ code: String) -> String? {
        switch code {
        case cardLimitReached: tr("errors.cards.CARD_LIMIT_REACHED")
        case "CONTENT_TOO_LARGE": tr("errors.cards.CONTENT_TOO_LARGE")
        case "INVALID_UTF8": tr("errors.cards.INVALID_UTF8")
        case fileTooLarge: tr("errors.cards.FILE_TOO_LARGE")
        case "TOO_MANY_FILES": tr("errors.cards.TOO_MANY_FILES", String(TeakLimits.maxFilesPerUpload))
        case unsupportedType: tr("errors.cards.UNSUPPORTED_TYPE")
        case "TYPE_MISMATCH": tr("errors.cards.TYPE_MISMATCH")
        case "DUPLICATE_NAME": tr("errors.folders.DUPLICATE_NAME")
        case "EMPTY_QUERY": tr("errors.folders.EMPTY_QUERY")
        case "SMART_FOLDER_IN_QUERY": tr("errors.folders.SMART_FOLDER_IN_QUERY")
        case "SMART_FOLDER_MEMBERSHIP": tr("errors.folders.SMART_FOLDER_MEMBERSHIP")
        case "QUERY_ON_MANUAL_FOLDER": tr("errors.folders.QUERY_ON_MANUAL_FOLDER")
        case "SMART_FOLDER_TRASH": tr("errors.folders.SMART_FOLDER_TRASH")
        case "SAME_TAG": tr("errors.tags.SAME_TAG")
        case "OPERATION_RUNNING": tr("errors.tags.OPERATION_RUNNING")
        case "OPERATION_NOT_FOUND": tr("errors.tags.OPERATION_NOT_FOUND")
        case "TAG_TOO_LONG": tr("errors.cardTags.TAG_TOO_LONG", String(SharedConstants.shared.limits.maxTagNameLength))
        case "IN_PROGRESS": tr("errors.pdfs.IN_PROGRESS")
        case "NO_PDF": tr("errors.pdfs.NO_PDF")
        case "TRASHED": tr("errors.pdfs.TRASHED")
        case "UNSUPPORTED_LOCALE": tr("errors.settings.UNSUPPORTED_LOCALE")
        default: nil
        }
    }

    public static func server(message: String) -> TeakError {
        TeakError(code: message.contains("InvalidCursor") ? invalidCursorCode : nil,
                  message: ConvexHTTP.userMessage(message))
    }

    public var isCardLimit: Bool { code == Self.cardLimitReached }
    public var isOffline: Bool { code == Self.offlineCode }
    public var isInvalidCursor: Bool { code == Self.invalidCursorCode }
    public var isSignedOut: Bool { code == Self.unauthenticatedCode }
}

public extension Error {
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
