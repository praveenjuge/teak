import Foundation

/// The folder a library view is scoped to. A smart folder is a saved search.
public struct FolderScope: Hashable, Sendable {
    public let id: String
    public var name: String
    public var isSmart: Bool
    /// A smart folder's saved search, so the view knows when it lists archived cards.
    public var query: String?

    public init(id: String, name: String, isSmart: Bool = false, query: String? = nil) {
        self.id = id
        self.name = name
        self.isSmart = isSmart
        self.query = query
    }

    public init(_ folder: Folder) {
        self.init(id: folder.id, name: folder.name, isSmart: folder.isSmart, query: folder.isSmart ? folder.query : nil)
    }
}

public enum LibrarySort: Hashable, Sendable {
    case newest, oldest, shuffle(seed: Int)

    public var label: String {
        switch self {
        case .newest: tr("native.filters.sort.newest")
        case .oldest: tr("native.filters.sort.oldest")
        case .shuffle: tr("native.filters.sort.shuffle")
        }
    }

    public var isShuffle: Bool { if case .shuffle = self { true } else { false } }

    var args: ConvexArgs {
        switch self {
        case .newest: [:]
        case .oldest: ["sort": "oldest"]
        case let .shuffle(seed): ["sort": "shuffle", "shuffleSeed": .number(seed)]
        }
    }
}

public struct LibraryFilters: Hashable, Sendable {
    public var favoritesOnly = false
    /// Trash and Archive are separate views: turning one on turns the other off.
    public var trashOnly = false { didSet { if trashOnly { archivedOnly = false } } }
    public var archivedOnly = false { didSet { if archivedOnly { trashOnly = false } } }
    public var types: [CardType] = []
    public var hue: ColorHue?
    public var folder: FolderScope?

    public init(favoritesOnly: Bool = false, trashOnly: Bool = false, archivedOnly: Bool = false, types: [CardType] = [],
                hue: ColorHue? = nil, folder: FolderScope? = nil) {
        self.favoritesOnly = favoritesOnly
        self.trashOnly = trashOnly
        self.archivedOnly = archivedOnly
        self.types = types
        self.hue = hue
        self.folder = folder
    }

    public static let empty = LibraryFilters()

    public var isActive: Bool { favoritesOnly || trashOnly || archivedOnly || !types.isEmpty || hue != nil || folder != nil }

    public func togglingType(_ type: CardType) -> LibraryFilters {
        var next = self
        if let index = next.types.firstIndex(of: type) { next.types.remove(at: index) } else { next.types.append(type) }
        return next
    }

    public var title: String {
        if trashOnly { return tr("native.filters.trash") }
        if let folder { return folder.name }
        if archivedOnly { return tr("native.filters.archive") }
        let type = types.count == 1 ? types[0] : nil
        if favoritesOnly { return type?.favoritesTitle ?? tr("native.filters.favorites") }
        if let type { return type.plural }
        if let hue { return hue.label }
        return isHome ? tr("native.filters.home") : tr("native.filters.filtered")
    }

    /// Whether the title is Home: no view, folder, type or color picked.
    var isHome: Bool { !trashOnly && folder == nil && !archivedOnly && !favoritesOnly && types.isEmpty && hue == nil }
}

