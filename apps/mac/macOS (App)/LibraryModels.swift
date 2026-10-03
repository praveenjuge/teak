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

struct LibraryLinkFact: Decodable, Sendable {
    let label: String
    let value: String
}

struct LibraryCard: Decodable, Identifiable, Sendable {
    let id: String
    let type: String
    var content: String?
    let url: String?
    var metadataTitle: String?
    let metadataDescription: String?
    let linkPreviewTitle: String?
    let linkPreviewDescription: String?
    let linkFacts: [LibraryLinkFact]?
    let linkFaviconUrl: String?
    var isDeleted: Bool?
    let linkSiteName: String?
    let linkAuthor: String?
    let linkPublisher: String?
    let linkPublishedAt: String?
    var notes: String?
    let aiSummary: String?
    let aiTranscript: String?
    var tags: [String]
    let aiTags: [String]
    let colors: [LibraryColor]?
    var isFavorited: Bool
    let createdAt: Double
    let updatedAt: Double
    let fileName: String?
    let fileExtension: String?
    let fileKind: String?
    let fileLanguage: String?
    let filePreview: LibraryFilePreview?
    let fileWidth: Int?
    let fileHeight: Int?
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

    var linkTitle: String { linkPreviewTitle ?? metadataTitle ?? url ?? "Link" }

    var displayImageURL: URL? {
        let mediaImage = linkPreviewMedia?.first(where: { $0.type == "image" })?.url
        let mediaPoster = linkPreviewMedia?.first(where: { $0.type == "video" })?.posterUrl
        let candidate = cardType == .link
            ? mediaImage ?? mediaPoster ?? linkPreviewImageUrl ?? screenshotUrl
            : compactUrl ?? thumbnailUrl ?? detailUrl
        return Self.safeURL(candidate)
    }

    var previewText: String { Self.plainPreview(content ?? fileName ?? "") }

