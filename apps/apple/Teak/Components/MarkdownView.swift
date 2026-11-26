import SwiftUI
import TeakCore
import TeakUI

struct MarkdownView: View {
    let markdown: String
    var textStyle: Font.TextStyle = .body
    var cardLinks: [String: CardLinkTarget]?
    var toggleTask: ((MarkdownListItem) -> Void)?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(MarkdownBlocks.parse(markdown).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    @ViewBuilder private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case let .heading(level, text):
            let style = headingStyle(level)
            inline(text, style, weight: .semibold).font(.allo(style)).fontWeight(.semibold)
        case let .paragraph(text):
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(Self.pieces(text).enumerated()), id: \.offset) { _, piece in inline(piece, textStyle) }
            }
            .font(.allo(textStyle))
        case let .quote(text):
            HStack(alignment: .top, spacing: 10) {
                Capsule().fill(.tertiary).frame(width: 3)
                inline(text, textStyle).font(.allo(textStyle)).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case let .code(text):
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(Self.pieces(text).enumerated()), id: \.offset) { _, piece in Text(piece) }
                }
                .font(.callout.monospaced())
                .padding(12)
            }
            .background(.fill.tertiary, in: .rect(cornerRadius: 10))
        case .rule:
            Divider()
        case let .list(items):
            VStack(alignment: .leading, spacing: 6) {
                // Keyed by text rather than position, so a ticked task moves to its new place.
                ForEach(KeyedItem.keyed(items)) { keyed in
                    let item = keyed.item
                    if let checked = item.checked {
                        task(item, checked: checked)
                    } else {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(item.marker).foregroundStyle(.secondary).monospacedDigit()
                            inline(item.text, textStyle)
                        }
                        .font(.allo(textStyle))
                        .padding(.leading, Double(item.depth) * 16)
                    }
                }
            }
        case let .table(table):
            MarkdownTableView(table: table) { inline($0, textStyle, weight: $1) }.font(.allo(textStyle))
        }
    }

    private func task(_ item: MarkdownListItem, checked: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Button {
                toggleTask?(item)
            } label: {
                // The box alone is a small target, so the button takes the gap up to the text, and on iOS a little
                // above and below too (macOS hit-tests a button within its frame).
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .foregroundStyle(checked ? Color.accentColor : .secondary)
                    .contentTransition(.symbolEffect(.replace))
                    .padding(.trailing, 8)
                    .padding(.vertical, 4)
                    .contentShape(.rect)
                    .padding(.vertical, -4)
            }
            .buttonStyle(.plain)
            .disabled(toggleTask == nil)
            inline(item.text, textStyle)
                .strikethrough(checked)
                .foregroundStyle(checked ? .secondary : .primary)
        }
        .font(.allo(textStyle))
        .padding(.leading, Double(item.depth) * 16)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(MarkdownBlocks.plainText(CardLinks.tokensToText(item.text))))
        .accessibilityValue(checked ? tr("native.notes.checked") : tr("native.notes.unchecked"))
        .accessibilityAddTraits(toggleTask == nil ? [] : .isToggle)
        .accessibilityAction { toggleTask?(item) }
    }

    /// `weight` is the weight the surrounding text is set in, which runs with a font of their own keep.
    private func inline(_ text: String, _ style: Font.TextStyle, weight: Font.Weight? = nil) -> Text {
        guard let cardLinks, CardLinks.mayHaveCardLinks(text) else { return Text(attributed(text, style, weight)) }
        let source = text as NSString
        var result = AttributedString()
        var cursor = 0
        for match in CardLinks.matches(text) {
            result += attributed(source.substring(with: NSRange(location: cursor, length: match.start - cursor)), style, weight)
            result += pill(match, target: cardLinks[match.id])
            cursor = match.end
        }
        result += attributed(source.substring(from: cursor), style, weight)
        return Text(result)
    }

    private func attributed(_ text: String, _ style: Font.TextStyle, _ weight: Font.Weight?) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        var result = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
        // A text style's italic and monospaced design don't reach a custom font, so emphasis and code name their
        // font at the text style's size: Allo's oblique for the weight around it, and SF Mono.
        for run in result.runs {
            guard let intent = run.inlinePresentationIntent, !intent.isDisjoint(with: [.emphasized, .code]) else { continue }
            let code = intent.contains(.code)
            let size = Allo.pointSize(style, at: dynamicTypeSize)
            let bold = intent.contains(.stronglyEmphasized)
            let font: Font
            if code {
                // SF Mono sets larger than Allo at one size, so code steps down, as on the web.
                let mono = Font.system(size: size * 0.9, design: .monospaced)
                font = bold ? mono.bold() : weight.map { mono.weight($0) } ?? mono
            } else {
                font = .alloOblique(size: size, weight: bold ? .bold : weight ?? .regular)
            }
            result[run.range].font = font
            if code { result[run.range].backgroundColor = Color.primary.opacity(0.08) }
        }
        return result
    }

    private static let pieceLength = 40000

    /// `text` in pieces of at most `pieceLength` characters, split at a line break, a sentence or a word: a single
    /// Text taller than the largest layer the system draws comes out blank.
    private static func pieces(_ text: String) -> [String] {
        guard text.utf16.count > pieceLength else { return [text] }
        var pieces: [String] = []
        var rest = Substring(text)
        while rest.count > pieceLength {
            let head = rest.prefix(pieceLength)
            let space = head.lastIndex(of: "\n")
                ?? head.range(of: ". ", options: .backwards).map { rest.index(before: $0.upperBound) }
                ?? head.lastIndex(of: " ")
            if let space {
                pieces.append(String(rest[..<space]))
                rest = rest[rest.index(after: space)...]
            } else {
                pieces.append(String(head))
                rest = rest[head.endIndex...]
            }
        }
        pieces.append(String(rest))
        return pieces
    }

    private func pill(_ match: CardLinks.Match, target: CardLinkTarget?) -> AttributedString {
        if target?.missing == true {
            var missing = AttributedString("\u{2009}\(tr("native.card.preview.missingCard"))\u{2009}")
            missing.foregroundColor = .secondary
            missing.backgroundColor = Color.secondary.opacity(0.12)
            missing.strikethroughStyle = .single
            return missing
        }
        let title = target?.title?.nonEmptyTrimmed ?? match.title.nonEmptyTrimmed ?? tr("cards.types.card")
        var pill = AttributedString("\u{2009}\(title)\u{2009}")
        pill.link = CardLinkURL.url(for: match.id)
        pill.foregroundColor = .accentColor
        pill.backgroundColor = Color.accentColor.opacity(0.12)
        return pill
    }

    private func headingStyle(_ level: Int) -> Font.TextStyle {
        switch level {
        case 1: .title2
        case 2: .title3
        default: .headline
        }
    }
}