public struct SearchToken: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable { case keyword, date, type, tag, style, hue, hex, favorites, trash, qualifier }

    public let kind: Kind
    public let value: String
    public let label: String
    public var range: CreatedAtRange?
    /// For `.qualifier`: what it filters by. `value` is its search text.
    public var qualifier: SearchQualifier?

    public init(kind: Kind, value: String, label: String, range: CreatedAtRange? = nil, qualifier: SearchQualifier? = nil) {
        self.kind = kind
        self.value = value
        self.label = label
        self.range = range
        self.qualifier = qualifier
    }

    public var id: String { "\(kind.rawValue):\(value)" }

    public var symbol: String {
        switch kind {
        case .keyword: "magnifyingglass"
        case .date: "calendar"
        case .type: CardType(rawValue: value)?.symbol ?? "square.grid.2x2"
        case .tag: "number"
        case .style: "sparkles"
        case .hue: "paintpalette"
        case .hex: "eyedropper"
        case .favorites: "heart"
        case .trash: "trash"
        case .qualifier: qualifierSymbol
        }
    }

    private var qualifierSymbol: String {
        guard let qualifier else { return "line.3.horizontal.decrease" }
        switch qualifier.key {
        case .is:
            switch SearchIsValue(rawValue: qualifier.value) {
            case .archived: return "archivebox"
            case .done: return "checkmark.circle"
            case .todo: return "circle"
            default: return "heart"
            }
        case .like: return "sparkles"
        case .mood: return "camera.aperture"
        case .price: return "banknote"
        case .text: return "text.viewfinder"
        case .folder: return "folder"
        case .tag: return "number"
        case .type: return CardType(rawValue: qualifier.value)?.symbol ?? "square.grid.2x2"
        }
    }
}

public enum SearchTokens {
    public static func tag(_ name: String) -> SearchToken {
        SearchToken(kind: .tag, value: name, label: name)
    }

    /// A chip for a parsed qualifier. Tags, types and favorites keep their own kinds.
    public static func token(for qualifier: SearchQualifier, likeTitle: String? = nil) -> SearchToken {
        switch qualifier.key {
        case .tag: return tag(qualifier.value)
        case .type: return SearchToken(kind: .type, value: qualifier.value, label: CardType(rawValue: qualifier.value)?.label ?? qualifier.value)
        case .is where qualifier.value == SearchIsValue.fav.rawValue:
            return SearchToken(kind: .favorites, value: "favorites", label: tr("native.filters.favorites"))
        default:
            let chip = SearchQualifiers.chip(qualifier, likeTitle: likeTitle)
            let label = qualifier.key == .is ? chip.label : tr("native.filters.chips.titled", chip.title, chip.label)
            return SearchToken(kind: .qualifier, value: SearchQualifiers.format(qualifier), label: label, qualifier: qualifier)
        }
    }

    /// The "More like this" chip for a card.
    public static func like(cardId: String, title: String?) -> SearchToken {
        token(for: SearchQualifier(.like, cardId), likeTitle: title)
    }

    private static let showOptions: [(SearchIsValue, [String])] = [
        (.archived, ["archived", "archive"]), (.done, ["done", "completed", "finished"]), (.todo, ["todo", "to-do"]),
    ]

    public static func classify(_ input: String, now: Date = Date(), timeZone: TimeZone = .current) -> SearchToken {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = trimmed.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        if ["fav", "favs", "favorites", "favourite", "favourites"].contains(value) {
            return SearchToken(kind: .favorites, value: "favorites", label: tr("native.filters.favorites"))
        }
        if ["trash", "deleted", "bin", "recycle", "trashed"].contains(value) {
            return SearchToken(kind: .trash, value: "trash", label: tr("native.filters.trash"))
        }
        let parsed = SearchQualifiers.parse(trimmed)
        if parsed.qualifiers.count == 1, parsed.terms.isEmpty, parsed.phrases.isEmpty {
            return token(for: parsed.qualifiers[0])
        }
        if let date = TimeSearch.parse(value, now: now, timeZone: timeZone) {
            return SearchToken(kind: .date, value: value, label: date.label, range: date.range)
        }
        if let type = CardType(rawValue: value) {
            return SearchToken(kind: .type, value: value, label: type.label)
        }
        let constants = SharedConstants.shared
        let facet = value.filter { $0.isLetter || $0.isNumber }
        if let style = constants.visualStyleAliases[facet] {
            return SearchToken(kind: .style, value: style, label: VisualStyle.label(style))
        }
        if let hue = constants.colorHueAliases[facet], let bucket = ColorHue(hue) {
            return SearchToken(kind: .hue, value: hue, label: bucket.label)
        }
        let hex = value.hasPrefix("#") ? String(value.dropFirst()) : value
        if isHex(hex) {
            let full = (hex.count == 3 ? hex.map { "\($0)\($0)" }.joined() : hex).uppercased()
            return SearchToken(kind: .hex, value: "#" + full, label: "#" + full)
        }
        return SearchToken(kind: .keyword, value: trimmed, label: trimmed)
    }

