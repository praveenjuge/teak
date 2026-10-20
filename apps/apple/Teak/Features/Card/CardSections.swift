import SwiftUI
import TeakCore

struct LibraryFilterAction {
    var tag: (String) -> Void = { _ in }
    var type: (CardType) -> Void = { _ in }
}

extension EnvironmentValues {
    @Entry var filterLibrary = LibraryFilterAction()
}

struct CardSections: View {
    let card: Card
    var backlinks: [LinkedCard] = []
    var hasMoreBacklinks = false
    var folderNames: [String] = []
    var openCard: (String) -> Void = { _ in }
    var openSource: (URL) -> Void = { _ in }
    var editFolders: (() -> Void)?
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
            linkedFrom
            info
            source
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
            let facts = linkRows
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
        let colors = card.type.showsSummaryColors ? (card.colors ?? []).prefix(8).map(\.hex) : []
        if !text.isEmpty || !tags.isEmpty || !colors.isEmpty {
            section("Summary") {
                VStack(alignment: .leading, spacing: 10) {
                    if !text.isEmpty { paragraph(text) }
                    ChipRow(tags: tags, colors: colors, sparkles: true, onTag: searchTag)
                }
            }
        }
    }

    /// A product's price first, then the site's facts, then when it was published.
    private var linkRows: [DetailRow] {
        var rows = CardSheet.linkFacts(card)
        if let price = card.metadata?.linkCategory?.price { rows.insert(DetailRow("Price", price.formatted()), at: 0) }
        if let published = PublishedDate.format(card.metadata?.linkPreview?.publishedAt) {
            rows.append(DetailRow("Published", published))
        }
        return rows
    }

    @ViewBuilder private var linkedFrom: some View {
        if !backlinks.isEmpty {
            section("Linked from") {
                VStack(spacing: 0) {
                    ForEach(Array(backlinks.enumerated()), id: \.element.id) { index, linked in
                        if index > 0 { Divider().padding(.leading, 16) }
                        Button { openCard(linked.id) } label: {
                            Label(linked.title, systemImage: linked.type.symbol)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                    if hasMoreBacklinks {
                        Divider().padding(.leading, 16)
                        Text("and more")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                    }
                }
                .grouped()
            }
        }
    }

    /// "From example.com": where a saved note or quote came from.
    @ViewBuilder private var source: some View {
        if let host = CardSourceRow.host(card.sourceUrl) {
            Button {
                if let url = SafeURL.sanitize(card.sourceUrl) { openSource(url) }
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Label("From \(host)", systemImage: "arrow.up.right.square")
                        .font(.footnote.weight(.medium))
                    if let title = card.sourceTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
                        Text(title).font(.footnote).foregroundStyle(Color.secondary).lineLimit(1)
                    }
                }
                .padding(.leading, 4)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .accessibilityHint(card.sourceUrl ?? "")
            .accessibilityIdentifier("detail.source")
        }
    }

    private var info: some View {
        let exif = card.type == .image ? ExifFacts.rows(card.fileMetadata?.exif) : []
        let details = CardSheet.detailRows(card).filter { $0.label != "Type" } + exif
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
                if let editFolders {
                    Divider().padding(.leading, 16)
                    Button(action: editFolders) {
                        InfoRow(label: "Folders") {
                            Text(folderSummary).foregroundStyle(.tint)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(folderNames.isEmpty ? "Add to a folder" : "In \(folderNames.joined(separator: ", ")). Change folders")
                }
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

    private var folderSummary: String {
        guard let first = folderNames.first else { return "Add…" }
        return folderNames.count > 1 ? "\(first) +\(folderNames.count - 1)" : first
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
    func grouped() -> some View {
        background(.background.secondary, in: .rect(cornerRadius: 16, style: .continuous))
    }
}

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
