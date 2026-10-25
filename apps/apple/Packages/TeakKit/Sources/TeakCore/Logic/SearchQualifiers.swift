import Foundation

/// A port of `parseSearchQuery` and its helpers in
/// `packages/convex/shared/search/qualifiers.ts`, so the search field turns
/// typed qualifiers into chips the way the web does. The backend parses the
/// search text itself, operators included; this reads only the flat form and
/// decides what each chip says. Text with `-`, `OR` or parentheses is sent as
/// typed (`hasOperators`).
public enum SearchQualifierKey: String, CaseIterable, Sendable {
    case tag, type, `is`, site, folder, like, mood, price, text
}

public enum SearchIsValue: String, Sendable {
    case fav, archived, done, todo

    public var label: String {
        switch self {
        case .fav: tr("native.filters.is.fav")
        case .archived: tr("native.filters.is.archived")
        case .done: tr("native.filters.is.done")
        case .todo: tr("native.filters.is.todo")
        }
    }
}

public struct PriceBound: Hashable, Sendable {
    public enum Comparison: String, Sendable { case lessThan = "<", greaterThan = ">", atMost = "<=", atLeast = ">=", equal = "=" }

    public let op: Comparison
    public let amount: Double

    public init(_ op: Comparison, _ amount: Double) {
        self.op = op
        self.amount = amount
    }
}

public struct SearchQualifier: Hashable, Sendable {
    public let key: SearchQualifierKey
    public let value: String

    public init(_ key: SearchQualifierKey, _ value: String) {
        self.key = key
        self.value = value
    }
}

public struct ParsedSearchQuery: Hashable, Sendable {
    public var qualifiers: [SearchQualifier] = []
    public var terms: [String] = []
    public var phrases: [String] = []

    public var text: String { (terms + phrases).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines) }
    public var tags: [String] { values(.tag) }
    public var types: [CardType] { values(.type).compactMap(CardType.init(rawValue:)) }
    public var sites: [String] { values(.site) }
    public var folders: [String] { values(.folder).map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() } }
    public var ocrTexts: [String] { values(.text) }
    public var prices: [PriceBound] { values(.price).compactMap(SearchQualifiers.parsePriceBound) }
    public var likeCardId: String? { values(.like).last }
    public var mood: String? { values(.mood).last }
    public func has(_ value: SearchIsValue) -> Bool { values(.is).contains(value.rawValue) }

    public var canonical: String {
        (qualifiers.map(SearchQualifiers.format) + phrases.map(SearchQualifiers.quote) + terms).joined(separator: " ")
    }

    private func values(_ key: SearchQualifierKey) -> [String] { qualifiers.filter { $0.key == key }.map(\.value) }
}

public enum SearchQualifiers {
    static let trimCharacters: Set<Character> = Set(",.;:!?()[]{}\"'")
    private static let quoteCharacters: Set<Unicode.Scalar> = ["\"", "\u{201C}", "\u{201D}"]
    private static let favoriteWords: Set<String> = ["fav", "favs", "favorite", "favorites", "favourite", "favourites", "starred"]
    private static let archivedWords: Set<String> = ["archived", "archive"]
    private static let doneWords: Set<String> = ["done", "completed", "finished"]
    private static let todoWords: Set<String> = ["todo", "to-do"]
    private static let maxMoodLength = 200
    private static let maxOCRTextLength = 200
    /// Lowercasing can lengthen a tag, so keys allow more than a name's 64.
    static let maxTagKeyLength = 256

    public struct RawToken: Hashable, Sendable {
        public let prefix: String
        public let quoted: Bool
        public let text: String
        /// The token as it was typed, quotes and escapes included.
        public var source = ""
    }

    /// Words split on whitespace, where quotes (straight or curly) group words
    /// and `\"` escapes a quote inside them.
    public static func tokenize(_ input: String) -> [RawToken] {
        let scalars = Array(input.unicodeScalars)
        var tokens: [RawToken] = []
        var index = 0
        func isSpace(_ scalar: Unicode.Scalar) -> Bool { scalar.properties.isWhitespace }
        while index < scalars.count {
            while index < scalars.count, isSpace(scalars[index]) { index += 1 }
            if index >= scalars.count { break }
            let start = index
            var text = String.UnicodeScalarView()
            var prefix: String?
            var inQuotes = false
            while index < scalars.count {
                let character = scalars[index]
                if inQuotes {
                    let next = index + 1 < scalars.count ? scalars[index + 1] : nil
                    if character == "\\", let next, quoteCharacters.contains(next) || next == "\\" {
                        text.append(next)
                        index += 2
                        continue
                    }
                    if quoteCharacters.contains(character) {
                        inQuotes = false
                        index += 1
                        continue
                    }
                    text.append(character)
                    index += 1
                    continue
                }
                if isSpace(character) { break }
                if quoteCharacters.contains(character) {
                    if prefix == nil { prefix = String(text) }
                    inQuotes = true
                    index += 1
                    continue
                }
                text.append(character)
                index += 1
            }
            var source = String.UnicodeScalarView()
            source.append(contentsOf: scalars[start..<index])
            tokens.append(RawToken(prefix: prefix ?? "", quoted: prefix != nil, text: String(text), source: String(source)))
        }
        return tokens
    }

