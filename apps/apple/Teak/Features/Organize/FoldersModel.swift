import Foundation
import Observation
import TeakCore
import TeakSync

/// The signed-in user's folders and smart folders, kept live.
@MainActor @Observable
final class FoldersModel {
    private(set) var folders: [Folder] = []
    private(set) var isLoaded = false

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var task: Task<Void, Never>?

    init(backend: TeakBackend) {
        self.backend = backend
    }

    var manual: [Folder] { folders.filter { !$0.isSmart } }

    func start() {
        guard task == nil else { return }
        task = Task {
            while !Task.isCancelled {
                do {
                    for try await value in backend.subscribe(ConvexFunctions.listFolders) {
                        folders = value
                        isLoaded = true
                    }
                } catch {
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
    }

    func folder(_ id: String) -> Folder? { folders.first { $0.id == id } }

    func create(name: String, smartQuery: String? = nil) async throws -> Folder {
        var args: ConvexArgs = ["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))]
        if let smartQuery {
            args["kind"] = "smart"
            args["query"] = .string(smartQuery)
        }
        return try await backend.mutation(ConvexFunctions.createFolder, args)
    }

    func rename(_ folder: Folder, to name: String) async throws {
        let _: Folder = try await backend.mutation(ConvexFunctions.updateFolder, [
            "folderId": .string(folder.id), "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
        ])
    }

    /// Renames a smart folder and changes its search together, as the web's and Android's folder dialog do.
    func update(_ folder: Folder, name: String, query: String) async throws -> Folder {
        try await backend.mutation(ConvexFunctions.updateFolder, [
            "folderId": .string(folder.id),
            "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "query": .string(query.trimmingCharacters(in: .whitespacesAndNewlines)),
        ])
    }

    func delete(_ folder: Folder) async throws {
        let _: String = try await backend.mutation(ConvexFunctions.deleteFolder, ["folderId": .string(folder.id)])
    }

    func restore(_ folder: Folder) async throws {
        let _: Folder = try await backend.mutation(ConvexFunctions.restoreFolder, ["folderId": .string(folder.id)])
    }

    func setFolders(cardId: String, folderIds: [String]) async throws {
        let _: [String] = try await backend.mutation(ConvexFunctions.setCardFolders, [
            "cardId": .string(cardId), "folderIds": .array(folderIds.map(ConvexValue.string)),
        ])
    }
}
