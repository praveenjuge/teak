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
                section("Notes") { paragraph(notes) }
            }
            let tags = (card.tags ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if !tags.isEmpty {
                section("Tags") { ChipRow(tags: tags, onTag: searchTag) }
            }
            summary
            if let transcript = card.aiTranscript?.trimmingCharacters(in: .whitespacesAndNewlines), !transcript.isEmpty {
                section("Transcript") { paragraph(transcript) }
            }
            info
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func paragraph(_ text: String) -> some View {
        Text(text)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .grouped()
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
                    if !text.isEmpty { paragraph(text) }
                    ChipRow(tags: tags, colors: colors, sparkles: true, onTag: searchTag)
                }
            }
        }
    }

    private var info: some View {
        let details = CardSheet.detailRows(card).filter { $0.label != "Type" }
            + [DetailRow("Created", CardSheet.formatTimestamp(card.createdAt)),
               DetailRow("Updated", CardSheet.formatTimestamp(card.updatedAt))]
        return section("Info") {
            VStack(spacing: 0) {
                Button {
                    filterLibrary.type(card.type)
                    dismiss()
                } label: {
                    InfoRow(label: "Type") {
                        HStack(spacing: 4) {
                            Image(systemName: card.type.symbol)
                            Text(card.type.label)
                        }
                        .foregroundStyle(.tint)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows every \(card.type.label.lowercased()) card")
                ForEach(details, id: \.self) { row in
                    Divider().padding(.leading, 16)
                    InfoRow(label: row.label) { Text(row.value) }
                        .contextMenu {
                            Button("Copy \(row.label)", systemImage: "doc.on.doc") { Pasteboard.copy(row.value) }
                        }
                }
            }
            .grouped()
        }
    }

    private func rows(_ rows: [DetailRow]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { Divider().padding(.leading, 16) }
                InfoRow(label: row.label) { Text(row.value) }
            }
        }
        .grouped()
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 4)
            content().font(.body)
        }
    }
}

/// One label and value, like a row in Settings.
private struct InfoRow<Value: View>: View {
    let label: String
    @ViewBuilder let value: Value

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label).foregroundStyle(.primary).fixedSize()
            Spacer(minLength: 12)
            value
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(.rect)
    }
}

private extension View {
    /// The inset grouped look: a rounded card on the page background.
    func grouped() -> some View {
        background(.background.secondary, in: .rect(cornerRadius: 16, style: .continuous))
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
