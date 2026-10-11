import Foundation

/// A block of a Markdown note: the same split the web, iPhone and Android note views use.
public enum MarkdownBlock: Hashable, Sendable {
    case heading(level: Int, text: String)
    case list([MarkdownListItem])
    case quote(String)
    case code(String)
    case rule
    case paragraph(String)
}

public struct MarkdownListItem: Hashable, Sendable {
    public let depth: Int
    public let marker: String
    public let text: String

    public init(depth: Int, marker: String, text: String) {
        self.depth = depth
        self.marker = marker
        self.text = text
    }
}

/// Port of `apps/mobile/lib/markdown-blocks.ts`.
public enum MarkdownBlocks {
    private nonisolated(unsafe) static let heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/
    private nonisolated(unsafe) static let bullet = /^(\s*)[-*+]\s+(.*)$/
    private nonisolated(unsafe) static let ordered = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
    private nonisolated(unsafe) static let quote = /^\s{0,3}>\s?(.*)$/
    private nonisolated(unsafe) static let rule = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
    private nonisolated(unsafe) static let fence = /^\s{0,3}(```|~~~)/

    private static func listItem(_ line: String) -> MarkdownListItem? {
        if let m = line.wholeMatch(of: bullet) {
            return MarkdownListItem(depth: m.1.count / 2, marker: "•", text: String(m.2))
        }
        if let m = line.wholeMatch(of: ordered) {
            return MarkdownListItem(depth: m.1.count / 2, marker: "\(m.2).", text: String(m.3))
        }
        return nil
    }

    private static func startsBlock(_ line: String) -> Bool {
        line.prefixMatch(of: fence) != nil || line.wholeMatch(of: heading) != nil
            || line.wholeMatch(of: quote) != nil || line.wholeMatch(of: rule) != nil || listItem(line) != nil
    }

    private static func isBlank(_ line: String) -> Bool {
        line.allSatisfy(\.isWhitespace)
    }

    public static func parse(_ markdown: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var index = 0
        while index < lines.count {
            let line = lines[index]
            if isBlank(line) {
                index += 1
                continue
            }
            if let m = line.prefixMatch(of: fence) {
                let marker = String(m.1)
                var code: [String] = []
                index += 1
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(marker) {
                    code.append(lines[index])
                    index += 1
                }
                index += 1
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
                while index < lines.count, let item = listItem(lines[index]) {
                    items.append(item)
                    index += 1
                }
                blocks.append(.list(items))
                continue
            }
            var paragraph: [String] = []
            while index < lines.count, !isBlank(lines[index]), !startsBlock(lines[index]) {
                paragraph.append(lines[index])
                index += 1
            }
            blocks.append(.paragraph(paragraph.joined(separator: "\n")))
        }
        return blocks
    }

    /// A note as plain lines for small previews: block markers and inline emphasis removed.
    public static func plainText(_ markdown: String) -> String {
        parse(markdown).map { block -> String in
            let text: String = switch block {
            case let .heading(_, text): text
            case let .list(items): items.map { "\($0.marker) \($0.text)" }.joined(separator: "\n")
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
