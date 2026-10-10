import SwiftUI
import TeakCore

/// A note's Markdown, block by block like the web, with inline emphasis and links.
struct MarkdownView: View {
    let markdown: String
    var baseFont: Font = .body

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
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(item.marker).foregroundStyle(.secondary).monospacedDigit()
                        inline(item.text)
                    }
                    .font(baseFont)
                    .padding(.leading, Double(item.depth) * 16)
                }
            }
        }
    }

    private func inline(_ text: String) -> Text {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        if let attributed = try? AttributedString(markdown: text, options: options) {
            return Text(attributed)
        }
        return Text(text)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2
        case 2: .title3
        default: .headline
        }
    }
}
