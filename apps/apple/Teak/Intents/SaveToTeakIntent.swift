import AppIntents
import TeakCore

struct SaveToTeakIntent: AppIntent {
    static let title: LocalizedStringResource = "Save to Teak"
    static let description = IntentDescription("Saves text or a link to your Teak library.")

    @Parameter(title: "Text or Link", inputOptions: String.IntentInputOptions(multiline: true))
    var content: String

    static var parameterSummary: some ParameterSummary {
        Summary("Save \(\.$content) to Teak")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw TeakError(message: "The shortcut didn't send any text or link.")
        }
        let session = TeakServices.session()
        guard try await session.restore() != nil else {
            throw TeakError(message: "Open Teak and sign in, then run the shortcut again.")
        }
        let _: String = try await TeakServices.http(session: session)
            .mutation(ConvexFunctions.createCard, LinkDetection.resolve(content).createArgs)
        return .result(dialog: "Saved to Teak")
    }
}

struct TeakShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SaveToTeakIntent(), phrases: ["Save to \(.applicationName)"],
                    shortTitle: "Save to Teak", systemImageName: "square.and.arrow.down")
    }
}