    /// Whether the text uses search operators: a word that starts with `-`, an
    /// uppercase `OR` or a parenthesis, outside quotes. Such text is sent as
    /// typed, since lifting a filter out of it could change what it means.
    public static func hasOperators(_ text: String) -> Bool {
        var inQuotes = false
        var word = ""
        var escaped = false
        for scalar in text.unicodeScalars {
            if inQuotes {
                if escaped { escaped = false } else if scalar == "\\" { escaped = true } else if quoteCharacters.contains(scalar) { inQuotes = false }
                continue
            }
            if quoteCharacters.contains(scalar) {
                if word == "-" { return true }
                inQuotes = true
                word.append("\"")
            } else if scalar == "(" || scalar == ")" {
                return true
            } else if scalar.properties.isWhitespace {
                if word == "OR" { return true }
                word = ""
            } else {
                if word.isEmpty, scalar == "-" { word.append("-"); continue }
                if word == "-" { return true }
                word.unicodeScalars.append(scalar)
            }
        }
        return word == "OR"
    }

    /// Search parts joined by spaces, each part with an `OR` in parentheses
    /// when there are others, since a space binds tighter than `OR`: the
    /// grouping the web's `buildCardsSearchTerms` applies.
    public static func join(_ parts: [String]) -> String {
        let parts = parts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard parts.count > 1 else { return parts.first ?? "" }
        return parts.map { $0.contains(/(^|[\s(])OR(?=[\s)]|$)/) ? "(\($0))" : $0 }.joined(separator: " ")
    }

