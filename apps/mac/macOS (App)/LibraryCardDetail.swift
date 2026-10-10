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
    /// Text cards open as rendered Markdown, like the web; Edit shows the source.
    @State private var isEditingText = false

    init(initialCard: LibraryCard, store: LibraryStore, onAuthenticationRequired: @escaping () -> Void) {
        self.initialCard = initialCard
        self.store = store
        self.onAuthenticationRequired = onAuthenticationRequired
        _card = State(initialValue: initialCard)
        _draft = State(initialValue: initialCard.content ?? "")
    }

    var body: some View {
        HStack(spacing: 0) {
            GeometryReader { geometry in
                ScrollView {
                    detailPreview(width: geometry.size.width - 48, height: geometry.size.height - 48)
                        .frame(maxWidth: .infinity, minHeight: geometry.size.height - 48)
                        .padding(24)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if hasUnsavedChanges {
                    Button("Save changes", action: saveContent)
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.capsule)
                        .disabled(isSaving || store.mutatingIDs.contains(card.id) || isLoadingDetails || card.isDeleted == true)
                        .padding(16)
                }
            }
            Divider()
            inspector.frame(width: 340)
        }
        .background(SheetOutsideClickDismissal(onDismiss: requestClose))
        .frame(minWidth: 960, idealWidth: 1080, minHeight: 640, idealHeight: 720)
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
                card = try await store.details(for: initialCard.id)
                draft = card.content ?? ""
            } catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
            catch { self.error = "Couldn’t load complete card details. \(error.localizedDescription)" }
        }
    }

    /// Previews sit centered in the pane like the web modal.
    @ViewBuilder private func detailPreview(width: CGFloat, height: CGFloat) -> some View {
        switch card.cardType {
        case .text:
            VStack(alignment: .leading, spacing: 12) {
                if card.isDeleted != true {
                    Picker("Mode", selection: $isEditingText) {
                        Text("Preview").tag(false)
                        Text("Edit").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if isEditingText {
                    TextEditor(text: $draft)
                        .font(.system(.body, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: max(height - 40, 240))
                        .disabled(isLoadingDetails || isSaving || card.isDeleted == true)
                } else {
                    MarkdownText(markdown: draft)
                        .frame(minHeight: max(height - 40, 240), alignment: .topLeading)
                        .onTapGesture(count: 2) { if card.isDeleted != true { isEditingText = true } }
                }
            }
            .frame(maxWidth: 720)
        case .quote:
            QuoteDetailPreview(text: $draft, isEditable: !(isLoadingDetails || isSaving || card.isDeleted == true), availableWidth: width)
        case .link:
            LinkDetailPreview(card: card)
        case .image:
            if let url = LibraryCard.safeURL(card.detailUrl ?? card.fileUrl ?? card.thumbnailUrl) {
                RemoteImage(urls: [url], maxHeight: max(height, 240), showsUnavailable: true)
            } else { missingPreview }
        case .video:
            VStack(spacing: 16) {
                if let url = LibraryCard.safeURL(card.fileUrl) {
                    NativePlayer(url: url)
                        .aspectRatio(videoRatio, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .frame(maxHeight: max(height - 40, 240))
                } else { missingPreview }
                if let transcript = card.aiTranscript, !transcript.isEmpty { TranscriptBox(transcript: transcript) }
            }
        case .audio:
            if let url = LibraryCard.safeURL(card.fileUrl) {
                AudioDetailPreview(card: card, url: url)
            } else {
                VStack(spacing: 16) {
                    missingPreview
                    if let transcript = card.aiTranscript, !transcript.isEmpty { TranscriptBox(transcript: transcript).frame(maxWidth: 576) }
                }
            }
        case .document:
            DocumentDetail(card: card).frame(maxWidth: 720)
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                PaletteDetailPreview(colors: colors, availableWidth: width, availableHeight: height, onCopy: copyHex)
            } else {
                Text("No colors detected in this palette").foregroundStyle(.secondary)
            }
        case nil:
            Text(card.content ?? "").textSelection(.enabled)
        }
    }

    private var videoRatio: CGFloat {
        guard let width = card.fileWidth, let height = card.fileHeight, width > 0, height > 0 else { return 16 / 9 }
        return CGFloat(width) / CGFloat(height)
    }

    private var missingPreview: some View {
        ContentUnavailableView("Preview unavailable", systemImage: "eye.slash")
    }

    /// Right-hand panel, like the web modal's metadata panel.
    private var inspector: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                Button(role: .close, action: requestClose)
                    .keyboardShortcut(.cancelAction)
                    .disabled(isSaving)
            }
            .padding([.top, .horizontal], 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let notes = card.notes, !notes.isEmpty { infoBox("Notes", notes) }
                    if let summary = card.aiSummary, !summary.isEmpty { infoBox("Summary", summary) }
                    chips
                    actions
                    if let error {
                        Text(error).font(.callout).foregroundStyle(.red)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding([.horizontal, .bottom], 16)
            }
        }
        .background(.fill.quinary)
        .disabled(isLoadingDetails || store.mutatingIDs.contains(card.id))
    }

    private func infoBox(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.body.weight(.medium))
            Text(text)
                .textSelection(.enabled)
                .lineSpacing(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .teakCardSurface(cornerRadius: 12)
        }
    }

    private var chips: some View {
        CardChipFlow {
            if let type = card.cardType {
                Button(type.title, systemImage: type.symbol) { store.toggleType(type); requestClose() }
            }
            ForEach(card.tags, id: \.self) { tag in
                Button(tag) { store.filterByTag(tag); requestClose() }
                    .help("Show cards tagged \(tag)")
            }
            ForEach(Array((card.colors ?? []).enumerated()), id: \.offset) { _, color in
                Button { copyHex(color.hex) } label: {
                    Circle()
                        .fill(Color(teakHex: color.hex) ?? .secondary)
                        .overlay { Circle().strokeBorder(.primary.opacity(0.12)) }
                        .frame(width: 14, height: 14)
                }
                .help(color.hex)
                .accessibilityLabel("Copy \(color.hex)")
            }
            ForEach(card.aiTags, id: \.self) { tag in
                Button(tag, systemImage: "sparkles") { store.filterByTag(tag); requestClose() }
                    .help("Show cards tagged \(tag)")
            }
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
    }

    private var actions: some View {
        CardChipFlow {
            Button("Info", systemImage: "info.circle") { showingInfo = true }
            if card.isDeleted != true {
                Button(card.isFavorited ? "Unfavorite" : "Favorite", systemImage: card.isFavorited ? "heart.fill" : "heart") {
                    Task {
                        do { card = try await store.setFavorite(card) }
                        catch { self.error = error.localizedDescription }
                    }
                }
                .disabled(isSaving)
            }
            if LibraryCard.safeURL(card.url) != nil {
                Button("Open Link", systemImage: "arrow.up.right") {
                    if let url = LibraryCard.safeURL(card.url) { NSWorkspace.shared.open(url) }
                }
            }
            if LibraryCard.safeURL(card.fileUrl) != nil {
                Button("Download", systemImage: "arrow.down.to.line") { Task { await downloadFile() } }
                    .disabled(isDownloading)
            }
            if let link = LibraryLinks.card(card) {
                Button("Copy Link", systemImage: "link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(link.absoluteString, forType: .string)
                    store.showStatus("Card link copied")
                }
                Button("Open on Web", systemImage: "safari") { NSWorkspace.shared.open(link) }
            }
            if card.isDeleted != true {
                Button(card.notes?.isEmpty == false ? "Edit Notes" : "Add Notes", systemImage: "square.and.pencil") { showingNotes = true }
                    .disabled(isSaving)
                Button("Manage Tags", systemImage: "tag") { showingTags = true }
                    .disabled(isSaving)
            }
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
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
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

private struct DocumentDetail: View {
    let card: LibraryCard
    @State private var pdfData: Data?
    @State private var fileText: String?
    @State private var isLoading = false

    /// Text previews stay small, like the web's file text preview.
    private static let textPreviewLimit = 512 * 1024
    private var isMarkdown: Bool { ["md", "mdx", "markdown"].contains(card.fileExtension?.lowercased() ?? "") }
    private var isTextFile: Bool {
        isMarkdown || card.fileLanguage != nil || card.mimeType?.hasPrefix("text/") == true
            || ["json", "yaml", "yml", "toml", "csv", "xml", "svg"].contains(card.fileExtension?.lowercased() ?? "")
    }

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
            } else if let fileText, isMarkdown {
                MarkdownText(markdown: fileText)
                    .padding(16)
                    .teakCardSurface(cornerRadius: 12)
            } else if let fileText {
                CodePreview(text: fileText, language: card.fileLanguage)
            } else if isLoading {
                ProgressView("Loading preview…").frame(maxWidth: .infinity, minHeight: 240)
            } else if let thumbnail = card.displayImageURL {
                RemoteImage(urls: [thumbnail], maxHeight: 520)
            } else if let content = card.content, !content.isEmpty {
                Text(content).textSelection(.enabled)
            }
        }
        .task(id: card.fileUrl) {
            guard let url = LibraryCard.safeURL(card.fileUrl), let size = card.fileSize else { return }
            if card.mimeType == "application/pdf", size <= 15_000_000 {
                isLoading = true
                defer { isLoading = false }
                if let (data, _) = try? await URLSession.shared.data(from: url), data.count <= 15_000_000 {
                    pdfData = data
                }
            } else if isTextFile, size <= Self.textPreviewLimit {
                isLoading = true
                defer { isLoading = false }
                if let (data, _) = try? await URLSession.shared.data(from: url), data.count <= Self.textPreviewLimit {
                    fileText = String(data: data, encoding: .utf8)
                }
            }
        }
    }
}

/// Source files in a monospaced, line-numbered view.
private struct CodePreview: View {
    let text: String
    let language: String?

    var body: some View {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        VStack(alignment: .leading, spacing: 8) {
            if let language { Text(language).font(.caption.weight(.medium)).foregroundStyle(.secondary) }
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    Text(lines.indices.map { String($0 + 1) }.joined(separator: "\n"))
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.trailing)
                        .accessibilityHidden(true)
                    Text(text).textSelection(.enabled)
                }
                .font(.system(.callout, design: .monospaced))
                .padding(16)
            }
            .teakCardSurface(cornerRadius: 12)
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
