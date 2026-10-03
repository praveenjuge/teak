import Combine
import Foundation

@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var cards: [LibraryCard] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var hasMore = false
    @Published private(set) var error: String?
    @Published private(set) var mutatingIDs = Set<String>()
    @Published var searchText = ""
    @Published private(set) var selectedTypes = Set<LibraryCardType>()
    @Published private(set) var favoritesOnly = false

    private let api: LibraryAPI
    private let onAuthenticationRequired: () -> Void
    private var optimisticCards: [String: LibraryCard] = [:]
    private var deletedIDs = Set<String>()
    private var nextCursor: String?
    private var generation = 0
    private var mutationRevision = 0
    private var searchTask: Task<Void, Never>?

    init(api: LibraryAPI? = nil, onAuthenticationRequired: @escaping () -> Void) {
        self.api = api ?? LibraryAPI()
        self.onAuthenticationRequired = onAuthenticationRequired
    }

    var hasFilters: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !selectedTypes.isEmpty || favoritesOnly
    }

    func scheduleSearch() {
        generation += 1
        searchTask?.cancel()
        hasMore = false
        nextCursor = nil
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            await self?.loadFirstPage()
        }
    }

    func toggleType(_ type: LibraryCardType) {
        if selectedTypes.contains(type) {
            selectedTypes.remove(type)
        } else {
            selectedTypes.insert(type)
        }
        scheduleSearch()
    }

    func toggleFavorites() {
        favoritesOnly.toggle()
        scheduleSearch()
    }

    func clearFilters() {
        searchText = ""
        selectedTypes.removeAll()
        favoritesOnly = false
        scheduleSearch()
    }

    func loadFirstPage() async {
        generation += 1
        let currentGeneration = generation
        let currentRevision = mutationRevision
        isLoading = true
        error = nil
        do {
            let page = try await firstNonEmptyPage(
                query: searchText, types: selectedTypes,
                favoritesOnly: favoritesOnly, cursor: nil,
                currentGeneration: currentGeneration
            )
            guard currentGeneration == generation else { return }
            guard currentRevision == mutationRevision else {
                await loadFirstPage()
                return
            }
            cards = reconcile(page.items)
            hasMore = page.pageInfo.hasMore && page.pageInfo.nextCursor != nil
            nextCursor = hasMore ? page.pageInfo.nextCursor : nil
        } catch {
            guard currentGeneration == generation else { return }
            hasMore = false
            nextCursor = nil
            handle(error)
        }
        if currentGeneration == generation { isLoading = false }
    }

    func loadMore() async {
        guard hasMore, let nextCursor, !isLoading, !isLoadingMore else { return }
        let currentGeneration = generation
        let currentRevision = mutationRevision
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await firstNonEmptyPage(
                query: searchText, types: selectedTypes,
                favoritesOnly: favoritesOnly, cursor: nextCursor,
                currentGeneration: currentGeneration
            )
            guard currentGeneration == generation else { return }
            guard currentRevision == mutationRevision else { return }
            let known = Set(cards.map(\.id))
            cards.append(contentsOf: reconcile(page.items).filter { !known.contains($0.id) })
            hasMore = page.pageInfo.hasMore && page.pageInfo.nextCursor != nil
                && page.pageInfo.nextCursor != nextCursor
            self.nextCursor = hasMore ? page.pageInfo.nextCursor : nil
        } catch {
            guard currentGeneration == generation else { return }
            hasMore = false
            self.nextCursor = nil
            handle(error)
        }
    }

    func insertCreated(id: String) async {
        // Insert directly for the ordinary unfiltered library. When creation
        // leaves a filtered view, reset its query and pagination together.
        let hadFilters = hasFilters
        searchTask?.cancel()
        generation += 1
        if hadFilters {
            searchText = ""
            selectedTypes.removeAll()
            favoritesOnly = false
            nextCursor = nil
            hasMore = false
            await loadFirstPage()
        }
        isLoading = false
        let insertionGeneration = generation
        do {
            let card = try await api.card(id: id)
            guard insertionGeneration == generation else { return }
            cards.removeAll { $0.id == id }
            cards.insert(card, at: 0)
        } catch { handle(error) }
    }

    func setFavorite(_ card: LibraryCard) async throws -> LibraryCard {
        var optimistic = card
        optimistic.isFavorited.toggle()
        return try await mutate(card, optimistic: optimistic) {
            try await self.api.setFavorite(id: card.id, isFavorited: optimistic.isFavorited)
        }
    }

    func update(_ card: LibraryCard, title: String, content: String?, notes: String, tags: [String]) async throws -> LibraryCard {
        var optimistic = card
        let changedTitle = title != (card.metadataTitle ?? "") ? title : nil
        if let changedTitle { optimistic.metadataTitle = changedTitle.isEmpty ? nil : changedTitle }
        optimistic.content = content ?? card.content
        optimistic.notes = notes.isEmpty ? nil : notes
        optimistic.tags = tags
        return try await mutate(card, optimistic: optimistic) {
            try await self.api.update(id: card.id, metadataTitle: changedTitle, content: content, notes: notes, tags: tags)
        }
    }

    func delete(_ card: LibraryCard) async throws {
        _ = try await mutate(card, optimistic: nil) {
            try await self.api.delete(id: card.id)
            return card
        }
    }

    private func mutate(_ original: LibraryCard, optimistic: LibraryCard?,
                        operation: () async throws -> LibraryCard) async throws -> LibraryCard {
        guard !mutatingIDs.contains(original.id) else { throw SafariServiceError.message("This card is still saving.") }
        mutatingIDs.insert(original.id)
        mutationRevision += 1
        let mutationGeneration = generation
        let index = cards.firstIndex { $0.id == original.id } ?? 0
        if let optimistic { optimisticCards[original.id] = optimistic }
        else { deletedIDs.insert(original.id) }
        cards = reconcile(cards)
        defer {
            mutationRevision += 1
            mutatingIDs.remove(original.id)
            optimisticCards[original.id] = nil
            deletedIDs.remove(original.id)
        }
        do {
            let confirmed = try await operation()
            if optimistic != nil {
                optimisticCards[original.id] = confirmed
                cards.removeAll { $0.id == original.id }
                if matchesFilters(confirmed) { cards.insert(confirmed, at: min(index, cards.count)) }
            }
            if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                await loadFirstPage()
            }
            return confirmed
        } catch {
            optimisticCards[original.id] = nil
            deletedIDs.remove(original.id)
            mutationRevision += 1
            if generation != mutationGeneration || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                await loadFirstPage()
            } else {
                cards.removeAll { $0.id == original.id }
                if matchesFilters(original) { cards.insert(original, at: min(index, cards.count)) }
            }
            handle(error)
            throw error
        }
    }

    private func reconcile(_ items: [LibraryCard]) -> [LibraryCard] {
        items.compactMap { card in
            guard !deletedIDs.contains(card.id) else { return nil }
            let value = optimisticCards[card.id] ?? card
            return matchesFilters(value) ? value : nil
        }
    }

    private func matchesFilters(_ card: LibraryCard) -> Bool {
        (selectedTypes.isEmpty || card.cardType.map { selectedTypes.contains($0) } == true)
            && (!favoritesOnly || card.isFavorited)
    }

    private func firstNonEmptyPage(
        query: String, types: Set<LibraryCardType>, favoritesOnly: Bool,
        cursor: String?, currentGeneration: Int
    ) async throws -> LibraryPage {
        var currentCursor = cursor
        var page = try await api.list(
            query: query, types: types, favoritesOnly: favoritesOnly,
            cursor: currentCursor
        )
        guard currentGeneration == generation else { throw CancellationError() }
        var attempts = 1
        while attempts < 8 && page.items.isEmpty && page.pageInfo.hasMore {
            guard let nextCursor = page.pageInfo.nextCursor,
                  nextCursor != currentCursor else { break }
            currentCursor = nextCursor
            page = try await api.list(
                query: query, types: types, favoritesOnly: favoritesOnly,
                cursor: currentCursor
            )
            guard currentGeneration == generation else { throw CancellationError() }
            attempts += 1
        }
        return page
    }

    private func handle(_ failure: Error) {
        if case SafariServiceError.unauthenticated = failure {
            onAuthenticationRequired()
        } else {
            error = failure.localizedDescription
        }
    }
}