    /// Chips for typed text. Quotes group words, so `text:"Total due"` and
    /// `"design system"` stay whole; other words go through `words`.
    public static func parse(_ input: String, now: Date = Date(), timeZone: TimeZone = .current) -> [SearchToken] {
        var tokens: [SearchToken] = []
        var run: [String] = []
        func flush() {
            tokens += words(run, now: now, timeZone: timeZone)
            run = []
        }
        for raw in SearchQualifiers.tokenize(input) {
            let source = raw.quoted
                ? raw.prefix + SearchQualifiers.quote(String(raw.text.dropFirst(raw.prefix.count)))
                : raw.text
            let parsed = SearchQualifiers.parse(source)
            if let qualifier = parsed.qualifiers.first, raw.quoted || !raw.text.hasPrefix("#") {
                flush()
                tokens.append(token(for: qualifier))
            } else if raw.quoted, raw.prefix.isEmpty, let phrase = parsed.phrases.first {
                flush()
                tokens.append(SearchToken(kind: .keyword, value: SearchQualifiers.quote(phrase), label: phrase))
            } else {
                run.append(raw.text)
            }
        }
        flush()
        return tokens.filter { !$0.value.isEmpty }
    }

    private static func words(_ input: [String], now: Date, timeZone: TimeZone) -> [SearchToken] {
        let punctuation = CharacterSet(charactersIn: ",.;:!?()[]{}\"'")
        let words = input.map { $0.trimmingCharacters(in: punctuation) }
        var tokens: [SearchToken] = []
        var index = 0
        while index < words.count {
            var matched: (SearchToken, Int)?
            for length in stride(from: min(9, words.count - index), through: 2, by: -1) {
                let phrase = words[index..<(index + length)].joined(separator: " ")
                if let date = TimeSearch.parse(phrase, now: now, timeZone: timeZone) {
                    matched = (SearchToken(kind: .date, value: phrase.lowercased(), label: date.label, range: date.range), length)
                    break
                }
            }
            if let (token, length) = matched {
                tokens.append(token)
                index += length
            } else {
                tokens.append(classify(words[index], now: now, timeZone: timeZone))
                index += 1
            }
        }
        return tokens
    }

    public static func suggestions(for text: String, now: Date = Date(), timeZone: TimeZone = .current) -> [SearchToken] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        var tokens = parse(trimmed, now: now, timeZone: timeZone).filter { $0.kind != .keyword }
        // "is:" and the start of a word like "done" offer the Show chips.
        let last = trimmed.split(whereSeparator: \.isWhitespace).last.map { $0.lowercased() } ?? ""
        let typed = last.hasPrefix("is:") ? String(last.dropFirst(3)) : last
        if last.hasPrefix("is:") || typed.count >= 2 {
            for (value, words) in showOptions where words.contains(where: { $0.hasPrefix(typed) }) {
                let chip = token(for: SearchQualifier(.is, value.rawValue))
                if !tokens.contains(where: { $0.id == chip.id }) { tokens.append(chip) }
            }
        }
        return tokens
    }

    private static func isHex(_ value: String) -> Bool {
        [3, 6].contains(value.count) && value.allSatisfy(\.isHexDigit)
    }
}

public struct LibraryQuery: Hashable, Sendable {
    public var text: String
    public var tokens: [SearchToken]
    public var filters: LibraryFilters
    public var sort: LibrarySort

    public init(text: String = "", tokens: [SearchToken] = [], filters: LibraryFilters = .empty, sort: LibrarySort = .newest) {
        self.text = text
        self.tokens = tokens
        self.filters = filters
        self.sort = sort
    }

    public var effectiveFilters: LibraryFilters {
        var result = filters
        for token in tokens {
            switch token.kind {
            case .favorites: result.favoritesOnly = true
            case .trash: result.trashOnly = true
            case .type:
                if let type = CardType(rawValue: token.value), !result.types.contains(type) { result.types.append(type) }
            case .hue:
                if result.hue == nil { result.hue = ColorHue(token.value) }
            default: break
            }
        }
        return result
    }

