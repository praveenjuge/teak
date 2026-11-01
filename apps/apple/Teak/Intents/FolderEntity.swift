import AppIntents
import TeakCore

struct FolderEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(
        name: LocalizedStringResource("intents.folderEntity", table: "AppIntents"))
    static let defaultQuery = FolderEntityQuery()

    let id: String
    let name: String
    let isSmart: Bool
    let cardCount: Int

    init(_ folder: Folder) {
        id = folder.id
        name = folder.name
        isSmart = folder.isSmart
        cardCount = Int(folder.activeCardCount)
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(tr("native.common.cardCount", count: cardCount))",
                              image: .init(systemName: isSmart ? "folder.badge.gearshape" : "folder"))
    }
}

struct FolderEntityQuery: EntityStringQuery {
    /// Every folder, smart ones too, so a shortcut can show any folder it holds.
    func entities(for identifiers: [FolderEntity.ID]) async throws -> [FolderEntity] {
        try await folders().filter { identifiers.contains($0.id) }.map(FolderEntity.init)
    }

    func entities(matching string: String) async throws -> [FolderEntity] {
        let text = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await folders()
            .filter { !$0.isSmart && (text.isEmpty || $0.name.localizedStandardContains(text)) }
            .map(FolderEntity.init)
    }

    func suggestedEntities() async throws -> [FolderEntity] {
        try await folders().filter { !$0.isSmart }.map(FolderEntity.init)
    }

    private func folders() async throws -> [Folder] {
        try await IntentSession.http().query(ConvexFunctions.listFolders)
    }
}

struct AddToFolderIntent: AppIntent {
    static let title = LocalizedStringResource("intents.addToFolderTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("intents.addToFolderDescription", table: "AppIntents"))

    @Parameter(title: LocalizedStringResource("intents.cardsParameter", table: "AppIntents"))
    var cards: [CardEntity]

    @Parameter(title: LocalizedStringResource("intents.folderParameter", table: "AppIntents"))
    var folder: FolderEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$cards) to \(\.$folder)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let http = try await IntentSession.http()
        guard !folder.isSmart else { throw TeakError(message: tr("apple.intents.smartFolderMessage")) }
        var seen = Set<String>()
        let ids = cards.map(\.id).filter { seen.insert($0).inserted }
        var updated = 0
        var failed = 0
        for chunk in BulkCardAction.chunks(ids) {
            let result = try await http.mutation(ConvexFunctions.addCardsToFolder, [
                "folderId": .string(folder.id), "cardIds": .array(chunk.map(ConvexValue.string)),
            ])
            updated += result.updatedIds.count
            failed += result.failedIds.count
        }
        let message = BulkCardAction.addToFolder.message(updated: updated, failed: failed, folder: folder.name)
        guard updated > 0 else { throw TeakError(message: message) }
        return .result(dialog: IntentDialog(stringLiteral: message))
    }
}
