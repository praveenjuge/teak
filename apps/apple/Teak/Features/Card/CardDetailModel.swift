import Foundation
import Observation
import TeakCore
import TeakSync

@MainActor @Observable
final class CardDetailModel {
    let id: String
    private(set) var card: Card?
    private(set) var isLoading = true
    private(set) var favoriteOverride: Bool?
    private(set) var doneOverride: Bool?
    private(set) var isSaving = false
    private(set) var isRefreshing = false
    /// Live titles for the `[[…|teak:id]]` pills in a note, by id.
    private(set) var linkTargets: [String: CardLinkTarget] = [:]
    private(set) var backlinks: CardBacklinks?
    var message: String?
    /// A short confirmation, like "Marked as read".
    var notice: String?

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var linksTask: Task<Void, Never>?
    @ObservationIgnored private var backlinksTask: Task<Void, Never>?
    @ObservationIgnored private var linkIds: [String] = []
    @ObservationIgnored private var noticeTask: Task<Void, Never>?

    init(id: String, backend: TeakBackend) {
        self.id = id
        self.backend = backend
    }

    func start() {
        guard task == nil else { return }
        task = Task {
            while !Task.isCancelled {
                do {
                    for try await value in backend.subscribe(ConvexFunctions.getCard, ["id": .string(id)]) {
                        card = value
                        isLoading = false
                        if favoriteOverride == value?.isFavorited { favoriteOverride = nil }
                        if doneOverride == value?.isDone { doneOverride = nil }
                        watchLinks(value)
                    }
                    return
                } catch {
                    isLoading = false
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        linksTask?.cancel()
        linksTask = nil
        backlinksTask?.cancel()
        backlinksTask = nil
        linkIds = []
    }

    var isFavorited: Bool { favoriteOverride ?? card?.favorited ?? false }
    var isDone: Bool { doneOverride ?? card?.isDone ?? false }

    /// One live lookup for the note's pills, redone only when its links change,
    /// and one for the notes that link here.
    private func watchLinks(_ card: Card?) {
        if backlinksTask == nil, card != nil {
            backlinksTask = Task {
                do {
                    for try await value in backend.subscribe(ConvexFunctions.getCardBacklinks, ["cardId": .string(id)]) {
                        backlinks = value
                    }
                } catch {}
            }
        }
        let ids = card?.type == .text ? CardLinks.parseIds(card?.content) : []
        guard ids != linkIds else { return }
        linkIds = ids
        linksTask?.cancel()
        guard !ids.isEmpty else { return linkTargets = [:] }
        linksTask = Task {
            do {
                for try await targets in backend.subscribe(ConvexFunctions.getCardLinkTargets,
                                                           ["cardIds": .array(ids.map(ConvexValue.string))]) {
                    linkTargets = Dictionary(targets.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                }
            } catch {}
        }
    }

    func show(_ text: String) {
        noticeTask?.cancel()
        notice = text
        noticeTask = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled { notice = nil }
        }
    }

    /// Marks a link done (or not) right away and undoes it if the save fails.
    func toggleDone() async -> Bool {
        let next = !isDone
        doneOverride = next
        message = nil
        do {
            try await update(["field": next ? "done" : "undone"])
            show(LinkDone.toast(card?.linkCategoryName, done: next))
            return true
        } catch {
            doneOverride = !next
            message = tr("native.card.failed.update")
            return false
        }
    }

    func setArchived(_ archived: Bool) async -> Bool {
        await perform(archived ? tr("native.card.failed.archive") : tr("native.card.failed.unarchive")) {
            try await self.update(["field": archived ? "archive" : "unarchive"])
        }
    }

    func refreshDetails() async {
        isRefreshing = true
        defer { isRefreshing = false }
        message = nil
        do {
            let result = try await backend.mutation(ConvexFunctions.reprocessCard, ["cardId": .string(id)])
            if result.isQueued {
                show(tr("native.card.notice.refreshing"))
            } else {
                message = result.message ?? tr("native.card.failed.refresh")
            }
        } catch {
            message = tr("native.card.failed.refresh")
        }
    }

    private func update(_ args: ConvexArgs) async throws {
        let _: ConvexVoid = try await backend.mutation(ConvexFunctions.updateCardField, args.merging(["cardId": .string(id)]) { $1 })
    }

    func toggleFavorite() async -> Bool {
        let next = !isFavorited
        favoriteOverride = next
        do {
            try await update(["field": "isFavorited", "value": .bool(next)])
            return true
        } catch {
            favoriteOverride = !next
            message = tr("native.card.failed.favorite")
            return false
        }
    }

    func moveToTrash() async -> Bool {
        await perform(tr("native.card.failed.moveToTrash")) { try await self.update(["field": "delete"]) }
    }

    func restore() async -> Bool {
        await perform(tr("native.card.failed.restore")) { try await self.update(["field": "restore"]) }
    }

    func deleteForever() async -> Bool {
        await perform(tr("native.card.failed.delete")) {
            let _: ConvexVoid = try await self.backend.mutation(ConvexFunctions.permanentDeleteCard, ["id": .string(self.id)])
        }
    }

    func save(_ changes: [CardFieldChange]) async throws {
        isSaving = true
        defer { isSaving = false }
        for change in changes {
            let _: ConvexVoid = try await backend.mutation(ConvexFunctions.updateCardField, change.args(cardId: id))
        }
    }

    private func perform(_ failure: String, _ operation: () async throws -> Void) async -> Bool {
        message = nil
        do {
            try await operation()
            return true
        } catch {
            message = (error as? TeakError)?.message ?? failure
            return false
        }
    }
}
