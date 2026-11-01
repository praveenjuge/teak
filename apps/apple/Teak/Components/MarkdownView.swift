import SwiftUI
import TeakCore

struct MarkdownView: View {
    let markdown: String
    var baseFont: Font = .body
    var cardLinks: [String: CardLinkTarget]?
    var toggleTask: ((MarkdownListItem) -> Void)?

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
            inline(text).font(headingFont(level)).fontWeight(.semibold)
        case let .paragraph(text):
            inline(text).font(baseFont)
        case let .quote(text):
            HStack(alignment: .top, spacing: 10) {
                Capsule().fill(.tertiary).frame(width: 3)
                inline(text).font(baseFont).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case let .code(text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.system(.callout, design: .monospaced)).padding(12)
            }
            .background(.fill.tertiary, in: .rect(cornerRadius: 10))
        case .rule:
            Divider()
        case let .list(items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    if let checked = item.checked {
                        task(item, checked: checked)
                    } else {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(item.marker).foregroundStyle(.secondary).monospacedDigit()
                            inline(item.text)
                        }
                        .font(baseFont)
                        .padding(.leading, Double(item.depth) * 16)
                    }
                }
            }
        case let .table(table):
            MarkdownTableView(table: table, cell: inline).font(baseFont)
        }
    }

    private func task(_ item: MarkdownListItem, checked: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button {
                toggleTask?(item)
            } label: {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .foregroundStyle(checked ? Color.accentColor : .secondary)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .disabled(toggleTask == nil)
            inline(item.text)
                .strikethrough(checked)
                .foregroundStyle(checked ? .secondary : .primary)
        }
        .font(baseFont)
        .padding(.leading, Double(item.depth) * 16)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(MarkdownBlocks.plainText(CardLinks.tokensToText(item.text))))
        .accessibilityValue(checked ? tr("native.notes.checked") : tr("native.notes.unchecked"))
        .accessibilityAddTraits(toggleTask == nil ? [] : .isToggle)
        .accessibilityAction { toggleTask?(item) }
    }

    private func inline(_ text: String) -> Text {
        guard let cardLinks, CardLinks.mayHaveCardLinks(text) else { return Text(attributed(text)) }
        let source = text as NSString
        var result = AttributedString()
        var cursor = 0
        for match in CardLinks.matches(text) {
            result += attributed(source.substring(with: NSRange(location: cursor, length: match.start - cursor)))
            result += pill(match, target: cardLinks[match.id])
            cursor = match.end
        }
        result += attributed(source.substring(from: cursor))
        return Text(result)
    }

    private func attributed(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
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

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2
        case 2: .title3
        default: .headline
        }
    }
}

private struct MarkdownTableView: View {
    let table: MarkdownTable
    let cell: (String) -> Text

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(table.header.enumerated()), id: \.offset) { _, text in
                        cellView(text).fontWeight(.semibold)
                    }
                }
                .background(.fill.tertiary)
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    Divider()
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, text in cellView(text) }
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

    private func cellView(_ text: String) -> some View {
        CappedWidth(maxWidth: 280) { cell(text) }
            .frame(minWidth: 48, alignment: .leading)
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
