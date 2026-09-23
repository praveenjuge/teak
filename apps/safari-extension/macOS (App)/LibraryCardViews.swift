import AppKit
import AVKit
import PDFKit
import SwiftUI

private extension Color {
    init?(teakHex: String) {
        let digits = teakHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let expanded: String
        switch digits.count {
        case 3, 4:
            expanded = digits.map { "\($0)\($0)" }.joined()
        case 6, 8:
            expanded = digits
        default:
            return nil
        }
        guard let value = UInt64(expanded, radix: 16) else { return nil }
        let hasAlpha = expanded.count == 8
        let rgb = hasAlpha ? value >> 8 : value
        self.init(.sRGB,
                  red: Double((rgb >> 16) & 0xff) / 255,
                  green: Double((rgb >> 8) & 0xff) / 255,
                  blue: Double(rgb & 0xff) / 255,
                  opacity: hasAlpha ? Double(value & 0xff) / 255 : 1)
    }
}

struct LibraryCardTile: View {
    let card: LibraryCard

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if card.cardType == .palette, let colors = card.colors, !colors.isEmpty {
                HStack(spacing: 0) {
                    ForEach(Array(colors.prefix(8).enumerated()), id: \.offset) { _, color in
                        (Color(teakHex: color.hex) ?? .gray)
                    }
                }
                .frame(height: 118)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let imageURL = card.displayImageURL {
                AsyncImage(url: imageURL) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.quaternary)
                        .overlay { ProgressView() }
                        .frame(height: 140)
                }
                .frame(maxHeight: 220)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let type = card.cardType, [.image, .video, .audio, .document].contains(type) {
                Image(systemName: type.symbol)
                    .font(.system(size: 34, weight: .ultraLight))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 104)
            }

            HStack(spacing: 6) {
                Image(systemName: card.cardType?.symbol ?? "square.stack")
                Text(card.cardType?.title ?? "Card")
                Spacer(minLength: 0)
                if card.isFavorited { Image(systemName: "heart.fill").foregroundStyle(.red) }
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            Text(card.title)
                .font(.headline)
                .lineLimit(card.cardType == .quote ? 5 : 3)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let summary = card.aiSummary ?? card.metadataDescription ?? card.content,
               summary != card.title, !summary.isEmpty {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(card.cardType == .text || card.cardType == .quote ? 5 : 3)
            }

            if !card.tags.isEmpty {
                Text(card.tags.prefix(3).map { "#\($0)" }.joined(separator: "  "))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(.quaternary) }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.cardType?.title ?? "Card"): \(card.title)")
    }
}

struct LibraryCardDetail: View {
    let initialCard: LibraryCard
    let onAuthenticationRequired: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var card: LibraryCard
    @State private var error: String?
    @State private var isDownloading = false

