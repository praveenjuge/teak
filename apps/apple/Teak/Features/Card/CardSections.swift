import SwiftUI
import TeakCore

/// Filters the library from a card's tag or type, like tapping a tag on the web.
struct LibraryFilterAction {
    var tag: (String) -> Void = { _ in }
    var type: (CardType) -> Void = { _ in }
}

extension EnvironmentValues {
    @Entry var filterLibrary = LibraryFilterAction()
}

/// Notes, tags, Teak's summary, transcript and info, shown below the preview
/// or in the inspector.
struct CardSections: View {
    let card: Card
    @Environment(\.filterLibrary) private var filterLibrary
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            linkDetails
            if let notes = card.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                section("Notes") { Text(notes).textSelection(.enabled) }
            }
            let tags = (card.tags ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if !tags.isEmpty {
                section("Tags") { ChipRow(tags: tags, onTag: searchTag) }
            }
            summary
            if let transcript = card.aiTranscript?.trimmingCharacters(in: .whitespacesAndNewlines), !transcript.isEmpty {
                section("Transcript") { Text(transcript).textSelection(.enabled) }
            }
            info
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func searchTag(_ tag: String) {
        filterLibrary.tag(tag)
        dismiss()
    }

    @ViewBuilder private var linkDetails: some View {
        if card.type == .link {
            let facts = CardSheet.linkFacts(card)
            if !facts.isEmpty {
                section("Details") { rows(facts) }
            }
            let media = CardSheet.linkMedia(card)
            if media.count > 1 {
                section("Media") {
                    VStack(spacing: 8) {
                        ForEach(media, id: \.url) { item in
                            RemoteImage(item.url, contentMode: .fit)
                                .aspectRatio(item.width.flatMap { width in item.height.map { width / max($0, 1) } } ?? 4.0 / 3.0,
                                             contentMode: .fit)
                                .frame(maxHeight: 520)
                                .clipShape(.rect(cornerRadius: 12))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var summary: some View {
        let text = card.aiSummary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let tags = (card.aiTags ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        // Palettes already show their colors as the preview.
        let colors = card.type == .palette ? [] : (card.colors ?? []).prefix(8).map(\.hex)
        if !text.isEmpty || !tags.isEmpty || !colors.isEmpty {
            section("Summary") {
                VStack(alignment: .leading, spacing: 10) {
                    if !text.isEmpty { Text(text).textSelection(.enabled) }
                    ChipRow(tags: tags, colors: colors, sparkles: true, onTag: searchTag)
                }
            }
        }
    }

    private var info: some View {
        section("Info") {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    filterLibrary.type(card.type)
                    dismiss()
                } label: {
                    LabeledContent("Type") { Text(card.type.label).foregroundStyle(.tint) }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows every \(card.type.label.lowercased()) card")
                rows(CardSheet.detailRows(card).filter { $0.label != "Type" })
                LabeledContent("Created", value: CardSheet.formatTimestamp(card.createdAt))
                LabeledContent("Updated", value: CardSheet.formatTimestamp(card.updatedAt))
                HStack {
                    if let url = card.url, !url.isEmpty {
                        Button("Copy URL", systemImage: "link") { Pasteboard.copy(url) }
                    }
                    if !card.content.isEmpty {
                        Button("Copy Original", systemImage: "doc.on.doc") { Pasteboard.copy(card.content) }
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
    }

    private func rows(_ rows: [DetailRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows, id: \.self) { row in
                LabeledContent(row.label) {
                    Text(row.value).multilineTextAlignment(.trailing).textSelection(.enabled)
                }
            }
        }
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content().font(.body)
        }
    }
}

/// A row of capsule chips; tapping a tag searches for it.
struct ChipRow: View {
    var tags: [String] = []
    var colors: [String] = []
    var sparkles = false
    var onTag: ((String) -> Void)?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(colors, id: \.self) { hex in
                    Circle().fill(Color(hex: hex) ?? .gray).frame(width: 22, height: 22)
                        .accessibilityLabel(hex)
                }
                ForEach(tags, id: \.self) { tag in
                    Button {
                        onTag?(tag)
                    } label: {
                        HStack(spacing: 4) {
                            if sparkles { Image(systemName: "sparkles").font(.caption2).foregroundStyle(.secondary) }
                            Text(tag).font(.footnote.weight(.medium))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.fill.tertiary, in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Search for \(tag)")
                }
            }
        }
        .scrollClipDisabled()
    }
}
