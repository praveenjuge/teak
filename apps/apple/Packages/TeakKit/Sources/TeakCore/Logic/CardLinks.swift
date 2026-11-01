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

    public static func mayHaveCardLinks(_ markdown: String?) -> Bool {
        markdown?.contains("|teak:") == true
    }

    public static func tokenTitle(_ title: String) -> String {
        let safe = replace(spacesRegex, in: replace(titleUnsafeRegex, in: title, with: " "), with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return truncate(safe.isEmpty ? fallbackTitle : safe, max: titleMaxLength)
    }

    public static func formatToken(title: String, id: String) -> String {
        "[[\(tokenTitle(title))|teak:\(id)]]"
    }

    public static func parseIds(_ markdown: String?) -> [String] {
        var seen = Set<String>()
        var ids: [String] = []
        for match in matches(markdown ?? "") {
            if ids.count >= maxLinks { break }
            if seen.insert(match.id).inserted { ids.append(match.id) }
        }
        return ids
    }

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

    public static func tokensToText(_ markdown: String) -> String {
        replaceTokens(markdown) { title, _ in title }
    }

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

    private static func blank(_ units: ArraySlice<UInt16>) -> [UInt16] {
        units.map { $0 == 10 ? 10 : 32 }
    }

    private static func blank(_ line: String) -> String {
        String(decoding: blank(Array(line.utf16)[...]), as: UTF16.self)
    }

    private static func firstMatch(_ regex: NSRegularExpression, _ line: String) -> NSTextCheckingResult? {
        regex.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length))
    }

    private static func maskCodeSpans(_ line: String) -> String {
        let runs = backtickRunRegex.matches(in: line, range: NSRange(location: 0, length: (line as NSString).length)).map(\.range)
        // Each run's next run of the same length, found in one pass from the
        // end: searching forward from every run took tens of seconds on a
        // long line of backticks.
        var nextSameLength = [Int](repeating: -1, count: runs.count)
        var laterByLength: [Int: Int] = [:]
        for index in runs.indices.reversed() {
            nextSameLength[index] = laterByLength[runs[index].length] ?? -1
            laterByLength[runs[index].length] = index
        }
        let units = Array(line.utf16)
        var masked: [UInt16] = []
        masked.reserveCapacity(units.count)
        var cursor = 0
        var index = 0
        while index < runs.count {
            let closeIndex = nextSameLength[index]
            guard closeIndex != -1 else {
                index += 1
                continue
            }
            let close = runs[closeIndex]
            let start = runs[index].location
            let end = close.location + close.length
            masked.append(contentsOf: units[cursor..<start])
            masked.append(contentsOf: blank(units[start..<end]))
            cursor = end
            index = closeIndex + 1
        }
        masked.append(contentsOf: units[cursor...])
        return String(decoding: masked, as: UTF16.self)
    }

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

// MARK: - The `[[` picker

extension CardLinks {
    /// A `[[` the person is typing a card's name after: `[[` starts at
    /// `start`, the cursor is at `end` (UTF-16 offsets), and `query` is the
    /// text between them, trimmed.
    public struct OpenQuery: Hashable, Sendable {
        public let start: Int
        public let end: Int
        public let query: String

        public init(start: Int, end: Int, query: String) {
            self.start = start
            self.end = end
            self.query = query
        }
    }

    public static func openQuery(in text: String, cursor: Int) -> OpenQuery? {
        let units = Array(text.utf16)
        guard cursor >= 2, cursor <= units.count else { return nil }
        let unit = { (character: Unicode.Scalar) in UInt16(UInt8(ascii: character)) }
        let newline = unit("\n"), bracket = unit("["), close = unit("]"), pipe = unit("|")
        let lineStart = units[..<cursor].lastIndex(of: newline).map { $0 + 1 } ?? 0
        var start: Int?
        var index = cursor - 2
        while index >= lineStart {
            if units[index] == bracket, units[index + 1] == bracket {
                start = index
                break
            }
            index -= 1
        }
        guard let start else { return nil }
        let typed = units[(start + 2)..<cursor]
        guard typed.count <= titleMaxLength, !typed.contains(close), !typed.contains(pipe) else { return nil }
        let line = String(decoding: units[lineStart...].prefix { $0 != newline }, as: UTF16.self)
        guard !line.trimmingCharacters(in: .whitespaces).hasPrefix("|") else { return nil }
        let masked = Array(maskCode(text).utf16)
        guard masked[start] == bracket, masked[start + 1] == bracket else { return nil }
        guard !matches(text).contains(where: { $0.start < cursor && cursor < $0.end }) else { return nil }
        let query = String(decoding: typed, as: UTF16.self).trimmingCharacters(in: .whitespaces)
        return OpenQuery(start: start, end: cursor, query: query)
    }

    /// `text` with the typed `[[query` replaced by a link to the card, then a
    /// space unless whitespace follows already, and the cursor (a UTF-16
    /// offset) just after them.
    public static func insertingLink(in text: String, replacing open: OpenQuery, title: String, id: String)
        -> (text: String, cursor: Int) {
        let source = text as NSString
        let token = formatToken(title: title, id: id)
        let after = source.substring(from: open.end)
        let spacer = after.first?.isWhitespace == true ? "" : " "
        let inserted = token + spacer
        return (source.substring(to: open.start) + inserted + after, open.start + inserted.utf16.count)
    }
}
