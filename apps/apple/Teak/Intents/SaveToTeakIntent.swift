import AppIntents
import TeakCore

// The system reads an intent's title, description and parameter names from the
// `AppIntents` string table in the app's bundle (generated from packages/i18n), in
// the system's language. What `perform()` says comes from `tr`, in Teak's language.
struct SaveToTeakIntent: AppIntent {
    static let title = LocalizedStringResource("apple.intents.saveTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("apple.intents.saveDescription", table: "AppIntents"))

    @Parameter(title: LocalizedStringResource("apple.intents.contentParameter", table: "AppIntents"),
               inputOptions: String.IntentInputOptions(multiline: true))
    var content: String

    static var parameterSummary: some ParameterSummary {
        Summary("Save \(\.$content) to Teak")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw TeakError(message: tr("apple.intents.noText"))
        }
        let session = TeakServices.session()
        guard try await session.restore() != nil else {
            throw TeakError(message: tr("apple.intents.signInFirst"))
        }
        let _: String = try await TeakServices.http(session: session)
            .mutation(ConvexFunctions.createCard, LinkDetection.resolve(content).createArgs)
        return .result(dialog: IntentDialog(stringLiteral: tr("apple.intents.saved")))
    }
}

struct TeakShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SaveToTeakIntent(), phrases: ["Save to \(.applicationName)"],
                    shortTitle: LocalizedStringResource("apple.intents.saveTitle", table: "AppIntents"),
                    systemImageName: "square.and.arrow.down")
    }
}
