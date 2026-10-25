import Foundation

/// A card as Shortcuts, Siri and Spotlight know it: its title, the start of its
/// text, its site, type and thumbnail. Never its notes or full content, and
/// never a card in Trash or a hidden one (`#secret`, `#hidden`).
public struct IndexedCard: Hashable, Sendable {
    public let id: String
    public let type: CardType
    public let title: String
    public let previewText: String?
    public let url: URL?
    public let thumbnailURL: URL?
    /// Milliseconds since 1970, as Convex writes `_creationTime`.
    public let creationTime: Double

    static let previewLength = 280

    /// A card from a library page. Pages never list hidden cards unless the
    /// search asks for them, which `CardIndex.revealsHidden` catches first.
    public init?(_ summary: CardSummary, includeArchived: Bool = false) {
        guard includeArchived || !summary.archived else { return nil }
        let preview = summary.previewText.flatMap(Self.compact)
        let url = SafeURL.sanitize(summary.url)
        id = summary.id
        type = summary.type
        previewText = preview
        self.url = url
        title = Self.firstOf([summary.title, preview.map(Self.firstLine), SafeURL.hostname(summary.url)]) ?? summary.type.label
        thumbnailURL = SafeURL.sanitize(CardGrid.tileImageURL(summary))
        creationTime = summary.creationTime
    }

    /// A card read whole, titled as `cardDisplayTitle` titles it
    /// (`packages/convex/card/displayTitle.ts`).
    public init?(_ card: Card) {
        guard !card.deleted, !card.archived, !HiddenTags.isHiddenTagList(card.tags) else { return nil }
        let text = card.type == .audio ? card.aiTranscript : CardLinks.tokensToText(card.content)
        let preview = text.flatMap(Self.compact)
        let linkPreview = card.metadata?.linkPreview
        id = card.id
        type = card.type
        previewText = preview
        url = SafeURL.sanitize(card.url)
        title = Self.firstOf([
            card.metadataTitleEdited == true ? card.metadataTitle : nil,
            linkPreview?.status == "success" ? linkPreview?.title : nil,
            card.metadataTitle,
            card.fileMetadata?.fileName,
            card.type == .link ? SafeURL.hostname(card.url) : nil,
            preview.map(Self.firstLine),
        ]) ?? card.type.label
        thumbnailURL = SafeURL.sanitize(Self.thumbnail(card))
        creationTime = card.creationTime
    }

    /// The site a link card came from, without `www.`.
    public var host: String? { url.flatMap { SafeURL.hostname($0.absoluteString) } }

    /// The line under the title: the site, or what kind of card it is.
    public var subtitle: String { host ?? type.label }

    /// Spotlight's description: the site, then the start of the text.
    public var summary: String? {
        let parts = [host, previewText == title ? nil : previewText].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " — ")
    }

    /// Extra words Spotlight matches: the site and the card's type.
    public var keywords: [String] { [host, type.label].compactMap { $0 } }

    /// Changes when anything Spotlight shows changes. A thumbnail's address
    /// counts without its query, which signed addresses rewrite on every read.
    public var fingerprint: String {
        var thumbnail = thumbnailURL.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
        thumbnail?.query = nil
        let fields = [type.rawValue, title, previewText ?? "", host ?? "", thumbnail?.string ?? ""]
        return Self.hash(fields.joined(separator: "\u{1F}"))
    }

    private static func thumbnail(_ card: Card) -> String? {
        switch card.type {
        case .link: card.linkPreviewImageUrl ?? card.screenshotUrl
        case .image: card.compactUrl ?? card.thumbnailUrl
        case .video, .document: card.thumbnailUrl ?? card.compactUrl
        default: nil
        }
    }

    private static func compact(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(previewLength))
    }

    private static func firstLine(_ text: String) -> String {
        String(text.split(whereSeparator: \.isNewline).first ?? "")
    }

    private static func firstOf(_ candidates: [String?]) -> String? {
        candidates.lazy.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty }
    }

    /// FNV-1a, which stays the same from one launch to the next.
    private static func hash(_ text: String) -> String {
        var value: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in text.utf8 {
            value ^= UInt64(byte)
            value = value &* 0x100_0000_01b3
        }
        return String(value, radix: 16)
    }
}

/// What Shortcuts and Spotlight may read from the library, and when.
public enum CardIndex {
    /// The most cards a Shortcuts search returns.
    public static let searchLimit = 20

