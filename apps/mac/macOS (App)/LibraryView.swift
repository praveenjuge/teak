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
    @State private var recording = false
    @State private var dropping = false
    @State private var uploadError: String?
    @State private var uploading = false
    @State private var refreshing = false
    @State private var paginationVisible = false
    @State private var pendingUploads: [PendingLibraryUpload] = []
    @State private var uploadAPI = LibraryAPI()

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
        .onDrop(of: [UTType.fileURL.identifier], isTargeted: $dropping, perform: acceptDrop)
        .overlay {
            if dropping { GroupBox { Label("Drop files to upload", systemImage: "square.and.arrow.up") }.allowsHitTesting(false) }
        }
        .overlay(alignment: .bottom) {
            statusOverlay.padding(.bottom, 20).allowsHitTesting(false)
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
        NSApp.keyWindow?.title == "Teak Library" && selectedCard == nil && tagsCard == nil && !recording && !noteDraft.expanded
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
            VStack {
                Image(nsImage: NSImage(named: NSImage.applicationIconName) ?? NSImage())
                composer
                Text("Let's add your first card!")
                Text("Start capturing your thoughts, links, and media above").foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else { masonry }
    }

    private var loadingGrid: some View {
        GeometryReader { geometry in
            ScrollView {
                LibraryMasonryLayout(columns: columnCount(for: geometry.size.width)) {
                    ForEach(0..<10) { index in
                        GroupBox {
                            VStack(alignment: .leading) {
                                Rectangle().fill(.quaternary)
                                    .aspectRatio(index.isMultiple(of: 3) ? 1 : 4 / 3, contentMode: .fit)
                                Text("A saved thought or inspiration").lineLimit(1)
                                Text("Ready to rediscover").font(.caption)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.redacted(reason: .placeholder)
                    }
                }.padding()
            }.allowsHitTesting(false).accessibilityLabel("Loading cards")
        }
    }

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
                LibraryMasonryLayout(columns: count) {
                    if !store.trashOnly { composer }
                    ForEach(store.cards) { card in
                        LibraryCardTile(card: card, isSaving: store.mutatingIDs.contains(card.id), onOpen: { selectedCard = card })
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
            Button("Restore") { Task { try? await store.restore(card) } }
            Divider()
            Button("Delete Forever", role: .destructive) { Task { try? await store.permanentDelete(card) } }
        } else {
            if card.cardType == .text || card.cardType == .link || (card.cardType == .image && card.mimeType != "image/svg+xml") {
                Button(card.cardType == .image ? "Copy Image" : card.cardType == .link ? "Copy Link" : "Copy Text") { Task { await copy(card) } }
            }
            Button("Add Tags") { tagsCard = card }
            Button(card.isFavorited ? "Unfavorite" : "Favorite") { Task { _ = try? await store.setFavorite(card) } }
            Divider()
            Button("Delete", role: .destructive) { Task { try? await store.delete(card) } }
        }
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
            catch { uploadError = error.localizedDescription; return }
        }
    }

    private func handleCreated(_ id: String) { Task { await store.insertCreated(id: id) } }
}

private struct PendingLibraryUpload {
    let url: URL
    let key = UUID().uuidString
}