    init(initialCard: LibraryCard, onAuthenticationRequired: @escaping () -> Void) {
        self.initialCard = initialCard
        self.onAuthenticationRequired = onAuthenticationRequired
        _card = State(initialValue: initialCard)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(card.title).font(.title3.weight(.semibold)).lineLimit(1)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()

            HStack(spacing: 0) {
                ScrollView {
                    detailPreview
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(24)
                }
                .frame(maxWidth: .infinity)
                Divider()
                ScrollView {
                    metadataPanel.padding(20)
                }
                .frame(width: 290)
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(.red).padding(8)
            }
        }
        .frame(minWidth: 840, minHeight: 590)
        .task(id: initialCard.id) {
            do { card = try await LibraryAPI().card(id: initialCard.id) }
            catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
            catch { self.error = "Couldn’t load complete card details. \(error.localizedDescription)" }
        }
    }

    @ViewBuilder
    private var detailPreview: some View {
        switch card.cardType {
        case .text, .quote:
            Text(card.content ?? "")
                .font(card.cardType == .quote ? .title2 : .body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .link:
            if let image = card.displayImageURL {
                AsyncImage(url: image) { view in view.resizable().scaledToFit() }
                    placeholder: { ProgressView().frame(height: 160) }
                    .frame(maxHeight: 340)
            }
            Text(card.metadataTitle ?? card.title).font(.title2.weight(.semibold))
            if let description = card.metadataDescription {
                Text(description).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if let media = card.linkPreviewMedia {
                ForEach(Array(media.enumerated()), id: \.offset) { _, item in
                    if item.type == "image", item.url != card.displayImageURL?.absoluteString,
                       let url = LibraryCard.safeURL(item.url) {
                        AsyncImage(url: url) { image in image.resizable().scaledToFit() }
                            placeholder: { ProgressView().frame(height: 160) }
                            .frame(maxHeight: 340)
                    } else if item.type == "video", let url = LibraryCard.safeURL(item.url) {
                        NativePlayer(url: url).frame(height: 300)
                    }
                }
            }
        case .image:
            if let url = LibraryCard.safeURL(card.detailUrl ?? card.fileUrl ?? card.thumbnailUrl) {
                AsyncImage(url: url) { image in image.resizable().scaledToFit() }
                    placeholder: { ProgressView().frame(height: 240) }
            } else { missingPreview }
        case .video:
            if let url = LibraryCard.safeURL(card.fileUrl) {
                NativePlayer(url: url).frame(height: 380)
            } else { missingPreview }
        case .audio:
            if let url = LibraryCard.safeURL(card.fileUrl) {
                NativePlayer(url: url).frame(height: 90)
            } else { missingPreview }
            if let transcript = card.aiTranscript, !transcript.isEmpty {
                Text("Transcript").font(.headline).padding(.top, 16)
                Text(transcript).textSelection(.enabled)
            }
        case .document:
            DocumentDetail(card: card)
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                ForEach(Array(colors.enumerated()), id: \.offset) { _, swatch in
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(swatch.hex, forType: .string)
                    } label: {
                        HStack {
                            (Color(teakHex: swatch.hex) ?? .gray)
                                .frame(width: 64, height: 52).clipShape(RoundedRectangle(cornerRadius: 6))
                            Text(swatch.name ?? swatch.hex)
                            Spacer()
                            Text(swatch.hex).foregroundStyle(.secondary)
                            Image(systemName: "doc.on.doc")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Copy \(swatch.hex)")
                }
            } else { missingPreview }
        case nil:
            Text(card.content ?? "").textSelection(.enabled)
        }
    }

    private var missingPreview: some View {
        ContentUnavailableView("Preview unavailable", systemImage: "eye.slash",
                               description: Text("You can still view the card details or download the file."))
    }

    private var metadataPanel: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(card.cardType?.title ?? "Card", systemImage: card.cardType?.symbol ?? "square.stack")
                .font(.headline)
            if card.isFavorited { Label("Favorite", systemImage: "heart.fill").foregroundStyle(.red) }
            if let notes = card.notes, !notes.isEmpty { detailSection("Notes", notes) }
            if let summary = card.aiSummary, !summary.isEmpty { detailSection("Summary", summary) }
            if !card.tags.isEmpty { detailSection("Tags", card.tags.joined(separator: ", ")) }
            if !card.aiTags.isEmpty { detailSection("AI tags", card.aiTags.joined(separator: ", ")) }
            if let site = card.linkSiteName { detailSection("Site", site) }
            if let author = card.linkAuthor { detailSection("Author", author) }
            if let publisher = card.linkPublisher { detailSection("Publisher", publisher) }
            if let published = card.linkPublishedAt { detailSection("Published", published) }
            detailSection("Created", Date(timeIntervalSince1970: card.createdAt / 1000).formatted())
            detailSection("Updated", Date(timeIntervalSince1970: card.updatedAt / 1000).formatted())
            if let file = card.fileName { detailSection("File", file) }
            if let fileExtension = card.fileExtension { detailSection("Extension", fileExtension) }
            if let size = card.fileSize { detailSection("Size", ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)) }
            if let kind = card.fileKind { detailSection("Kind", kind.capitalized) }
            if let language = card.fileLanguage { detailSection("Language", language) }
            Divider()
            if let url = LibraryCard.safeURL(card.url) {
                Button("Open Source", systemImage: "arrow.up.right.square") { NSWorkspace.shared.open(url) }
            }
            if let text = card.url ?? card.content, !text.isEmpty {
                Button("Copy", systemImage: "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(text, forType: .string)
                }
            }
            if LibraryCard.safeURL(card.fileUrl) != nil {
                Button(isDownloading ? "Downloading…" : "Download", systemImage: "arrow.down.to.line") {
                    Task { await downloadFile() }
                }
                .disabled(isDownloading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func detailSection(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline).textSelection(.enabled)
        }
    }

    private func downloadFile() async {
        guard let url = LibraryCard.safeURL(card.fileUrl) else { return }
        isDownloading = true
        defer { isDownloading = false }
        do {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = card.fileName ?? "Teak file"
            guard panel.runModal() == .OK, let destination = panel.url else { return }
            let (temporary, response) = try await URLSession.shared.download(from: url)
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            if FileManager.default.fileExists(atPath: destination.path) {
                _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
            } else {
                try FileManager.default.moveItem(at: temporary, to: destination)
            }
        } catch {
            self.error = "Couldn’t download this file. \(error.localizedDescription)"
        }
    }
}

private struct NativePlayer: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.player = AVPlayer(url: url)
        view.controlsStyle = .inline
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if (view.player?.currentItem?.asset as? AVURLAsset)?.url != url {
            view.player?.pause()
            view.player = AVPlayer(url: url)
        }
    }

    static func dismantleNSView(_ view: AVPlayerView, coordinator: ()) {
        view.player?.pause()
        view.player = nil
    }
}

private struct DocumentDetail: View {
    let card: LibraryCard
    @State private var pdfData: Data?
    @State private var isLoading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(card.fileName ?? "Document", systemImage: "doc.text")
                .font(.title2.weight(.medium))
            if let facts = card.filePreview {
                let details = [
                    facts.slideCount.map { "\($0) slides" },
                    facts.wordCount.map { "\($0) words" },
                    facts.headingCount.map { "\($0) headings" },
                    facts.lineCount.map { "\($0) lines" },
                    facts.archiveFileCount.map { "\($0) files" },
                    facts.archiveDirectoryCount.map { "\($0) folders" },
                    facts.colorVariableCount.map { "\($0) colors" },
                ].compactMap { $0 }
                Text(details.joined(separator: " · ")).foregroundStyle(.secondary)
            }
            if let pdfData {
                PDFPreview(data: pdfData).frame(minHeight: 420)
            } else if isLoading {
                ProgressView("Loading preview…").frame(maxWidth: .infinity, minHeight: 240)
            } else if let content = card.content, !content.isEmpty {
                Text(content).textSelection(.enabled)
            }
        }
        .task(id: card.fileUrl) {
            guard card.mimeType == "application/pdf", let size = card.fileSize, size <= 15_000_000,
                  let url = LibraryCard.safeURL(card.fileUrl) else { return }
            isLoading = true
            defer { isLoading = false }
            if let (data, _) = try? await URLSession.shared.data(from: url), data.count <= 15_000_000 {
                pdfData = data
            }
        }
    }
}

private struct PDFPreview: NSViewRepresentable {
    let data: Data

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = PDFDocument(data: data)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document == nil { view.document = PDFDocument(data: data) }
    }
}
