import Foundation

/// The backend's shared constants, read from `SharedConstants.json`, which
/// `apps/apple/scripts/shared-constants.ts` exports from `packages/convex/shared`.
public struct SharedConstants: Decodable, Sendable {
    public struct Limits: Decodable, Sendable {
        public let freeTierCards: Int
        public let maxFileSize: Int
        public let maxFilesPerUpload: Int
        public let maxFileNameLength: Int
        public let markdownContentMaxBytes: Int
    }

    public struct Messages: Decodable, Sendable {
        public let signupsPaused: String
        public let accountChangesPaused: String
    }

    public let cardTypes: [String]
    public let cardTypeLabels: [String: String]
    public let limits: Limits
    public let messages: Messages
    public let cardErrorMessages: [String: String]
    public let visualStyles: [String]
    public let visualStyleLabels: [String: String]
    public let visualStyleAliases: [String: String]
    public let colorHues: [String]
    public let colorHueLabels: [String: String]
    public let colorHueAliases: [String: String]
    public let genericMimeTypes: [String]
    public let fileFormats: [FileFormat]

    public static let shared: SharedConstants = {
        guard let url = Bundle.module.url(forResource: "SharedConstants", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let constants = try? JSONDecoder().decode(SharedConstants.self, from: data)
        else {
            fatalError("SharedConstants.json is missing or invalid; regenerate it with apps/apple/scripts/shared-constants.ts")
        }
        return constants
    }()
}

/// Shorthands for the constants the UI uses most.
public enum TeakLimits {
    public static var freeTierCards: Int { SharedConstants.shared.limits.freeTierCards }
    public static var maxFileSize: Int { SharedConstants.shared.limits.maxFileSize }
    public static var maxFilesPerUpload: Int { SharedConstants.shared.limits.maxFilesPerUpload }
}

public enum TeakMessages {
    public static var signupsPaused: String { SharedConstants.shared.messages.signupsPaused }
    public static var accountChangesPaused: String { SharedConstants.shared.messages.accountChangesPaused }
    public static let verifyEmail = "Verify your email before opening your vault."
    public static let vaultUnavailable = "Unable to open your vault. Please try again or contact support."
    public static let genericFailure = "Something went wrong. Please try again."
    public static let offline = "Check your connection and try again."
}
