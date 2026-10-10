import Foundation

/// The eight card types the backend stores.
public enum CardType: String, CaseIterable, Codable, Sendable, Identifiable, Hashable {
    case text, link, image, video, audio, document, palette, quote

    public var id: String { rawValue }

    /// "Text", "Link", … (`CARD_TYPE_LABELS`).
    public var label: String { SharedConstants.shared.cardTypeLabels[rawValue] ?? rawValue.capitalized }

    /// Plural names for menus and titles.
    public var plural: String {
        switch self {
        case .text: "Notes"
        case .link: "Links"
        case .image: "Images"
        case .video: "Videos"
        case .audio: "Audio"
        case .document: "Documents"
        case .palette: "Palettes"
        case .quote: "Quotes"
        }
    }

    public var symbol: String {
        switch self {
        case .text: "text.alignleft"
        case .link: "link"
        case .image: "photo"
        case .video: "play.rectangle"
        case .audio: "waveform"
        case .document: "doc.text"
        case .palette: "paintpalette"
        case .quote: "quote.bubble"
        }
    }
}

/// One grid tile (`cards:searchMobileCardSummariesPaginated`).
public struct CardSummary: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let creationTime: Double
    public let type: CardType
    public var title: String
    public var previewText: String?
    public var url: String?
    public var fileName: String?
    public var isFavorited: Bool?
    public var colors: [String]?
    public var aspectRatio: Double?
    public var thumbnailUrl: String?
    public var compactUrl: String?
    public var placeholderUrl: String?
    public var screenshotUrl: String?
    public var linkPreviewImageUrl: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id", creationTime = "_creationTime", type, title, previewText, url, fileName,
             isFavorited, colors, aspectRatio, thumbnailUrl, compactUrl, placeholderUrl,
             screenshotUrl, linkPreviewImageUrl
    }

    public init(id: String, creationTime: Double, type: CardType, title: String, previewText: String? = nil,
                url: String? = nil, fileName: String? = nil, isFavorited: Bool? = nil, colors: [String]? = nil,
                aspectRatio: Double? = nil, thumbnailUrl: String? = nil, compactUrl: String? = nil,
                placeholderUrl: String? = nil, screenshotUrl: String? = nil, linkPreviewImageUrl: String? = nil) {
        self.id = id
        self.creationTime = creationTime
        self.type = type
        self.title = title
        self.previewText = previewText
        self.url = url
        self.fileName = fileName
        self.isFavorited = isFavorited
        self.colors = colors
        self.aspectRatio = aspectRatio
        self.thumbnailUrl = thumbnailUrl
        self.compactUrl = compactUrl
        self.placeholderUrl = placeholderUrl
        self.screenshotUrl = screenshotUrl
        self.linkPreviewImageUrl = linkPreviewImageUrl
    }

    public var favorited: Bool { isFavorited == true }
}

public struct CardSummaryPage: Decodable, Sendable {
    public let page: [CardSummary]
    public let isDone: Bool
    public let continueCursor: String?

    public init(page: [CardSummary], isDone: Bool, continueCursor: String?) {
        self.page = page
        self.isDone = isDone
        self.continueCursor = continueCursor
    }
}

public struct CardColor: Codable, Sendable, Hashable {
    public let hex: String
    public let name: String?

    public init(hex: String, name: String? = nil) {
        self.hex = hex
        self.name = name
    }
}

public struct FilePreviewFacts: Codable, Sendable, Hashable {
    public var slideCount: Double?
    public var wordCount: Double?
    public var archiveFileCount: Double?
    public var archiveDirectoryCount: Double?
    public var animated: Bool?

    public init(slideCount: Double? = nil, wordCount: Double? = nil, archiveFileCount: Double? = nil,
                archiveDirectoryCount: Double? = nil, animated: Bool? = nil) {
        self.slideCount = slideCount
        self.wordCount = wordCount
        self.archiveFileCount = archiveFileCount
        self.archiveDirectoryCount = archiveDirectoryCount
        self.animated = animated
    }
}

