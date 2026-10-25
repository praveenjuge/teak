import Foundation

public enum MarkdownBlock: Hashable, Sendable {
    case heading(level: Int, text: String)
    case list([MarkdownListItem])
    case table(MarkdownTable)
    case quote(String)
    case code(String)
    case rule
    case paragraph(String)
}

public struct MarkdownListItem: Hashable, Sendable {
    public let depth: Int
    public let marker: String
    public let text: String
    /// A task item's state (`- [x]` is true, `- [ ]` false); nil for a plain item.
    public let checked: Bool?
    /// The item's line in the note, counting from 0: the line a tap on its checkbox flips.
    public let line: Int

    public init(depth: Int, marker: String, text: String, checked: Bool? = nil, line: Int = 0) {
        self.depth = depth
        self.marker = marker
        self.text = text
        self.checked = checked
        self.line = line
    }
}

/// A GFM table: a header row and body rows of inline Markdown, every row as wide as the header.
public struct MarkdownTable: Hashable, Sendable {
    public let header: [String]
    public let rows: [[String]]

    public init(header: [String], rows: [[String]]) {
        self.header = header
        self.rows = rows
    }
}

public enum MarkdownBlocks {
    nonisolated(unsafe) static let heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/
    nonisolated(unsafe) static let bullet = /^(\s*)([-*+])\s+(.*)$/
    nonisolated(unsafe) static let ordered = /^(\s*)(\d{1,9})([.)])\s+(.*)$/
    nonisolated(unsafe) static let task = /^\[([ xX])\] (.*)$/
    nonisolated(unsafe) static let quote = /^\s{0,3}>\s?(.*)$/
    nonisolated(unsafe) static let rule = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
    nonisolated(unsafe) static let fence = /^\s{0,3}(`{3,}|~{3,})/
    nonisolated(unsafe) static let delimiterRow = /^\s{0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

    /// The note's lines, split the same way for rendering and for ticking a task.
    static func lines(_ markdown: String) -> [String] {
        markdown.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    static func listItem(_ line: String, at index: Int = 0) -> MarkdownListItem? {
        if let m = line.wholeMatch(of: bullet) {
            let text = String(m.3)
            if let t = text.wholeMatch(of: task) {
                return MarkdownListItem(depth: m.1.count / 2, marker: "•", text: String(t.2), checked: t.1 != " ", line: index)
            }
            return MarkdownListItem(depth: m.1.count / 2, marker: "•", text: text, line: index)
        }
        if let m = line.wholeMatch(of: ordered) {
            return MarkdownListItem(depth: m.1.count / 2, marker: "\(m.2).", text: String(m.4), line: index)
        }
        return nil
    }

    private static func startsBlock(_ line: String) -> Bool {
        line.prefixMatch(of: fence) != nil || line.wholeMatch(of: heading) != nil
            || line.wholeMatch(of: quote) != nil || line.wholeMatch(of: rule) != nil || listItem(line) != nil
    }

    /// Whether `line` closes a fence opened with `marker`: the same character, at least as many times, and nothing
    /// else, so a shorter fence inside a longer one stays part of the code.
    private static func closesFence(_ line: String, _ marker: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard let character = marker.first else { return false }
        return trimmed.count >= marker.count && trimmed.allSatisfy { $0 == character }
    }

    /// Whether `lines[index]` runs on as paragraph text: not blank, and not the start of another block or a table.
    static func continuesParagraph(_ lines: [String], at index: Int) -> Bool {
        !isBlank(lines[index]) && !startsBlock(lines[index]) && table(lines, at: index) == nil
    }

    static func isBlank(_ line: String) -> Bool {
        line.allSatisfy(\.isWhitespace)
    }

    private static func indent(_ line: String) -> Int {
        line.prefix(while: { $0 == " " || $0 == "\t" }).count
    }

    /// A row's cells, split on unescaped pipes after dropping the outer ones, as the web counts them.
    static func cells(_ line: String) -> [String] {
        var row = Substring(line.trimmingCharacters(in: .whitespaces))
        if row.hasPrefix("|") { row = row.dropFirst() }
        if row.hasSuffix("|"), !row.hasSuffix("\\|") { row = row.dropLast() }
        var cells: [String] = []
        var cell = ""
        var escaped = false
        for char in row {
            if char == "|", !escaped {
                cells.append(cell)
                cell = ""
            } else {
                cell.append(char)
            }
            escaped = char == "\\" && !escaped
        }
        cells.append(cell)
        return cells.map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "\\|", with: "|") }
    }

    /// The table whose header row is `lines[index]`, and the line after it. `table` is nil for one the web keeps
    /// literal: aligned columns, or a row with a different number of cells.
    private static func table(_ lines: [String], at index: Int) -> (table: MarkdownTable?, end: Int)? {
        guard index + 1 < lines.count, !isBlank(lines[index]), indent(lines[index]) < 4 else { return nil }
        let delimiter = lines[index + 1]
        guard delimiter.wholeMatch(of: delimiterRow) != nil, delimiter.contains("|") || delimiter.contains(":") else {
            return nil
        }
        let header = cells(lines[index])
        let alignments = cells(delimiter)
        guard header.count == alignments.count else { return nil }
        var end = index + 2
        while end < lines.count, !isBlank(lines[end]), !startsBlock(lines[end]) {
            end += 1
        }
        let rows = lines[(index + 2) ..< end].map(cells)
        let aligned = alignments.contains { $0.contains(":") }
        let ragged = rows.contains { $0.count != header.count }
        return (aligned || ragged ? nil : MarkdownTable(header: header, rows: rows), end)
    }

    public static func parse(_ markdown: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        let lines = lines(markdown)
        var index = 0
        // Where the last list ended: a table right after it, or indented under it, is nested in it.
        var listEnd: Int?
        while index < lines.count {
            let line = lines[index]
            if isBlank(line) {
                index += 1
                continue
            }
            let afterList = listEnd
            listEnd = nil
            if let m = line.prefixMatch(of: fence) {
                let marker = String(m.1)
                var code: [String] = []
                index += 1
                while index < lines.count, !closesFence(lines[index], marker) {
                    code.append(lines[index])
                    index += 1
                }
                index += 1
                blocks.append(.code(code.joined(separator: "\n")))
                continue
            }
            // Text indented four spaces outside a list is code, so a `- [ ]` written there shows and can't be ticked.
            if indent(line) >= 4, afterList == nil {
                var code: [String] = []
                while index < lines.count, isBlank(lines[index]) || indent(lines[index]) >= 4 {
                    let text = lines[index]
                    code.append(text.hasPrefix("\t") ? String(text.dropFirst()) : String(text.dropFirst(min(4, indent(text)))))
                    index += 1
                }
                while let last = code.last, isBlank(last) { code.removeLast() }
                blocks.append(.code(code.joined(separator: "\n")))
                continue
            }
            if let m = line.wholeMatch(of: heading) {
                blocks.append(.heading(level: m.1.count, text: String(m.2)))
                index += 1
                continue
            }
            if line.wholeMatch(of: rule) != nil {
                blocks.append(.rule)
                index += 1
                continue
            }
            if line.wholeMatch(of: quote) != nil {
                var text: [String] = []
                while index < lines.count, let m = lines[index].wholeMatch(of: quote) {
                    text.append(String(m.1))
                    index += 1
                }
                blocks.append(.quote(text.joined(separator: "\n")))
                continue
            }
            if listItem(line) != nil {
                var items: [MarkdownListItem] = []
                while index < lines.count, let item = listItem(lines[index], at: index) {
                    items.append(item)
                    index += 1
                }
                blocks.append(.list(items))
                listEnd = index
                continue
            }
            if let found = table(lines, at: index) {
                let nested = afterList.map { $0 == index || indent(line) >= 2 } ?? false
                if let table = found.table, !nested {
                    blocks.append(.table(table))
                } else {
                    // The web shows these as literal Markdown, so they keep their pipes here too.
                    blocks.append(.code(lines[index ..< found.end].joined(separator: "\n")))
                }
                index = found.end
                continue
            }
            var paragraph: [String] = [line]
            index += 1
            while index < lines.count, continuesParagraph(lines, at: index) {
                paragraph.append(lines[index])
                index += 1
            }
            blocks.append(.paragraph(paragraph.joined(separator: "\n")))
        }
        return blocks
    }

    public static func plainText(_ markdown: String) -> String {
        parse(markdown).map { block -> String in
            let text: String = switch block {
            case let .heading(_, text): text
            case let .list(items): items.map { "\($0.marker) \($0.text)" }.joined(separator: "\n")
            case let .table(table):
                // As the web's tiles read a table: cells joined by " · ", rows by " / ", empty ones left out.
                ([table.header] + table.rows)
                    .map { $0.filter { !$0.isEmpty }.joined(separator: " · ") }
                    .filter { !$0.isEmpty }
                    .joined(separator: " / ")
            case let .quote(text): text
            case let .code(text): text
            case .rule: ""
            case let .paragraph(text): text
            }
            return text
                .replacing(/\[([^\]]+)\]\([^)]*\)/) { String($0.1) }
                .replacing(/(\*\*|__|\*|_|~~|`)(\S(?:.*?\S)?)\1/) { String($0.2) }
        }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
