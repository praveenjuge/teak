import Foundation

public struct DetailRow: Hashable, Sendable {
    public let label: String
    public let value: String

    public init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }
}

/// What sharing a card sends: text, a file to download first, or nothing.
public enum ShareTarget: Hashable, Sendable {
    case none
    case text(String, subject: String?)
    case file(url: URL, fileName: String, mimeType: String?)
}

/// A link's attached photo or video still, sized for the detail view.
public struct LinkMediaItem: Hashable, Sendable {
    public let url: URL
    public let width: Double?
    public let height: Double?
}

/// The detail screen's formatting rules. Port of `apps/mobile/lib/card-sheet.ts`
/// plus the Mac detail's link and document rules.
public enum CardSheet {
    private static let sizeUnits = ["B", "KB", "MB", "GB"]
    /// Same cap as the web's file text preview.
    public static let textPreviewLimit = 512 * 1024

    public static func formatFileSize(_ bytes: Double) -> String {
        guard bytes > 0 else { return "0 B" }
        let exponent = min(Int((log(bytes) / log(1024)).rounded(.down)), sizeUnits.count - 1)
        let scaled = bytes / pow(1024, Double(exponent))
        let rounded: String
        if exponent == 0 {
            rounded = String(Int(scaled.rounded()))
        } else {
            let tenths = (scaled * 10).rounded() / 10
            rounded = tenths.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(tenths)) : String(tenths)
        }
        return "\(rounded) \(sizeUnits[exponent])"
    }

    public static func formatDuration(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }

    private static func sanitizeFileName(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines).replacing(/[\/\\]+/, with: "_")
        return trimmed.isEmpty || trimmed == "." || trimmed == ".." ? nil : trimmed
    }

    /// A safe filename for a download: the saved name, else the URL's last segment, else a generated one.
    public static func downloadFileName(url: String?, fallback: String? = nil, mimeType: String? = nil,
                                        now: Date = Date()) -> String {
        if let fallback, let safe = sanitizeFileName(fallback) { return safe }
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

    /// "Swift · 12 slides · 1,204 words"-style facts, without the card type itself.
    public static func fileFacts(_ card: Card) -> [String] {
        guard let file = card.fileMetadata else { return [] }
        let preview = file.preview
        let number = NumberFormatter()
        number.numberStyle = .decimal
        number.locale = Locale(identifier: "en_US")
        let facts = [
            file.language,
            file.kind,
            preview?.slideCount.map { "\(Int($0)) slides" },
            preview?.wordCount.map { "\(number.string(from: NSNumber(value: Int($0))) ?? "\(Int($0))") words" },
            preview?.archiveFileCount.map { "\(Int($0)) files" },
            preview?.archiveDirectoryCount.map { "\(Int($0)) folders" },
        ].compactMap { $0 }.filter { !$0.isEmpty }
        let typeLabel = card.type.label.lowercased()
        return facts.filter { $0.lowercased() != typeLabel }
    }

    /// "PDF · 4.6 MB" for a document's subtitle.
    public static func documentSummary(_ card: Card) -> String? {
        let file = card.fileMetadata
        let format = file?.fileName.flatMap { FileFormats.infer(fileName: $0, mimeType: file?.mimeType) }
        let parts = [
            format.map { $0.extension.uppercased() } ?? file?.extension?.uppercased(),
            file?.fileSize.map(formatFileSize),
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    public static func detailRows(_ card: Card) -> [DetailRow] {
        var rows = [DetailRow("Type", card.type.label)]
        let file = card.fileMetadata
        if card.type == .link, let host = SafeURL.hostname(card.url) { rows.append(DetailRow("Website", host)) }
        if let name = file?.fileName { rows.append(DetailRow("File", name)) }
        if let mime = file?.mimeType { rows.append(DetailRow("Format", mime)) }
        if let size = file?.fileSize { rows.append(DetailRow("Size", formatFileSize(size))) }
        if let width = file?.width, let height = file?.height {
            rows.append(DetailRow("Dimensions", "\(Int(width)) × \(Int(height))"))
        }
        if let duration = file?.duration { rows.append(DetailRow("Duration", formatDuration(duration))) }
        let facts = fileFacts(card)
        if !facts.isEmpty { rows.append(DetailRow("Details", facts.joined(separator: " · "))) }
        if let description = card.metadataDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
           !description.isEmpty {
            rows.append(DetailRow("Description", description))
        }
        return rows
    }

    /// What Copy puts on the clipboard.
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

    /// The copy action's label: "Copy Link", "Copy Palette", "Copy Quote", "Copy Text".
    public static func copyLabel(_ card: Card) -> String {
        switch card.type {
        case .link: "Copy Link"
        case .palette: "Copy Palette"
        case .quote: "Copy Quote"
        default: "Copy Text"
        }
    }

    public static func shareTarget(_ card: Card) -> ShareTarget {
        func file(_ raw: String?, name: String?, mime: String?) -> ShareTarget {
            guard let raw, let url = SafeURL.sanitize(raw) else { return .none }
            return .file(url: url, fileName: downloadFileName(url: raw, fallback: name, mimeType: mime), mimeType: mime)
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
            // A thumbnail is still an image, so it's a fine share when the original is missing.
            // Fallback renditions are named from their own URL, not the original file name.
            if card.fileUrl != nil {
                return file(card.fileUrl, name: card.fileMetadata?.fileName, mime: card.fileMetadata?.mimeType)
            }
            return file(card.thumbnailUrl ?? card.screenshotUrl, name: nil, mime: nil)
        default:
            // Video, audio and documents share only the original file.
            return file(card.fileUrl, name: card.fileMetadata?.fileName, mime: card.fileMetadata?.mimeType)
        }
    }

    /// The detail title: "Note", "Quote", the saved title, the file name, a cached title, or the type.
    public static func title(_ card: Card, fallback: String? = nil) -> String {
        switch card.type {
        case .text: return "Note"
        case .quote: return "Quote"
        default:
            if let title = card.metadataTitle?.nonEmpty { return title }
            if let name = card.fileMetadata?.fileName?.nonEmpty { return name }
            return fallback ?? card.type.label
        }
    }

    /// Images: the best rendition first; the original only when every device can decode it.
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

    /// A link's preview image: the post's first photo, a video still, the page image, then a screenshot.
    public static func linkImageURL(_ card: Card) -> URL? {
        let media = card.linkPreviewMedia ?? []
        let candidates = [media.first { $0.type == "image" }?.url, media.first { $0.type == "video" }?.posterUrl,
                          card.linkPreviewImageUrl, card.screenshotUrl]
        return candidates.lazy.compactMap { SafeURL.sanitize($0) }.first
    }

    /// The photos or video stills attached to a post, up to four.
    public static func linkMedia(_ card: Card) -> [LinkMediaItem] {
        (card.linkPreviewMedia ?? []).compactMap { item -> LinkMediaItem? in
            let raw = item.type == "image" ? item.url : item.posterUrl
            guard let url = SafeURL.sanitize(raw) else { return nil }
            return LinkMediaItem(url: url, width: item.width, height: item.height)
        }
        .prefix(4).map { $0 }
    }

    /// The link's title, site and byline, as the Mac detail shows them.
    public static func linkFacts(_ card: Card) -> [DetailRow] {
        let preview = card.metadata?.linkPreview
        var rows: [DetailRow] = []
        if let site = preview?.siteName?.nonEmpty { rows.append(DetailRow("Site", site)) }
        if let author = preview?.author?.nonEmpty { rows.append(DetailRow("Author", author)) }
        if let publisher = preview?.publisher?.nonEmpty, publisher != preview?.siteName {
            rows.append(DetailRow("Publisher", publisher))
        }
        return rows + (card.metadata?.linkCategory?.facts ?? []).map { DetailRow($0.label, $0.value) }
    }

    public static func linkTitle(_ card: Card) -> String {
        card.metadata?.linkPreview?.title?.nonEmpty ?? card.metadataTitle?.nonEmpty
            ?? SafeURL.hostname(card.url) ?? card.url ?? "Link"
    }

    public static func linkDescription(_ card: Card) -> String? {
        card.metadata?.linkPreview?.description?.nonEmpty ?? card.metadataDescription?.nonEmpty
    }

    public enum TextPreviewKind: Sendable { case markdown, code }

    /// Markdown and source documents show their text inline, up to 512 KB.
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

    /// The card on Teak for the web.
    public static func webURL(cardId: String, base: URL) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "card", value: cardId)]
        return components.url!
    }

    public static func formatTimestamp(_ milliseconds: Double) -> String {
        Date(timeIntervalSince1970: milliseconds / 1000).formatted(date: .abbreviated, time: .shortened)
    }
}
