import Foundation
import Observation
import TeakCore
import TeakSync

@MainActor @Observable
final class LibraryModel {
    let pager: CardPager

    var text = "" {
        didSet {
            if !text.isEmpty { typedText = text }
            scheduleSearch()
        }
    }
    var tokens: [SearchToken] = [] {
        didSet {
            // A picked hint (`-tag:`, `OR`) writes into the text instead of staying a token.
            if let hint = tokens.first(where: { $0.kind == .hint }) {
                tokens.removeAll { $0.kind == .hint }
                applyHint(hint)
                if tokens == oldValue { return }
            }
            // A tag or "Similar to" shows other cards, so a selection made here ends, as it does for filters.
            if tokens != oldValue { selection = nil }
            reload()
        }
    }
    var filters = LibraryFilters.empty {
        didSet {
            // Another view's cards: a selection made here would act on cards no longer shown.
            if filters != oldValue { selection = nil }
            reload()
        }
    }
    var sort = LibrarySort.newest { didSet { reload() } }

    private(set) var selection: Set<String>?
    private(set) var isRunningBulkAction = false
    private(set) var isEmptyingTrash = false
    /// Every card in Trash, from `cards:trashCount`, while this view is Trash.
    private(set) var trashCount: TrashCount?
    private(set) var status: StatusMessage?
    /// The last answer from search by meaning, for the empty state.
    private(set) var semanticOutcome: String?
    /// Whether an empty view is empty because its cards are hidden.
    private(set) var hasHiddenCards = false

    private var favoriteOverrides: [String: Bool] = [:]
    private var hiddenIds: Set<String> = []
    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var debouncedText = ""
    /// The text as last typed, which picking a suggestion may clear.
    @ObservationIgnored private var typedText = ""
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var statusTask: Task<Void, Never>?
    @ObservationIgnored private var semanticTask: Task<Void, Never>?
    @ObservationIgnored private var hiddenTask: Task<Void, Never>?

    init(backend: TeakBackend, spotlight: SpotlightIndexer) {
        self.backend = backend
        pager = CardPager(backend: backend)
        pager.onLoad = { [weak self, spotlight] cards, left in
            guard let self else { return }
            // Once the server agrees, live data wins, so a change made elsewhere shows.
            for card in cards where favoriteOverrides[card.id] == card.favorited {
                favoriteOverrides[card.id] = nil
            }
            // A card that left (unfavorited out of Favorites) shows again if it comes back favorited.
            for id in left { favoriteOverrides[id] = nil }
            spotlight.apply(CardIndex.changes(cards, left: left, in: query))
        }
    }

    struct StatusMessage: Equatable, Identifiable {
        let id = UUID()
        let text: String
        let isError: Bool
        let isCardLimit: Bool
        var undo: (@MainActor () -> Void)?

        static func == (lhs: StatusMessage, rhs: StatusMessage) -> Bool { lhs.id == rhs.id }
    }

    var query: LibraryQuery {
        LibraryQuery(text: debouncedText, tokens: tokens, filters: filters, sort: sort)
    }

    var title: String {
        if let selection {
            return selection.isEmpty ? tr("native.library.selectCards") : tr("native.library.selectedCount", count: selection.count)
        }
        return query.title
    }

