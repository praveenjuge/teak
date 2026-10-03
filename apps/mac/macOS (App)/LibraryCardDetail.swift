import AppKit
import AVKit
import PDFKit
import SwiftUI

struct LibraryCardDetail: View {
    let initialCard: LibraryCard
    @ObservedObject var store: LibraryStore
    let onAuthenticationRequired: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var card: LibraryCard
    @State private var draft: String
    @State private var error: String?
    @State private var isLoadingDetails = true
    @State private var isDownloading = false
    @State private var isSaving = false
    @State private var showingInfo = false
    @State private var showingNotes = false
    @State private var showingTags = false
    @State private var confirmingPermanentDelete = false
    @State private var confirmingDiscard = false

    init(initialCard: LibraryCard, store: LibraryStore, onAuthenticationRequired: @escaping () -> Void) {
        self.initialCard = initialCard
        self.store = store
        self.onAuthenticationRequired = onAuthenticationRequired
        _card = State(initialValue: initialCard)
        _draft = State(initialValue: initialCard.content ?? "")
    }

    var body: some View {
        VStack {
            GeometryReader { geometry in
                HStack {
                    ScrollView { detailPreview.frame(maxWidth: .infinity, alignment: .topLeading) }
                        .frame(width: geometry.size.width * 2 / 3)
                    Divider()
                    VStack {
                        HStack {
                            Spacer()
                            Button("Close", action: requestClose).keyboardShortcut(.cancelAction).disabled(isSaving)
                        }.padding([.top, .horizontal])
                        metadataPanel
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .padding(.horizontal)
        .background(SheetOutsideClickDismissal(onDismiss: requestClose))
        .frame(minWidth: 840, minHeight: 590)
        .interactiveDismissDisabled(hasUnsavedChanges || isSaving)
        .confirmationDialog("Discard unsaved changes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard Changes", role: .destructive) { dismiss() }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showingInfo) { CardInfoSheet(card: card) }
        .sheet(isPresented: $showingNotes) { CardNotesSheet(card: card, store: store) { card = $0 } }
        .sheet(isPresented: $showingTags) { CardTagsSheet(card: card, store: store) { card = $0 } }
        .confirmationDialog("Delete this card forever?", isPresented: $confirmingPermanentDelete, titleVisibility: .visible) {
            Button("Delete Forever", role: .destructive) { remove(permanent: true) }
        }
        .task(id: initialCard.id) {
            defer { isLoadingDetails = false }
            guard initialCard.isDeleted != true else { return }
            do {
                card = try await LibraryAPI().card(id: initialCard.id)
                draft = card.content ?? ""
            } catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
            catch { self.error = "Couldn’t load complete card details. \(error.localizedDescription)" }
        }
    }

    @ViewBuilder private var detailPreview: some View {
        switch card.cardType {
        case .text, .quote:
            editablePreview
        case .link:
            linkPreview
        case .image:
            if let url = LibraryCard.safeURL(card.detailUrl ?? card.fileUrl ?? card.thumbnailUrl) {
                detailImage(url)
            } else { missingPreview }
        case .video, .audio:
            if let url = LibraryCard.safeURL(card.fileUrl) {
                NativePlayer(url: url).frame(height: card.cardType == .audio ? 90 : 380)
            } else { missingPreview }
            if let transcript = card.aiTranscript, !transcript.isEmpty {
                GroupBox("Transcript") { Text(transcript).textSelection(.enabled) }
            }
        case .document: DocumentDetail(card: card).padding(12)
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 16)], spacing: 20) {
                    ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                        Button { copyHex(color.hex) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color(teakHex: color.hex) ?? .secondary)
                                    .aspectRatio(1.25, contentMode: .fit)
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .strokeBorder(.primary.opacity(0.1))
                                    }
                                Text(color.hex.uppercased())
                                if let name = color.name, name.lowercased() != color.hex.lowercased() {
                                    Text(name).foregroundStyle(.secondary)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Copy \(color.hex)")
                        .accessibilityLabel("Copy \(color.hex)")
                    }
                }
                .padding(16)
            } else { Text("No colors detected in this palette") }
        case nil: Text(card.content ?? "").textSelection(.enabled)
        }
    }

    private var editablePreview: some View {
        VStack {
            if card.cardType == .quote {
                Text("“").font(.title).foregroundStyle(.quaternary).frame(maxWidth: .infinity, alignment: .leading)
            }
            if card.cardType == .quote {
                TextField("", text: $draft, axis: .vertical)
                    .font(.body.italic()).multilineTextAlignment(.center).frame(minHeight: 360).disabled(isLoadingDetails || isSaving || card.isDeleted == true)
            } else {
                TextEditor(text: $draft).font(.body).frame(minHeight: 360).disabled(isLoadingDetails || isSaving || card.isDeleted == true)
            }
            if card.cardType == .quote {
                Text("”").font(.title).foregroundStyle(.quaternary).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if draft != (card.content ?? "") {
                Button("Save changes", action: saveContent)
                    .disabled(isSaving || store.mutatingIDs.contains(card.id) || isLoadingDetails || card.isDeleted == true)
            }
        }
    }

    private var linkPreview: some View {
        VStack(alignment: .leading) {
            Button {
                if let url = LibraryCard.safeURL(card.url) { NSWorkspace.shared.open(url) }
            } label: { linkBox }
            .buttonStyle(.plain)
            if let facts = card.linkFacts, !facts.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {
                    ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                        VStack(alignment: .leading) {
                            Text(fact.label).font(.caption).foregroundStyle(.secondary)
                            Text(fact.value).textSelection(.enabled)
                        }
                    }
                }
            }
            if let media = card.linkPreviewMedia {
                ForEach(Array(media.enumerated()), id: \.offset) { _, item in
                    if let url = LibraryCard.safeURL(item.url) {
                        if item.type == "video" { NativePlayer(url: url).frame(height: 300) }
                        else if item.type == "image" { detailImage(url) }
                    }
                }
            }
        }
    }

    private var linkBox: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let image = card.displayImageURL {
                detailImage(image)
                    .frame(maxWidth: .infinity, maxHeight: 340)
                    .clipped()
            }
            linkInformation.padding(16)
        }
        .background(.quaternary.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(12)
    }

    private var linkInformation: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                if let url = faviconURL {
                    AsyncImage(url: url) { image in image.resizable().scaledToFit() }
                        placeholder: { EmptyView() }.frame(width: 16, height: 16)
                }
                Text(LibraryCard.safeURL(card.url)?.host ?? "Link")
                    .foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Image(systemName: "arrow.up.right").foregroundStyle(.secondary)
            }
            Text(card.linkTitle).font(.headline).fixedSize(horizontal: false, vertical: true)
            if let description = card.linkPreviewDescription ?? card.metadataDescription {
                Text(description).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var faviconURL: URL? {
        LibraryCard.safeURL(card.linkFaviconUrl)
    }

    private func detailImage(_ url: URL) -> some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image { image.resizable().scaledToFit() }
            else if phase.error != nil { Rectangle().fill(.quaternary) }
            else { ProgressView() }
        }
    }

    private var missingPreview: some View {
        ContentUnavailableView("Preview unavailable", systemImage: "eye.slash")
    }

    private var metadataPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let notes = card.notes, !notes.isEmpty {
                    inspectorSection("Notes") { Text(notes).textSelection(.enabled) }
                }
                if let summary = card.aiSummary, !summary.isEmpty {
                    inspectorSection("Summary") { Text(summary).textSelection(.enabled) }
                }
                inspectorSection("Tags") { chips }
                Divider()
                inspectorActions
                Divider()
                deletionActions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
        .font(.body)
        .controlSize(.small)
        .disabled(isLoadingDetails || store.mutatingIDs.contains(card.id))
    }

    private func inspectorSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content().frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var inspectorActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            quickActions
            HStack {
                Button(action: { showingNotes = true }) {
                    Label(card.notes?.isEmpty == false ? "Edit Notes" : "Add Notes", systemImage: "note.text")
                }
                Button(action: { showingTags = true }) {
                    Label("Manage Tags", systemImage: "tag")
                }
            }
            .disabled(isLoadingDetails || isSaving || card.isDeleted == true)
        }
    }

    private var chips: some View {
        CardChipFlow {
            if let type = card.cardType {
                Button(type.title) { store.toggleType(type); requestClose() }
            }
            ForEach(card.tags, id: \.self) { tag in
                Button(tag) { store.searchText = tag; store.scheduleSearch(); requestClose() }
            }
            ForEach(Array((card.colors ?? []).enumerated()), id: \.offset) { _, color in
                Button { copyHex(color.hex) } label: {
                    Image(systemName: "circle.fill").foregroundStyle(Color(teakHex: color.hex) ?? .secondary)
                }.help(color.hex).accessibilityLabel("Copy \(color.hex)")
            }
            ForEach(card.aiTags, id: \.self) { tag in
                Button { store.searchText = tag; store.scheduleSearch(); requestClose() } label: {
                    Label(tag, systemImage: "sparkles")
                }
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }

    private var quickActions: some View {
        HStack {
            Button("Info", systemImage: "info.circle") { showingInfo = true }.help("Card information")
            Button(card.isFavorited ? "Unfavorite" : "Favorite", systemImage: card.isFavorited ? "heart.fill" : "heart") {
                Task {
                    do { card = try await store.setFavorite(card) }
                    catch { self.error = error.localizedDescription }
                }
            }.disabled(isLoadingDetails || isSaving || card.isDeleted == true).help(card.isFavorited ? "Remove favorite" : "Add favorite")
            if LibraryCard.safeURL(card.fileUrl) != nil {
                Button("Download", systemImage: "arrow.down.to.line") { Task { await downloadFile() } }
                    .disabled(isDownloading).help("Download file")
            }
        }
        .buttonStyle(.bordered)
        .labelStyle(.iconOnly)
    }

    @ViewBuilder private var deletionActions: some View {
        if store.trashOnly {
            Button("Restore", systemImage: "arrow.uturn.backward") {
                Task {
                    do { try await store.restore(card); dismiss() }
                    catch { self.error = error.localizedDescription }
                }
            }
            Button("Delete Forever", systemImage: "trash", role: .destructive) { confirmingPermanentDelete = true }
        } else {
            Button("Delete", systemImage: "trash", role: .destructive) { remove(permanent: false) }
        }
    }

    private func copyHex(_ hex: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(hex, forType: .string)
        store.showStatus("Copied \(hex.hasPrefix("#") ? hex : "#" + hex)")
    }

    private var hasUnsavedChanges: Bool {
        (card.cardType == .text || card.cardType == .quote) && draft != (card.content ?? "")
    }

    private func requestClose() {
        guard !isSaving else { return }
        if hasUnsavedChanges { confirmingDiscard = true }
        else { dismiss() }
    }

    private func saveContent() {
        guard !isSaving else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                card = try await store.update(card, title: card.metadataTitle ?? "", content: draft, notes: card.notes ?? "", tags: card.tags)
                draft = card.content ?? ""
            } catch { self.error = error.localizedDescription }
        }
    }

    private func remove(permanent: Bool) {
        Task {
            do {
                if permanent { try await store.permanentDelete(card) }
                else { try await store.delete(card) }
                dismiss()
            } catch { self.error = error.localizedDescription }
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
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            if FileManager.default.fileExists(atPath: destination.path) {
                _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
            } else { try FileManager.default.moveItem(at: temporary, to: destination) }
        } catch { self.error = "Couldn’t download this file. \(error.localizedDescription)" }
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
        VStack(alignment: .leading) {
            Label(card.fileName ?? "Document", systemImage: "doc.text")
            if let url = LibraryCard.safeURL(card.fileUrl) {
                Button("Open file", systemImage: "arrow.up.right.square") { NSWorkspace.shared.open(url) }
            }
            if let facts = card.filePreview {
                let details = [facts.wordCount.map { "\($0) words" }, facts.lineCount.map { "\($0) lines" }].compactMap { $0 }
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

private struct SheetOutsideClickDismissal: NSViewRepresentable {
    let onDismiss: () -> Void

    func makeNSView(context: Context) -> OutsideClickView {
        let view = OutsideClickView()
        view.onDismiss = onDismiss
        return view
    }

    func updateNSView(_ nsView: OutsideClickView, context: Context) {
        nsView.onDismiss = onDismiss
    }

    static func dismantleNSView(_ nsView: OutsideClickView, coordinator: ()) {
        nsView.stopMonitoring()
    }

    final class OutsideClickView: NSView {
        var onDismiss: (() -> Void)?
        private var monitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stopMonitoring()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
                guard let self, let sheet = self.window,
                      let parent = sheet.sheetParent,
                      parent.attachedSheet === sheet,
                      sheet.attachedSheet == nil,
                      event.window === parent else { return event }
                self.onDismiss?()
                return nil
            }
        }

        func stopMonitoring() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }
}