    /// The word being typed at the end of the text, and where it starts, as
    /// the web's `currentSearchToken` finds it: quotes keep spaces inside a word.
    public static func currentWord(_ text: String) -> (before: String, word: String) {
        var start = text.startIndex
        var inQuotes = false
        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            if character == "\\", inQuotes {
                index = text.index(after: index)
                if index < text.endIndex { index = text.index(after: index) }
                continue
            }
            if character.unicodeScalars.first.map(quoteCharacters.contains) == true {
                inQuotes.toggle()
            } else if !inQuotes, character.isWhitespace {
                start = text.index(after: index)
            }
            index = text.index(after: index)
        }
        return (String(text[..<start]), String(text[start...]))
    }

    /// Whether a word typed after `before` belongs to an `OR` or an open group,
    /// as the web's `continuesOperator` decides; a filter picked there stays in
    /// the text.
    public static func continuesOperator(_ before: String) -> Bool {
        var depth = 0
        var inQuotes = false
        var word = ""
        var topLevelOr = false
        func endWord() {
            if word == "OR", depth == 0 { topLevelOr = true }
            word = ""
        }
        var escaped = false
        for character in before {
            if escaped { escaped = false; continue }
            if character == "\\", inQuotes { escaped = true; continue }
            if character.unicodeScalars.first.map(quoteCharacters.contains) == true {
                inQuotes.toggle()
                word = ""
            } else if inQuotes {
                continue
            } else if character == "(" {
                endWord()
                depth += 1
            } else if character == ")" {
                endWord()
                depth = max(0, depth - 1)
            } else if character.isWhitespace {
                endWord()
            } else {
                word.append(character)
            }
        }
        endWord()
        return depth > 0 || topLevelOr
    }

    static func trimEdgePunctuation(_ value: String, keeping keep: String = "") -> String {
        func trims(_ character: Character) -> Bool { trimCharacters.contains(character) && !keep.contains(character) }
        var characters = Substring(value)
        while let first = characters.first, trims(first) { characters.removeFirst() }
        while let last = characters.last, trims(last) { characters.removeLast() }
        return String(characters)
    }

    public static func tagKey(_ tag: String) -> String {
        tag.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func parseType(_ value: String) -> CardType? {
        let word = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let type = CardType(rawValue: word) { return type }
        return word.hasSuffix("s") ? CardType(rawValue: String(word.dropLast())) : nil
    }

    public static func parsePriceBound(_ value: String) -> PriceBound? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = trimmed.wholeMatch(of: /(<=|>=|<|>|=)(\d{1,12}(?:\.\d{1,6})?)/),
              let op = PriceBound.Comparison(rawValue: String(match.1)), let amount = Double(match.2), amount.isFinite
        else { return nil }
        return PriceBound(op, amount)
    }

    public static func formatPriceBound(_ bound: PriceBound) -> String {
        "\(bound.op.rawValue)\(formatNumber(bound.amount, grouping: false))"
    }

    /// The chip text for a price bound, as `describePriceBound` writes it.
    public static func describePriceBound(_ bound: PriceBound, locale: Locale = AppLanguage.locale) -> String {
        let amount = formatNumber(bound.amount, grouping: true, locale: locale)
        switch bound.op {
        case .lessThan: return tr("native.filters.price.under", amount)
        case .greaterThan: return tr("native.filters.price.over", amount)
        case .atMost: return tr("native.filters.price.atMost", amount)
        case .atLeast: return tr("native.filters.price.atLeast", amount)
        case .equal: return tr("native.filters.price.exactly", amount)
        }
    }

    /// JavaScript's shortest number form (`String(n)`) for the search text, or
    /// `toLocaleString` in the app's language with up to six decimals when grouping.
    private static func formatNumber(_ value: Double, grouping: Bool, locale: Locale = Locale(identifier: "en_US")) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = grouping
        formatter.maximumFractionDigits = grouping ? 6 : 12
        formatter.minimumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    private static func collapseSpaces(_ value: String) -> String {
        value.replacing(/\s+/, with: " ")
    }

    private static func prefix(_ value: String, utf16 limit: Int) -> String {
        guard value.utf16.count > limit else { return value }
        var result = ""
        var length = 0
        for character in value {
            length += character.utf16.count
            if length > limit { break }
            result.append(character)
        }
        return result
    }

    static func parseQualifier(_ key: SearchQualifierKey, _ rawValue: String) -> SearchQualifier? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        switch key {
        case .tag:
            let tag = tagKey(value)
            return !tag.isEmpty && tag.utf16.count <= maxTagKeyLength ? SearchQualifier(key, tag) : nil
        case .type:
            return parseType(value).map { SearchQualifier(key, $0.rawValue) }
        case .is:
            let word = value.lowercased()
            if favoriteWords.contains(word) { return SearchQualifier(key, SearchIsValue.fav.rawValue) }
            if doneWords.contains(word) { return SearchQualifier(key, SearchIsValue.done.rawValue) }
            if todoWords.contains(word) { return SearchQualifier(key, SearchIsValue.todo.rawValue) }
            return archivedWords.contains(word) ? SearchQualifier(key, SearchIsValue.archived.rawValue) : nil
        case .site:
            return normalizeHost(value).map { SearchQualifier(key, $0) }
        case .folder:
            return SearchQualifier(key, value)
        case .like:
            return value.wholeMatch(of: /[0-9a-z]{31,37}/) != nil ? SearchQualifier(key, value) : nil
        case .mood:
            let text = prefix(collapseSpaces(value), utf16: maxMoodLength).trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : SearchQualifier(key, text)
        case .price:
            return parsePriceBound(value).map { SearchQualifier(key, formatPriceBound($0)) }
        case .text:
            let text = prefix(collapseSpaces(value), utf16: maxOCRTextLength).trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : SearchQualifier(key, text)
        }
    }

    /// The lowercase host without `www.`, a port or a path, as `normalizeUrlHost`
    /// reads a `site:` value. Unicode names stay as typed; the backend reads the text.
    static func normalizeHost(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.firstMatch(of: /^[a-zA-Z][a-zA-Z\d+.\-]*:(?!\/\/)(?!\d)/) == nil else { return nil }
        let afterScheme = trimmed.firstMatch(of: /^[a-zA-Z][a-zA-Z\d+.\-]*:\/\//).map { String(trimmed[$0.range.upperBound...]) }
            ?? trimmed
        let authority = afterScheme.prefix { !"/?#\\".contains($0) }
        let hostAndPort = authority.split(separator: "@", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        var host: String
        if hostAndPort.hasPrefix("[") {
            guard let close = hostAndPort.firstIndex(of: "]") else { return nil }
            host = String(hostAndPort[...close])
        } else {
            host = String(hostAndPort.prefix { $0 != ":" })
        }
        host = host.lowercased()
        guard !host.isEmpty, !host.contains(where: { $0.isWhitespace || "<>^|%\u{0}".contains($0) }) else { return nil }
        while host.hasSuffix(".") { host.removeLast() }
        if host.hasPrefix("www."), host.count > 4 { host.removeFirst(4) }
        return host.isEmpty ? nil : host
    }

    private static func isSimilarity(_ key: SearchQualifierKey) -> Bool { key == .like || key == .mood }

    private static func identity(_ qualifier: SearchQualifier) -> String {
        let folded = [.folder, .mood, .text].contains(qualifier.key) ? qualifier.value.lowercased() : qualifier.value
        return "\(qualifier.key.rawValue):\(folded)"
    }

    private static func needsQuotes(_ value: String) -> Bool {
        value.contains { $0.isWhitespace || "\"\u{201C}\u{201D}\\".contains($0) }
            || value.first.map(trimCharacters.contains) == true || value.last.map(trimCharacters.contains) == true
    }

    public static func quote(_ value: String) -> String {
        var escaped = ""
        for character in value {
            if "\\\"\u{201C}\u{201D}".contains(character) { escaped.append("\\") }
            escaped.append(character)
        }
        return "\"\(escaped)\""
    }

    public static func format(_ qualifier: SearchQualifier) -> String {
        "\(qualifier.key.rawValue):\(needsQuotes(qualifier.value) ? quote(qualifier.value) : qualifier.value)"
    }

    private static func isHexColor(_ value: String) -> Bool {
        [3, 4, 6, 8].contains(value.count) && value.allSatisfy(\.isHexDigit)
    }

    public static func parse(_ input: String) -> ParsedSearchQuery {
        var parsed = ParsedSearchQuery()
        var seen = Set<String>()
        func add(_ qualifier: SearchQualifier) {
            if seen.insert(identity(qualifier)).inserted { parsed.qualifiers.append(qualifier) }
        }
        for token in tokenize(input) {
            let colonSource = token.quoted ? token.prefix : token.text
            let colon = colonSource.firstIndex(of: ":").map { colonSource.distance(from: colonSource.startIndex, to: $0) }
            let keyCandidate = colon.map { String(token.text.prefix($0)).lowercased() } ?? ""
            if let colon, colon > 0, !token.quoted || colon == token.prefix.count - 1,
               let key = SearchQualifierKey(rawValue: keyCandidate) {
                let rawValue = String(token.text.dropFirst(colon + 1))
                let qualifier = parseQualifier(key, token.quoted ? rawValue : trimEdgePunctuation(rawValue, keeping: key == .site ? "[]" : ""))
                if let qualifier, isSimilarity(qualifier.key),
                   parsed.qualifiers.contains(where: { isSimilarity($0.key) && identity($0) != identity(qualifier) }) {
                    parsed.terms.append(token.text)
                } else if let qualifier {
                    add(qualifier)
                } else if !rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    parsed.terms.append(token.text)
                }
                continue
            }
            if token.text.hasPrefix("#"), !token.quoted || token.prefix == "#" {
                let rest = String(token.text.dropFirst())
                let value = token.quoted ? rest : trimEdgePunctuation(rest)
                if !token.quoted, !value.isEmpty, isHexColor(value) {
                    parsed.terms.append(token.text)
                    continue
                }
                if let qualifier = parseQualifier(.tag, value) { add(qualifier) }
                continue
            }
            if token.quoted, token.prefix.isEmpty {
                let phrase = token.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !phrase.isEmpty { parsed.phrases.append(phrase) }
                continue
            }
            if !token.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { parsed.terms.append(token.text) }
        }
        return parsed
    }

    /// The muted prefix and label a chip shows, as the web's
    /// `describeQualifierChip` writes them. `like:` shows the anchor's title,
    /// which the caller looks up.
    public static func chip(_ qualifier: SearchQualifier, likeTitle: String? = nil) -> (title: String, label: String) {
        switch qualifier.key {
        case .tag: return (tr("native.filters.chips.tag"), qualifier.value)
        case .type: return (tr("native.filters.chips.type"), CardType(rawValue: qualifier.value)?.label ?? qualifier.value)
        case .is: return (tr("native.filters.chips.is"), SearchIsValue(rawValue: qualifier.value)?.label ?? qualifier.value)
        case .site: return (tr("native.filters.chips.site"), qualifier.value)
        case .folder: return (tr("native.filters.chips.folder"), qualifier.value)
        case .like: return (tr("native.filters.chips.like"), likeTitle ?? tr("native.filters.chips.anyCard"))
        case .mood: return (tr("native.filters.chips.mood"), tr("native.filters.chips.moodValue", qualifier.value))
        case .price:
            return (tr("native.filters.chips.price"),
                    parsePriceBound(qualifier.value).map { describePriceBound($0) } ?? qualifier.value)
        case .text: return (tr("native.filters.chips.text"), qualifier.value)
        }
    }
}
