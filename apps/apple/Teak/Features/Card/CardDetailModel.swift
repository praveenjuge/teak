import Foundation
import Observation
import TeakCore
import TeakSync

/// One card, live, with the detail page's actions.
@MainActor @Observable
final class CardDetailModel {
    let id: String
    private(set) var card: Card?
    private(set) var isLoading = true
    private(set) var favoriteOverride: Bool?
    private(set) var isSaving = false
    var message: String?

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var task: Task<Void, Never>?

    init(id: String, backend: TeakBackend) {
        self.id = id
        self.backend = backend
    }

    func start() {
        guard task == nil else { return }
        task = Task {
            while !Task.isCancelled {
                do {
                    for try await value in backend.subscribe("cards:getCard", ["id": .string(id)], as: Card?.self) {
                        card = value
                        isLoading = false
                        if favoriteOverride == value?.isFavorited { favoriteOverride = nil }
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
    }

    var isFavorited: Bool { favoriteOverride ?? card?.favorited ?? false }

    private func update(_ args: ConvexArgs) async throws {
        let _: ConvexVoid = try await backend.mutation("cards:updateCardField", args.merging(["cardId": .string(id)]) { $1 })
    }

    func toggleFavorite() async -> Bool {
        let next = !isFavorited
        favoriteOverride = next
        do {
            try await update(["field": "isFavorited", "value": .bool(next)])
            return true
        } catch {
            favoriteOverride = !next
            message = "Couldn't update this favorite."
            return false
        }
    }

    func moveToTrash() async -> Bool {
        await perform("Couldn't delete this card.") { try await self.update(["field": "delete"]) }
    }

    func restore() async -> Bool {
        await perform("Couldn't restore this card.") { try await self.update(["field": "restore"]) }
    }

    func deleteForever() async -> Bool {
        await perform("Couldn't delete this card.") {
            let _: ConvexVoid = try await self.backend.mutation("cards:permanentDeleteCard", ["id": .string(self.id)])
        }
    }

    /// Saves edits one field at a time, in order, sending only what changed.
    func save(_ changes: [CardFieldChange]) async throws {
        isSaving = true
        defer { isSaving = false }
        for change in changes {
            let _: ConvexVoid = try await backend.mutation("cards:updateCardField", change.args(cardId: id))
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
