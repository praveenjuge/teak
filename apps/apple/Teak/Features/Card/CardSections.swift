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
    /// Keep and Remove for Teak's suggested tags; nil shows them without either, as in Trash.
    var suggestedTags: SuggestedTagActions?
    @Environment(\.filterLibrary) private var filterLibrary
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if let notes = card.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                section(tr("native.card.sections.notes")) { paragraph(notes) }
            }
            let tags = (card.tags ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let suggested = CardEdit.suggestedTags(card)
            if !tags.isEmpty || !suggested.isEmpty {
                section(tr("native.card.sections.tags")) {
                    VStack(alignment: .leading, spacing: 12) {
                        if !tags.isEmpty { ChipRow(tags: tags, onTag: searchTag) }
                        if !suggested.isEmpty {
                            SuggestedTagRow(tags: suggested, actions: suggestedTags, onTag: searchTag)
                        }
                    }
                }
            }
            summary
            if let transcript = card.aiTranscript?.trimmingCharacters(in: .whitespacesAndNewlines), !transcript.isEmpty {
                section(tr("native.card.sections.transcript")) { paragraph(transcript) }
            }
            linkMedia
            linkedFrom
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

    @ViewBuilder private var linkMedia: some View {
        let media = card.type == .link ? CardSheet.linkMedia(card) : []
        if media.count > 1 {
            section(tr("native.card.sections.media")) {
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

    @ViewBuilder private var summary: some View {
        let text = card.aiSummary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let colors = card.type.showsSummaryColors ? (card.colors ?? []).prefix(8).map(\.hex) : []
        if !text.isEmpty || !colors.isEmpty {
            section(tr("native.card.sections.summary")) {
                VStack(alignment: .leading, spacing: 10) {
                    if !text.isEmpty { paragraph(text) }
                    if !colors.isEmpty { ChipRow(colors: colors) }
                }
            }
        }
    }

    /// A link's facts lead Info: a product's price, then the site's facts, then when it was published.
    private var linkRows: [DetailRow] {
        guard card.type == .link else { return [] }
        var rows = CardSheet.linkFacts(card)
        if let price = card.metadata?.linkCategory?.price { rows.insert(DetailRow(tr("native.details.price"), price.formatted()), at: 0) }
        if let published = PublishedDate.format(card.metadata?.linkPreview?.publishedAt) {
            rows.append(DetailRow(tr("native.details.published"), published))
        }
        return rows
    }

    @ViewBuilder private var linkedFrom: some View {
        if !backlinks.isEmpty {
            section(tr("native.card.sections.linkedFrom")) {
                VStack(spacing: 0) {
                    ForEach(Array(backlinks.enumerated()), id: \.element.id) { index, linked in
                        if index > 0 { Divider().padding(.leading, 16) }
                        Button { openCard(linked.id) } label: {
                            HStack {
                                Label(linked.title, systemImage: linked.type.symbol)
                                Spacer(minLength: 8)
                                Chevron()
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                    if hasMoreBacklinks {
                        Divider().padding(.leading, 16)
                        Text(tr("native.card.backlinksMore"))
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

    /// The facts about the card, one group: what the hero already shows (a link's site and description) is left out.
    private var info: some View {
        let exif = card.type == .image ? ExifFacts.rows(card.fileMetadata?.exif) : []
        let shownAbove: Set<String> = card.type == .link
            ? [tr("native.details.type"), tr("native.details.website"), tr("native.details.description")]
            : [tr("native.details.type")]
        let details = linkRows + CardSheet.detailRows(card).filter { !shownAbove.contains($0.label) } + exif
            + [DetailRow(tr("native.details.created"), CardSheet.formatTimestamp(card.createdAt)),
               DetailRow(tr("native.details.updated"), CardSheet.formatTimestamp(card.updatedAt))]
        return section(tr("native.card.sections.info")) {
            VStack(spacing: 0) {
                Button {
                    filterLibrary.type(card.type)
                    dismiss()
                } label: {
                    InfoRow(label: tr("native.details.type"), opens: true) {
                        Label(card.type.label, systemImage: card.type.symbol)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint(tr("native.card.showsType"))
                if let editFolders {
                    Divider().padding(.leading, 16)
                    Button(action: editFolders) {
                        InfoRow(label: tr("native.card.sections.folders"), opens: true) { Text(folderSummary) }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(folderNames.isEmpty ? tr("native.card.folderRow.addLabel") : tr("native.card.folderRow.inFolders", folderNames.formatted(.list(type: .and).locale(AppLanguage.locale))))
                }
                source
                ForEach(details, id: \.self) { row in
                    Divider().padding(.leading, 16)
                    InfoRow(label: row.label) { Text(row.value) }
                        .contextMenu {
                            Button(tr("native.card.copyRow", row.label), systemImage: "doc.on.doc") { Pasteboard.copy(row.value) }
                        }
                }
            }
            .grouped()
        }
    }

    /// "From example.com": where a saved note or quote came from.
    @ViewBuilder private var source: some View {
        if let host = CardSourceRow.host(card.sourceUrl) {
            Divider().padding(.leading, 16)
            Button {
                if let url = SafeURL.sanitize(card.sourceUrl) { openSource(url) }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tr("native.card.source.from", host))
                        if let title = card.sourceTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
                            Text(title).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.up.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(card.sourceUrl ?? "")
            .accessibilityIdentifier("detail.source")
        }
    }

    private var folderSummary: String {
        guard let first = folderNames.first else { return tr("native.card.folderRow.add") }
        return folderNames.count > 1 ? tr("native.card.folderRow.summary", first, (folderNames.count - 1).formatted(.number.locale(AppLanguage.locale))) : first
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 4)
                .accessibilityAddTraits(.isHeader)
            content().font(.body)
        }
    }
}

/// The disclosure mark on a row that goes somewhere.
private struct Chevron: View {
    var body: some View {
        Image(systemName: "chevron.forward")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }
}

private struct InfoRow<Value: View>: View {
    let label: String
    /// A row that opens something, marked with a chevron.
    var opens = false
    @ViewBuilder let value: Value
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // Accessibility text sizes stack the value under its label instead of squeezing both onto one line.
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 16))
        HStack(spacing: 8) {
            layout {
                Text(label)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: !typeSize.isAccessibilitySize, vertical: false)
                if !typeSize.isAccessibilitySize { Spacer(minLength: 12) }
                value
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .trailing)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if opens { Chevron() }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }
}

private extension View {
    func grouped() -> some View {
        background(.background.secondary, in: .rect(cornerRadius: 16, style: .continuous))
    }
}

struct SuggestedTagActions {
    var keep: (String) -> Void
    var remove: (String) -> Void
}

/// "Suggested by Teak": tags Teak added, each with Keep and Remove, like the web's card details.
private struct SuggestedTagRow: View {
    let tags: [String]
    let actions: SuggestedTagActions?
    let onTag: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(tr("native.tags.suggested"), systemImage: "sparkles")
                .font(.footnote)
                .foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(tags, id: \.self, content: chip)
                }
            }
            .scrollClipDisabled()
        }
    }

    /// A dashed chip. With actions, it opens a menu to keep, look up or remove the tag, so each choice is a full-size
    /// target; in Trash it only looks the tag up.
    @ViewBuilder private func chip(_ tag: String) -> some View {
        if let actions {
            Menu {
                Button(tr("native.tags.keep"), systemImage: "plus") { actions.keep(tag) }
                    .accessibilityIdentifier("detail.keepTag.\(tag)")
                Button(tr("native.card.searchForTag", tag), systemImage: "magnifyingglass") { onTag(tag) }
                Button(tr("common.remove"), systemImage: "xmark", role: .destructive) { actions.remove(tag) }
            } label: {
                label(tag, symbol: "plus")
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: tag))
            .accessibilityHint(tr("native.tags.suggested"))
            .accessibilityIdentifier("detail.suggestedTag.\(tag)")
        } else {
            Button { onTag(tag) } label: { label(tag, symbol: nil) }
                .buttonStyle(.plain)
                .accessibilityLabel(tr("native.card.searchForTag", tag))
        }
    }

    private func label(_ tag: String, symbol: String?) -> some View {
        HStack(spacing: 4) {
            Text(tag)
            if let symbol { Image(systemName: symbol).imageScale(.small).accessibilityHidden(true) }
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .overlay(Capsule().strokeBorder(.tertiary, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
        .contentShape(.capsule)
    }
}

struct ChipRow: View {
    var tags: [String] = []
    var colors: [String] = []
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
                        Text(tag)
                            .font(.footnote.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(.fill.tertiary, in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tr("native.card.searchForTag", tag))
                }
            }
        }
        .scrollClipDisabled()
    }
}
