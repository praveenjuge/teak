import Foundation

/// The filter menu: favorites, Trash, types and one color, like the iPhone app.
public struct LibraryFilters: Hashable, Sendable {
    public var favoritesOnly = false
    public var trashOnly = false
    public var types: [CardType] = []
    public var hue: ColorHue?

    public init(favoritesOnly: Bool = false, trashOnly: Bool = false, types: [CardType] = [], hue: ColorHue? = nil) {
        self.favoritesOnly = favoritesOnly
        self.trashOnly = trashOnly
        self.types = types
        self.hue = hue
    }

    public static let empty = LibraryFilters()

    public var isActive: Bool { favoritesOnly || trashOnly || !types.isEmpty || hue != nil }

    public func togglingType(_ type: CardType) -> LibraryFilters {
        var next = self
        if let index = next.types.firstIndex(of: type) { next.types.remove(at: index) } else { next.types.append(type) }
        return next
    }

    /// The large title names the view: "Trash", "Favorites", "Links", "Favorite Links".
    public var title: String {
        if trashOnly { return "Trash" }
        let typeTitle = types.count == 1 ? types[0].plural : nil
        if favoritesOnly { return typeTitle.map { "Favorite \($0)" } ?? "Favorites" }
        if let typeTitle { return typeTitle }
        if let hue { return hue.label }
        return types.count > 1 ? "Filtered" : "Home"
    }
}

/// A committed search token: the Mac app's search syntax, now on every platform.
public struct SearchToken: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable { case keyword, date, type, tag, style, hue, hex, favorites, trash }

    public let kind: Kind
    public let value: String
    public let label: String
    public var range: CreatedAtRange?

    public init(kind: Kind, value: String, label: String, range: CreatedAtRange? = nil) {
        self.kind = kind
        self.value = value
        self.label = label
        self.range = range
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
        }
    }
}

/// Port of the Mac app's `LibrarySearchTokens`.
public enum SearchTokens {
    /// An exact tag filter, from a card's tag.
    public static func tag(_ name: String) -> SearchToken {
        SearchToken(kind: .tag, value: name, label: "#\(name)")
    }

    public static func classify(_ input: String, now: Date = Date(), timeZone: TimeZone = .current) -> SearchToken {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = trimmed.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        if ["fav", "favs", "favorites", "favourite", "favourites"].contains(value) {
            return SearchToken(kind: .favorites, value: "favorites", label: "Favorites")
        }
        if ["trash", "deleted", "bin", "recycle", "trashed"].contains(value) {
            return SearchToken(kind: .trash, value: "trash", label: "Trash")
        }
        if let date = TimeSearch.parse(value, now: now, timeZone: timeZone) {
            return SearchToken(kind: .date, value: value, label: date.label, range: date.range)
        }
        if let type = CardType(rawValue: value) {
            return SearchToken(kind: .type, value: value, label: type.label)
        }
        if value.hasPrefix("#"), value.count > 1, !isHex(String(value.dropFirst())) {
            return tag(String(trimmed.dropFirst()))
        }
        let constants = SharedConstants.shared
        let facet = value.filter { $0.isLetter || $0.isNumber }
        if let style = constants.visualStyleAliases[facet] {
            return SearchToken(kind: .style, value: style, label: constants.visualStyleLabels[style] ?? style.capitalized)
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

    /// Splits typed text into tokens, keeping multi-word dates ("last week",
    /// "from June 5 2024 to July 6 2025") together.
    public static func parse(_ input: String, now: Date = Date(), timeZone: TimeZone = .current) -> [SearchToken] {
        let punctuation = CharacterSet(charactersIn: ",.;:!?()[]{}\"'")
        let words = input.split(whereSeparator: \.isWhitespace).map { String($0).trimmingCharacters(in: punctuation) }
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
        return tokens.filter { !$0.value.isEmpty }
    }

    /// Tokens worth suggesting while someone types, so search syntax is discoverable.
    public static func suggestions(for text: String, now: Date = Date(), timeZone: TimeZone = .current) -> [SearchToken] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let tokens = parse(trimmed, now: now, timeZone: timeZone)
        return tokens.filter { $0.kind != .keyword }
    }

    private static func isHex(_ value: String) -> Bool {
        [3, 6].contains(value.count) && value.allSatisfy(\.isHexDigit)
    }
}

/// Everything the library shows: typed text, committed tokens and the filter menu.
public struct LibraryQuery: Hashable, Sendable {
    public var text: String
    public var tokens: [SearchToken]
    public var filters: LibraryFilters

