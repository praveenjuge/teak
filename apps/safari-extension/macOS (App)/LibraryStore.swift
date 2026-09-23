import Combine
import Foundation

@MainActor
final class LibraryStore: ObservableObject {
    @Published private(set) var cards: [LibraryCard] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var hasMore = false
    @Published private(set) var error: String?
    @Published var searchText = ""
    @Published private(set) var selectedTypes = Set<LibraryCardType>()
    @Published private(set) var favoritesOnly = false

    private let api: LibraryAPI
    private let onAuthenticationRequired: () -> Void
    private var nextCursor: String?
    private var generation = 0
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
        isLoading = true
        error = nil
        do {
            let page = try await api.list(
                query: searchText, types: selectedTypes,
                favoritesOnly: favoritesOnly, cursor: nil
            )
            guard currentGeneration == generation else { return }
            cards = page.items
            hasMore = page.pageInfo.hasMore
            nextCursor = page.pageInfo.nextCursor
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
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await api.list(
                query: searchText, types: selectedTypes,
                favoritesOnly: favoritesOnly, cursor: nextCursor
            )
            guard currentGeneration == generation else { return }
            let known = Set(cards.map(\.id))
            cards.append(contentsOf: page.items.filter { !known.contains($0.id) })
            hasMore = page.pageInfo.hasMore && page.pageInfo.nextCursor != nextCursor
            self.nextCursor = hasMore ? page.pageInfo.nextCursor : nil
        } catch {
            guard currentGeneration == generation else { return }
            hasMore = false
            self.nextCursor = nil
            handle(error)
        }
    }

    private func handle(_ failure: Error) {
        if case SafariServiceError.unauthenticated = failure {
            onAuthenticationRequired()
        } else {
            error = failure.localizedDescription
        }
    }
}