    /// How many of the newest cards Spotlight refreshes when the app opens.
    public static let refreshCount = 500

    /// The most cards one page of `searchMobileCardSummariesPaginated` holds.
    public static let maxPageSize = 100

    /// Whether a search could list hidden cards: it names `#secret` or
    /// `#hidden` anywhere, in an `OR` group or a negation too, since only the
    /// backend knows what such text means.
    public static func revealsHidden(_ search: String) -> Bool {
        SearchQualifiers.tokenize(search).contains { token in
            var word = Substring(token.text)
            while let first = word.first, "(-".contains(first) { word = word.dropFirst() }
            let value: Substring
            if word.hasPrefix("#") {
                value = word.dropFirst()
            } else if word.lowercased().hasPrefix("tag:") {
                value = word.dropFirst(4)
            } else {
                return false
            }
            return HiddenTags.isHidden(SearchQualifiers.trimEdgePunctuation(String(value)))
        }
    }

    /// Whether a library view could list hidden cards.
    public static func revealsHidden(_ query: LibraryQuery) -> Bool {
        query.revealsHiddenCards || revealsHidden(query.searchText() ?? "")
            || query.filters.folder?.query.map(revealsHidden) == true
    }

    /// Arguments for one page of `searchMobileCardSummariesPaginated`: the
    /// text as typed, newest first without it. Archived cards come only when
    /// asked for, since the backend lists either them or the rest.
    public static func searchArgs(_ text: String, archivedOnly: Bool = false, limit: Int = searchLimit,
                                  cursor: String? = nil) -> ConvexArgs {
        var args: ConvexArgs = [
            "paginationOpts": ["numItems": .number(Double(limit)), "cursor": cursor.map(ConvexValue.string) ?? .null],
        ]
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { args["searchQuery"] = .string(text) }
        if archivedOnly { args["showArchivedOnly"] = true }
        return args
    }

    /// A Shortcuts search's cards: the library's matches, then the archived
    /// ones when asked for, at most `limit`.
    public static func results(_ cards: [CardSummary], archived: [CardSummary] = [], includeArchived: Bool = false,
                               limit: Int = searchLimit) -> [IndexedCard] {
        var seen = Set<String>()
        return Array((cards + (includeArchived ? archived : []))
            .filter { seen.insert($0.id).inserted }
            .compactMap { IndexedCard($0, includeArchived: includeArchived) }
            .prefix(limit))
    }

    /// What Spotlight should change after a library view loads.
    public struct Changes: Equatable, Sendable {
        public var index: [IndexedCard] = []
        public var remove: [String] = []

        public init(index: [IndexedCard] = [], remove: [String] = []) {
            self.index = index
            self.remove = remove
        }

        public var isEmpty: Bool { index.isEmpty && remove.isEmpty }
    }

    /// What a library view's cards tell Spotlight. Cards in Trash and archived
    /// cards leave it, and a view that could list hidden cards adds nothing.
    /// `left` holds the cards that dropped out of the view since it last
    /// loaded: in the plain library, newest first, only leaving Trash,
    /// the Archive, a hidden tag or deletion does that. A view that empties at
    /// once is more likely a read while signed out, so it removes nothing.
    public static func changes(_ cards: [CardSummary], left: [String] = [], in query: LibraryQuery) -> Changes {
        if query.isTrash { return Changes(remove: cards.map(\.id)) }
        let reveals = revealsHidden(query)
        var changes = Changes()
        for card in cards {
            if card.archived {
                changes.remove.append(card.id)
            } else if !reveals, let indexed = IndexedCard(card) {
                changes.index.append(indexed)
            }
        }
        if query == LibraryQuery(), !cards.isEmpty { changes.remove += left }
        return changes
    }

    /// The indexed cards a refresh of the newest cards shows have left the
    /// library: those as new as the oldest card read, or all of them when the
    /// read reached the end, even with no cards left to show.
    public static func stale(indexed: [String: Double], newest: [IndexedCard], complete: Bool) -> [String] {
        let kept = Set(newest.map(\.id))
        if complete { return indexed.keys.filter { !kept.contains($0) }.sorted() }
        guard let oldest = newest.map(\.creationTime).min() else { return [] }
        return indexed.filter { id, created in !kept.contains(id) && (complete || created >= oldest) }
            .keys.sorted()
    }
}