    public init(text: String = "", tokens: [SearchToken] = [], filters: LibraryFilters = .empty) {
        self.text = text
        self.tokens = tokens
        self.filters = filters
    }

    /// The menu filters with the tokens folded in.
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

    /// A date typed but not committed ("last week") filters by date, as on iPhone.
    public func timeFilter(now: Date = Date(), timeZone: TimeZone = .current) -> TimeFilter? {
        TimeSearch.parse(text, now: now, timeZone: timeZone)
    }

    public var hasSearch: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !tokens.isEmpty }
    public var isNarrowed: Bool { hasSearch || filters.isActive }

    public var title: String {
        let base = effectiveFilters.title
        let narrowing = tokens.contains { [.keyword, .tag, .style, .hex, .date].contains($0.kind) }
        return base == "Home" && narrowing ? "Filtered" : base
    }

    /// Arguments for `cards:searchMobileCardSummariesPaginated`, without pagination.
    public func searchArgs(now: Date = Date(), timeZone: TimeZone = .current) -> ConvexArgs {
        let effective = effectiveFilters
        var args: ConvexArgs = [:]
        if effective.favoritesOnly { args["favoritesOnly"] = true }
        if effective.trashOnly { args["showTrashOnly"] = true }
        if !effective.types.isEmpty { args["types"] = .array(effective.types.map { .string($0.rawValue) }) }

        var hues = filters.hue.map { [$0.id] } ?? []
        var styles: [String] = []
        var hexes: [String] = []
        var words: [String] = []
        var range: CreatedAtRange?
        for token in tokens {
            switch token.kind {
            case .hue where !hues.contains(token.value): hues.append(token.value)
            case .style where !styles.contains(token.value): styles.append(token.value)
            case .hex where !hexes.contains(token.value): hexes.append(token.value)
            case .keyword, .tag: words.append(token.value)
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
        if !hues.isEmpty { args["hueFilters"] = .array(hues.map { .string($0) }) }
        if !styles.isEmpty { args["styleFilters"] = .array(styles.map { .string($0) }) }
        if !hexes.isEmpty { args["hexFilters"] = .array(hexes.map { .string($0) }) }
        if let range { args["createdAtRange"] = ["start": .number(range.start), "end": .number(range.end)] }
        if !words.isEmpty { args["searchQuery"] = .string(words.joined(separator: " ")) }
        return args
    }

    /// The empty state for a query that matched nothing.
    public func emptyState(now: Date = Date(), timeZone: TimeZone = .current) -> (title: String, message: String, symbol: String) {
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if typed.isEmpty, tokens.isEmpty, effectiveFilters.trashOnly {
            return ("Trash Is Empty", "Cards you delete stay here for 30 days.", "trash")
        }
        if typed.isEmpty, tokens.isEmpty, filters.isActive {
            return ("No Matching Cards", "Try other filters.", "line.3.horizontal.decrease.circle")
        }
        let title = typed.isEmpty ? "No Matching Cards" : "No Results for \u{201C}\(typed)\u{201D}"
        if let time = timeFilter(now: now, timeZone: timeZone), tokens.isEmpty {
            return (title, "No cards from \(time.label).", "magnifyingglass")
        }
        return (title, "Check the spelling or try a new search.", "magnifyingglass")
    }
}
