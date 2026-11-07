import Foundation

public struct SharedConstants: Decodable, Sendable {
    public struct Limits: Decodable, Sendable {
        public let freeTierCards: Int
        public let maxFileSize: Int
        public let maxFilesPerUpload: Int
        public let maxFileNameLength: Int
        public let markdownContentMaxBytes: Int
        public let maxTagNameLength: Int
        public let maxTagKeyLength: Int
        public let maxBulkCardIds: Int
        public let maxBulkTags: Int
        public let cardLinkTitleMaxLength: Int
        public let maxCardLinks: Int
        public let semanticQueryMaxChars: Int
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
    public let cardTypeAliases: [String: String]
    public let limits: Limits
    public let messages: Messages
    public let cardErrorMessages: [String: String]
    public let tagErrorMessages: [String: String]
    public let folderErrorMessages: [String: String]
    public let hiddenTagKeys: [String]
    public let linkCategoryDoneVerbs: [String: String]
    public let actionableLinkCategories: [String]
    public let bulkCardActions: [String]
    public let visualStyles: [String]
    public let visualStyleLabels: [String: String]
    public let visualStyleAliases: [String: String]
    public let colorHues: [String]
    public let colorHueLabels: [String: String]
    public let colorHueAliases: [String: String]
    public let colorHueSwatches: [String: String]
    public let genericMimeTypes: [String]
    public let cardLinkTokenPattern: String
    public let searchQualifierKeys: [String]
    public let searchIsWords: [String: [String]]
    public let searchTokenTrimCharacters: String
    public let searchSuggestionHints: SearchSuggestionHints
    public let locales: [AppLanguage.Option]
    public let fileFormats: [FileFormat]

    public enum LoadError: Error, CustomStringConvertible {
        case missing
        case unreadable(any Error)
        case invalid(any Error)

        public var description: String {
            switch self {
            case .missing: "SharedConstants.json isn't in TeakCore's resources"
            case let .unreadable(error): "SharedConstants.json can't be read: \(error)"
            case let .invalid(error):
                "SharedConstants.json doesn't match SharedConstants; regenerate it with apps/apple/scripts/shared-constants.ts --write: \(error)"
            }
        }
    }

    public static func decode(_ data: Data) throws -> SharedConstants {
        do {
            return try JSONDecoder().decode(SharedConstants.self, from: data)
        } catch {
            throw LoadError.invalid(error)
        }
    }

    static func load(from bundle: Bundle = .module) throws -> SharedConstants {
        guard let url = bundle.url(forResource: "SharedConstants", withExtension: "json") else { throw LoadError.missing }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw LoadError.unreadable(error)
        }
        return try decode(data)
    }

    public static let shared: SharedConstants = {
        do {
            return try load()
        } catch {
            fatalError("\(error)")
        }
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