public struct FileMetadata: Codable, Sendable, Hashable {
    public var fileSize: Double?
    public var fileName: String?
    public var mimeType: String?
    public var `extension`: String?
    public var kind: String?
    public var language: String?
    public var duration: Double?
    public var width: Double?
    public var height: Double?
    public var preview: FilePreviewFacts?

    public init(fileSize: Double? = nil, fileName: String? = nil, mimeType: String? = nil, extension: String? = nil,
                kind: String? = nil, language: String? = nil, duration: Double? = nil, width: Double? = nil,
                height: Double? = nil, preview: FilePreviewFacts? = nil) {
        self.fileSize = fileSize
        self.fileName = fileName
        self.mimeType = mimeType
        self.extension = `extension`
        self.kind = kind
        self.language = language
        self.duration = duration
        self.width = width
        self.height = height
        self.preview = preview
    }
}

public struct LinkPreview: Codable, Sendable, Hashable {
    public var status: String?
    public var url: String?
    public var finalUrl: String?
    public var title: String?
    public var description: String?
    public var faviconUrl: String?
    public var siteName: String?
    public var author: String?
    public var publisher: String?
    public var publishedAt: String?

    public init(status: String? = nil, url: String? = nil, finalUrl: String? = nil, title: String? = nil,
                description: String? = nil, faviconUrl: String? = nil, siteName: String? = nil,
                author: String? = nil, publisher: String? = nil, publishedAt: String? = nil) {
        self.status = status
        self.url = url
        self.finalUrl = finalUrl
        self.title = title
        self.description = description
        self.faviconUrl = faviconUrl
        self.siteName = siteName
        self.author = author
        self.publisher = publisher
        self.publishedAt = publishedAt
    }
}

public struct LinkFact: Codable, Sendable, Hashable {
    public let label: String
    public let value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

public struct LinkCategory: Codable, Sendable, Hashable {
    public var category: String?
    public var facts: [LinkFact]?

    public init(category: String? = nil, facts: [LinkFact]? = nil) {
        self.category = category
        self.facts = facts
    }
}

public struct CardMetadata: Codable, Sendable, Hashable {
    public var linkPreview: LinkPreview?
    public var linkCategory: LinkCategory?

    public init(linkPreview: LinkPreview? = nil, linkCategory: LinkCategory? = nil) {
        self.linkPreview = linkPreview
        self.linkCategory = linkCategory
    }
}

public struct LinkPreviewMedia: Codable, Sendable, Hashable {
    public let type: String
    public let url: String
    public var width: Double?
    public var height: Double?
    public var posterUrl: String?

    public init(type: String, url: String, width: Double? = nil, height: Double? = nil, posterUrl: String? = nil) {
        self.type = type
        self.url = url
        self.width = width
        self.height = height
        self.posterUrl = posterUrl
    }
}

/// The full card for the detail and edit screens (`cards:getCard`).
public struct Card: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let creationTime: Double
    public let type: CardType
    public var content: String
    public var url: String?
    public var notes: String?
    public var tags: [String]?
    public var aiTags: [String]?
    public var aiSummary: String?
    public var aiTranscript: String?
    public var metadataTitle: String?
    public var metadataDescription: String?
    public var isFavorited: Bool?
    public var isDeleted: Bool?
    public var createdAt: Double
    public var updatedAt: Double
    public var colors: [CardColor]?
    public var fileMetadata: FileMetadata?
    public var metadata: CardMetadata?
    public var fileUrl: String?
    public var detailUrl: String?
    public var thumbnailUrl: String?
    public var compactUrl: String?
    public var placeholderUrl: String?
    public var screenshotUrl: String?
    public var linkPreviewImageUrl: String?
    public var linkPreviewMedia: [LinkPreviewMedia]?

    enum CodingKeys: String, CodingKey {
        case id = "_id", creationTime = "_creationTime", type, content, url, notes, tags, aiTags, aiSummary,
             aiTranscript, metadataTitle, metadataDescription, isFavorited, isDeleted, createdAt, updatedAt,
             colors, fileMetadata, metadata, fileUrl, detailUrl, thumbnailUrl, compactUrl, placeholderUrl,
             screenshotUrl, linkPreviewImageUrl, linkPreviewMedia
    }

