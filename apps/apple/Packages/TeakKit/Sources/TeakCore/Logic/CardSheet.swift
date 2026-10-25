import Foundation

public struct DetailRow: Hashable, Sendable {
    public let label: String
    public let value: String

    public init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }
}

public enum ShareTarget: Hashable, Sendable {
    case none
    case text(String, subject: String?)
    case file(url: URL, fileName: String, mimeType: String?)
}

public struct LinkMediaItem: Hashable, Sendable {
    public let url: URL
    public let width: Double?
    public let height: Double?
}

public enum CardSheet {
    private static let sizeUnits = ["B", "KB", "MB", "GB"]
    public static let textPreviewLimit = 512 * 1024

    public static func formatFileSize(_ bytes: Double, locale: Locale = AppLanguage.locale) -> String {
        guard bytes > 0 else { return "0 B" }
        let exponent = min(Int((log(bytes) / log(1024)).rounded(.down)), sizeUnits.count - 1)
        let scaled = bytes / pow(1024, Double(exponent))
        let rounded = exponent == 0 ? scaled.rounded() : (scaled * 10).rounded() / 10
        let number = rounded.formatted(.number.precision(.fractionLength(0...1)).grouping(.never).locale(locale))
        return "\(number) \(sizeUnits[exponent])"
    }

    public static func formatDuration(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    private static func sanitizeFileName(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines).replacing(/[\/\\]+/, with: "_")
        return trimmed.isEmpty || trimmed == "." || trimmed == ".." ? nil : trimmed
    }

    public static func downloadFileName(url: String?, savedName: String? = nil, mimeType: String? = nil,
                                        now: Date = Date()) -> String {
        if let savedName, let safe = sanitizeFileName(savedName) { return safe }
        if let url, let components = URLComponents(string: url), components.scheme != nil,
           let segment = components.percentEncodedPath.split(separator: "/").last {
            let decoded = String(segment).removingPercentEncoding ?? String(segment)
            let base = decoded.split(separator: "/").last.map(String.init) ?? decoded
            if let safe = sanitizeFileName(base) { return safe }
        }
        let format = mimeType.flatMap { FileFormats.infer(fileName: "download", mimeType: $0) }
        let suffix = format.map { ".\($0.extension)" } ?? ""
        return "download-\(Int(now.timeIntervalSince1970 * 1000))\(suffix)"
    }

    public static func fileFacts(_ card: Card) -> [String] {
        guard let file = card.fileMetadata else { return [] }
        let preview = file.preview
        let facts = [
            file.language,
            file.kind,
            preview?.slideCount.map { tr("native.details.slides", count: Int($0)) },
            preview?.wordCount.map { tr("native.details.words", count: Int($0)) },
            preview?.archiveFileCount.map { tr("native.details.files", count: Int($0)) },
            preview?.archiveDirectoryCount.map { tr("native.details.folders", count: Int($0)) },
        ].compactMap { $0 }.filter { !$0.isEmpty }
        // The server writes `kind` in English, so it's compared with the type's English name.
        return facts.filter { $0.lowercased() != card.type.rawValue }
    }