    var isTrash: Bool { query.isTrash }
    var isArchive: Bool { query.isArchive }

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
        hasHiddenCards = false
        pager.load(query.searchArgs())
        requestSemanticResults()
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            debouncedText = text
            reload()
        }
    }

    /// Asks the backend to rank cards by meaning, 300 ms after the search
    /// settles. The paged search reads those results when they're ready; a
    /// failure leaves the keyword results as they are.
    private func requestSemanticResults() {
        semanticTask?.cancel()
        semanticOutcome = nil
        guard let args = query.semanticArgs() else { return }
        semanticTask = Task { [backend] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let result = try? await backend.action(ConvexFunctions.requestSemanticResults, args)
            guard !Task.isCancelled else { return }
            semanticOutcome = result?.outcome
        }
    }

    /// Asks once whether an empty view holds only hidden cards.
    func checkHiddenCards() {
        hiddenTask?.cancel()
        let query = query
        guard !query.hasSearch else { return hasHiddenCards = false }
        var args: ConvexArgs = [:]
        if let folder = query.filters.folder {
            args["folderId"] = .string(folder.id)
        } else if query.filters.types.isEmpty, query.filters.hue == nil {
            args["view"] = query.isTrash ? "trash" : query.filters.archivedOnly ? "archive"
                : query.filters.favoritesOnly ? "favorites" : "all"
        } else {
            return hasHiddenCards = false
        }
        hiddenTask = Task { [backend] in
            let hidden = (try? await backend.query(ConvexFunctions.viewHasHiddenCards, args)) ?? false
            guard !Task.isCancelled else { return }
            hasHiddenCards = hidden
        }
    }

    /// Puts a picked hint in place of the word being typed. The search field
    /// may clear its text as it takes a token, so this works from the text as
    /// last typed and writes it on the next turn, after the field's own change.
    private func applyHint(_ hint: SearchToken) {
        let next = SearchTokens.applying(hint, to: text.isEmpty ? typedText : text)
        Task { @MainActor [weak self] in self?.text = next }
    }

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

    func filterByTag(_ tag: String) {
        var next = tokens.filter { $0.kind != .tag }
        next.append(SearchTokens.tag(tag))
        tokens = next
    }

    func filterByType(_ type: CardType) {
        filters = LibraryFilters(types: [type])
    }

    func open(_ folder: Folder?) {
        text = ""
        debouncedText = ""
        tokens = []
        filters = LibraryFilters(folder: folder.map(FolderScope.init))
    }

    func showArchive() {
        tokens = []
        filters = LibraryFilters(archivedOnly: true)
    }

    /// "More like this": every card like this one, with filters cleared.
    func moreLike(_ id: String, title: String?) {
        text = ""
        debouncedText = ""
        sort = .newest
        filters = .empty
        tokens = [SearchTokens.like(cardId: id, title: title)]
    }

    func clearFilters() {
        text = ""
        debouncedText = ""
        tokens = []
        filters = .empty
    }

    /// A fresh order each time, never the one just shown.
    func shuffle() {
        let previous: Int? = if case let .shuffle(seed) = sort { seed } else { nil }
        sort = .shuffle(seed: ShuffleSeed.next(after: previous))
    }

    func refresh() async {
        // The old cards stay until the fresh ones arrive, with the changes made to them.
        await pager.refresh()
        guard !pager.isStale, !Task.isCancelled else { return }
        favoriteOverrides = [:]
        hiddenIds = []
    }

    func show(_ text: String, isError: Bool = false, isCardLimit: Bool = false, undo: (@MainActor () -> Void)? = nil) {
        statusTask?.cancel()
        let message = StatusMessage(text: text, isError: isError, isCardLimit: isCardLimit, undo: undo)
        status = message
        statusTask = Task {
            // An Undo stays 10 seconds, as on the web.
            try? await Task.sleep(for: .seconds(isError ? 5 : undo == nil ? 3 : 10))
            if status?.id == message.id { status = nil }
        }
    }

    func show(_ error: any Error) {
        let teak = error as? TeakError
        show(error.teakMessage, isError: true, isCardLimit: teak?.isCardLimit == true)
        PostHogReporting.capture(error)
    }

    func dismissStatus() {
        status = nil
    }

    func setFavorite(_ card: CardSummary, _ favorite: Bool) async -> Bool {
        favoriteOverrides[card.id] = favorite
        do {
            let _: ConvexVoid = try await backend.mutation(ConvexFunctions.updateCardField, [
                "cardId": .string(card.id), "field": "isFavorited", "value": .bool(favorite),
            ])
            return true
        } catch {
            favoriteOverrides[card.id] = card.favorited
            show(error)
            return false
        }
    }

    /// Moves one card to Trash with Undo, as the web's card view does, so it asks nothing first.
    @discardableResult
    func moveToTrash(_ id: String) async -> Bool {
        hiddenIds.insert(id)
        do {
            try await write(.moveToTrash, id)
            showTrashed(id)
            return true
        } catch {
            hiddenIds.remove(id)
            show(error)
            return false
        }
    }

    /// "Card moved to Trash" with Undo, which puts the card back where it was.
    func showTrashed(_ id: String) {
        show(tr("native.library.toast.trashed")) { [weak self] in
            Task { await self?.undoTrash(id) }
        }
    }

    private func undoTrash(_ id: String) async {
        dismissStatus()
        do {
            try await write(.restore, id)
            hiddenIds.remove(id)
        } catch {
            show(tr("native.card.failed.restore"), isError: true)
        }
    }

    func restore(_ id: String) async -> Bool {
        await hide(id, success: tr("native.library.toast.restored")) {
            try await self.write(.restore, id)
        }
    }

    private func write(_ change: CardFieldChange, _ id: String) async throws {
        let _: ConvexVoid = try await backend.mutation(ConvexFunctions.updateCardField, change.args(cardId: id))
    }

    /// Follows `cards:trashCount` while this view is Trash; the view runs it in a task keyed by `isTrash`.
    func followTrashCount() async {
        trashCount = nil
        guard isTrash else { return }
        do {
            for try await value in backend.subscribe(ConvexFunctions.trashCount) { trashCount = value }
        } catch {}
    }

    /// Whether Trash has cards to empty, hidden ones included; the shown cards stand in until the count arrives.
    var canEmptyTrash: Bool { isTrash && !isEmptyingTrash && (trashCount.map { $0.count > 0 } ?? !cards.isEmpty) }

    var emptyTrashMessage: String { EmptyTrash.message(count: trashCount.map { Int($0.count) } ?? cards.count, more: trashCount?.more ?? false) }

    /// Deletes every card in Trash forever. The server deletes them in pages, and the view follows live.
    func emptyTrash() async {
        guard canEmptyTrash else { return }
        isEmptyingTrash = true
        defer { isEmptyingTrash = false }
        let shown = cards.map(\.id)
        do {
            let result = try await backend.mutation(ConvexFunctions.emptyTrash)
            hiddenIds.formUnion(shown)
            show(EmptyTrash.done(result))
        } catch {
            show(EmptyTrash.failure(error), isError: true)
        }
    }

    func deleteForever(_ id: String) async -> Bool {
        await hide(id, success: tr("native.library.toast.deletedForever")) {
            let _: ConvexVoid = try await self.backend.mutation(ConvexFunctions.permanentDeleteCard, ["id": .string(id)])
        }
    }

    /// Archives or returns one card, with Undo, as the web does.
    @discardableResult
    func setArchived(_ id: String, _ archived: Bool) async -> Bool {
        let action: BulkCardAction = archived ? .archive : .unarchive
        let leavesView = archived != isArchive
        if leavesView { hiddenIds.insert(id) }
        do {
            try await updateArchive(id, archived)
            show(action.done(1)) { [weak self] in
                Task { await self?.undoArchive(id, archived) }
            }
            return true
        } catch {
            hiddenIds.remove(id)
            show(error)
            return false
        }
    }

    private func undoArchive(_ id: String, _ archived: Bool) async {
        dismissStatus()
        do {
            try await updateArchive(id, !archived)
            hiddenIds.remove(id)
        } catch {
            show(error)
        }
    }

    func updateArchive(_ id: String, _ archived: Bool) async throws {
        let _: ConvexVoid = try await backend.mutation(ConvexFunctions.updateCardField,
                                                       ["cardId": .string(id), "field": archived ? "archive" : "unarchive"])
    }

    /// Reruns a card's processing and says how it went.
    func refreshDetails(_ id: String) async {
        do {
            let result = try await backend.mutation(ConvexFunctions.reprocessCard, ["cardId": .string(id)])
            if result.isQueued {
                show(tr("native.card.notice.refreshing"))
            } else {
                show(result.message ?? tr("native.card.failed.refresh"), isError: true)
            }
        } catch {
            show(tr("native.card.failed.refresh"), isError: true)
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

    /// Whether a bulk action takes the cards out of this view.
    private func leavesView(_ action: BulkCardAction) -> Bool {
        switch action {
        case .archive: !isArchive
        case .unarchive: isArchive
        case .delete, .restore: true
        case .unfavorite: query.effectiveFilters.favoritesOnly
        default: false
        }
    }

    /// Changes the selected cards through `cards:bulkUpdateCards`, 100 at a
    /// time, then says what changed, with Undo where there's an opposite.
    func run(_ action: BulkCardAction, tags: [String] = [], folder: Folder? = nil) async {
        let ids = selectedCards.map(\.id)
        guard !ids.isEmpty, !isRunningBulkAction else { return }
        isRunningBulkAction = true
        defer { isRunningBulkAction = false }
        let (updated, failed) = await apply(action, ids: ids, tags: tags, folder: folder)
        endSelection()
        let message = action.message(updated: updated.count, failed: failed.count, folder: folder?.name)
        if updated.isEmpty {
            show(message, isError: true)
        } else if let undo = action.undo {
            show(message, isError: !failed.isEmpty) { [weak self] in
                Task { await self?.undoBulk(undo, ids: updated) }
            }
        } else {
            show(message, isError: !failed.isEmpty)
        }
    }

    private func undoBulk(_ action: BulkCardAction, ids: [String]) async {
        dismissStatus()
        let (_, failed) = await apply(action, ids: ids)
        if !failed.isEmpty { show(action.failure, isError: true) }
        hiddenIds.subtract(ids)
        for id in ids { favoriteOverrides[id] = nil }
    }

    private func apply(_ action: BulkCardAction, ids: [String], tags: [String] = [],
                       folder: Folder? = nil) async -> (updated: [String], failed: [String]) {
        let leaves = leavesView(action)
        if leaves { hiddenIds.formUnion(ids) }
        if action == .favorite || action == .unfavorite {
            for id in ids { favoriteOverrides[id] = action == .favorite }
        }
        var updated: [String] = []
        var failed: [String] = []
        for chunk in BulkCardAction.chunks(ids) {
            var args: ConvexArgs = ["cardIds": .array(chunk.map(ConvexValue.string)), "action": .string(action.rawValue)]
            if !tags.isEmpty { args["tags"] = .array(tags.map(ConvexValue.string)) }
            if let folder { args["folderId"] = .string(folder.id) }
            do {
                let result = try await backend.mutation(ConvexFunctions.bulkUpdateCards, args)
                updated += result.updatedIds
                failed += result.failedIds
            } catch {
                failed += chunk
            }
        }
        for id in failed {
            hiddenIds.remove(id)
            favoriteOverrides[id] = nil
        }
        return (updated, failed)
    }

    /// Permanent deletion has no bulk action, so it goes card by card.
    func deleteSelectedForever() async {
        let chosen = selectedCards
        guard !chosen.isEmpty, !isRunningBulkAction else { return }
        isRunningBulkAction = true
        defer { isRunningBulkAction = false }
        var failed = 0
        for card in chosen {
            hiddenIds.insert(card.id)
            do {
                let _: ConvexVoid = try await backend.mutation(ConvexFunctions.permanentDeleteCard, ["id": .string(card.id)])
            } catch {
                failed += 1
                hiddenIds.remove(card.id)
            }
        }
        endSelection()
        let done = chosen.count - failed
        if done == 0 {
            show(tr("native.bulk.failed.deleteForever"), isError: true)
        } else {
            show(BulkCardAction.partial(tr("native.bulk.done.deleteForever", count: done), failed: failed), isError: failed > 0)
        }
    }
}