    public var isTrash: Bool { effectiveFilters.trashOnly }

    /// The Archive view, a search for `is:archived`, or a smart folder that saves one.
    public var isArchive: Bool {
        !isTrash && (filters.archivedOnly || parsedSearch.has(.archived)
            || filters.folder?.query.map { SearchQualifiers.parse($0).has(.archived) } == true)
    }

    public func timeFilter(now: Date = Date(), timeZone: TimeZone = .current) -> TimeFilter? {
        TimeSearch.parse(text, now: now, timeZone: timeZone)
    }

    public var hasSearch: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !tokens.isEmpty }
    public var isNarrowed: Bool { hasSearch || filters.isActive }

    public var title: String {
        let effective = effectiveFilters
        let narrowing = tokens.contains { [.keyword, .tag, .style, .hex, .date, .qualifier].contains($0.kind) }
        return effective.isHome && narrowing ? tr("native.filters.filtered") : effective.title
    }

    /// The search text the backend parses, with qualifiers and tags written
    /// the canonical way.
    public func searchText(now: Date = Date(), timeZone: TimeZone = .current) -> String? {
        searchParts(now: now, timeZone: timeZone).words
    }

    private var parsedSearch: ParsedSearchQuery { SearchQualifiers.parse(searchText() ?? "") }

    /// Whether the search names a tag that reveals hidden cards.
    public var revealsHiddenCards: Bool { parsedSearch.tags.contains(where: HiddenTags.isHidden) }

    /// The anchor of a "More like this" search.
    public var likeCardId: String? { parsedSearch.likeCardId }

    /// Whether the search has words or an anchor to look up by meaning.
    public var wantsSemanticResults: Bool {
        guard !isTrash else { return false }
        let parsed = parsedSearch
        return !parsed.text.isEmpty || parsed.likeCardId != nil || parsed.mood != nil
    }

    /// Arguments for `requestSemanticResults`, which warms the results the
    /// paged search reads.
    public func semanticArgs(now: Date = Date(), timeZone: TimeZone = .current) -> ConvexArgs? {
        guard wantsSemanticResults, let words = searchText(now: now, timeZone: timeZone) else { return nil }
        var args: ConvexArgs = ["searchQuery": .string(words)]
        if let folder = filters.folder { args["folderId"] = .string(folder.id) }
        return args
    }

    private func searchParts(now: Date, timeZone: TimeZone) -> (words: String?, range: CreatedAtRange?) {
        var words: [String] = []
        var range: CreatedAtRange?
        for token in tokens {
            switch token.kind {
            case .keyword, .qualifier: words.append(token.value)
            case .tag: words.append(SearchQualifiers.format(SearchQualifier(.tag, SearchQualifiers.tagKey(token.value))))
            case .date where range == nil: range = token.range
            default: break
            }
        }
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            if range == nil, let time = timeFilter(now: now, timeZone: timeZone) {
                range = time.range
            } else {
                words.append(typed)
            }
        }
        return (words.isEmpty ? nil : words.joined(separator: " "), range)
    }

    public func searchArgs(now: Date = Date(), timeZone: TimeZone = .current) -> ConvexArgs {
        let effective = effectiveFilters
        var args = sort.args
        if effective.favoritesOnly { args["favoritesOnly"] = true }
        if effective.trashOnly { args["showTrashOnly"] = true }
        if effective.archivedOnly, !effective.trashOnly { args["showArchivedOnly"] = true }
        if let folder = effective.folder { args["folderId"] = .string(folder.id) }
        if !effective.types.isEmpty { args["types"] = .array(effective.types.map { .string($0.rawValue) }) }

        var hues = filters.hue.map { [$0.id] } ?? []
        var styles: [String] = []
        var hexes: [String] = []
        for token in tokens {
            switch token.kind {
            case .hue where !hues.contains(token.value): hues.append(token.value)
            case .style where !styles.contains(token.value): styles.append(token.value)
            case .hex where !hexes.contains(token.value): hexes.append(token.value)
            default: break
            }
        }
        let (words, range) = searchParts(now: now, timeZone: timeZone)
        if !hues.isEmpty { args["hueFilters"] = .array(hues.map { .string($0) }) }
        if !styles.isEmpty { args["styleFilters"] = .array(styles.map { .string($0) }) }
        if !hexes.isEmpty { args["hexFilters"] = .array(hexes.map { .string($0) }) }
        if let range { args["createdAtRange"] = ["start": .number(range.lowerBound), "end": .number(range.upperBound)] }
        if let words { args["searchQuery"] = .string(words) }
        return args
    }

    /// The search a smart folder saves: types, favorites and archive as
    /// qualifiers, then the search text. Colors, styles and dates aren't saved.
    public var smartFolderQuery: String? {
        guard !isTrash else { return nil }
        let effective = effectiveFilters
        var parts = effective.types.map { SearchQualifiers.format(SearchQualifier(.type, $0.rawValue)) }
        if effective.favoritesOnly { parts.append("is:fav") }
        if effective.archivedOnly { parts.append("is:archived") }
        if let words = searchText() { parts.append(words) }
        let query = parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty ? nil : query
    }

    /// Whether saving a smart folder would leave filters behind.
    public var smartFolderDropsFilters: Bool {
        filters.hue != nil || tokens.contains { [.hue, .style, .hex, .date].contains($0.kind) }
    }

    /// A name for a smart folder made from this search, like the web's.
    public var suggestedSmartFolderName: String {
        let effective = effectiveFilters
        var parts = effective.types.map(\.plural)
        if effective.favoritesOnly { parts.append(tr("native.filters.is.fav")) }
        if effective.archivedOnly { parts.append(tr("native.filters.is.archived")) }
        for token in tokens where [.keyword, .tag, .qualifier].contains(token.kind) { parts.append(token.label) }
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty { parts.append(typed) }
        let name = parts.joined(separator: " \u{00B7} ")
        let capitalized = name.prefix(1).uppercased() + name.dropFirst()
        return String(capitalized.prefix(300))
    }

    public func emptyState(now: Date = Date(), timeZone: TimeZone = .current) -> (title: String, message: String, symbol: String) {
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let parsed = parsedSearch
        if typed.isEmpty, tokens.isEmpty, effectiveFilters.trashOnly {
            return (tr("native.filters.empty.trashTitle"), tr("native.filters.empty.trashMessage"), "trash")
        }
        if let folder = filters.folder, typed.isEmpty, tokens.isEmpty {
            return folder.isSmart
                ? (tr("native.filters.empty.noMatches"), tr("native.filters.empty.smartFolderMessage"), "folder.badge.gearshape")
                : (tr("native.filters.empty.folderTitle"), tr("native.filters.empty.folderMessage"), "folder")
        }
        if typed.isEmpty, tokens.isEmpty, filters.archivedOnly {
            return (tr("native.filters.empty.archiveTitle"), tr("native.filters.empty.archiveMessage"), "archivebox")
        }
        if parsed.likeCardId != nil {
            return (tr("native.filters.empty.similarTitle"), "", "sparkles")
        }
        if parsed.has(.todo) {
            return (tr("native.filters.empty.todoTitle"), "", "checkmark.circle")
        }
        if typed.isEmpty, tokens.isEmpty, filters.isActive {
            return (tr("native.filters.empty.noMatches"), tr("native.filters.empty.filtersMessage"),
                    "line.3.horizontal.decrease.circle")
        }
        let title = typed.isEmpty ? tr("native.filters.empty.noMatches") : tr("native.filters.empty.noResults", typed)
        if let time = timeFilter(now: now, timeZone: timeZone), tokens.isEmpty {
            return (title, tr("native.filters.empty.noCardsFrom", time.label), "magnifyingglass")
        }
        return (title, tr("native.filters.empty.checkSpelling"), "magnifyingglass")
    }
}
