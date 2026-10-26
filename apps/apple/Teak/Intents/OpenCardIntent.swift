import AppIntents
import TeakCore

/// Opens a card in Teak. Spotlight runs this when you pick a card there.
struct OpenCardIntent: OpenIntent {
    static let title = LocalizedStringResource("intents.openCardTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("intents.openCardDescription", table: "AppIntents"))

    @Parameter(title: LocalizedStringResource("intents.cardParameter", table: "AppIntents"))
    var target: CardEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$target)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        try await openInTeak(.card(target.id))
        return .result()
    }
}