    public init(id: String, creationTime: Double = 0, type: CardType, content: String = "", url: String? = nil,
                notes: String? = nil, tags: [String]? = nil, aiTags: [String]? = nil, aiSummary: String? = nil,
                aiTranscript: String? = nil, metadataTitle: String? = nil, metadataDescription: String? = nil,
                isFavorited: Bool? = nil, isDeleted: Bool? = nil, createdAt: Double? = nil, updatedAt: Double? = nil,
                colors: [CardColor]? = nil, fileMetadata: FileMetadata? = nil, metadata: CardMetadata? = nil,
                fileUrl: String? = nil, detailUrl: String? = nil, thumbnailUrl: String? = nil,
                compactUrl: String? = nil, placeholderUrl: String? = nil, screenshotUrl: String? = nil,
                linkPreviewImageUrl: String? = nil, linkPreviewMedia: [LinkPreviewMedia]? = nil) {
        self.id = id
        self.creationTime = creationTime
        self.type = type
        self.content = content
        self.url = url
        self.notes = notes
        self.tags = tags
        self.aiTags = aiTags
        self.aiSummary = aiSummary
        self.aiTranscript = aiTranscript
        self.metadataTitle = metadataTitle
        self.metadataDescription = metadataDescription
        self.isFavorited = isFavorited
        self.isDeleted = isDeleted
        self.createdAt = createdAt ?? creationTime
        self.updatedAt = updatedAt ?? creationTime
        self.colors = colors
        self.fileMetadata = fileMetadata
        self.metadata = metadata
        self.fileUrl = fileUrl
        self.detailUrl = detailUrl
        self.thumbnailUrl = thumbnailUrl
        self.compactUrl = compactUrl
        self.placeholderUrl = placeholderUrl
        self.screenshotUrl = screenshotUrl
        self.linkPreviewImageUrl = linkPreviewImageUrl
        self.linkPreviewMedia = linkPreviewMedia
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        creationTime = try c.decode(Double.self, forKey: .creationTime)
        type = try c.decode(CardType.self, forKey: .type)
        content = try c.decodeIfPresent(String.self, forKey: .content) ?? ""
        url = try c.decodeIfPresent(String.self, forKey: .url)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        tags = try c.decodeIfPresent([String].self, forKey: .tags)
        aiTags = try c.decodeIfPresent([String].self, forKey: .aiTags)
        aiSummary = try c.decodeIfPresent(String.self, forKey: .aiSummary)
        aiTranscript = try c.decodeIfPresent(String.self, forKey: .aiTranscript)
        metadataTitle = try c.decodeIfPresent(String.self, forKey: .metadataTitle)
        metadataDescription = try c.decodeIfPresent(String.self, forKey: .metadataDescription)
        isFavorited = try c.decodeIfPresent(Bool.self, forKey: .isFavorited)
        isDeleted = try c.decodeIfPresent(Bool.self, forKey: .isDeleted)
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? creationTime
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? creationTime
        colors = try c.decodeIfPresent([CardColor].self, forKey: .colors)
        fileMetadata = try c.decodeIfPresent(FileMetadata.self, forKey: .fileMetadata)
        metadata = try c.decodeIfPresent(CardMetadata.self, forKey: .metadata)
        fileUrl = try c.decodeIfPresent(String.self, forKey: .fileUrl)
        detailUrl = try c.decodeIfPresent(String.self, forKey: .detailUrl)
        thumbnailUrl = try c.decodeIfPresent(String.self, forKey: .thumbnailUrl)
        compactUrl = try c.decodeIfPresent(String.self, forKey: .compactUrl)
        placeholderUrl = try c.decodeIfPresent(String.self, forKey: .placeholderUrl)
        screenshotUrl = try c.decodeIfPresent(String.self, forKey: .screenshotUrl)
        linkPreviewImageUrl = try c.decodeIfPresent(String.self, forKey: .linkPreviewImageUrl)
        linkPreviewMedia = try c.decodeIfPresent([LinkPreviewMedia].self, forKey: .linkPreviewMedia)
    }

