import Foundation

/// A hint the search field offers for the word being typed: a filter to start
/// (`tag:`), one to leave out (`-tag:`), `OR`, or a value Teak knows.
public struct SearchSuggestion: Hashable, Sendable, Identifiable {
    public let id: String
    /// The web's group: Filters, Exclude, Combine, Types or Show.
    public let group: String
    /// What picking it writes in place of the word being typed.
    public let insert: String
    /// `-tag:`, `OR`, or a value in the app's language.
    public let label: String
    /// What a hint does, in the app's language.
    public let detail: String?
    /// A whole filter, so a space follows it.
    public let complete: Bool

    /// The text after picking this suggestion while `text` is typed.
    public func accept(in text: String) -> String {
        SearchQualifiers.currentWord(text).before + insert + (complete ? " " : "")
    }
}

/// A port of the web's `buildSearchSuggestions`
/// (`apps/web/src/components/search/searchSuggestions.ts`), from the hint lists
/// in `packages/convex/shared/search/suggestionHints.ts`. The web also suggests
/// the person's tags, sites and folders; the apps offer the hints, card types
/// and `is:` values. Android's `SearchSuggestions` is the same port.
public enum SearchSuggestions {
    private static let groupLimit = 8
    private static var hints: SharedConstants.SearchSuggestionHints { SharedConstants.shared.searchSuggestionHints }

    /// Suggestions for the last word of `text`.
    public static func build(for text: String) -> [SearchSuggestion] {
        let (before, word) = SearchQualifiers.currentWord(text)
        return build(word, afterWord: !before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    static func build(_ token: String, afterWord: Bool) -> [SearchSuggestion] {
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        if token.hasPrefix("-"), !token.hasPrefix("--") { return excluding(String(token.dropFirst())) }
        // `OR` joins two words or filters, so it is offered only after one.
        if afterWord, token.wholeMatch(of: /(?i)or?/) != nil {
            return [suggestion(hints.or)] + build(token, afterWord: false)
        }
        if token.hasPrefix("#") { return [] }
        if let match = token.wholeMatch(of: /(?i)(tag|type|is|site|folder):([\s\S]*)/) {
            let values = valueSuggestions(String(match.1).lowercased(), unquote(String(match.2)))
            if let typed = SearchQualifiers.parse(token).qualifiers.first, values.count == 1,
               values[0].insert == SearchQualifiers.format(typed) {
                return []
            }
            return values
        }
        let word = token.lowercased()
        return hints.qualifiers.filter { $0.key.hasPrefix(word) }.map(suggestion)
    }

    /// After a `-`: the filters to leave out, then excluded values.
    private static func excluding(_ token: String) -> [SearchSuggestion] {
        let word = token.lowercased()
        let keys = token.contains(":") || token.hasPrefix("#") ? [] : hints.exclude.filter { $0.key.hasPrefix(word) }.map(suggestion)
        let excludable = Set(hints.exclude.map(\.key))
        let values = build(token, afterWord: false)
            .filter { $0.group != "Filters" && excludable.contains(String($0.insert.prefix { $0 != ":" })) }
            .map {
                SearchSuggestion(id: "Exclude:-\($0.insert)", group: "Exclude", insert: "-\($0.insert)", label: $0.label,
                                 detail: $0.detail, complete: $0.complete)
            }
        return keys + values
    }

    private static func valueSuggestions(_ key: String, _ value: String) -> [SearchSuggestion] {
        let needle = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch key {
        case "type":
            let constants = SharedConstants.shared
            let types = constants.cardTypes.compactMap(CardType.init(rawValue:))
            return rank(types, needle) { "\($0.rawValue) \(constants.cardTypeLabels[$0.rawValue] ?? "")" }
                .prefix(groupLimit)
                .map { complete(SearchQualifier(.type, $0.rawValue), group: "Types", label: $0.label) }
        case "is":
            return hints.isOptions
                .filter { option in needle.isEmpty || option.words.contains { $0.hasPrefix(needle) } }
                .map { complete(SearchQualifier(.is, $0.value), group: "Show", label: tr($0.messageKey)) }
        default:
            return []
        }
    }

    private static func suggestion(_ hint: SharedConstants.SearchSuggestionHints.Hint) -> SearchSuggestion {
        SearchSuggestion(id: hint.id, group: hint.group, insert: hint.insert,
                         label: hint.insert.trimmingCharacters(in: .whitespaces), detail: tr(hint.messageKey), complete: false)
    }

    private static func complete(_ qualifier: SearchQualifier, group: String, label: String) -> SearchSuggestion {
        let insert = SearchQualifiers.format(qualifier)
        return SearchSuggestion(id: "\(group):\(insert)", group: group, insert: insert, label: label, detail: nil, complete: true)
    }

    /// Exact names, then names that start with the text, then names with a word that does.
    private static func rank<T>(_ items: [T], _ needle: String, name: (T) -> String) -> [T] {
        guard !needle.isEmpty else { return items }
        var exact: [T] = [], starts: [T] = [], words: [T] = []
        for item in items {
            let itemName = name(item).lowercased()
            if itemName == needle {
                exact.append(item)
            } else if itemName.hasPrefix(needle) {
                starts.append(item)
            } else if itemName.split(whereSeparator: { " -_./".contains($0) }).contains(where: { $0.hasPrefix(needle) }) {
                words.append(item)
            }
        }
        return exact + starts + words
    }

    private static func unquote(_ value: String) -> String {
        var text = Substring(value)
        if let first = text.first, "\"\u{201C}\u{201D}".contains(first) { text = text.dropFirst() }
        if let last = text.last, "\"\u{201C}\u{201D}".contains(last) { text = text.dropLast() }
        return String(text)
    }
}
