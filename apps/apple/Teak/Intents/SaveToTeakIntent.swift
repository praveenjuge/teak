import AppIntents
import TeakCore

// The system reads an intent's title, description and parameter names from the
// `AppIntents` string table in the app's bundle (generated from packages/i18n), in
// the system's language. What `perform()` says comes from `tr`, in Teak's language.
struct SaveToTeakIntent: AppIntent {
    static let title = LocalizedStringResource("intents.saveTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("intents.saveDescription", table: "AppIntents"))

    @Parameter(title: LocalizedStringResource("intents.contentParameter", table: "AppIntents"),
               inputOptions: String.IntentInputOptions(multiline: true))
    var content: String

    static var parameterSummary: some ParameterSummary {
        Summary("Save \(\.$content) to Teak")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw TeakError(message: tr("native.app.saveRequest.emptyMessage"))
        }
        let _: String = try await IntentSession.http()
            .mutation(ConvexFunctions.createCard, LinkDetection.resolve(content).createArgs)
        return .result(dialog: IntentDialog(stringLiteral: tr("native.capture.savedToTeak")))
    }
}