    public var favorited: Bool { isFavorited == true }
    public var deleted: Bool { isDeleted == true }
}

/// `auth:getCurrentUser`.
public struct CurrentUser: Decodable, Sendable, Hashable {
    public let id: String
    public let email: String
    public var hasPremium: Bool
    public var cardCount: Double
    public var canCreateCard: Bool

    enum CodingKeys: String, CodingKey { case id = "_id", email, hasPremium, cardCount, canCreateCard }

    public init(id: String, email: String, hasPremium: Bool = false, cardCount: Double = 0, canCreateCard: Bool = true) {
        self.id = id
        self.email = email
        self.hasPremium = hasPremium
        self.cardCount = cardCount
        self.canCreateCard = canCreateCard
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = try c.decodeIfPresent(String.self, forKey: .email) ?? ""
        hasPremium = try c.decodeIfPresent(Bool.self, forKey: .hasPremium) ?? false
        cardCount = try c.decodeIfPresent(Double.self, forKey: .cardCount) ?? 0
        canCreateCard = try c.decodeIfPresent(Bool.self, forKey: .canCreateCard) ?? true
    }

    public var plan: String { hasPremium ? "Pro" : "Free" }

    /// "12 of 200 Cards" on Free, "12 Cards" on Pro.
    public var usageLabel: String {
        let count = Int(cardCount)
        let noun = count == 1 ? "Card" : "Cards"
        return hasPremium ? "\(count) \(noun)" : "\(count) of \(TeakLimits.freeTierCards) Cards"
    }
}

/// `auth:getAuthMode`: whether sign-up is open and which WorkOS client signs in.
public struct AuthMode: Codable, Sendable, Hashable {
    public let primary: String
    public let signupsDisabled: Bool
    public let accountChangesPaused: Bool
    public let authKitClientId: String?

    public init(primary: String = "workos", signupsDisabled: Bool, accountChangesPaused: Bool, authKitClientId: String?) {
        self.primary = primary
        self.signupsDisabled = signupsDisabled
        self.accountChangesPaused = accountChangesPaused
        self.authKitClientId = authKitClientId
    }

    /// Port of `parseAuthMode`: anything but a WorkOS mode with a well-formed client ID is rejected.
    public static func parse(_ data: Data) throws -> AuthMode {
        guard let mode = try? JSONDecoder().decode(AuthMode.self, from: data),
              mode.primary == "workos",
              let clientId = mode.authKitClientId,
              WorkOSClientID.isValid(clientId)
        else { throw TeakError(message: "Unable to load sign-in configuration") }
        return mode
    }
}

public enum WorkOSClientID {
    public static func isValid(_ value: String) -> Bool {
        value.wholeMatch(of: /client_[A-Za-z0-9]{1,128}/) != nil
    }
}

/// The color buckets the server can filter by (`COLOR_HUE_BUCKETS`).
public struct ColorHue: Hashable, Sendable, Identifiable {
    public let id: String
    public var label: String { SharedConstants.shared.colorHueLabels[id] ?? id.capitalized }

    public init?(_ id: String) {
        guard SharedConstants.shared.colorHues.contains(id) else { return nil }
        self.id = id
    }

    public static var all: [ColorHue] { SharedConstants.shared.colorHues.compactMap(ColorHue.init) }

    /// A swatch for the filter menu.
    public var hex: String {
        switch id {
        case "red": "#EF4444"
        case "orange": "#F97316"
        case "yellow": "#EAB308"
        case "green": "#22C55E"
        case "teal": "#14B8A6"
        case "cyan": "#06B6D4"
        case "blue": "#3B82F6"
        case "purple": "#A855F7"
        case "pink": "#EC4899"
        case "brown": "#92400E"
        default: "#737373"
        }
    }
}
