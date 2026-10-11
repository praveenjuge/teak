import Foundation
import Observation
import TeakCore
import TeakSync

/// One library view: what it's showing, the live pages, selection and the
/// card actions with optimistic updates that roll back on failure.
@MainActor @Observable
final class LibraryModel {
    let pager: CardPager

    var text = "" { didSet { scheduleSearch() } }
    var tokens: [SearchToken] = [] { didSet { reload() } }
    var filters = LibraryFilters.empty { didSet { reload() } }

    private(set) var selection: Set<String>?
    private(set) var isRunningBulkAction = false
    private(set) var status: StatusMessage?

    /// Favorite changes the server hasn't confirmed yet.
    private var favoriteOverrides: [String: Bool] = [:]
    /// Cards moved out of this view (trashed, restored, deleted) until the server drops them.
    private var hiddenIds: Set<String> = []
    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var debouncedText = ""
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var statusTask: Task<Void, Never>?

    init(backend: TeakBackend) {
        self.backend = backend
        pager = CardPager(backend: backend)
    }

    struct StatusMessage: Equatable, Identifiable {
        let id = UUID()
        let text: String
        let isError: Bool
        /// The Mac offers Upgrade… next to the Free-plan limit.
        let isCardLimit: Bool
    }

    // MARK: Query

    /// The query as the server sees it: the filter menu, tokens and text.
    var query: LibraryQuery {
        LibraryQuery(text: debouncedText, tokens: tokens, filters: filters)
    }

    var title: String {
        if let selection { return selection.isEmpty ? "Select Cards" : "\(selection.count) Selected" }
        return query.title
    }

    var isTrash: Bool { query.isTrash }

    var cards: [CardSummary] {
        pager.cards.compactMap { card in
            guard !hiddenIds.contains(card.id) else { return nil }
            guard let favorite = favoriteOverrides[card.id] else { return card }
            if query.effectiveFilters.favoritesOnly, !favorite { return nil }
            var updated = card
            updated.isFavorited = favorite
            return updated
        }
    }

    func start() {
        pager.load(query.searchArgs())
    }

    func reload() {
        favoriteOverrides = [:]
        hiddenIds = []
        pager.load(query.searchArgs())
    }

