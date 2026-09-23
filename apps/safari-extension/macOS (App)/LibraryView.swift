import AppKit
import SwiftUI

struct LibraryView: View {
    let onSettings: () -> Void
    let onAuthenticationRequired: () -> Void

    @StateObject private var store: LibraryStore
    @FocusState private var searchFocused: Bool
    @State private var selectedCard: LibraryCard?
    @State private var pendingCard: LibraryCard?
    @State private var showingSaveLink = false
    @State private var paginationFooterVisible = false

    init(onSettings: @escaping () -> Void, onAuthenticationRequired: @escaping () -> Void) {
        self.onSettings = onSettings
        self.onAuthenticationRequired = onAuthenticationRequired
        _store = StateObject(wrappedValue: LibraryStore(onAuthenticationRequired: onAuthenticationRequired))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if store.isLoading && store.cards.isEmpty {
                ProgressView("Loading your library…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.cards.isEmpty {
                ContentUnavailableView(
                    store.hasFilters ? "No matching cards" : "Your library is empty",
                    systemImage: store.hasFilters ? "magnifyingglass" : "square.grid.2x2",
                    description: Text(store.hasFilters ? "Try another search or clear your filters." : "Save a page from Safari or add a link here.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                masonry
            }
            if let error = store.error {
                HStack {
                    Text(error).lineLimit(2)
                    Spacer()
                    Button("Retry") { Task { await store.loadFirstPage() } }
                }
                .font(.caption)
                .padding(10)
                .background(.red.opacity(0.08))
            }
        }
        .frame(minWidth: 650, minHeight: 480)
        .sheet(item: $selectedCard) { card in
            LibraryCardDetail(initialCard: card, onAuthenticationRequired: onAuthenticationRequired)
        }
        .sheet(isPresented: $showingSaveLink, onDismiss: {
            selectedCard = pendingCard
            pendingCard = nil
        }) {
            SaveLinkSheet(onComplete: handleSave, onAuthenticationRequired: onAuthenticationRequired)
        }
        .task { await store.loadFirstPage() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search for anything…", text: $store.searchText)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .focused($searchFocused)
                    .onChange(of: store.searchText) { _, _ in store.scheduleSearch() }
                    .accessibilityLabel("Search cards")
                Button("Save Link", systemImage: "plus") { showingSaveLink = true }
                Button(action: onSettings) {
                    Image(systemName: "gearshape")
                }
                .help("Settings")
                .accessibilityLabel("Settings")
            }
            .padding(.vertical, 9)

            if searchFocused || store.hasFilters {
                if store.hasFilters {
                    HStack(spacing: 7) {
                        ScrollView(.horizontal) {
                            HStack(spacing: 7) {
                                ForEach(LibraryCardType.allCases.filter { store.selectedTypes.contains($0) }) { type in
                                    Button { store.toggleType(type) } label: {
                                        Label(type.title, systemImage: type.symbol)
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .accessibilityLabel("Remove \(type.title) filter")
                                }
                                if store.favoritesOnly {
                                    Button { store.toggleFavorites() } label: {
                                        Label("Favorites", systemImage: "heart")
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .accessibilityLabel("Remove Favorites filter")
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                        Button("Clear All") { store.clearFilters() }
                            .buttonStyle(.borderless)
                    }
                }
                ScrollView(.horizontal) {
                    HStack(spacing: 7) {
                        ForEach(LibraryCardType.allCases.filter { !store.selectedTypes.contains($0) }) { type in
                            Button {
                                store.toggleType(type)
                            } label: {
                                Label(type.title, systemImage: type.symbol)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("Filter \(type.title) cards")
                        }
                        if !store.favoritesOnly {
                            Button {
                                store.toggleFavorites()
                            } label: {
                                Label("Favorites", systemImage: "heart")
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("Filter favorite cards")
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .padding(.bottom, 7)
            }
        }
        .padding(.horizontal, 20)
    }

    private var masonry: some View {
        GeometryReader { geometry in
            let columnCount = max(1, min(5, Int((geometry.size.width - 40 + 16) / 266)))
            let layout = distribute(store.cards, across: columnCount)
            ScrollView {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(0..<columnCount, id: \.self) { index in
                        LazyVStack(spacing: 16) {
                            ForEach(layout.columns[index]) { card in
                                Button { selectedCard = card } label: {
                                    LibraryCardTile(card: card)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Open \(card.cardType?.title ?? "card") card: \(card.title)")
                            }
                            if index == layout.footerColumn && store.hasMore {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                                    .padding(16)
                                    .onAppear {
                                        paginationFooterVisible = true
                                        Task { await store.loadMore() }
                                    }
                                    .onDisappear { paginationFooterVisible = false }
                                    .onChange(of: store.isLoadingMore) { _, loading in
                                        guard !loading, paginationFooterVisible, store.hasMore else { return }
                                        Task {
                                            try? await Task.sleep(for: .milliseconds(100))
                                            if paginationFooterVisible { await store.loadMore() }
                                        }
                                    }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                }
                .padding(20)
            }
        }
    }

    private func distribute(_ cards: [LibraryCard], across count: Int) -> (columns: [[LibraryCard]], footerColumn: Int) {
        var columns = Array(repeating: [LibraryCard](), count: count)
        var heights = Array(repeating: Double.zero, count: count)
        for card in cards {
            let shortest = heights.enumerated().min { $0.element < $1.element }?.offset ?? 0
            columns[shortest].append(card)
            let textLength = Double((card.aiSummary ?? card.metadataDescription ?? card.content ?? "").count)
            let imageHeight: Double = card.displayImageURL == nil ? 0 : 150
            let paletteHeight: Double = card.cardType == .palette ? 118 : 0
            heights[shortest] += 100 + imageHeight + paletteHeight + min(110, textLength * 0.17)
        }
        let footerColumn = heights.enumerated().max { $0.element < $1.element }?.offset ?? 0
        return (columns, footerColumn)
    }

    private func handleSave(_ result: LibrarySaveResult) {
        Task {
            switch result {
            case .saved:
                showingSaveLink = false
                store.clearFilters()
            case let .duplicate(id):
                do { pendingCard = try await LibraryAPI().card(id: id) }
                catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
                catch { await store.loadFirstPage() }
                showingSaveLink = false
            }
        }
    }
}

private struct SaveLinkSheet: View {
    let onComplete: (LibrarySaveResult) -> Void
    let onAuthenticationRequired: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Save a link").font(.title3.weight(.semibold))
            TextField("https://example.com", text: $url)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await save() } }
                .accessibilityLabel("Link URL")
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving || url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 430)
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do { onComplete(try await LibraryAPI().saveLink(url)) }
        catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
        catch { self.error = error.localizedDescription }
    }
}
