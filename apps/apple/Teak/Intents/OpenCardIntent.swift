import AppIntents
import TeakCore

/// Opens a card in Teak. Spotlight runs this when you pick a card there.
struct OpenCardIntent: OpenIntent {
    static let title = LocalizedStringResource("apple.intents.openCardTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("apple.intents.openCardDescription", table: "AppIntents"))

    @Parameter(title: LocalizedStringResource("apple.intents.cardParameter", table: "AppIntents"))
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