    public static func documentSummary(_ card: Card) -> String? {
        let file = card.fileMetadata
        let format = file?.fileName.flatMap { FileFormats.infer(fileName: $0, mimeType: file?.mimeType) }
        let parts = [
            format.map { $0.extension.uppercased() } ?? file?.extension?.uppercased(),
            file?.fileSize.map { formatFileSize($0) },
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    public static func detailRows(_ card: Card) -> [DetailRow] {
        var rows = [DetailRow(tr("native.details.type"), card.type.label)]
        let file = card.fileMetadata
        if card.type == .link, let host = SafeURL.hostname(card.url) { rows.append(DetailRow(tr("native.details.website"), host)) }
        if let name = file?.fileName { rows.append(DetailRow(tr("native.details.file"), name)) }
        if let mime = file?.mimeType { rows.append(DetailRow(tr("native.details.format"), mime)) }
        if let size = file?.fileSize { rows.append(DetailRow(tr("native.details.size"), formatFileSize(size))) }
        if let width = file?.width, let height = file?.height {
            rows.append(DetailRow(tr("native.details.dimensions"), "\(Int(width)) × \(Int(height))"))
        }
        if let duration = file?.duration { rows.append(DetailRow(tr("native.details.duration"), formatDuration(duration))) }
        let facts = fileFacts(card)
        if !facts.isEmpty { rows.append(DetailRow(tr("native.details.details"), facts.joined(separator: " · "))) }
        if let description = card.metadataDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
           !description.isEmpty {
            rows.append(DetailRow(tr("native.details.description"), description))
        }
        return rows
    }

    public static func copyText(_ card: Card) -> String? {
        let content = card.content.trimmingCharacters(in: .whitespacesAndNewlines)
        switch card.type {
        case .link:
            if let url = card.url?.trimmingCharacters(in: .whitespacesAndNewlines), !url.isEmpty { return url }
            return content.isEmpty ? nil : content
        case .palette:
            let hexes = (card.colors ?? []).map(\.hex).filter { !$0.isEmpty }
            return hexes.isEmpty ? nil : hexes.joined(separator: ", ")
        default:
            return content.isEmpty ? nil : content
        }
    }

    public static func copyLabel(_ card: Card) -> String {
        switch card.type {
        case .link: tr("native.actions.copyLink")
        case .palette: tr("native.actions.copyPalette")
        case .quote: tr("native.actions.copyQuote")
        default: tr("native.actions.copyText")
        }
    }

    public static func shareTarget(_ card: Card) -> ShareTarget {
        func file(_ raw: String?, name: String?, mime: String?) -> ShareTarget {
            guard let raw, let url = SafeURL.sanitize(raw) else { return .none }
            return .file(url: url, fileName: downloadFileName(url: raw, savedName: name, mimeType: mime), mimeType: mime)
        }
        switch card.type {
        case .link:
            guard let url = card.url?.trimmingCharacters(in: .whitespacesAndNewlines), !url.isEmpty else { return .none }
            return .text(url, subject: card.metadataTitle)
        case .text, .quote:
            let content = card.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return content.isEmpty ? .none : .text(content, subject: nil)
        case .palette:
            return copyText(card).map { .text($0, subject: nil) } ?? .none
        case .image:
            if card.fileUrl != nil {
                return file(card.fileUrl, name: card.fileMetadata?.fileName, mime: card.fileMetadata?.mimeType)
            }
            return file(card.thumbnailUrl ?? card.screenshotUrl, name: nil, mime: nil)
        default:
            return file(card.fileUrl, name: card.fileMetadata?.fileName, mime: card.fileMetadata?.mimeType)
        }
    }

    public static func title(_ card: Card, fallback: String? = nil) -> String {
        switch card.type {
        case .text: return tr("native.card.note")
        case .quote: return tr("cards.types.quote")
        default:
            if let title = card.metadataTitle?.nonEmpty { return title }
            if let name = card.fileMetadata?.fileName?.nonEmpty { return name }
            return fallback ?? card.type.label
        }
    }

    public static func imageURLs(_ card: Card) -> [URL] {
        let name = card.fileMetadata?.fileName?.lowercased() ?? ""
        let needsRendition = name.hasSuffix(".heic") || name.hasSuffix(".heif") || name.hasSuffix(".svg")
        let candidates = [card.detailUrl, card.compactUrl, card.thumbnailUrl,
                          needsRendition ? nil : card.fileUrl, card.screenshotUrl]
        var seen = Set<URL>()
        return candidates.compactMap { SafeURL.sanitize($0) }.filter { seen.insert($0).inserted }
    }

    public static func isAnimatedGIF(_ card: Card) -> Bool {
        guard let name = card.fileMetadata?.fileName else { return false }
        return FileFormats.infer(fileName: name, mimeType: card.fileMetadata?.mimeType)?.id == "gif"
    }

    public static func linkImageURL(_ card: Card) -> URL? {
        let media = card.linkPreviewMedia ?? []
        let candidates = [media.first { $0.type == "image" }?.url, media.first { $0.type == "video" }?.posterUrl,
                          card.linkPreviewImageUrl, card.screenshotUrl]
        return candidates.lazy.compactMap { SafeURL.sanitize($0) }.first
    }

    public static func linkMedia(_ card: Card) -> [LinkMediaItem] {
        (card.linkPreviewMedia ?? []).compactMap { item -> LinkMediaItem? in
            let raw = item.type == "image" ? item.url : item.posterUrl
            guard let url = SafeURL.sanitize(raw) else { return nil }
            return LinkMediaItem(url: url, width: item.width, height: item.height)
        }
        .prefix(4).map { $0 }
    }

    public static func linkFacts(_ card: Card) -> [DetailRow] {
        let preview = card.metadata?.linkPreview
        var rows: [DetailRow] = []
        if let site = preview?.siteName?.nonEmpty { rows.append(DetailRow(tr("native.details.site"), site)) }
        if let author = preview?.author?.nonEmpty { rows.append(DetailRow(tr("native.details.author"), author)) }
        if let publisher = preview?.publisher?.nonEmpty, publisher != preview?.siteName {
            rows.append(DetailRow(tr("native.details.publisher"), publisher))
        }
        return rows + (card.metadata?.linkCategory?.facts ?? []).map { DetailRow($0.label, $0.value) }
    }

    public static func linkTitle(_ card: Card) -> String {
        card.metadata?.linkPreview?.title?.nonEmpty ?? card.metadataTitle?.nonEmpty
            ?? SafeURL.hostname(card.url) ?? card.url ?? tr("cards.types.link")
    }

    public static func linkDescription(_ card: Card) -> String? {
        card.metadata?.linkPreview?.description?.nonEmpty ?? card.metadataDescription?.nonEmpty
    }

    public enum TextPreviewKind: Sendable { case markdown, code }

    public static func textPreviewKind(_ card: Card) -> TextPreviewKind? {
        let file = card.fileMetadata
        if let size = file?.fileSize, size > Double(textPreviewLimit) { return nil }
        let ext = file?.fileName?.split(separator: ".").last.map { $0.lowercased() } ?? ""
        if ["md", "mdx", "markdown"].contains(ext) { return .markdown }
        if file?.language != nil || file?.mimeType?.hasPrefix("text/") == true
            || ["json", "yaml", "yml", "toml", "csv", "xml"].contains(ext) {
            return .code
        }
        return nil
    }

    public static func isPDF(_ card: Card) -> Bool {
        card.fileMetadata?.mimeType == "application/pdf"
            || card.fileMetadata?.fileName?.lowercased().hasSuffix(".pdf") == true
    }

    /// Audio formats AVFoundation can't play.
    public static func isUnplayableAudio(_ card: Card) -> Bool {
        let mime = FileFormats.normalizeMimeType(card.fileMetadata?.mimeType)
        let ext = card.fileMetadata?.fileName?.split(separator: ".").last.map { $0.lowercased() } ?? ""
        return ["audio/webm", "audio/ogg", "audio/opus"].contains(mime) || ["webm", "ogg", "opus", "oga"].contains(ext)
    }

    public static func webURL(cardId: String, base: URL) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "card", value: cardId)]
        return components.url!
    }

    public static func formatTimestamp(_ milliseconds: Double, locale: Locale = AppLanguage.locale) -> String {
        Date(timeIntervalSince1970: milliseconds / 1000).formatted(.dateTime.day().month(.abbreviated).year()
            .hour().minute().locale(locale))
    }
}