    /// Typing waits a quarter second before searching.
    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            debouncedText = text
            reload()
        }
    }

    /// Commits typed text as tokens (Return), like the Mac app.
    func commitText() {
        var next = tokens
        for token in SearchTokens.parse(text) where !next.contains(where: { $0.id == token.id }) {
            if token.kind == .date { next.removeAll { $0.kind == .date } }
            next.append(token)
        }
        text = ""
        debouncedText = ""
        tokens = next
    }

    /// Filters by one exact tag, from a card's tag.
    func filterByTag(_ tag: String) {
        var next = tokens.filter { $0.kind != .tag }
        next.append(SearchTokens.tag(tag))
        tokens = next
    }

    func filterByType(_ type: CardType) {
        filters = LibraryFilters(types: [type])
    }

    func clearFilters() {
        text = ""
        debouncedText = ""
        tokens = []
        filters = .empty
    }

    func refresh() async {
        favoriteOverrides = [:]
        hiddenIds = []
        await pager.refresh()
    }

    // MARK: Status

    func show(_ text: String, isError: Bool = false, isCardLimit: Bool = false) {
        statusTask?.cancel()
        let message = StatusMessage(text: text, isError: isError, isCardLimit: isCardLimit)
        status = message
        statusTask = Task {
            try? await Task.sleep(for: .seconds(isError ? 5 : 3))
            if status?.id == message.id { status = nil }
        }
    }

    func show(_ error: any Error) {
        let teak = error as? TeakError
        show(error.teakMessage, isError: true, isCardLimit: teak?.isCardLimit == true)
        SentryReporting.capture(error)
    }

    // MARK: Card actions

    func setFavorite(_ card: CardSummary, _ favorite: Bool) async -> Bool {
        favoriteOverrides[card.id] = favorite
        do {
            let _: ConvexVoid = try await backend.mutation("cards:updateCardField", [
                "cardId": .string(card.id), "field": "isFavorited", "value": .bool(favorite),
            ])
            return true
        } catch {
            favoriteOverrides[card.id] = card.favorited
            show(error)
            return false
        }
    }

    func moveToTrash(_ id: String) async -> Bool {
        await hide(id, success: "Card deleted. Find it in Trash.") {
            let _: ConvexVoid = try await self.backend.mutation("cards:updateCardField",
                                                                ["cardId": .string(id), "field": "delete"])
        }
    }

    func restore(_ id: String) async -> Bool {
        await hide(id, success: "Card restored") {
            let _: ConvexVoid = try await self.backend.mutation("cards:updateCardField",
                                                                ["cardId": .string(id), "field": "restore"])
        }
    }

    func deleteForever(_ id: String) async -> Bool {
        await hide(id, success: "Card deleted forever") {
            let _: ConvexVoid = try await self.backend.mutation("cards:permanentDeleteCard", ["id": .string(id)])
        }
    }

    private func hide(_ id: String, success: String, _ operation: () async throws -> Void) async -> Bool {
        hiddenIds.insert(id)
        do {
            try await operation()
            show(success)
            return true
        } catch {
            hiddenIds.remove(id)
            show(error)
            return false
        }
    }

    // MARK: Selection

    var isSelecting: Bool { selection != nil }

    func beginSelection(with id: String? = nil) {
        selection = id.map { [$0] } ?? []
    }

    func toggleSelection(_ id: String) {
        var next = selection ?? []
        if next.contains(id) { next.remove(id) } else { next.insert(id) }
        selection = next
    }

    func selectAll() {
        selection = Set(cards.map(\.id))
    }

    func endSelection() {
        selection = nil
    }

    var selectedCards: [CardSummary] {
        guard let selection else { return [] }
        return cards.filter { selection.contains($0.id) }
    }

    enum BulkAction {
        case favorite, unfavorite, trash, restore, deleteForever

        var verb: String {
            switch self {
            case .favorite: "Favorited"
            case .unfavorite: "Unfavorited"
            case .trash: "Moved to Trash:"
            case .restore: "Restored"
            case .deleteForever: "Deleted forever:"
            }
        }
    }

    /// Runs one mutation per selected card, like the iPhone app, then reports any that failed.
    func run(_ action: BulkAction) async {
        let chosen = selectedCards
        guard !chosen.isEmpty, !isRunningBulkAction else { return }
        isRunningBulkAction = true
        defer { isRunningBulkAction = false }
        var failed = 0
        for card in chosen {
            let id = card.id
            do {
                switch action {
                case .favorite, .unfavorite:
                    let favorite = action == .favorite
                    favoriteOverrides[id] = favorite
                    let _: ConvexVoid = try await backend.mutation("cards:updateCardField", [
                        "cardId": .string(id), "field": "isFavorited", "value": .bool(favorite),
                    ])
                case .trash, .restore:
                    hiddenIds.insert(id)
                    let _: ConvexVoid = try await backend.mutation("cards:updateCardField", [
                        "cardId": .string(id), "field": action == .trash ? "delete" : "restore",
                    ])
                case .deleteForever:
                    hiddenIds.insert(id)
                    let _: ConvexVoid = try await backend.mutation("cards:permanentDeleteCard", ["id": .string(id)])
                }
            } catch {
                failed += 1
                favoriteOverrides[id] = nil
                hiddenIds.remove(id)
            }
        }
        endSelection()
        let done = chosen.count - failed
        let noun = done == 1 ? "1 card" : "\(done) cards"
        if failed > 0 {
            show("\(failed) of \(chosen.count) didn't change. Please try again.", isError: true)
        } else {
            show("\(action.verb) \(noun)")
        }
    }
}
