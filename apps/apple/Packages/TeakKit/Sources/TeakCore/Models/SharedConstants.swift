import Foundation

public struct SharedConstants: Decodable, Sendable {
    public struct Limits: Decodable, Sendable {
        public let freeTierCards: Int
        public let maxFileSize: Int
        public let maxFilesPerUpload: Int
        public let maxFileNameLength: Int
        public let markdownContentMaxBytes: Int
        public let maxTagNameLength: Int
    }

    public struct Messages: Decodable, Sendable {
        public let signupsPaused: String
    }

    public struct SearchSuggestionHints: Decodable, Sendable {
        public struct Hint: Decodable, Sendable {
            public let id: String
            public let group: String
            public let key: String
            public let insert: String
            public let messageKey: String
        }

        public struct IsOption: Decodable, Sendable {
            public let value: String
            public let words: [String]
            public let messageKey: String
        }

        public let qualifiers: [Hint]
        public let exclude: [Hint]
        public let or: Hint
        public let isOptions: [IsOption]
        public let groups: [String: String]
    }

    public let cardTypes: [String]
    public let cardTypeLabels: [String: String]
    public let limits: Limits
    public let messages: Messages
    public let cardErrorMessages: [String: String]
    public let tagErrorMessages: [String: String]
    public let folderErrorMessages: [String: String]
    public let hiddenTagKeys: [String]
    public let linkCategoryDoneVerbs: [String: String]
    public let actionableLinkCategories: [String]
    public let visualStyles: [String]
    public let visualStyleLabels: [String: String]
    public let visualStyleAliases: [String: String]
    public let colorHues: [String]
    public let colorHueLabels: [String: String]
    public let colorHueAliases: [String: String]
    public let genericMimeTypes: [String]
    public let searchSuggestionHints: SearchSuggestionHints
    public let locales: [AppLanguage.Option]
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

public enum TeakLimits {
    public static var freeTierCards: Int { SharedConstants.shared.limits.freeTierCards }
    public static var maxFileSize: Int { SharedConstants.shared.limits.maxFileSize }
    public static var maxFilesPerUpload: Int { SharedConstants.shared.limits.maxFilesPerUpload }
}

public enum TeakMessages {
    public static var signupsPaused: String { tr("native.errors.signupsPaused") }
    public static var verifyEmail: String { tr("native.errors.verifyEmail") }
    public static var vaultUnavailable: String { tr("native.errors.vaultUnavailable") }
    public static var genericFailure: String { tr("native.errors.generic") }
    public static var offline: String { tr("native.errors.offline") }
}
