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
    private(set) var contentOverride: String?
    private(set) var tagsOverride: [String]?
    private(set) var isSaving = false
    private(set) var isRefreshing = false
    private(set) var linkTargets: [String: CardLinkTarget] = [:]
    private(set) var backlinks: CardBacklinks?
    var message: String?
    private(set) var notice: LibraryModel.StatusMessage?

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private let spotlight: SpotlightIndexer?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var linksTask: Task<Void, Never>?
    @ObservationIgnored private var backlinksTask: Task<Void, Never>?
    @ObservationIgnored private var linkIds: [String] = []
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    @ObservationIgnored private var taskSaves = 0
    @ObservationIgnored private var keepSaves = 0

    init(id: String, backend: TeakBackend, spotlight: SpotlightIndexer? = nil) {
        self.id = id
        self.backend = backend
        self.spotlight = spotlight
    }

    func start() {
        guard task == nil else { return }
        task = Task {
            var failures = 0
            while !Task.isCancelled {
                do {
                    for try await value in backend.subscribe(ConvexFunctions.getCard, ["id": .string(id)]) {
                        card = value
                        isLoading = false
                        if favoriteOverride == value?.isFavorited { favoriteOverride = nil }
                        if doneOverride == value?.isDone { doneOverride = nil }
                        if contentOverride != nil, value?.content == contentOverride || taskSaves == 0 { contentOverride = nil }
                        if tagsOverride != nil, value?.tags == tagsOverride || keepSaves == 0 { tagsOverride = nil }
                        watchLinks(value)
                        if let value { spotlight?.follow(value) } else { spotlight?.forget(id) }
                    }
                    return
                } catch {
                    failures += 1
                    if card != nil || failures >= 3 { isLoading = false }
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

    var displayedCard: Card? {
        guard var card else { return nil }
        if let contentOverride { card.content = contentOverride }
        if let tagsOverride { card.tags = tagsOverride }
        return card
    }

    func toggleTask(_ item: MarkdownListItem) async {
        guard let card = displayedCard, card.type == .text, !card.deleted,
              let next = TaskLists.toggle(card.content, item: item) else { return }
        contentOverride = next
        message = nil
        taskSaves += 1
        defer { taskSaves -= 1 }
        do {
            try await update(["field": "content", "value": .string(next)])
            if taskSaves == 1, self.card?.content == contentOverride { contentOverride = nil }
        } catch {
            contentOverride = nil
            message = tr("native.notes.taskFailed")
        }
    }

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

    func show(_ text: String, undo: (@MainActor () -> Void)? = nil) {
        noticeTask?.cancel()
        notice = LibraryModel.StatusMessage(text: text, isError: false, isCardLimit: false, undo: undo)
        noticeTask = Task {
            // An Undo stays 10 seconds, as in the library.
            try? await Task.sleep(for: .seconds(undo == nil ? 3 : 10))
            if !Task.isCancelled { notice = nil }
        }
    }

    private func dismissNotice() {
        noticeTask?.cancel()
        notice = nil
    }

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
        await perform(tr("native.card.failed.moveToTrash")) { try await self.write(.moveToTrash) }
    }

    func restore() async -> Bool {
        await perform(tr("native.card.failed.restore")) { try await self.write(.restore) }
    }

    private func write(_ change: CardFieldChange) async throws {
        let _: ConvexVoid = try await backend.mutation(ConvexFunctions.updateCardField, change.args(cardId: id))
    }

    func saveTitle(_ input: String) async {
        guard let card, let change = CardEdit.titleChange(input, current: CardSheet.linkTitle(card)) else { return }
        message = nil
        do {
            try await write(change)
        } catch {
            message = (error as? TeakError)?.message ?? tr("native.card.failed.title")
        }
    }

    func saveLink(_ input: String) async -> String? {
        if let invalid = LinkEdit.validationError(input) { return invalid }
        guard let change = LinkEdit.change(input, current: card?.url) else { return nil }
        do {
            try await write(change)
            show(tr("native.card.editLink.saved"))
            return nil
        } catch {
            return (error as? TeakError)?.message ?? tr("native.card.failed.editLink")
        }
    }

    /// Keeps a tag Teak suggested as one of the card's own. Quick Keeps build on each other before the card catches up.
    func keepTag(_ tag: String) async {
        guard let change = CardEdit.keeping(tag, tags: tagsOverride ?? card?.tags ?? []),
              case let .tags(tags) = change else { return }
        tagsOverride = tags
        message = nil
        keepSaves += 1
        defer { keepSaves -= 1 }
        do {
            try await write(change)
            if keepSaves == 1, card?.tags == tagsOverride { tagsOverride = nil }
        } catch {
            tagsOverride = nil
            message = tr("native.card.failed.update")
        }
    }

    func removeSuggestedTag(_ tag: String) async {
        message = nil
        do {
            try await write(.removeAiTag(tag))
        } catch {
            message = tr("native.card.failed.update")
        }
    }

    func addColor(_ hex: String) async -> Bool {
        message = nil
        do {
            try await write(.addColor(hex))
            show(tr("native.card.palette.added", hex))
            return true
        } catch {
            message = tr("native.card.palette.saveFailed")
            return false
        }
    }

    func removeColor(_ stored: String) async -> Bool {
        guard let hex = PaletteEdit.storedHex(stored) else { return false }
        message = nil
        do {
            try await write(.removeColor(hex))
            show(tr("native.card.palette.removed", hex)) { [weak self] in
                Task { await self?.undoRemoveColor(stored.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()) }
            }
            return true
        } catch {
            message = tr("native.card.palette.saveFailed")
            return false
        }
    }

    private func undoRemoveColor(_ hex: String) async {
        dismissNotice()
        do {
            try await write(.addColor(hex))
        } catch {
            message = tr("native.card.palette.saveFailed")
        }
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
