import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    let onSettings: () -> Void
    let onAuthenticationRequired: () -> Void
    @StateObject private var store: LibraryStore
    @StateObject private var noteDraft = LibraryNoteDraft()
    @FocusState private var searchFocused: Bool
    @State private var selectedCard: LibraryCard?
    @State private var tagsCard: LibraryCard?
    @State private var permanentDeleteCard: LibraryCard?
    @State private var recording = false
    @State private var dropping = false
    @State private var uploadError: String?
    @State private var uploading = false
    @State private var refreshing = false
    @State private var paginationVisible = false
    @State private var pendingUploads: [PendingLibraryUpload] = []
    @State private var uploadAPI = LibraryAPI()
    @State private var limitMessage: String?
    @State private var confirmingBulkDeleteForever = false

    init(api: LibraryAPI? = nil, onSettings: @escaping () -> Void, onAuthenticationRequired: @escaping () -> Void) {
        self.onSettings = onSettings
        self.onAuthenticationRequired = onAuthenticationRequired
        _store = StateObject(wrappedValue: LibraryStore(api: api, onAuthenticationRequired: onAuthenticationRequired))
    }

    var body: some View {
        VStack {
            header.padding(.horizontal)
            Divider()
            content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            if let message = uploadError ?? store.error {
                HStack {
                    Text(message).foregroundStyle(.red)
                    Button("Retry") { Task {
                        if !pendingUploads.isEmpty { await processUploads() }
                        else { await store.loadFirstPage() }
                    } }
                }
            }
            if uploading { ProgressView("Uploading files...") }
        }
        .frame(minWidth: 650, minHeight: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .sheet(item: $selectedCard) { card in
            LibraryCardDetail(initialCard: card, store: store, onAuthenticationRequired: onAuthenticationRequired)
        }
        .sheet(item: $tagsCard) { card in
            CardTagsSheet(card: card, store: store) { _ in }
        }
        .sheet(isPresented: $noteDraft.expanded) {
            NoteComposer(draft: noteDraft, isExpanded: true, onCreated: handleCreated, onAuthenticationRequired: onAuthenticationRequired)
        }
        .sheet(isPresented: $recording) {
            AudioCaptureSheet(onCreated: handleCreated, onAuthenticationRequired: onAuthenticationRequired)
        }
        .confirmationDialog("Delete this card forever?", isPresented: Binding(
            get: { permanentDeleteCard != nil },
            set: { if !$0 { permanentDeleteCard = nil } }
        ), titleVisibility: .visible, presenting: permanentDeleteCard) { card in
            Button("Delete Forever", role: .destructive) {
                Task {
                    do { try await store.permanentDelete(card) }
                    catch { uploadError = error.localizedDescription }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("You've reached the Free plan limit", isPresented: Binding(
            get: { limitMessage != nil },
            set: { if !$0 { limitMessage = nil } }
        )) {
            Button("Upgrade…") { NSWorkspace.shared.open(LibraryLinks.settings) }
            Button("Not Now", role: .cancel) {}
        } message: {
            Text(limitMessage ?? "")
        }
        .confirmationDialog("Delete \(store.selectedIDs.count == 1 ? "this card" : "these \(store.selectedIDs.count) cards") forever?",
                            isPresented: $confirmingBulkDeleteForever, titleVisibility: .visible) {
            Button("Delete Forever", role: .destructive) { Task { await store.deleteSelectedForever() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the cards and their files. You can't undo it.")
        }
        .onDrop(of: [UTType.fileURL.identifier], isTargeted: $dropping, perform: acceptDrop)
        .overlay {
            if dropping { GroupBox { Label("Drop files to upload", systemImage: "square.and.arrow.up") }.allowsHitTesting(false) }
        }
        .overlay(alignment: .bottom) {
            VStack(spacing: 10) {
                statusOverlay.allowsHitTesting(false)
                if store.isSelecting { selectionBar }
            }
            .padding(.bottom, 20)
        }
        .onExitCommand { if store.isSelecting { store.endSelection() } }
        .onReceive(NotificationCenter.default.publisher(for: .libraryPaste)) { note in
            guard acceptsLibraryCommands, let content = note.object as? PasteboardCapture.Content else { return }
            Task { await savePasted(content) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .libraryCardCreated)) { note in
            guard let id = note.object as? String else { return }
            Task { await store.insertCreated(id: id) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .libraryRefresh)) { _ in
            guard acceptsLibraryCommands else { return }
            refreshLibrary()
        }
        .onReceive(NotificationCenter.default.publisher(for: .librarySearch)) { _ in
            guard acceptsLibraryCommands else { return }
            searchFocused = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .libraryNewNote)) { _ in
            guard acceptsLibraryCommands else { return }
            noteDraft.expanded = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .libraryUpload)) { _ in
            guard acceptsLibraryCommands else { return }
            chooseFiles()
        }
        .task { await store.loadFirstPage() }
        // SF Rounded across the library and every sheet it presents.
        .fontDesign(.rounded)
    }

    @ViewBuilder private var statusOverlay: some View {
        if refreshing || store.statusMessage != nil {
            HStack(spacing: 8) {
                if refreshing { ProgressView().controlSize(.small) }
                else if store.statusMessage == "Library refreshed" {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.secondary)
                }
                Text(refreshing ? "Refreshing library…" : store.statusMessage ?? "")
            }
            .font(.callout)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(.primary.opacity(0.08))
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        }
    }

    /// Floating bar for the selected cards, like the web's bulk action bar.
    private var selectionBar: some View {
        HStack(spacing: 12) {
            Text(store.selectedIDs.isEmpty ? "Select cards" : "\(store.selectedIDs.count) selected")
                .font(.callout.weight(.medium))
                .monospacedDigit()
            Divider().frame(height: 18)
            Button("Select All") { store.selectAll() }
            if store.trashOnly {
                Button("Restore", systemImage: "arrow.uturn.backward") { Task { await store.restoreSelected() } }
                Button("Delete Forever", systemImage: "trash", role: .destructive) { confirmingBulkDeleteForever = true }
            } else {
                Button("Favorite", systemImage: "heart") { Task { await store.favoriteSelected(true) } }
                Button("Unfavorite", systemImage: "heart.slash") { Task { await store.favoriteSelected(false) } }
                Button("Delete", systemImage: "trash", role: .destructive) { Task { await store.deleteSelected() } }
            }
            Button("Cancel") { store.endSelection() }.keyboardShortcut(.cancelAction)
        }
        .disabled(store.isRunningBulkAction)
        .controlSize(.regular)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: Capsule())
        .overlay { Capsule().strokeBorder(.primary.opacity(0.08)) }
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .overlay(alignment: .topTrailing) {
            if store.isRunningBulkAction { ProgressView().controlSize(.small).padding(6) }
        }
    }

    private func savePasted(_ content: PasteboardCapture.Content) async {
        switch content {
        case .files(let urls):
            await upload(urls)
        case .text(let text):
            do {
                let id = try await uploadAPI.createText(text, idempotencyKey: UUID().uuidString)
                await store.insertCreated(id: id)
                store.showStatus("Saved from the clipboard")
            } catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
            catch SafariServiceError.cardLimit(let message) { limitMessage = message }
            catch { uploadError = error.localizedDescription }
        }
    }

    private func refreshLibrary() {
        guard !refreshing else { return }
        refreshing = true
        Task {
            await store.loadFirstPage()
            refreshing = false
            if store.error == nil { store.showStatus("Library refreshed") }
        }
    }

    private var acceptsLibraryCommands: Bool {
        (NSApp.keyWindow?.windowController is LibraryWindowController) && selectedCard == nil && tagsCard == nil && !recording && !noteDraft.expanded
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search for anything...", text: $store.searchText)
                    .focused($searchFocused)
                    .onChange(of: store.searchText) { _, _ in store.scheduleSearch() }
                    .onSubmit { store.commitSearchTokens() }
                    .onKeyPress(.delete) {
                        guard store.searchText.isEmpty else { return .ignored }
                        store.removeLastChip()
                        return .handled
                    }
                    .textFieldStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
                .overlay {
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(searchFocused ? Color.accentColor : Color.primary.opacity(0.12), lineWidth: searchFocused ? 2 : 1)
                }
                Button("Upload files", systemImage: "square.and.arrow.up", action: chooseFiles)
                    .labelStyle(.iconOnly).help("Upload files").disabled(uploading)
                Button("Record audio", systemImage: "mic") { recording = true }
                    .labelStyle(.iconOnly).help("Record audio")
                Button("Settings", systemImage: "gearshape", action: onSettings)
                    .labelStyle(.iconOnly).help("Settings")
            }
            if searchFocused || store.hasFilters { filters }
        }
    }

    private var filters: some View {
        ScrollView(.horizontal) {
            HStack {
                ForEach(store.activeChips) { chip in
                    Button(chip.label) { store.removeChip(chip) }.buttonStyle(.borderedProminent)
                }
                ForEach(LibraryCardType.allCases.filter { !store.selectedTypes.contains($0) }) { type in
                    Button(type.title) { store.toggleType(type) }.buttonStyle(.bordered)
                }
                if !store.favoritesOnly {
                    Button("Favorites") { store.toggleFavorites() }.buttonStyle(.bordered)
                }
                if !store.trashOnly { Button("Trash") { store.toggleTrash() }.buttonStyle(.bordered) }
                Button("Clear All") { store.clearFilters() }
            }
        }
    }

    @ViewBuilder private var content: some View {
        if store.isLoading && store.cards.isEmpty {
            loadingGrid
        } else if store.cards.isEmpty && store.hasFilters {
            ContentUnavailableView {
                Text("Nothing found matching your filters")
            } actions: {
                Button("Clear filters") { store.clearFilters() }
                if store.hasMore { Button("Keep searching") { Task { await store.loadMore() } } }
            }
        } else if store.cards.isEmpty {
            emptyLibrary
        } else { masonry }
    }

    /// Mirrors the web empty state: wordmark, the note composer, then a short prompt.
    private var emptyLibrary: some View {
        ScrollView {
            VStack(spacing: 20) {
                TeakWordmark()
                composer
                VStack(spacing: 4) {
                    Text("Let's add your first card!").font(.headline)
                    Text("Start capturing your thoughts, links, and media above")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: 320)
            .padding(.vertical, 80)
            .frame(maxWidth: .infinity)
        }
    }

    private var loadingGrid: some View {
        GeometryReader { geometry in
            ScrollView {
                LibraryMasonryLayout(columns: columnCount(for: geometry.size.width), spacing: gridSpacing) {
                    ForEach(0..<10) { index in
                        VStack(alignment: .leading, spacing: 0) {
                            Rectangle().fill(.quinary)
                                .aspectRatio(index.isMultiple(of: 3) ? 1 : 4 / 3, contentMode: .fit)
                            Text("A saved thought or inspiration").lineLimit(1)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .teakCardSurface()
                        .redacted(reason: .placeholder)
                    }
                }.padding()
            }.allowsHitTesting(false).accessibilityLabel("Loading cards")
        }
    }

    /// Matches the web masonry gutter.
    private let gridSpacing: CGFloat = 24

    private func columnCount(for width: CGFloat) -> Int {
        width >= 992 ? 5 : width >= 768 ? 3 : width >= 576 ? 2 : 1
    }

    private var composer: some View {
        NoteComposer(draft: noteDraft, onCreated: handleCreated, onAuthenticationRequired: onAuthenticationRequired)
    }

    private var masonry: some View {
        GeometryReader { geometry in
            let count = columnCount(for: geometry.size.width)
            ScrollView {
                LibraryMasonryLayout(columns: count, spacing: gridSpacing) {
                    if !store.trashOnly { composer }
                    ForEach(store.cards) { card in
                        LibraryCardTile(card: card, isSaving: store.mutatingIDs.contains(card.id),
                                        isSelecting: store.isSelecting, isSelected: store.selectedIDs.contains(card.id),
                                        onOpen: { selectedCard = card },
                                        onToggleSelection: { store.toggleSelection(card) })
                            .contextMenu { cardMenu(card) }
                    }
                }.padding()
                if store.hasMore {
                    ProgressView()
                }
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height
            } action: { _, nearBottom in
                paginationVisible = nearBottom
                if nearBottom && store.hasMore { Task { await store.loadMore() } }
            }
            .onChange(of: store.isLoadingMore) { _, loading in
                if !loading && paginationVisible && store.hasMore { Task { await store.loadMore() } }
            }
        }
    }

    @ViewBuilder private func cardMenu(_ card: LibraryCard) -> some View {
        if let url = LibraryCard.safeURL(card.url) { Button("Open Link") { NSWorkspace.shared.open(url) } }
        if store.trashOnly {
            Button("Restore") {
                Task {
                    do { try await store.restore(card) }
                    catch { uploadError = error.localizedDescription }
                }
            }
            Divider()
            Button("Delete Forever", role: .destructive) { permanentDeleteCard = card }
        } else {
            if card.cardType == .text || card.cardType == .link || (card.cardType == .image && card.mimeType != "image/svg+xml") {
                Button(card.cardType == .image ? "Copy Image" : card.cardType == .link ? "Copy Link" : "Copy Text") { Task { await copy(card) } }
            }
            Button("Add Tags") { tagsCard = card }
            Button(card.isFavorited ? "Unfavorite" : "Favorite") { Task { _ = try? await store.setFavorite(card) } }
            Divider()
            Button("Delete", role: .destructive) { Task { try? await store.delete(card) } }
        }
        Divider()
        if let link = LibraryLinks.card(card) {
            Button("Copy Link to Card") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(link.absoluteString, forType: .string)
                store.showStatus("Card link copied")
            }
            Button("Open on Web") { NSWorkspace.shared.open(link) }
        }
        Button(store.selectedIDs.contains(card.id) ? "Deselect" : "Select") { store.toggleSelection(card) }
    }

    private func copy(_ card: LibraryCard) async {
        if card.cardType == .image {
            guard let url = LibraryCard.safeURL(card.fileUrl ?? card.detailUrl) else { return }
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                      let image = NSImage(data: data) else { throw URLError(.cannotDecodeContentData) }
                NSPasteboard.general.clearContents()
                NSPasteboard.general.writeObjects([image])
                store.showStatus("Image copied to clipboard")
            } catch { store.showStatus("Failed to copy image") }
        } else {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(card.cardType == .link ? card.url ?? "" : card.content ?? "", forType: .string)
            store.showStatus(card.cardType == .link ? "Link copied to clipboard" : "Text copied to clipboard")
        }
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        if panel.runModal() == .OK { Task { await upload(panel.urls) } }
    }

    private func acceptDrop(_ providers: [NSItemProvider]) -> Bool {
        let files = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
        guard !files.isEmpty else { return false }
        Task { @MainActor in
            var urls: [URL] = []
            for provider in files {
                let url: URL? = await withCheckedContinuation { continuation in
                    provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                        let url = (item as? URL) ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                        continuation.resume(returning: url?.isFileURL == true ? url : nil)
                    }
                }
                if let url { urls.append(url) }
            }
            await upload(urls)
        }
        return true
    }

    private func upload(_ urls: [URL]) async {
        pendingUploads.append(contentsOf: urls.map { PendingLibraryUpload(url: $0) })
        await processUploads()
    }

    private func processUploads() async {
        guard !uploading else { return }
        uploading = true
        defer { uploading = false }
        while let pending = pendingUploads.first {
            do {
                let mime = UTType(filenameExtension: pending.url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                let id = try await uploadAPI.createFile(pending.url, mimeType: mime, idempotencyKey: pending.key)
                pendingUploads.removeFirst()
                await store.insertCreated(id: id)
                uploadError = nil
            } catch SafariServiceError.unauthenticated { onAuthenticationRequired(); return }
            catch SafariServiceError.cardLimit(let message) {
                pendingUploads.removeAll()
                limitMessage = message
                return
            }
            catch { uploadError = error.localizedDescription; return }
        }
    }

    private func handleCreated(_ id: String) { Task { await store.insertCreated(id: id) } }
}

private struct PendingLibraryUpload {
    let url: URL
    let key = UUID().uuidString
}

/// The Teak wordmark in the current text color, like the web empty state logo.
private struct TeakWordmark: View {
    private static let image: NSImage? = Bundle.main.url(forResource: "Wordmark", withExtension: "png")
        .flatMap(NSImage.init(contentsOf:))

    var body: some View {
        if let image = Self.image {
            Image(nsImage: image)
                .renderingMode(.template)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: 72, height: 23)
                .foregroundStyle(.primary)
                .accessibilityLabel("Teak")
        } else {
            Text("teak").font(.title2.weight(.heavy))
        }
    }
}

/// Links from the app to Teak on the web.
enum LibraryLinks {
    static var settings: URL { TeakSafariService.appBaseURL.appendingPathComponent("settings") }

    /// The card's own page on the web, from the API, or built from its ID.
    static func card(_ card: LibraryCard) -> URL? {
        if let url = LibraryCard.safeURL(card.appUrl) { return url }
        var components = URLComponents(url: TeakSafariService.appBaseURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "card", value: card.id)]
        return components?.url
    }
}
