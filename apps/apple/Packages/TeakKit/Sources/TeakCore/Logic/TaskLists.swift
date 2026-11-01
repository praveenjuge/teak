import Foundation

/// Ticking a task in a note as the web's editor does (`taskListSort.ts`): flip that one line, then move the item
/// within its own list, below the open items when ticked or to the end of them when unticked. Children move with
/// their item, and every other line stays as written.
public enum TaskLists {
    public static func sortedOrder(_ checked: [Bool], index: Int) -> [Int] {
        let others = checked.indices.filter { $0 != index }
        var target = 0
        for (position, at) in others.enumerated() where !checked[at] {
            target = position + 1
        }
        return Array(others[..<target]) + [index] + Array(others[target...])
    }

    public static func toggle(_ markdown: String, item: MarkdownListItem) -> String? {
        guard let checked = item.checked else { return nil }
        var lines = MarkdownBlocks.lines(markdown)
        guard lines.indices.contains(item.line), let task = Line(lines[item.line]), task.checked == checked else {
            return nil
        }
        lines[item.line] = task.flipped
        if let range = siblings(lines, of: item.line, indent: task.indent, bullet: task.bullet) {
            lines.replaceSubrange(range.span, with: reordered(lines, range: range, toggled: item.line))
        }
        return lines.joined(separator: markdown.contains("\r\n") ? "\r\n" : "\n")
    }

    private struct Line {
        let indent: Int
        let bullet: String
        let checked: Bool?
        let flipped: String

        init?(_ text: String) {
            if text.wholeMatch(of: MarkdownBlocks.rule) != nil { return nil }
            if let m = text.wholeMatch(of: MarkdownBlocks.bullet) {
                indent = m.1.count
                bullet = String(m.2)
                if let t = String(m.3).wholeMatch(of: MarkdownBlocks.task) {
                    let isChecked = t.1 != " "
                    checked = isChecked
                    let box = text.index(m.3.startIndex, offsetBy: 1)
                    flipped = text.replacingCharacters(in: box ... box, with: isChecked ? " " : "x")
                } else {
                    checked = nil
                    flipped = text
                }
            } else if let m = text.wholeMatch(of: MarkdownBlocks.ordered) {
                indent = m.1.count
                bullet = String(m.3)
                checked = nil
                flipped = text
            } else {
                return nil
            }
        }
    }

    private struct Siblings {
        let span: Range<Int>
        let starts: [Int]
    }

    /// The items sharing a list with the one on `line`: same indent and bullet, with only their children, the text
    /// indented under them, and blank lines between them. Nil unless every one of them is a task and there are at
    /// least two, or when unindented paragraph text runs on from the list's last line, which Markdown joins to that
    /// item. A heading, quote, fence, rule or table there ends the list.
    private static func siblings(_ lines: [String], of line: Int, indent: Int, bullet: String) -> Siblings? {
        /// True for a sibling, false for a line inside an item, nil for a line that ends the list.
        func belongs(_ index: Int) -> Bool? {
            guard let item = Line(lines[index]) else {
                return lines[index].prefix(while: \.isWhitespace).count > indent ? false : nil
            }
            if item.indent > indent { return false }
            return item.indent == indent && item.bullet == bullet ? true : nil
        }
        var start = line
        var index = line - 1
        while index >= 0 {
            if MarkdownBlocks.isBlank(lines[index]) {
                index -= 1
                continue
            }
            guard let isSibling = belongs(index) else { break }
            if isSibling { start = index }
            index -= 1
        }
        var end = line + 1
        index = line + 1
        while index < lines.count {
            if MarkdownBlocks.isBlank(lines[index]) {
                index += 1
                continue
            }
            guard belongs(index) != nil else {
                if !MarkdownBlocks.isBlank(lines[index - 1]), MarkdownBlocks.continuesParagraph(lines, at: index) { return nil }
                break
            }
            index += 1
            end = index
        }
        let starts = (start ..< end).filter { belongs($0) == true }
        guard starts.count > 1, starts.allSatisfy({ Line(lines[$0])?.checked != nil }) else { return nil }
        return Siblings(span: start ..< end, starts: starts)
    }

    /// The items in their new order. Blank lines between items stay where they were, so a loose list stays loose.
    private static func reordered(_ lines: [String], range: Siblings, toggled: Int) -> [String] {
        let starts = range.starts
        var items: [[String]] = []
        var gaps: [[String]] = []
        for at in starts.indices {
            var item = Array(lines[starts[at] ..< (at + 1 < starts.count ? starts[at + 1] : range.span.upperBound)])
            var gap: [String] = []
            while let last = item.last, MarkdownBlocks.isBlank(last) {
                gap.insert(item.removeLast(), at: 0)
            }
            items.append(item)
            gaps.append(gap)
        }
        let checked = starts.map { Line(lines[$0])?.checked == true }
        let order = sortedOrder(checked, index: starts.firstIndex(of: toggled) ?? 0)
        return order.indices.flatMap { position in items[order[position]] + gaps[position] }
    }
}
