import SwiftUI

/// Renders Markdown the way the web's note view does: headings, lists,
/// quotes, code, and inline styles, as selectable native text.
struct MarkdownText: View {
    let markdown: String

    var body: some View {
        Text(MarkdownRenderer.render(markdown))
            .textSelection(.enabled)
            .lineSpacing(3)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum MarkdownRenderer {
    /// SwiftUI's `Text` styles inline Markdown but drops block structure, so
    /// walk the parsed blocks and add their line breaks, sizes, and markers.
    static func render(_ markdown: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
        guard let parsed = try? AttributedString(markdown: markdown, options: options) else {
            return AttributedString(markdown)
        }
        var output = AttributedString()
        var previousBlock: Int?
        var previousItem: Int?
        for run in parsed.runs {
            var piece = AttributedString(parsed[run.range])
            let components = run.presentationIntent?.components ?? []
            if let block = components.first?.identity, block != previousBlock {
                if previousBlock != nil {
                    output.append(AttributedString(isTight(components) ? "\n" : "\n\n"))
                }
                if let marker = listMarker(components, previousItem: previousItem) {
                    output.append(AttributedString(marker))
                }
                previousBlock = block
            }
            previousItem = components.first { if case .listItem = $0.kind { true } else { false } }?.identity
            style(&piece, for: components)
            output.append(piece)
        }
        return output
    }

    private static func isTight(_ components: [PresentationIntent.IntentType]) -> Bool {
        components.contains { if case .listItem = $0.kind { true } else { false } }
    }

    private static func listMarker(_ components: [PresentationIntent.IntentType], previousItem: Int?) -> String? {
        guard let item = components.first(where: { if case .listItem = $0.kind { true } else { false } }),
              item.identity != previousItem,
              case .listItem(let ordinal) = item.kind else { return nil }
        let depth = components.filter {
            if case .orderedList = $0.kind { return true }
            if case .unorderedList = $0.kind { return true }
            return false
        }.count
        let indent = String(repeating: "    ", count: max(0, depth - 1))
        let isOrdered = components.contains { if case .orderedList = $0.kind { true } else { false } }
        return indent + (isOrdered ? "\(ordinal). " : "•  ")
    }

    private static func style(_ piece: inout AttributedString, for components: [PresentationIntent.IntentType]) {
        for component in components {
            switch component.kind {
            case .header(let level):
                piece.font = [Font.title.bold(), .title2.bold(), .title3.bold()][safe: level - 1] ?? .headline
            case .codeBlock:
                piece.font = .system(.body, design: .monospaced)
                piece.foregroundColor = .secondary
            case .blockQuote:
                piece.foregroundColor = .secondary
            case .thematicBreak:
                piece = AttributedString("―――")
                piece.foregroundColor = .secondary
            default:
                continue
            }
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
