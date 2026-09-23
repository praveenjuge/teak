import Foundation

enum LibraryCardType: String, CaseIterable, Identifiable {
    case text, link, image, video, audio, document, palette, quote

    var id: String { rawValue }

    var title: String { rawValue.capitalized }

    var symbol: String {
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

struct LibraryColor: Decodable, Sendable {
    let hex: String
    let name: String?
}

struct LibraryMedia: Decodable, Sendable {
    let type: String
    let url: String
    let contentType: String?
    let width: Int?
    let height: Int?
    let posterUrl: String?
}

struct LibraryFilePreview: Decodable, Sendable {
    let slideCount: Int?
    let wordCount: Int?
    let headingCount: Int?
    let lineCount: Int?
    let archiveFileCount: Int?
    let archiveDirectoryCount: Int?
    let colorVariableCount: Int?
}

struct LibraryCard: Decodable, Identifiable, Sendable {
    let id: String
    let type: String
    let content: String?
    let url: String?
    let metadataTitle: String?
    let metadataDescription: String?
    let linkSiteName: String?
    let linkAuthor: String?
    let linkPublisher: String?
    let linkPublishedAt: String?
    let notes: String?
    let aiSummary: String?
    let aiTranscript: String?
    let tags: [String]
    let aiTags: [String]
    let colors: [LibraryColor]?
    let isFavorited: Bool
    let createdAt: Double
    let updatedAt: Double
    let fileName: String?
    let fileExtension: String?
    let fileKind: String?
    let fileLanguage: String?
    let filePreview: LibraryFilePreview?
    let fileSize: Int?
    let mimeType: String?
    let fileUrl: String?
    let thumbnailUrl: String?
    let compactUrl: String?
    let detailUrl: String?
    let screenshotUrl: String?
    let linkPreviewImageUrl: String?
    let linkPreviewMedia: [LibraryMedia]?

    var cardType: LibraryCardType? { LibraryCardType(rawValue: type) }

    var title: String {
        if let metadataTitle, !metadataTitle.isEmpty { return metadataTitle }
        if let fileName, !fileName.isEmpty { return fileName }
        if let url, let host = URL(string: url)?.host { return host }
        if let content, !content.isEmpty { return String(content.prefix(90)) }
        return cardType?.title ?? "Card"
    }

    var displayImageURL: URL? {
        let mediaImage = linkPreviewMedia?.first(where: { $0.type == "image" })?.url
        let mediaPoster = linkPreviewMedia?.first(where: { $0.type == "video" })?.posterUrl
        let candidate = compactUrl ?? thumbnailUrl ?? linkPreviewImageUrl ?? mediaImage ?? mediaPoster ?? screenshotUrl
        return Self.safeURL(candidate)
    }

    static func safeURL(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil else { return nil }
        return url
    }
}

struct LibraryPage: Decodable, Sendable {
    let items: [LibraryCard]
    let pageInfo: PageInfo

    struct PageInfo: Decodable, Sendable {
        let hasMore: Bool
        let nextCursor: String?
    }
}

enum LibrarySaveResult: Sendable {
    case saved(String)
    case duplicate(String)
}

struct LibraryAPI {
    private let service: TeakSafariService

    init(service: TeakSafariService = .shared) { self.service = service }

    func list(query: String, types: Set<LibraryCardType>, favoritesOnly: Bool, cursor: String?) async throws -> LibraryPage {
        var items = [
            URLQueryItem(name: "limit", value: "40"),
            URLQueryItem(name: "include", value: "content,metadata,processing"),
        ]
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { items.append(URLQueryItem(name: "q", value: trimmed)) }
        for type in LibraryCardType.allCases where types.contains(type) {
            items.append(URLQueryItem(name: "type", value: type.rawValue))
        }
        if favoritesOnly { items.append(URLQueryItem(name: "favorited", value: "true")) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        let data = try await service.libraryGET(path: "v1/cards", queryItems: items)
        return try JSONDecoder().decode(LibraryPage.self, from: data)
    }

    func card(id: String) async throws -> LibraryCard {
        guard !id.isEmpty, id.count <= 128,
              id.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "_" || $0 == "-" }) else {
            throw SafariServiceError.message("Invalid card ID.")
        }
        let data = try await service.libraryGET(path: "v1/cards/\(id)")
        return try JSONDecoder().decode(LibraryCard.self, from: data)
    }

    func saveLink(_ rawURL: String) async throws -> LibrarySaveResult {
        let result = await service.saveCurrentPage(url: rawURL.trimmingCharacters(in: .whitespacesAndNewlines))
        let status = result["status"] as? String
        if let id = result["cardId"] as? String {
            if status == "saved" { return .saved(id) }
            if status == "duplicate" { return .duplicate(id) }
        }
        if status == "unauthenticated" { throw SafariServiceError.unauthenticated }
        throw SafariServiceError.message(result["message"] as? String ?? "Unable to save this link.")
    }
}
