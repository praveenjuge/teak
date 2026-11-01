import Foundation

public enum CardType: String, CaseIterable, Codable, Sendable, Identifiable, Hashable {
    case text, link, image, video, audio, document, palette, quote

    public var id: String { rawValue }

    public var showsSummaryColors: Bool { self != .palette }

    public var label: String {
        switch self {
        case .text: tr("cards.types.text")
        case .link: tr("cards.types.link")
        case .image: tr("cards.types.image")
        case .video: tr("cards.types.video")
        case .audio: tr("cards.types.audio")
        case .document: tr("cards.types.document")
        case .palette: tr("cards.types.palette")
        case .quote: tr("cards.types.quote")
        }
    }

    public var plural: String {
        switch self {
        case .text: tr("native.filters.types.text")
        case .link: tr("native.filters.types.link")
        case .image: tr("native.filters.types.image")
        case .video: tr("native.filters.types.video")
        case .audio: tr("native.filters.types.audio")
        case .document: tr("native.filters.types.document")
        case .palette: tr("native.filters.types.palette")
        case .quote: tr("native.filters.types.quote")
        }
    }

    public var favoritesTitle: String {
        switch self {
        case .text: tr("native.filters.favoriteTypes.text")
        case .link: tr("native.filters.favoriteTypes.link")
        case .image: tr("native.filters.favoriteTypes.image")
        case .video: tr("native.filters.favoriteTypes.video")
        case .audio: tr("native.filters.favoriteTypes.audio")
        case .document: tr("native.filters.favoriteTypes.document")
        case .palette: tr("native.filters.favoriteTypes.palette")
        case .quote: tr("native.filters.favoriteTypes.quote")
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
    public var isArchived: Bool?
    public var completedAt: Double?
    public var linkCategory: String?
    public var linkPrice: LinkPrice?

    enum CodingKeys: String, CodingKey {
        case id = "_id", creationTime = "_creationTime", type, title, previewText, url, fileName,
             isFavorited, colors, aspectRatio, thumbnailUrl, compactUrl, placeholderUrl,
             screenshotUrl, linkPreviewImageUrl, isArchived, completedAt, linkCategory, linkPrice
    }

    public init(id: String, creationTime: Double, type: CardType, title: String, previewText: String? = nil,
                url: String? = nil, fileName: String? = nil, isFavorited: Bool? = nil, colors: [String]? = nil,
                aspectRatio: Double? = nil, thumbnailUrl: String? = nil, compactUrl: String? = nil,
                placeholderUrl: String? = nil, screenshotUrl: String? = nil, linkPreviewImageUrl: String? = nil,
                isArchived: Bool? = nil, completedAt: Double? = nil, linkCategory: String? = nil,
                linkPrice: LinkPrice? = nil) {
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
        self.isArchived = isArchived
        self.completedAt = completedAt
        self.linkCategory = linkCategory
        self.linkPrice = linkPrice
    }

    public var favorited: Bool { isFavorited == true }
    public var archived: Bool { isArchived == true }
    public var isDone: Bool { completedAt != nil }
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

public struct CardSummaryPageResult: Decodable, Sendable {
    public let page: CardSummaryPage
    public let splitCursor: String?
    public let pageStatus: String?

    enum CodingKeys: String, CodingKey { case splitCursor, pageStatus }

    public init(from decoder: any Decoder) throws {
        page = try CardSummaryPage(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        splitCursor = try container.decodeIfPresent(String.self, forKey: .splitCursor)
        pageStatus = try container.decodeIfPresent(String.self, forKey: .pageStatus)
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
    public var exif: ImageExif?

    public init(fileSize: Double? = nil, fileName: String? = nil, mimeType: String? = nil, extension: String? = nil,
                kind: String? = nil, language: String? = nil, duration: Double? = nil, width: Double? = nil,
                height: Double? = nil, preview: FilePreviewFacts? = nil, exif: ImageExif? = nil) {
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
        self.exif = exif
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
    public var price: LinkPrice?

    public init(category: String? = nil, facts: [LinkFact]? = nil, price: LinkPrice? = nil) {
        self.category = category
        self.facts = facts
        self.price = price
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
    public var metadataTitleEdited: Bool?
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
    public var isArchived: Bool?
    public var completedAt: Double?
    public var sourceUrl: String?
    public var sourceTitle: String?
    public var folderIds: [String]?

    enum CodingKeys: String, CodingKey {
        case id = "_id", creationTime = "_creationTime", type, content, url, notes, tags, aiTags, aiSummary,
             aiTranscript, metadataTitle, metadataTitleEdited, metadataDescription, isFavorited, isDeleted, createdAt,
             updatedAt, colors, fileMetadata, metadata, fileUrl, detailUrl, thumbnailUrl, compactUrl, placeholderUrl,
             screenshotUrl, linkPreviewImageUrl, linkPreviewMedia, isArchived, completedAt, sourceUrl, sourceTitle,
             folderIds
    }

    public init(id: String, creationTime: Double = 0, type: CardType, content: String = "", url: String? = nil,
                notes: String? = nil, tags: [String]? = nil, aiTags: [String]? = nil, aiSummary: String? = nil,
                aiTranscript: String? = nil, metadataTitle: String? = nil, metadataDescription: String? = nil,
                isFavorited: Bool? = nil, isDeleted: Bool? = nil, createdAt: Double? = nil, updatedAt: Double? = nil,
                colors: [CardColor]? = nil, fileMetadata: FileMetadata? = nil, metadata: CardMetadata? = nil,
                fileUrl: String? = nil, detailUrl: String? = nil, thumbnailUrl: String? = nil,
                compactUrl: String? = nil, placeholderUrl: String? = nil, screenshotUrl: String? = nil,
                linkPreviewImageUrl: String? = nil, linkPreviewMedia: [LinkPreviewMedia]? = nil,
                isArchived: Bool? = nil, completedAt: Double? = nil, sourceUrl: String? = nil,
                sourceTitle: String? = nil, folderIds: [String]? = nil, metadataTitleEdited: Bool? = nil) {
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
        self.metadataTitleEdited = metadataTitleEdited
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
        self.isArchived = isArchived
        self.completedAt = completedAt
        self.sourceUrl = sourceUrl
        self.sourceTitle = sourceTitle
        self.folderIds = folderIds
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
        metadataTitleEdited = try c.decodeIfPresent(Bool.self, forKey: .metadataTitleEdited)
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
        isArchived = try c.decodeIfPresent(Bool.self, forKey: .isArchived)
        completedAt = try c.decodeIfPresent(Double.self, forKey: .completedAt)
        sourceUrl = try c.decodeIfPresent(String.self, forKey: .sourceUrl)
        sourceTitle = try c.decodeIfPresent(String.self, forKey: .sourceTitle)
        folderIds = try c.decodeIfPresent([String].self, forKey: .folderIds)
    }

    public var favorited: Bool { isFavorited == true }
    public var deleted: Bool { isDeleted == true }
    public var archived: Bool { isArchived == true }
    public var isDone: Bool { completedAt != nil }
    public var linkCategoryName: String? { metadata?.linkCategory?.category }
}

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

    public var plan: String { hasPremium ? "Pro" : tr("native.card.plan.free") }

    public var usageLabel: String {
        let count = Int(cardCount)
        if hasPremium { return tr("native.common.cardCount", count: count) }
        return tr("native.card.usage", count: TeakLimits.freeTierCards, count.formatted(.number.locale(AppLanguage.locale)))
    }
}

public struct AuthMode: Codable, Sendable, Hashable {
    public let primary: String
    public let signupsDisabled: Bool
    public let authKitClientId: String?

    public init(primary: String = "workos", signupsDisabled: Bool, authKitClientId: String?) {
        self.primary = primary
        self.signupsDisabled = signupsDisabled
        self.authKitClientId = authKitClientId
    }

    public static func parse(_ data: Data) throws -> AuthMode {
        guard let mode = try? JSONDecoder().decode(AuthMode.self, from: data),
              mode.primary == "workos",
              let clientId = mode.authKitClientId,
              WorkOSClientID.isValid(clientId)
        else { throw TeakError(message: tr("native.errors.signInConfig")) }
        return mode
    }
}

public enum WorkOSClientID {
    public static func isValid(_ value: String) -> Bool {
        value.wholeMatch(of: /client_[A-Za-z0-9]{1,128}/) != nil
    }
}

public enum VisualStyle {
    public static func label(_ id: String) -> String {
        switch id {
        case "abstract": tr("search.visualStyles.abstract")
        case "cinematic": tr("search.visualStyles.cinematic")
        case "dark": tr("search.visualStyles.dark")
        case "illustrative": tr("search.visualStyles.illustrative")
        case "minimal": tr("search.visualStyles.minimal")
        case "monochrome": tr("search.visualStyles.monochrome")
        case "moody": tr("search.visualStyles.moody")
        case "pastel": tr("search.visualStyles.pastel")
        case "photographic": tr("search.visualStyles.photographic")
        case "retro": tr("search.visualStyles.retro")
        case "surreal": tr("search.visualStyles.surreal")
        case "vintage": tr("search.visualStyles.vintage")
        case "vibrant": tr("search.visualStyles.vibrant")
        case "typographic": tr("search.visualStyles.typographic")
        case "3d": tr("search.visualStyles.threeD")
        case "flat": tr("search.visualStyles.flat")
        case "geometric": tr("search.visualStyles.geometric")
        case "hand-drawn": tr("search.visualStyles.handDrawn")
        case "futuristic": tr("search.visualStyles.futuristic")
        default: id.capitalized
        }
    }
}

public struct ColorHue: Hashable, Sendable, Identifiable {
    public let id: String
    public var label: String {
        switch id {
        case "red": tr("search.colorHues.red")
        case "orange": tr("search.colorHues.orange")
        case "yellow": tr("search.colorHues.yellow")
        case "green": tr("search.colorHues.green")
        case "teal": tr("search.colorHues.teal")
        case "cyan": tr("search.colorHues.cyan")
        case "blue": tr("search.colorHues.blue")
        case "purple": tr("search.colorHues.purple")
        case "pink": tr("search.colorHues.pink")
        case "brown": tr("search.colorHues.brown")
        case "neutral": tr("search.colorHues.neutral")
        default: id.capitalized
        }
    }

    public init?(_ id: String) {
        guard SharedConstants.shared.colorHues.contains(id) else { return nil }
        self.id = id
    }

    public static var all: [ColorHue] { SharedConstants.shared.colorHues.compactMap(ColorHue.init) }

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