private struct KeyedItem: Identifiable {
    let id: String
    let item: MarkdownListItem

    /// Each item keyed by its depth and text, numbered when the same text repeats.
    static func keyed(_ items: [MarkdownListItem]) -> [KeyedItem] {
        var seen: [String: Int] = [:]
        return items.map { item in
            let key = "\(item.depth) \(item.text)"
            seen[key, default: 0] += 1
            return KeyedItem(id: "\(key) \(seen[key, default: 1])", item: item)
        }
    }
}

private struct MarkdownTableView: View {
    let table: MarkdownTable
    let cell: (String, Font.Weight?) -> Text

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(table.header.enumerated()), id: \.offset) { _, text in
                        cellView(text, weight: .semibold).fontWeight(.semibold)
                    }
                }
                .background(.fill.tertiary)
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    Divider()
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, text in cellView(text, weight: nil) }
                    }
                }
            }
            .clipShape(.rect(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))
        }
        .scrollIndicators(.automatic)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(tr("native.notes.table", count: table.rows.count))
    }

    private func cellView(_ text: String, weight: Font.Weight?) -> some View {
        // Filling the column's width lets the header row's fill run edge to edge.
        CappedWidth(maxWidth: 280) { cell(text, weight) }
            .frame(minWidth: 48, maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
    }
}

/// Gives its content its own width up to `maxWidth`, wrapping longer text, even where the width on offer is
/// unlimited, as inside a sideways scroll.
private struct CappedWidth: Layout {
    let maxWidth: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        let width = min(child.sizeThatFits(.unspecified).width, proposal.width ?? maxWidth, maxWidth)
        return child.sizeThatFits(ProposedViewSize(width: width, height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
}

enum CardLinkURL {
    static let scheme = "teak-card"

    static func url(for id: String) -> URL? { URL(string: "\(scheme)://\(id)") }

    static func cardId(_ url: URL) -> String? {
        guard url.scheme == scheme, let host = url.host(), !host.isEmpty else { return nil }
        return host
    }
}

private extension String {
    var nonEmptyTrimmed: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
