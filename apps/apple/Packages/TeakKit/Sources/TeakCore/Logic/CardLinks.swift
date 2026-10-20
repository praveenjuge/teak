import Foundation

/// `[[Title|teak:<cardId>]]` links between cards, written in a text card's
/// Markdown. A port of `packages/convex/shared/cardLinks.ts`: lengths and
/// indexes are UTF-16 units, as in JavaScript, so both sides cut titles and
/// find tokens at the same places.
public enum CardLinks {
    public static let titleMaxLength = 200
    /// Distinct targets indexed per card; later ones still render.
    public static let maxLinks = 500

    static let tokenPattern = #"\[\[([^\]|\n]{0,200})\|teak:([a-z0-9]{16,64})\]\]"#
    private static let tokenRegex = regex(tokenPattern)
    private static let titleUnsafeRegex = regex(#"[|\]\r\n]+"#)
    private static let spacesRegex = regex(#"\s+"#)
    private static let fenceRegex = regex(#"^ {0,3}(`{3,}|~{3,})"#)
    private static let closingFenceRegex = regex(#"^ {0,3}(`{3,}|~{3,})[ \t]*$"#)
    private static let backtickRunRegex = regex("`+")
    private static let listItemRegex = regex(#"^( *)([-+*]|\d{1,9}[.)])( {1,4}|$)"#)
    private static let codeIndent = 4

    /// The patterns are constants that the tests run, so a bad one is a programming error.
    private static func regex(_ pattern: String) -> NSRegularExpression {
        do {
            return try NSRegularExpression(pattern: pattern)
        } catch {
            preconditionFailure("Invalid card link pattern \(pattern): \(error)")
        }
    }
    private static let ellipsis = "\u{2026}"
    private static let fallbackTitle = "Card"

    public struct Match: Hashable, Sendable {
        /// UTF-16 offsets into the Markdown.
        public let start: Int
        public let end: Int
        public let title: String
        public let id: String
    }

    /// Whether `markdown` might hold a link token: a cheap check before parsing.
    public static func mayHaveCardLinks(_ markdown: String?) -> Bool {
        markdown?.contains("|teak:") == true
    }

    /// A card title made fit to store in a token: one line, 200 units at most.
    public static func tokenTitle(_ title: String) -> String {
        let safe = replace(spacesRegex, in: replace(titleUnsafeRegex, in: title, with: " "), with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return truncate(safe.isEmpty ? fallbackTitle : safe, max: titleMaxLength)
    }

    /// A token that always matches the parse pattern, whatever the title.
    public static func formatToken(title: String, id: String) -> String {
        "[[\(tokenTitle(title))|teak:\(id)]]"
    }

    /// Linked card ids in order, unique, at most `maxLinks`; code excluded.
    public static func parseIds(_ markdown: String?) -> [String] {
        var seen = Set<String>()
        var ids: [String] = []
        for match in matches(markdown ?? "") {
            if ids.count >= maxLinks { break }
            if seen.insert(match.id).inserted { ids.append(match.id) }
        }
        return ids
    }

    /// Every token outside code replaced by `replace(title, id)`.
    public static func replaceTokens(_ markdown: String, _ replace: (String, String) -> String) -> String {
        let found = matches(markdown)
        guard !found.isEmpty else { return markdown }
        let source = markdown as NSString
        var result = ""
        var cursor = 0
        for match in found {
            result += source.substring(with: NSRange(location: cursor, length: match.start - cursor))
            result += replace(match.title, match.id)
            cursor = match.end
        }
        return result + source.substring(from: cursor)
    }

    /// Tokens shown as their stored titles, for previews and search text.
    public static func tokensToText(_ markdown: String) -> String {
        replaceTokens(markdown) { title, _ in title }
    }

    /// Every token outside code, in order.
    public static func matches(_ markdown: String) -> [Match] {
        guard mayHaveCardLinks(markdown) else { return [] }
        let masked = maskCode(markdown) as NSString
        let source = markdown as NSString
        // ICU counts `{0,200}` in code points and JavaScript in UTF-16 units;
        // a title holds no `]` or `|`, so a longer one can't match at all.
        return tokenRegex.matches(in: masked as String, range: NSRange(location: 0, length: masked.length)).compactMap { result in
            let titleRange = result.range(at: 1)
            guard titleRange.length <= titleMaxLength else { return nil }
            // The title comes from the original: masking blanks backticks in it.
            return Match(start: result.range.location, end: result.range.location + result.range.length,
                         title: source.substring(with: titleRange), id: masked.substring(with: result.range(at: 2)))
        }
    }

    // MARK: - Titles

    /// `title` cut to `max` UTF-16 units on a whole grapheme, ending in `…`.
    private static func truncate(_ title: String, max: Int) -> String {
        guard title.utf16.count > max else { return title }
        var result = ""
        var length = 0
        for character in title {
            let units = character.utf16.count
            if length + units + ellipsis.utf16.count > max { break }
            result.append(character)
            length += units
        }
        return trimEnd(result) + ellipsis
    }

    private static func trimEnd(_ value: String) -> String {
        var result = value
        while let last = result.last, last.isWhitespace { result.removeLast() }
        return result
    }

    // MARK: - Masking code

    private static func replace(_ regex: NSRegularExpression, in value: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: value, range: NSRange(location: 0, length: (value as NSString).length),
                                       withTemplate: NSRegularExpression.escapedTemplate(for: template))
    }

    /// Every UTF-16 unit but newlines replaced by a space, keeping indexes.
    private static func blank(_ units: ArraySlice<UInt16>) -> [UInt16] {
        units.map { $0 == 10 ? 10 : 32 }
    }

    private static func blank(_ line: String) -> String {
        String(decoding: blank(Array(line.utf16)[...]), as: UTF16.self)
    }

    private static func firstMatch(_ regex: NSRegularExpression, _ line: String) -> NSTextCheckingResult? {
        regex.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length))
    }

    /// Inline code spans in one line replaced by spaces, keeping every index.
    private static func maskCodeSpans(_ line: String) -> String {
        let runs = backtickRunRegex.matches(in: line, range: NSRange(location: 0, length: (line as NSString).length)).map(\.range)
        var units = Array(line.utf16)
        var index = 0
        while index < runs.count {
            let open = runs[index]
            guard let closeIndex = runs.indices.first(where: { $0 > index && runs[$0].length == open.length }) else {
                index += 1
                continue
            }
            let close = runs[closeIndex]
            let start = open.location
            let end = close.location + close.length
            units.replaceSubrange(start..<end, with: blank(units[start..<end]))
            index = closeIndex + 1
        }
        return String(decoding: units, as: UTF16.self)
    }

    /// `markdown` with fenced code blocks, indented code blocks and inline
    /// code spans replaced by spaces, so every index still points at the original.
    private static func maskCode(_ markdown: String) -> String {
        var fence: String?
        var previousBlank = true
        var inIndented = false
        // Where the open list item's text starts; its lines indented less
        // than four more than that are the item's paragraphs, not code.
        var listContent = 0
        let lines = markdown.components(separatedBy: "\n").map { line -> String in
            let nsLine = line as NSString
            if let open = fence {
                if let closing = firstMatch(closingFenceRegex, line) {
                    let marker = nsLine.substring(with: closing.range(at: 1))
                    if marker.first == open.first, marker.utf16.count >= open.utf16.count { fence = nil }
                }
                return blank(line)
            }
            if let opening = firstMatch(fenceRegex, line) {
                fence = nsLine.substring(with: opening.range(at: 1))
                return blank(line)
            }
            let isBlank = line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let leading = line.prefix { $0 == " " || $0 == "\t" }
            let expanded = leading.replacingOccurrences(of: "\t", with: "    ") + line.dropFirst(leading.count)
            let columns = expanded.utf16.count - expanded.drop(while: \.isWhitespace).utf16.count
            inIndented = !isBlank && columns >= listContent + codeIndent && (inIndented || previousBlank)
            if !(isBlank || inIndented) {
                if let item = firstMatch(listItemRegex, expanded), item.range(at: 1).length < listContent + codeIndent {
                    listContent = item.range.length + (item.range(at: 3).length > 0 ? 0 : 1)
                } else if previousBlank, columns < listContent {
                    listContent = 0
                }
            }
            previousBlank = isBlank
            return inIndented ? blank(line) : maskCodeSpans(line)
        }
        return lines.joined(separator: "\n")
    }
}