    static func plainPreview(_ content: String) -> String {
        var text = String(content.prefix(500))
        let replacements: [(String, String)] = [
            (#"<!--[\s\S]*?-->"#, " "), (#"(?m)^\s*(?:```|~~~).*$"#, " "),
            (#"!?\[([^\]]*)\]\([^)]*\)"#, "$1"), (#"\[([^\]]*)\]\[[^\]]*\]"#, "$1"),
            (#"</?[a-zA-Z][^>]*>"#, " "), (#"(?m)^\s*(?:[-*_]\s*){3,}$"#, " "),
            (#"(?m)^\s*#{1,6}\s+"#, ""), (#"(?m)^\s*(?:>\s?)+"#, ""),
            (#"(?m)^\s*[-*+]\s+\[[ xX]\]\s+"#, ""), (#"(?m)^\s*[-*+]\s+"#, ""),
            (#"(?m)^\s*\d+[.)]\s+"#, ""), (#"`([^`]+)`"#, "$1"),
            (#"(\*\*|__)(.+?)\1"#, "$2"), (#"(\*|_)(.+?)\1"#, "$2"),
            (#"~~(.+?)~~"#, "$1"), (#"\s+#{1,6}\s+"#, " "), (#"\s+"#, " "),
        ]
        for (pattern, replacement) in replacements {
            text = text.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
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

private actor LibraryUploadState {
    private var bodies: [String: Data] = [:]
    func body(for key: String) -> Data? { bodies[key] }
    func store(_ body: Data, for key: String) { bodies[key] = body }
    func clear(_ key: String) { bodies[key] = nil }
}

struct LibraryAPI {
    private let service: TeakSafariService
    private let uploads = LibraryUploadState()

    init(service: TeakSafariService = .shared) { self.service = service }

    func list(query: String, types: Set<LibraryCardType>, favoritesOnly: Bool, cursor: String?, tokens: [LibrarySearchToken] = []) async throws -> LibraryPage {
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
        for token in tokens {
            switch token.kind {
            case .trash: items.append(URLQueryItem(name: "trashed", value: "true"))
            case .style, .hue, .hex: items.append(URLQueryItem(name: token.kind.rawValue, value: token.value))
            case .date:
                if let range = token.dateRange {
                    items.append(URLQueryItem(name: "createdAfter", value: String(Int(range.lowerBound.timeIntervalSince1970 * 1000))))
                    items.append(URLQueryItem(name: "createdBefore", value: String(Int(range.upperBound.timeIntervalSince1970 * 1000) - 1)))
                }
            default: break
            }
        }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        let data = try await service.libraryGET(path: "v1/cards", queryItems: items)
        return try JSONDecoder().decode(LibraryPage.self, from: data)
    }

    func card(id: String) async throws -> LibraryCard {
        try Self.validateCardID(id)
        let data = try await service.libraryGET(path: "v1/cards/\(id)")
        return try JSONDecoder().decode(LibraryCard.self, from: data)
    }

    nonisolated static func isValidCardID(_ id: String) -> Bool {
        TeakSafariService.isValidCardID(id)
    }

    nonisolated static func validateCardID(_ id: String) throws {
        guard isValidCardID(id) else { throw SafariServiceError.message("Invalid card ID.") }
    }

    private func request(method: String, path: String, body: [String: Any]) async throws -> Data {
        try await service.libraryRequest(method: method, path: path,
            body: JSONSerialization.data(withJSONObject: body))
    }

    func createText(_ text: String, idempotencyKey: String? = nil) async throws -> String {
        try await create(["content": text], idempotencyKey: idempotencyKey)
    }

    func createQuote(_ text: String, idempotencyKey: String? = nil) async throws -> String {
        try await create(["content": text, "cardType": "quote"], idempotencyKey: idempotencyKey)
    }

    private func create(_ body: [String: Any], idempotencyKey: String?) async throws -> String {
        let data = try await service.libraryRequest(method: "POST", path: "v1/cards",
            body: JSONSerialization.data(withJSONObject: body), idempotencyKey: idempotencyKey)
        struct Result: Decodable { let cardId: String }
        let id = try JSONDecoder().decode(Result.self, from: data).cardId
        try Self.validateCardID(id)
        return id
    }

    func createFile(_ file: URL, mimeType: String, idempotencyKey: String) async throws -> String {
        let access = file.startAccessingSecurityScopedResource()
        defer { if access { file.stopAccessingSecurityScopedResource() } }
        let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize, size > 0, size <= 100 * 1024 * 1024 else {
            throw SafariServiceError.message("Choose a file smaller than 100 MB.")
        }
        // Reuse the successful upload and exact finalization payload after a
        // timeout. A fresh fileKey with the same idempotency key would conflict.
        let cacheKey = idempotencyKey + file.absoluteString
        let payload: Data
        if let cached = await uploads.body(for: cacheKey) {
            payload = cached
        } else {
            struct Upload: Decodable { let uploadUrl: URL; let fileKey: String }
            let upload = try JSONDecoder().decode(Upload.self, from: await request(method: "POST", path: "v1/uploads",
                body: ["fileName": file.lastPathComponent, "fileSize": size, "mimeType": mimeType]))
            let etag = try await service.uploadFile(to: upload.uploadUrl, from: file, mimeType: mimeType, size: size)
            var body: [String: Any] = ["fileKey": upload.fileKey, "fileName": file.lastPathComponent,
                                      "fileSize": size, "mimeType": mimeType]
            if let etag { body["fileEtag"] = etag }
            payload = try JSONSerialization.data(withJSONObject: body)
            await uploads.store(payload, for: cacheKey)
        }
        let data = try await service.libraryRequest(method: "POST", path: "v1/cards",
            body: payload, idempotencyKey: idempotencyKey)
        struct Result: Decodable { let cardId: String }
        let id = try JSONDecoder().decode(Result.self, from: data).cardId
        try Self.validateCardID(id)
        await uploads.clear(cacheKey)
        return id
    }

    func update(id: String, metadataTitle: String?, content: String?, notes: String, tags: [String]) async throws -> LibraryCard {
        try Self.validateCardID(id)
        var body: [String: Any] = ["notes": notes, "tags": tags]
        if let metadataTitle { body["metadataTitle"] = metadataTitle }
        if let content { body["content"] = content }
        let data = try await request(method: "PATCH", path: "v1/cards/\(id)", body: body)
        return try JSONDecoder().decode(LibraryCard.self, from: data)
    }

    func restore(id: String) async throws {
        try Self.validateCardID(id)
        _ = try await service.libraryRequest(method: "POST", path: "v1/cards/\(id)/restore")
    }

    func delete(id: String, permanent: Bool = false) async throws {
        try Self.validateCardID(id)
        _ = try await service.libraryRequest(method: "DELETE", path: "v1/cards/\(id)",
            queryItems: permanent ? [URLQueryItem(name: "permanent", value: "true")] : [])
    }

    func setFavorite(id: String, isFavorited: Bool) async throws -> LibraryCard {
        try Self.validateCardID(id)
        let data = try await request(method: "PATCH", path: "v1/cards/\(id)/favorite", body: ["isFavorited": isFavorited])
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
