import Foundation
import Observation
import TeakCore
import TeakSync

/// Infinite scroll over `searchMobileCardSummariesPaginated`, like Convex's
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

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var slots: [Slot] = []
    @ObservationIgnored private var args: ConvexArgs = [:]
    @ObservationIgnored private var generation = 0

    init(backend: TeakBackend) {
        self.backend = backend
    }

    /// Starts over for new search arguments. Same arguments keep the pages.
    func load(_ args: ConvexArgs, force: Bool = false) {
        guard force || args != self.args || slots.isEmpty else { return }
        self.args = args
        restart()
    }

    /// Pull to refresh: subscribe again from the top and wait for the first page.
    func refresh() async {
        restart()
        let generation = generation
        while generation == self.generation, isLoading { try? await Task.sleep(for: .milliseconds(50)) }
    }

    /// Loads the next page once the last one has arrived.
    func loadMore() {
        guard let page = slots.last?.page, !page.isDone, let cursor = page.continueCursor else { return }
        subscribe(Slot(cursor: cursor))
    }

    func stop() {
        slots.forEach { $0.task?.cancel() }
        slots.removeAll()
    }

    private func restart() {
        generation += 1
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
                for try await page in backend.subscribe("cards:searchMobileCardSummariesPaginated", query,
                                                        as: PageResult.self) {
                    guard let self, generation == self.generation else { return }
                    slot.page = page.page
                    slot.error = nil
                    self.splitIfNeeded(slot, splitCursor: page.splitCursor, pageStatus: page.pageStatus)
                    self.publish()
                }
            } catch is CancellationError {
            } catch {
                guard let self, generation == self.generation else { return }
                if "\(error)".contains("InvalidCursor") {
                    // The paginated query changed underneath us: start over.
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
    }
}

/// The paginated result with Convex's split hints.
struct PageResult: Decodable, Sendable {
    let page: CardSummaryPage
    let splitCursor: String?
    let pageStatus: String?

    enum CodingKeys: String, CodingKey { case splitCursor, pageStatus }

    init(from decoder: any Decoder) throws {
        page = try CardSummaryPage(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        splitCursor = try container.decodeIfPresent(String.self, forKey: .splitCursor)
        pageStatus = try container.decodeIfPresent(String.self, forKey: .pageStatus)
    }
}
