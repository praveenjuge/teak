import Foundation
import Observation
import TeakCore
import TeakSync

/// Infinite scroll over `ConvexFunctions.searchCardSummaries`, like Convex's
/// `usePaginatedQuery`: each page is its own live subscription keyed by its
/// cursors. Convex pins a page's end across updates, so new cards grow a page
/// instead of shifting the next one; a page that grows too big is split.
@MainActor @Observable
final class CardPager {
    static let pageSize = 20

    private final class Slot {
        let cursor: String?
        let endCursor: String?
        var task: Task<Void, Never>?
        var page: CardSummaryPage?
        var error: (any Error)?

        init(cursor: String?, endCursor: String? = nil) {
            self.cursor = cursor
            self.endCursor = endCursor
        }
    }

    private(set) var cards: [CardSummary] = []
    private(set) var isLoading = true
    private(set) var isLoadingMore = false
    private(set) var isDone = false
    private(set) var error: (any Error)?
    /// The cards shown are from before a refresh whose first page failed.
    private(set) var isStale = false
    /// Hears every load where every page has arrived: the cards, and the ids
    /// that dropped out since the last such load of the same search.
    @ObservationIgnored var onLoad: (@MainActor (_ cards: [CardSummary], _ left: [String]) -> Void)?

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var slots: [Slot] = []
    @ObservationIgnored private var args: ConvexArgs = [:]
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var loadedIds: (generation: Int, ids: Set<String>)?
    /// A refresh shows the cards it had until its first page arrives, and keeps them if that fails.
    @ObservationIgnored private var kept: [CardSummary]?

    init(backend: TeakBackend) {
        self.backend = backend
    }

    func load(_ args: ConvexArgs, force: Bool = false) {
        guard force || args != self.args || slots.isEmpty else { return }
        self.args = args
        restart()
    }

    func refresh() async {
        restart(keepingCards: true)
        let generation = generation
        while !Task.isCancelled, generation == self.generation, let first = slots.first, first.page == nil, first.error == nil {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    func loadMore() {
        guard let page = slots.last?.page, !page.isDone, let cursor = page.continueCursor else { return }
        subscribe(Slot(cursor: cursor))
    }

    /// Loads a failed page again: everything when the first page failed, else that page.
    func retry() {
        guard let index = slots.firstIndex(where: { $0.error != nil }) else { return }
        guard index > 0 else { return restart(keepingCards: !cards.isEmpty) }
        let failed = slots.remove(at: index)
        subscribe(Slot(cursor: failed.cursor, endCursor: failed.endCursor), at: index)
    }

    func stop() {
        slots.forEach { $0.task?.cancel() }
        slots.removeAll()
    }

    private func restart(keepingCards: Bool = false) {
        generation += 1
        kept = keepingCards && !cards.isEmpty ? cards : nil
        stop()
        subscribe(Slot(cursor: nil))
    }

    private func subscribe(_ slot: Slot, at index: Int? = nil) {
        if let index { slots.insert(slot, at: index) } else { slots.append(slot) }
        publish()
        var options: ConvexArgs = ["numItems": .number(Self.pageSize), "cursor": slot.cursor.map(ConvexValue.string) ?? .null]
        if let end = slot.endCursor { options["endCursor"] = .string(end) }
        var query = args
        query["paginationOpts"] = .object(options)
        let generation = generation
        slot.task = Task { [weak self, backend] in
            do {
                for try await page in backend.subscribe(ConvexFunctions.searchCardSummaries, query) {
                    guard let self, generation == self.generation else { return }
                    slot.page = page.page
                    slot.error = nil
                    self.splitIfNeeded(slot, splitCursor: page.splitCursor, pageStatus: page.pageStatus)
                    self.publish()
                }
            } catch is CancellationError {
            } catch {
                guard let self, generation == self.generation else { return }
                if (error as? TeakError)?.isInvalidCursor == true {
                    self.restart()
                    return
                }
                slot.error = error
                self.publish()
            }
        }
    }

    private func splitIfNeeded(_ slot: Slot, splitCursor: String?, pageStatus: String?) {
        guard let splitCursor, let page = slot.page,
              pageStatus == "SplitRecommended" || pageStatus == "SplitRequired" || page.page.count > Self.pageSize * 2,
              let index = slots.firstIndex(where: { $0 === slot })
        else { return }
        slot.task?.cancel()
        slots.remove(at: index)
        subscribe(Slot(cursor: slot.cursor, endCursor: splitCursor), at: index)
        subscribe(Slot(cursor: splitCursor, endCursor: page.continueCursor), at: index + 1)
    }

    private func publish() {
        if let kept, let first = slots.first, first.page == nil {
            guard let failure = first.error else { return }
            cards = kept
            isLoading = false
            isLoadingMore = false
            isStale = true
            error = failure
            return
        }
        kept = nil
        isStale = false
        var seen = Set<String>()
        var merged: [CardSummary] = []
        for slot in slots {
            guard let page = slot.page else { break }
            for card in page.page where seen.insert(card.id).inserted { merged.append(card) }
        }
        cards = merged
        let first = slots.first
        isLoading = first != nil && first?.page == nil && first?.error == nil
        isLoadingMore = slots.count > 1 && slots.last?.page == nil && slots.last?.error == nil
        isDone = slots.last?.page?.isDone == true
        error = slots.lazy.compactMap(\.error).first
        // While a page loads or splits, the cards after it aren't listed yet.
        guard !slots.isEmpty, slots.allSatisfy({ $0.page != nil }) else { return }
        let ids = Set(merged.map(\.id))
        let left = loadedIds?.generation == generation ? loadedIds?.ids.subtracting(ids) ?? [] : []
        loadedIds = (generation, ids)
        onLoad?(merged, Array(left))
    }
}
